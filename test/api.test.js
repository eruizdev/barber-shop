'use strict';
// Prueba de extremo a extremo con una base de datos temporal.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpDb = path.join(os.tmpdir(), `sb-test-${process.pid}.db`);
process.env.DB_PATH = tmpDb;
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN1_USER = 'sebasraigoza';
process.env.ADMIN1_PASS = 'TestPass123!';
process.env.ADMIN2_USER = 'ruiz';
process.env.ADMIN2_PASS = 'ruiz';
process.env.MIN_LEAD_MINUTES = '0';
process.env.WHATSAPP_ENABLED = 'false'; // nunca enviar mensajes reales en pruebas

const S = require('../src/schedule');
// Ancla: lunes de esta semana (hora Colombia) => ventana = esta semana + la siguiente
const today = S.nowParts().date;
const dow = S.dayOfWeek(today);
process.env.BOOKING_ANCHOR = S.addDays(today, -((dow + 6) % 7));

const { createApp } = require('../server');

// Cierra la base antes de borrarla (en Windows no se puede borrar un archivo abierto)
function cleanup() {
  try { require('../src/db').db.close(); } catch {}
  for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm']) fs.rmSync(f, { force: true });
}

let base, cookie = '';
async function call(method, url, body, { auth = false } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && setCookie.startsWith('sb_admin=')) cookie = setCookie.split(';')[0];
  let json = null;
  try { json = await res.json(); } catch (_) { /* html */ }
  return { status: res.status, json, res };
}

const server = createApp().listen(0, async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    // Calendario
    let r = await call('GET', '/api/calendar');
    assert.strictEqual(r.status, 200);
    const cal = r.json;
    assert.strictEqual(cal.window.nextUnlock, cal.window.end); // se abre el domingo en que termina el bloque
    assert.ok(cal.days.length > 0);
    assert.ok(cal.days.filter((d) => d.dow === 0 && !d.holiday).every((d) => !d.open), 'domingos cerrados');

    // Fuera de ventana
    r = await call('GET', `/api/slots?date=${S.addDays(cal.window.end, 1)}`);
    assert.strictEqual(r.status, 400);

    // Elegir dos días con cupo
    const free = cal.days.filter((d) => d.free >= 2);
    assert.ok(free.length >= 1, 'no hay días con cupo para probar');
    const day = free[0];
    r = await call('GET', `/api/slots?date=${day.date}`);
    const avail = r.json.slots.filter((s) => s.available);
    const t1 = avail[0].time;

    // Validaciones
    r = await call('POST', '/api/appointments', { name: 'A', phone: '300', date: day.date, time: t1, service: 'corte-premium' });
    assert.strictEqual(r.status, 400);
    r = await call('POST', '/api/appointments', { name: 'Carlos Pérez', phone: '12345', date: day.date, time: t1, service: 'corte-premium' });
    assert.strictEqual(r.status, 400);

    // Reserva
    r = await call('POST', '/api/appointments', { name: 'Carlos Pérez', phone: '300 123 4567', date: day.date, time: t1, service: 'corte-premium' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.json));
    assert.match(r.json.code, /^[A-Z2-9]{6}$/);

    // Servicio: obligatorio y válido
    r = await call('POST', '/api/appointments', { name: 'Sin Servicio', phone: '3115556666', date: day.date, time: avail[1].time });
    assert.strictEqual(r.status, 400);
    r = await call('POST', '/api/appointments', { name: 'Servicio Falso', phone: '3115556666', date: day.date, time: avail[1].time, service: 'no-existe' });
    assert.strictEqual(r.status, 400);
    r = await call('GET', '/api/config');
    assert.ok(r.json.services.length >= 8 && r.json.addon.price === 7000);
    assert.ok(!r.json.services.some((x) => x.group === 'Mensualidades'), 'las mensualidades se compran por WhatsApp');

    // Doble reserva misma hora
    r = await call('POST', '/api/appointments', { name: 'Otro', phone: '3109998888', date: day.date, time: t1, service: 'corte-premium' });
    assert.strictEqual(r.status, 409);

    // Hora fuera de horario
    r = await call('POST', '/api/appointments', { name: 'Otro', phone: '3109998888', date: day.date, time: '03:00', service: 'corte-premium' });
    assert.strictEqual(r.status, 400);

    // Admin: sin sesión
    r = await call('GET', '/api/admin/appointments');
    assert.strictEqual(r.status, 401);
    r = await call('POST', '/api/admin/login', { user: 'sebasraigoza', pass: 'mal' });
    assert.strictEqual(r.status, 401);
    r = await call('POST', '/api/admin/login', { user: 'nadie', pass: 'ruiz' });
    assert.strictEqual(r.status, 401);

    // Login ruiz
    r = await call('POST', '/api/admin/login', { user: 'ruiz', pass: 'ruiz' });
    assert.strictEqual(r.status, 200);
    r = await call('GET', '/api/admin/me', null, { auth: true });
    assert.strictEqual(r.json.user, 'ruiz');

    // Login sebasraigoza
    r = await call('POST', '/api/admin/login', { user: 'Sebasraigoza', pass: 'TestPass123!' });
    assert.strictEqual(r.status, 200);

    // Listar
    r = await call('GET', `/api/admin/appointments?from=${day.date}&to=${day.date}`, null, { auth: true });
    assert.strictEqual(r.json.appointments.length, 1);
    const appt = r.json.appointments[0];
    assert.strictEqual(appt.phone, '573001234567');
    assert.strictEqual(appt.service, 'Corte premium · $24.000');

    // Reprogramar a otra hora
    const t2 = avail.find((s) => s.time !== t1 && Math.abs(S.toMin(s.time) - S.toMin(t1)) >= 60).time;
    r = await call('PATCH', `/api/admin/appointments/${appt.id}`, { time: t2 }, { auth: true });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.appointment.time, t2);

    // La hora vieja vuelve a quedar libre y la nueva ocupada
    r = await call('GET', `/api/slots?date=${day.date}`);
    assert.strictEqual(r.json.slots.find((s) => s.time === t1).available, true);
    assert.strictEqual(r.json.slots.find((s) => s.time === t2).available, false);

    // Crear manual en la hora ocupada => 409; en una libre => 201
    r = await call('POST', '/api/admin/appointments', { name: 'Manual', phone: '3201112222', date: day.date, time: t2 }, { auth: true });
    assert.strictEqual(r.status, 409);
    r = await call('POST', '/api/admin/appointments', { name: 'Manual', phone: '3201112222', date: day.date, time: t1 }, { auth: true });
    assert.strictEqual(r.status, 201);
    const manualId = r.json.appointment.id;

    // Cancelar la manual => la hora se libera
    r = await call('PATCH', `/api/admin/appointments/${manualId}`, { status: 'cancelled' }, { auth: true });
    assert.strictEqual(r.json.appointment.status, 'cancelled');
    r = await call('GET', `/api/slots?date=${day.date}`);
    assert.strictEqual(r.json.slots.find((s) => s.time === t1).available, true);

    // Reactivar choca si alguien tomó la hora
    r = await call('POST', '/api/appointments', { name: 'Nuevo', phone: '3151234567', date: day.date, time: t1, service: 'corte-premium' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.whatsappSent, false);
    assert.match(r.json.manageUrl, /\/cita\/[\w-]{32}$/);
    const token = r.json.manageUrl.split('/cita/')[1];
    r = await call('PATCH', `/api/admin/appointments/${manualId}`, { status: 'confirmed' }, { auth: true });
    assert.strictEqual(r.status, 409);

    // Límite por teléfono (2 activas)
    const other = cal.days.filter((d) => d.free >= 1 && d.date !== day.date)[0];
    if (other) {
      const ss = (await call('GET', `/api/slots?date=${other.date}`)).json.slots.filter((s) => s.available);
      const mk = (t) => call('POST', '/api/appointments', { name: 'Nuevo', phone: '3151234567', date: other.date, time: t, service: 'corte-premium' });
      assert.strictEqual((await mk(ss[0].time)).status, 201);
      assert.strictEqual((await mk(ss[ss.length - 1].time)).status, 409); // ya tiene 2
    }

    // Bloqueo de día completo
    const blockDay = cal.days.find((d) => d.date !== day.date && d.open && d.free > 0 && (!other || d.date !== other.date));
    if (blockDay) {
      r = await call('POST', '/api/admin/blocks', { date: blockDay.date, reason: 'Vacaciones' }, { auth: true });
      assert.strictEqual(r.status, 201);
      const blkId = r.json.block.id;
      r = await call('GET', `/api/slots?date=${blockDay.date}`);
      assert.ok(r.json.slots.every((s) => !s.available));
      r = await call('DELETE', `/api/admin/blocks/${blkId}`, null, { auth: true });
      assert.strictEqual(r.status, 200);
    }

    // Cliente: gestionar su cita con el link privado
    assert.strictEqual((await call('GET', '/api/cita/token-que-no-existe')).status, 404);
    r = await call('GET', `/api/cita/${token}`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.appointment.time, t1);
    assert.strictEqual(r.json.appointment.canModify, true);
    assert.strictEqual(r.json.appointment.phone, undefined, 'no expone el celular');
    r = await call('GET', `/api/cita/${token}/slots?date=${day.date}`);
    assert.strictEqual(r.json.current, t1);
    assert.strictEqual(r.json.slots.find((s) => s.time === t1).available, true, 'su propia hora no cuenta como ocupada');
    r = await call('POST', `/api/cita/${token}/reschedule`, { date: day.date, time: t2 }); // ocupada por Carlos
    assert.strictEqual(r.status, 409);
    r = await call('POST', `/api/cita/${token}/reschedule`, { date: S.addDays(cal.window.end, 1), time: t1 });
    assert.strictEqual(r.status, 400);
    const t3 = (await call('GET', `/api/cita/${token}/slots?date=${day.date}`)).json.slots
      .find((s) => s.available && s.time !== t1);
    if (t3) {
      r = await call('POST', `/api/cita/${token}/reschedule`, { date: day.date, time: t3.time });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.appointment.time, t3.time);
      assert.strictEqual(r.json.whatsappSent, false);
      r = await call('GET', `/api/slots?date=${day.date}`);
      assert.strictEqual(r.json.slots.find((s) => s.time === t3.time).available, false);
    }
    const pg = await fetch(`${base}/cita/${token}`);
    assert.strictEqual(pg.status, 200);
    assert.match(pg.headers.get('x-robots-tag') || '', /noindex/);
    assert.ok((await pg.text()).includes('Mi cita'));
    r = await call('POST', `/api/cita/${token}/cancel`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.appointment.status, 'cancelled');
    assert.strictEqual(r.json.appointment.canModify, false);
    assert.strictEqual((await call('POST', `/api/cita/${token}/cancel`)).status, 409);
    assert.strictEqual((await call('POST', `/api/cita/${token}/reschedule`, { date: day.date, time: t1 })).status, 409);

    // Eliminar
    r = await call('DELETE', `/api/admin/appointments/${manualId}`, null, { auth: true });
    assert.strictEqual(r.status, 200);
    r = await call('GET', '/api/admin/audit', null, { auth: true });
    assert.ok(r.json.audit.length >= 5);

    // Origen cruzado bloqueado
    const x = await fetch(base + '/api/admin/logout', { method: 'POST', headers: { Origin: 'https://malo.example', Cookie: cookie } });
    assert.strictEqual(x.status, 403);

    // Páginas
    for (const [p, txt] of [['/', 'RESERVAR CITA'], ['/reservar', 'Reserva'], ['/admin', 'Panel']]) {
      const pr = await fetch(base + p);
      assert.strictEqual(pr.status, 200, p);
      assert.ok((await pr.text()).includes(txt), `${p} debe contener ${txt}`);
    }
    const adm = await fetch(base + '/admin');
    assert.match(adm.headers.get('x-robots-tag') || '', /noindex/);
    assert.strictEqual((await fetch(base + '/admin.html')).status, 404);
    assert.strictEqual((await fetch(base + '/.env')).status, 404);

    console.log('api.test.js OK');
    server.close(); cleanup();
    process.exit(0);
  } catch (e) {
    console.error('FALLÓ:', e);
    server.close(); cleanup();
    process.exit(1);
  }
});
