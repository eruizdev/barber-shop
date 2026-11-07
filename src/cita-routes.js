'use strict';
// API para que el cliente gestione su cita desde el link que recibe por WhatsApp.
// Se identifica solo con el token privado de la cita (sin login).
//
//   GET  /api/cita/:token               -> ver la cita
//   GET  /api/cita/:token/slots?date=   -> horas libres para reprogramar
//   POST /api/cita/:token/reschedule    -> { date, time }
//   POST /api/cita/:token/cancel
const express = require('express');
const rateLimit = require('express-rate-limit');
const cfg = require('./config');
const repo = require('./db');
const S = require('./schedule');
const notify = require('./notify');

class CitaError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const describe = (a) => `#${a.id} ${a.name} ${a.date} ${a.time}`;

/** Se puede cambiar o cancelar si sigue confirmada y falta al menos MIN_LEAD_MINUTES. */
const canModify = (a, nowMs = Date.now()) =>
  a.status === 'confirmed' && S.startMs(a.date, a.time) - nowMs >= cfg.minLeadMin * 60000;

const publicView = (a) => ({
  code: a.code, name: a.name, date: a.date, time: a.time, service: a.service, note: a.note,
  status: a.status, canModify: canModify(a),
});

function currentWindow() {
  const now = S.nowParts();
  return S.bookingWindow(now.date, cfg.anchor, now.minutes, cfg.openTime);
}

function assertBookableDate(date) {
  if (!S.isDateStr(date)) throw new CitaError(400, 'Fecha no válida');
  const w = currentWindow();
  if (date < w.firstBookable || date > w.end) {
    throw new CitaError(400, 'Esa fecha no está habilitada para reservas');
  }
}

function slotsFor(date, appt) {
  return S.computeSlots(date, {
    busyTimes: repo.activeTimes(date, appt.id), // su propia hora no cuenta como ocupada
    blocks: repo.blocksFor(date),
    minLeadMin: cfg.minLeadMin,
  });
}

function citaRoutes() {
  const router = express.Router();

  router.use(rateLimit({
    windowMs: 15 * 60 * 1000, limit: 150, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Intenta más tarde.' },
  }));
  const writeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Demasiados cambios. Intenta más tarde o escríbenos por WhatsApp.' },
  });
  router.use((req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });

  router.param('token', (req, res, next, token) => {
    const appt = repo.getAppointmentByToken(token);
    if (!appt) return next(new CitaError(404, 'No encontramos esta cita. Revisa el link.'));
    req.appt = appt;
    next();
  });

  router.get('/:token', (req, res) => res.json({ appointment: publicView(req.appt) }));

  router.get('/:token/slots', (req, res, next) => {
    try {
      const date = String(req.query.date || '');
      assertBookableDate(date);
      const current = req.appt.date === date ? req.appt.time : null;
      res.json({ date, current, slots: slotsFor(date, req.appt) });
    } catch (e) { next(e); }
  });

  const reschedule = repo.db.transaction((appt, date, time) => {
    const slot = slotsFor(date, appt).find((s) => s.time === time);
    if (!slot) throw new CitaError(400, 'Esa hora no hace parte del horario');
    if (!slot.available) throw new CitaError(409, 'Esa hora ya no está disponible. Elige otra.');
    return repo.updateAppointment(appt.id, { date, time, resetReminder: true });
  });

  router.post('/:token/reschedule', writeLimiter, async (req, res, next) => {
    try {
      const before = req.appt;
      if (!canModify(before)) throw new CitaError(409, 'Esta cita ya no se puede cambiar. Escríbenos por WhatsApp.');
      const { date, time } = req.body || {};
      if (!S.isTimeStr(time)) throw new CitaError(400, 'Hora no válida');
      assertBookableDate(date);
      if (date === before.date && time === before.time) throw new CitaError(400, 'Tu cita ya está en esa hora');

      let after;
      try {
        after = reschedule(before, date, time);
      } catch (e) {
        if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new CitaError(409, 'Esa hora ya no está disponible. Elige otra.');
        throw e;
      }
      repo.audit('cliente', 'reprogramar', `${describe(before)} → ${after.date} ${after.time}`);
      const whatsappSent = await notify.sendConfirmation(after, req);
      res.json({ appointment: publicView(after), whatsappSent });
    } catch (e) { next(e); }
  });

  router.post('/:token/cancel', writeLimiter, (req, res, next) => {
    try {
      const appt = req.appt;
      if (!canModify(appt)) throw new CitaError(409, 'Esta cita ya no se puede cancelar. Escríbenos por WhatsApp.');
      const after = repo.updateAppointment(appt.id, { status: 'cancelled' });
      repo.audit('cliente', 'cancelar', describe(appt));
      res.json({ appointment: publicView(after) });
    } catch (e) { next(e); }
  });

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err instanceof CitaError) return res.status(err.status).json({ error: err.message });
    next(err);
  });

  return router;
}

module.exports = { citaRoutes, canModify };
