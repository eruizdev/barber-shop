'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const cfg = require('./src/config');
const repo = require('./src/db');
const auth = require('./src/auth');
const reminders = require('./src/reminders');
const cleanup = require('./src/cleanup');
const notify = require('./src/notify');
const push = require('./src/push');
const { citaRoutes } = require('./src/cita-routes');
const S = require('./src/schedule');
const services = require('./src/services');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

// ---------- validación ----------
function normalizePhone(raw, { lenient = false } = {}) {
  const d = String(raw || '').replace(/\D/g, '');
  if (/^3\d{9}$/.test(d)) return '57' + d;       // celular colombiano
  if (/^573\d{9}$/.test(d)) return d;
  if (lenient && d.length >= 7 && d.length <= 15) return d; // admin: otros números
  return null;
}
const cleanText = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function createApp() {
  const app = express();
  if (cfg.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());

  // Defensa CSRF extra: si llega Origin, debe ser el mismo host.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin) {
      try {
        if (new URL(origin).host !== req.get('host')) throw new Error('x');
      } catch (_) {
        return res.status(403).json({ error: 'Origen no permitido' });
      }
    }
    next();
  });
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api/admin', (req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });

  // Para Docker / monitoreo: responde 200 si el servidor y la base de datos están bien
  app.get('/healthz', async (req, res) => {
    try { await repo.ping(); res.type('text/plain').send('ok'); } catch (e) { res.status(503).type('text/plain').send('db'); }
  });

  // ---------- API pública ----------
  app.get('/api/config', (req, res) => {
    res.json({
      name: cfg.name, whatsapp: cfg.whatsapp, today: S.nowParts().date,
      services: services.SERVICES, addon: services.ADDON,
    });
  });

  // Horas que necesita la reserva: ?service=<id> o ?slots=2 (página de la cita)
  const needFrom = (q) => (q.service ? services.slotsFor(String(q.service)) : (Number(q.slots) === 2 ? 2 : 1));

  app.get('/api/calendar', async (req, res, next) => {
    try {
    const need = needFrom(req.query);
    const now = S.nowParts();
    const w = S.bookingWindow(now.date, cfg.anchor, now.minutes, cfg.openTime);
    const dates = [];
    for (let d = w.firstBookable; d <= w.end; d = S.addDays(d, 1)) dates.push(d);
    const days = await Promise.all(dates.map(async (d) => {
      const info = S.dayInfo(d);
      const [busyTimes, blocks] = await Promise.all([repo.busyFor(d), repo.blocksFor(d)]);
      const slots = S.computeSlots(d, { busyTimes, blocks, minLeadMin: cfg.minLeadMin, need });
      return {
        date: d, dow: info.dow, open: info.open, holiday: info.holiday,
        total: slots.length, free: slots.filter((s) => s.available).length,
      };
    }));
    res.json({
      today: now.date,
      window: { start: w.start, end: w.end, nextUnlock: w.nextUnlock, nextUnlockTime: S.format12(w.nextUnlockTime) },
      days,
    });
    } catch (e) { next(e); }
  });

  function assertInWindow(date) {
    if (!S.isDateStr(date)) throw bad('Fecha no válida');
    const now = S.nowParts();
    const w = S.bookingWindow(now.date, cfg.anchor, now.minutes, cfg.openTime);
    if (date < w.firstBookable || date > w.end) {
      throw new HttpError(400, 'Esa fecha todavía no está habilitada para reservas');
    }
  }

  app.get('/api/slots', async (req, res, next) => {
    try {
      const date = String(req.query.date || '');
      assertInWindow(date);
      const info = S.dayInfo(date);
      const slots = S.computeSlots(date, {
        busyTimes: await repo.busyFor(date), blocks: await repo.blocksFor(date), minLeadMin: cfg.minLeadMin,
        need: needFrom(req.query),
      });
      res.json({ date, open: info.open, holiday: info.holiday, slots });
    } catch (e) { next(e); }
  });

  const bookLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, limit: cfg.bookLimitPerHour, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Demasiados intentos. Intenta más tarde.' },
  });

  // Transacción con bloqueo del día: si dos personas reservan la misma hora a la vez, solo una gana.
  const book = (data) => repo.tx(async () => {
    await repo.lockDay(data.date);
    const slot = S.computeSlots(data.date, {
      busyTimes: await repo.busyFor(data.date), blocks: await repo.blocksFor(data.date), minLeadMin: cfg.minLeadMin,
      need: data.slots,
    }).find((s) => s.time === data.time);
    if (!slot) throw bad('Esa hora no hace parte del horario');
    if (slot.reason === 'short') throw new HttpError(409, 'Este servicio dura 2 horas y no alcanza a esa hora. Elige otra.');
    if (!slot.available) throw new HttpError(409, 'Esa hora ya no está disponible. Elige otra.');
    if ((await repo.countFuturePhone(data.phone, S.nowParts().date)) >= cfg.maxActivePerPhone) {
      throw new HttpError(409, `Ya tienes ${cfg.maxActivePerPhone} citas activas con este número.`);
    }
    return repo.insertAppointment({ ...data, source: 'web' });
  });

  app.post('/api/appointments', bookLimiter, async (req, res, next) => {
    try {
      const b = req.body || {};
      const name = cleanText(b.name, 60);
      const phone = normalizePhone(b.phone);
      const service = services.describeChoice(b.service, b.addon);
      if (name.length < 2) throw bad('Escribe tu nombre');
      if (!phone) throw bad('Escribe un celular colombiano válido (10 dígitos, ej. 300 123 4567)');
      if (!service) throw bad('Elige el tipo de servicio');
      if (!S.isTimeStr(b.time)) throw bad('Hora no válida');
      assertInWindow(b.date);
      const appt = await book({ name, phone, service, slots: services.slotsFor(b.service), date: b.date, time: b.time });
      notify.alertAdmins(appt, 'new', req); // aviso a los admin: push al celular + WhatsApp (no se espera)
      // Confirmación por WhatsApp con el link para ver, cambiar o cancelar la cita
      const whatsappSent = await notify.sendConfirmation(appt, req);
      res.status(201).json({
        code: appt.code, name: appt.name, phone: appt.phone, service: appt.service, slots: appt.slots, date: appt.date, time: appt.time,
        manageUrl: notify.manageUrl(appt, req), whatsappSent,
      });
    } catch (e) {
      if (e && e.code === '23505') { // choque con el índice único de la base de datos
        return next(new HttpError(409, 'Esa hora ya no está disponible. Elige otra.'));
      }
      next(e);
    }
  });

  // ---------- Admin ----------
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera unos minutos.' },
  });

  app.post('/api/admin/login', loginLimiter, async (req, res, next) => {
    try {
      const user = await auth.verifyLogin(req.body && req.body.user, req.body && req.body.pass);
      if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
      auth.setSession(res, user);
      res.json({ user, today: S.nowParts().date });
    } catch (e) { next(e); }
  });

  app.post('/api/admin/logout', (req, res) => { auth.clearSession(res); res.json({ ok: true }); });

  const admin = express.Router();
  admin.use(auth.requireAdmin);

  admin.get('/me', (req, res) => res.json({ user: req.admin, today: S.nowParts().date }));

  // ---------- Admin: notificaciones push de citas nuevas ----------
  admin.get('/push/key', async (req, res, next) => {
    try { res.json({ publicKey: await push.publicKey() }); } catch (e) { next(e); }
  });
  admin.post('/push/subscribe', async (req, res, next) => {
    try {
      if (!await push.subscribe(req.body && req.body.subscription, req.admin)) throw bad('Suscripción no válida');
      res.status(201).json({ ok: true });
    } catch (e) { next(e); }
  });
  admin.post('/push/unsubscribe', async (req, res, next) => {
    try { await push.unsubscribe(req.body && req.body.endpoint); res.json({ ok: true }); } catch (e) { next(e); }
  });
  admin.post('/push/test', async (req, res, next) => {
    try {
      const sent = await push.sendAll({ title: '🔔 Notificaciones activas', body: 'Así te llegará el aviso cada vez que entre una cita.', tag: 'prueba', url: '/admin/' });
      res.json({ sent });
    } catch (e) { next(e); }
  });

  admin.get('/appointments', async (req, res, next) => {
    try {
      const { from, to, status, q } = req.query;
      if (from && !S.isDateStr(from)) throw bad('Fecha "desde" no válida');
      if (to && !S.isDateStr(to)) throw bad('Fecha "hasta" no válida');
      res.json({
        appointments: await repo.listAppointments({
          from, to, status: status || 'all', q: cleanText(q, 60),
        }),
      });
    } catch (e) { next(e); }
  });

  // Horas estándar de un día (para sugerir al reprogramar). No aplica ventana de 2 semanas.
  admin.get('/slots', async (req, res, next) => {
    try {
      const date = String(req.query.date || '');
      if (!S.isDateStr(date)) throw bad('Fecha no válida');
      const ex = Number(req.query.exclude) || 0;
      const editing = ex ? await repo.getAppointment(ex) : null;
      const info = S.dayInfo(date);
      const slots = S.computeSlots(date, {
        busyTimes: await repo.busyFor(date, ex), blocks: await repo.blocksFor(date), minLeadMin: -100000000,
        need: editing ? editing.slots : 1,
      });
      res.json({ date, open: info.open, holiday: info.holiday, slots });
    } catch (e) { next(e); }
  });

  function readApptFields(b, { partial }) {
    const out = {};
    if (!partial || b.name !== undefined) {
      out.name = cleanText(b.name, 60);
      if (out.name.length < 2) throw bad('Escribe el nombre del cliente');
    }
    if (!partial || b.phone !== undefined) {
      out.phone = normalizePhone(b.phone, { lenient: true });
      if (!out.phone) throw bad('Teléfono no válido');
    }
    if (b.note !== undefined) out.note = cleanText(b.note, 200);
    if (!partial || b.date !== undefined) {
      if (!S.isDateStr(b.date)) throw bad('Fecha no válida');
      out.date = b.date;
    }
    if (!partial || b.time !== undefined) {
      if (!S.isTimeStr(b.time)) throw bad('Hora no válida');
      out.time = b.time;
    }
    if (b.status !== undefined) {
      if (!['confirmed', 'completed', 'no_show', 'cancelled'].includes(b.status)) throw bad('Estado no válido');
      out.status = b.status;
    }
    return out;
  }

  admin.post('/appointments', async (req, res, next) => {
    try {
      const f = readApptFields(req.body || {}, { partial: false });
      const appt = await repo.tx(async () => {
        await repo.lockDay(f.date);
        if (await repo.hasConflict(f.date, f.time)) throw new HttpError(409, 'Ya hay una cita o un turno fijo en ese horario');
        return repo.insertAppointment({ ...f, status: 'confirmed', source: 'admin' });
      });
      res.status(201).json({ appointment: appt });
    } catch (e) {
      if (e && e.code === '23505') return next(new HttpError(409, 'Ya hay una cita en ese horario'));
      next(e);
    }
  });

  admin.patch('/appointments/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const f = readApptFields(req.body || {}, { partial: true });
      const { after } = await repo.tx(async () => {
        const before = await repo.getAppointment(id);
        if (!before) throw new HttpError(404, 'Cita no encontrada');
        const target = { ...before, ...f };
        await repo.lockDay(target.date);
        const becomesActive = target.status !== 'cancelled';
        const moved = target.date !== before.date || target.time !== before.time;
        const reactivated = before.status === 'cancelled' && becomesActive;
        if (becomesActive && (moved || reactivated) && await repo.hasConflict(target.date, target.time, id, before.slots)) {
          throw new HttpError(409, 'Ya hay una cita o un turno fijo en ese horario');
        }
        const updated = await repo.updateAppointment(id, { ...f, resetReminder: moved });
        return { before, after: updated, moved };
      });
      res.json({ appointment: after });
    } catch (e) {
      if (e && e.code === '23505') return next(new HttpError(409, 'Ya hay una cita en ese horario'));
      next(e);
    }
  });

  admin.delete('/appointments/:id', async (req, res, next) => {
    try {
      const a = await repo.getAppointment(Number(req.params.id));
      if (!a) throw new HttpError(404, 'Cita no encontrada');
      await repo.deleteAppointment(a.id);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  admin.get('/blocks', async (req, res, next) => {
    try { res.json({ blocks: await repo.listBlocks(S.nowParts().date) }); } catch (e) { next(e); }
  });

  admin.post('/blocks', async (req, res, next) => {
    try {
      const b = req.body || {};
      if (!S.isDateStr(b.date)) throw bad('Fecha no válida');
      let time = null;
      if (b.time) {
        if (!S.isTimeStr(b.time)) throw bad('Hora no válida');
        time = b.time;
      }
      const blk = await repo.addBlock(b.date, time, cleanText(b.reason, 80));
      res.status(201).json({ block: blk });
    } catch (e) { next(e); }
  });

  admin.delete('/blocks/:id', async (req, res, next) => {
    try {
      const blk = await repo.getBlock(Number(req.params.id));
      if (!blk) throw new HttpError(404, 'Bloqueo no encontrado');
      await repo.deleteBlock(blk.id);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---------- Admin: turnos fijos ----------
  function readFixed(b) {
    const dow = Number(b.dow);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) throw bad('Día no válido');
    if (!S.isTimeStr(b.time)) throw bad('Hora no válida');
    const name = cleanText(b.name, 60);
    if (name.length < 2) throw bad('Escribe el nombre del cliente');
    let phone = '';
    if (b.phone && String(b.phone).replace(/\D/g, '')) {
      phone = normalizePhone(b.phone, { lenient: true });
      if (!phone) throw bad('Celular no válido');
    }
    const every = Number(b.every) === 2 ? 2 : 1;
    if (!S.isDateStr(b.start_date)) throw bad('Elige la primera fecha');
    if (S.dayOfWeek(b.start_date) !== dow) throw bad('La primera fecha tiene que caer en el mismo día de la semana');
    return { dow, time: b.time, name, phone, every, start_date: b.start_date };
  }

  admin.get('/fixed', async (req, res, next) => {
    try { res.json({ fixed: await repo.listFixed() }); } catch (e) { next(e); }
  });

  admin.post('/fixed', async (req, res, next) => {
    try { res.status(201).json({ fixed: await repo.addFixed(readFixed(req.body || {})) }); } catch (e) { next(e); }
  });

  admin.patch('/fixed/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!await repo.getFixed(id)) throw new HttpError(404, 'Turno fijo no encontrado');
      res.json({ fixed: await repo.updateFixed(id, readFixed(req.body || {})) });
    } catch (e) { next(e); }
  });

  admin.delete('/fixed/:id', async (req, res, next) => {
    try {
      if (!await repo.deleteFixed(Number(req.params.id))) throw new HttpError(404, 'Turno fijo no encontrado');
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Liberar (PUT) o volver a bloquear (DELETE) un turno fijo solo en una fecha
  admin.put('/fixed/:id/skips/:date', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const { date } = req.params;
      if (!S.isDateStr(date)) throw bad('Fecha no válida');
      if (!(await repo.fixedFor(date, { includeSkipped: true })).some((f) => f.id === id)) {
        throw bad('Ese turno fijo no toca en esa fecha');
      }
      await repo.skipFixed(id, date);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  admin.delete('/fixed/:id/skips/:date', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const { date } = req.params;
      if (!S.isDateStr(date)) throw bad('Fecha no válida');
      const f = (await repo.fixedFor(date, { includeSkipped: true })).find((x) => x.id === id);
      if (!f) throw bad('Ese turno fijo no toca en esa fecha');
      if (f.skipped && await repo.hasConflict(date, f.time)) {
        throw new HttpError(409, 'Esa hora ya la tomó otra persona; cancela esa cita primero');
      }
      await repo.unskipFixed(id, date);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Calendario del admin: por cada día, horario, citas activas y turnos fijos (con nombres)
  admin.get('/agenda', async (req, res, next) => {
    try {
      const { from, to } = req.query;
      if (!S.isDateStr(from) || !S.isDateStr(to) || to < from || S.daysBetween(from, to) > 31) {
        throw bad('Rango de fechas no válido');
      }
      const appts = await repo.listAppointments({ from, to, status: 'active' });
      const dates = [];
      for (let d = from; d <= to; d = S.addDays(d, 1)) dates.push(d);
      const days = await Promise.all(dates.map(async (d) => {
        const info = S.dayInfo(d);
        return {
          date: d, dow: info.dow, open: info.open, holiday: info.holiday, ranges: info.ranges,
          appointments: appts.filter((a) => a.date === d),
          fixed: await repo.fixedFor(d, { includeSkipped: true }),
        };
      }));
      res.json({ days });
    } catch (e) { next(e); }
  });

  app.use('/api/admin', admin);

  // ---------- Cliente: gestionar su cita con el link privado ----------
  app.use('/api/cita', citaRoutes());

  // ---------- Páginas ----------
  // El panel no se enlaza desde ningún lado: solo se entra escribiendo /admin.
  const adminHtml = path.join(__dirname, 'admin-ui', 'views', 'admin.html');
  app.get(['/admin', '/admin/'], (req, res) => {
    res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
    res.sendFile(adminHtml);
  });
  app.use('/admin/assets', express.static(path.join(__dirname, 'admin-ui', 'assets'), { index: false, maxAge: 0 }));
  // Service worker (recibe las notificaciones push) y manifest (para instalar el panel como app en el celular)
  app.get('/admin/sw.js', (req, res) => {
    res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/admin/' });
    res.sendFile(path.join(__dirname, 'admin-ui', 'sw.js'));
  });
  app.get('/admin/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json').set('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, 'admin-ui', 'manifest.webmanifest'));
  });

  // Página del link que recibe el cliente por WhatsApp
  const citaHtml = path.join(__dirname, 'public', 'cita.html');
  app.get('/cita/:token', (req, res) => {
    res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.sendFile(citaHtml);
  });

  // Páginas, estilos y JS: el navegador siempre pregunta si hay versión nueva (responde 304 si no cambió),
  // así cada cambio se ve al recargar. Imágenes: se guardan 1 hora.
  app.use(express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    setHeaders(res, filePath) {
      res.setHeader('Cache-Control', /\.(html|css|js)$/.test(filePath) ? 'no-cache' : 'public, max-age=3600');
    },
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));
  app.use((req, res) => res.status(404).type('text/plain').send('Página no encontrada'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON no válido' });
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  });

  return app;
}

module.exports = { createApp };

if (require.main === module) {
  (async () => {
    await repo.init(); // conecta a Postgres y crea las tablas si faltan
    const server = createApp().listen(cfg.port, () => {
      console.log(`${cfg.name} escuchando en el puerto ${cfg.port}`);
      reminders.start();
      cleanup.start();
    });
    // Apagado ordenado (docker stop / reinicio): termina lo que está en curso y cierra la base de datos
    const shutdown = (sig) => {
      console.log(`[${sig}] cerrando...`);
      server.close(() => repo.close().finally(() => process.exit(0)));
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })().catch((e) => { console.error('No se pudo arrancar:', e.message); process.exit(1); });
}
