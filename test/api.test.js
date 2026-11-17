'use strict';
// Prueba de extremo a extremo con un Postgres real (temporal) y un WAHA falso (para los mensajes de WhatsApp).
const assert = require('assert');
const http = require('http');
const { startTestDb } = require('./helpers/postgres');

process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN1_USER = 'sebasraigoza';
process.env.ADMIN1_PASS = 'TestPass123!';
process.env.ADMIN2_USER = 'ruiz';
process.env.ADMIN2_PASS = 'ruiz';
process.env.MIN_LEAD_MINUTES = '0';
process.env.DB_POOL_MAX = '8';
process.env.BOOK_LIMIT_PER_HOUR = '1000';
process.env.REMINDER_PAUSE_MS = '0';
process.env.PUBLIC_URL = 'https://barberia.test';

const S = require('../src/schedule');
// Ancla: lunes de esta semana (hora Colombia) => ventana = esta semana + la siguiente
const today = S.nowParts().date;
const dow = S.dayOfWeek(today);
process.env.BOOKING_ANCHOR = S.addDays(today, -((dow + 6) % 7));

let pgdb, waha, server, repo;
const sent = [];              // mensajes que recibió el WAHA falso
let wahaStatus = 'WORKING';   // estado de la sesión de WhatsApp del WAHA falso

async function startWaha() {
  waha = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/sendText' && req.method === 'POST') {
        const m = JSON.parse(body); m.apiKey = req.headers['x-api-key']; sent.push(m);
        return res.end(JSON.stringify({ id: { _serialized: 'false_x@c.us_ABC' } }));
      }
      if (req.url === '/api/sessions/default') return res.end(JSON.stringify({ name: 'default', status: wahaStatus }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => waha.listen(0, '127.0.0.1', r));
  process.env.WHATSAPP_ENABLED = 'true';
  process.env.WAHA_URL = `http://127.0.0.1:${waha.address().port}`;
  process.env.WAHA_API_KEY = 'clave-de-prueba';
}

async function finish() {
  await new Promise((r) => server.close(r));
  await repo.close();
  await new Promise((r) => waha.close(r));
  await pgdb.stop();
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

async function runTests() {
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
    assert.strictEqual(r.json.whatsappSent, true);
    assert.match(r.json.manageUrl, /^https:\/\/barberia\.test\/cita\/[\w-]{32}$/);
    const token = r.json.manageUrl.split('/cita/')[1];
    {
      const m = sent[sent.length - 1];
      assert.strictEqual(m.chatId, '573151234567@c.us', 'el número colombiano va con 57');
      assert.strictEqual(m.session, 'default');
      assert.strictEqual(m.apiKey, 'clave-de-prueba');
      assert.ok(m.text.includes(r.json.manageUrl), 'el mensaje trae el link de la cita');
      assert.ok(m.text.includes('quedó confirmada') && m.text.includes('Hola Nuevo'), m.text);
    }
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
      assert.strictEqual(r.json.whatsappSent, true);
      assert.ok(sent[sent.length - 1].text.includes('fue cambiada'));
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

    // Servicio de 2 horas (VIP 1, 1 h 30): ocupa la hora elegida y la siguiente
    r = await call('GET', '/api/config');
    assert.strictEqual(r.json.services.find((x) => x.id === 'vip-1').slots, 2);
    assert.strictEqual(r.json.services.find((x) => x.id === 'corte-premium').slots, 1);
    let vipDay = null; let vipTime = null;
    for (const d of cal.days.filter((x) => x.open)) {
      const sl = (await call('GET', `/api/slots?date=${d.date}&service=vip-1`)).json.slots;
      const ok = sl.find((x) => x.available);
      if (ok) { vipDay = d.date; vipTime = ok.time; break; }
    }
    if (vipDay) {
      r = await call('POST', '/api/appointments', { name: 'Cliente Vip', phone: '3187776655', date: vipDay, time: vipTime, service: 'vip-1' });
      assert.strictEqual(r.status, 201, JSON.stringify(r.json));
      assert.strictEqual(r.json.slots, 2);
      const next = S.toTime(S.toMin(vipTime) + 60);
      const after = (await call('GET', `/api/slots?date=${vipDay}`)).json.slots;
      assert.strictEqual(after.find((x) => x.time === vipTime).available, false);
      assert.strictEqual(after.find((x) => x.time === next).available, false, 'la segunda hora también queda ocupada');
    }

    // Turnos fijos: la web los ve como BLOQUEADA ('fixed'); el admin ve nombre y celular
    r = await call('GET', '/api/admin/fixed', null, { auth: true });
    assert.ok(r.json.fixed.some((f) => f.name === 'Andreus' && f.dow === 5 && f.time === '10:00'), 'turnos iniciales cargados');
    const fxDay = cal.days.find((d) => d.open && (d.dow === 1 || d.dow === 2 || d.dow === 3)
      && S.computeSlots(d.date, { minLeadMin: 0 }).find((x) => x.time === '19:00').available);
    if (fxDay) {
      const fxDate = fxDay.date;
      const before = (await call('GET', `/api/slots?date=${fxDate}`)).json.slots.find((x) => x.time === '19:00');
      if (before.available) {
        r = await call('POST', '/api/admin/fixed', { dow: fxDay.dow, time: '19:00', name: 'Cliente Fijo', phone: '3001231234', every: 1, start_date: fxDate }, { auth: true });
        assert.strictEqual(r.status, 201, JSON.stringify(r.json));
        const fxId = r.json.fixed.id;
        let sl = (await call('GET', `/api/slots?date=${fxDate}`)).json.slots.find((x) => x.time === '19:00');
        assert.strictEqual(sl.available, false);
        assert.strictEqual(sl.reason, 'fixed');
        r = await call('POST', '/api/appointments', { name: 'Intruso', phone: '3009990000', date: fxDate, time: '19:00', service: 'corte-premium' });
        assert.strictEqual(r.status, 409, 'no se puede reservar encima de un turno fijo');
        r = await call('POST', '/api/admin/appointments', { name: 'Intruso', phone: '3009990000', date: fxDate, time: '19:00' }, { auth: true });
        assert.strictEqual(r.status, 409, 'el admin tampoco, sin liberarlo antes');
        // calendario del admin: trae el nombre
        r = await call('GET', `/api/admin/agenda?from=${fxDate}&to=${fxDate}`, null, { auth: true });
        assert.ok(r.json.days[0].fixed.some((f) => f.name === 'Cliente Fijo' && f.phone === '573001231234' && !f.skipped));
        // liberar solo ese día => la hora queda libre; volver a bloquear => ocupada
        assert.strictEqual((await call('PUT', `/api/admin/fixed/${fxId}/skips/${fxDate}`, null, { auth: true })).status, 200);
        sl = (await call('GET', `/api/slots?date=${fxDate}`)).json.slots.find((x) => x.time === '19:00');
        assert.strictEqual(sl.available, true);
        assert.strictEqual((await call('DELETE', `/api/admin/fixed/${fxId}/skips/${fxDate}`, null, { auth: true })).status, 200);
        sl = (await call('GET', `/api/slots?date=${fxDate}`)).json.slots.find((x) => x.time === '19:00');
        assert.strictEqual(sl.reason, 'fixed');
        // cada 2 semanas: la semana siguiente no aplica
        r = await call('PATCH', `/api/admin/fixed/${fxId}`, { dow: fxDay.dow, time: '19:00', name: 'Cliente Fijo', every: 2, start_date: S.addDays(fxDate, -7) }, { auth: true });
        assert.strictEqual(r.status, 200, JSON.stringify(r.json));
        sl = (await call('GET', `/api/slots?date=${fxDate}`)).json.slots.find((x) => x.time === '19:00');
        assert.strictEqual(sl.available, true, 'cada 2 semanas: esta semana no le toca');
        // fecha de otro día de la semana => error
        r = await call('POST', '/api/admin/fixed', { dow: fxDay.dow, time: '19:00', name: 'Malo', every: 1, start_date: S.addDays(fxDate, 1) }, { auth: true });
        assert.strictEqual(r.status, 400);
        assert.strictEqual((await call('DELETE', `/api/admin/fixed/${fxId}`, null, { auth: true })).status, 200);
      }
    }

    // Recordatorio por WhatsApp 1 hora antes (WAHA)
    const cfgm = require('../src/config');
    const rem = require('../src/reminders');
    const remDay = S.addDays(today, 5);
    const remPhone = '573201112222';
    const remAppt = await repo.insertAppointment({ name: 'Laura Gómez', phone: remPhone, date: remDay, time: '15:30', service: 'Corte premium · $24.000' });
    const remStart = S.startMs(remDay, '15:30');
    const forLaura = () => sent.filter((m) => m.chatId === `${remPhone}@c.us`);
    await rem.tick(remStart - 90 * 60000);
    assert.strictEqual(forLaura().length, 0, 'faltan 90 min: todavía no');
    wahaStatus = 'SCAN_QR_CODE';
    await rem.tick(remStart - 50 * 60000);
    assert.strictEqual(forLaura().length, 0, 'WhatsApp sin vincular: no se manda ni se gastan intentos');
    assert.strictEqual((await repo.getAppointment(remAppt.id)).reminder_attempts, 0);
    wahaStatus = 'WORKING';
    await rem.tick(remStart - 50 * 60000);
    assert.strictEqual(forLaura().length, 1, 'a 50 min de la cita se manda el recordatorio');
    assert.ok(forLaura()[0].text.includes('3:30 p. m.') && forLaura()[0].text.includes('Hola Laura'), forLaura()[0].text);
    assert.ok(forLaura()[0].text.includes(`https://barberia.test/cita/${remAppt.manage_token}`), 'con el link para cambiarla');
    await rem.tick(remStart - 40 * 60000);
    assert.strictEqual(forLaura().length, 1, 'no se repite');
    assert.strictEqual((await repo.getAppointment(remAppt.id)).reminder_sent, true);
    // reprogramada: se vuelve a avisar
    await repo.updateAppointment(remAppt.id, { time: '16:30', resetReminder: true });
    await rem.tick(S.startMs(remDay, '16:30') - 30 * 60000);
    assert.strictEqual(forLaura().length, 2);
    assert.ok(forLaura()[1].text.includes('4:30 p. m.'));
    // cita agendada hace pocos minutos para dentro de 50 min: no se manda el recordatorio (acaba de recibir la confirmación)
    const soon = new Date(Date.now() + 50 * 60000 - 5 * 3600000).toISOString();
    const soonAppt = await repo.insertAppointment({ name: 'Pedro Reciente', phone: '573004445555', date: soon.slice(0, 10), time: soon.slice(11, 16), service: 'x' });
    await rem.tick(Date.now());
    assert.strictEqual(sent.filter((m) => m.chatId === '573004445555@c.us').length, 0, 'recién agendada: sin recordatorio');
    cfgm.waha.skipIfBookedWithinMin = 0;
    await rem.tick(Date.now());
    assert.strictEqual(sent.filter((m) => m.chatId === '573004445555@c.us').length, 1, 'con la regla apagada sí se manda');
    cfgm.waha.skipIfBookedWithinMin = 90;
    await repo.deleteAppointment(soonAppt.id);
    await repo.deleteAppointment(remAppt.id);
    // turno fijo con celular: recordatorio una vez por fecha
    const fx = await repo.addFixed({ dow: S.dayOfWeek(remDay), time: '17:30', name: 'Don Fijo', phone: '573115556666', every: 1, start_date: remDay });
    const fxStart = S.startMs(remDay, '17:30');
    await rem.tick(fxStart - 30 * 60000);
    await rem.tick(fxStart - 20 * 60000);
    const forFijo = sent.filter((m) => m.chatId === '573115556666@c.us');
    assert.strictEqual(forFijo.length, 1, 'turno fijo: un solo recordatorio');
    assert.ok(forFijo[0].text.includes('Hola Don') && forFijo[0].text.includes('5:30 p. m.') && !forFijo[0].text.includes('/cita/'));
    await repo.deleteFixed(fx.id);

    // Dos reservas de la misma hora al mismo tiempo: solo una gana
    {
      let raceDate = null; let raceTime = null;
      for (const d of cal.days.filter((x) => x.open)) {
        const free = (await call('GET', `/api/slots?date=${d.date}&service=corte-premium`)).json.slots.find((x) => x.available);
        if (free) { raceDate = d.date; raceTime = free.time; break; }
      }
      assert.ok(raceDate, 'no hay una hora libre para probar la carrera');
      const attempt = (n) => call('POST', '/api/appointments', { name: `Carrera ${n}`, phone: `31200000${n}0`, date: raceDate, time: raceTime, service: 'corte-premium' });
      const res = await Promise.all([attempt(1), attempt(2), attempt(3), attempt(4)]);
      assert.strictEqual(res.filter((x) => x.status === 201).length, 1, JSON.stringify(res.map((x) => x.status)));
      assert.strictEqual(res.filter((x) => x.status === 409).length, 3);
    }

    // Limpieza: se borran las citas de hace más de 3 días; las de hace 3 días o menos se conservan
    const old4 = await repo.insertAppointment({ name: 'Vieja', phone: '573000000004', date: S.addDays(today, -4), time: '10:00', service: 'x' });
    const old3 = await repo.insertAppointment({ name: 'Reciente', phone: '573000000003', date: S.addDays(today, -3), time: '10:00', service: 'x' });
    assert.strictEqual(await require('../src/cleanup').purge(today), 1);
    assert.strictEqual(await repo.getAppointment(old4.id), undefined);
    assert.ok(await repo.getAppointment(old3.id));

    // Salud del servidor
    assert.strictEqual((await fetch(base + '/healthz')).status, 200);

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
    await finish();
    process.exitCode = 0;
  } catch (e) {
    console.error('FALLÓ:', e);
    await finish().catch(() => {});
    process.exitCode = 1;
  }
}

(async () => {
  pgdb = await startTestDb();
  process.env.DATABASE_URL = pgdb.url;
  await startWaha();
  const { createApp } = require('../server');
  repo = require('../src/db');
  await repo.init();
  server = createApp().listen(0, () => { runTests(); });
})().catch((e) => { console.error('No se pudo preparar la prueba:', e); process.exit(1); });
