'use strict';
// Recordatorio por WhatsApp (WAHA) 1 hora antes de la cita (REMINDER_MINUTES_BEFORE).
// Revisa cada minuto: citas confirmadas del calendario + turnos fijos que tengan celular.
// Cada recordatorio se manda una sola vez (queda marcado en la base de datos).
const cfg = require('./config');
const repo = require('./db');
const wa = require('./whatsapp');
const notify = require('./notify');
const { nowParts, addDays, startMs } = require('./schedule');

const EVERY_MS = 60 * 1000;
const RETRY_MS = 5 * 60 * 1000; // si un envío falla, reintentar a los 5 min
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = () => (cfg.waha.pauseMs ? sleep(cfg.waha.pauseMs * (0.6 + Math.random() * 0.8)) : null);

let busy = false;
let lastStatus = null;
const lastTry = new Map(); // clave -> última vez que se intentó (solo si falló)

/** Falta menos de reminderMinutes para la cita (y todavía no empieza). */
function inWindow(date, time, now) {
  const diffMin = (startMs(date, time) - now) / 60000;
  return diffMin > 0 && diffMin <= cfg.waha.reminderMinutes;
}

/** Evita mandar un recordatorio a quien acaba de agendar (acaba de recibir la confirmación). */
function bookedTooRecently(appt) {
  const skip = cfg.waha.skipIfBookedWithinMin;
  if (!skip) return false;
  return new Date(appt.updated_at).getTime() > startMs(appt.date, appt.time) - skip * 60000;
}

async function sendOne(key, phone, text, onSent, onFail) {
  const last = lastTry.get(key);
  if (last && Date.now() - last < RETRY_MS) return false;
  try {
    await wa.sendText(phone, text);
    lastTry.delete(key);
    await onSent();
    return true;
  } catch (err) {
    lastTry.set(key, Date.now());
    await onFail();
    console.error('[recordatorios]', err.message);
    return false;
  }
}

async function tick(now = Date.now()) {
  if (busy) return 0;
  busy = true;
  let sent = 0;
  try {
    const today = nowParts(now).date;
    const appts = (await repo.pendingReminders(today, addDays(today, 1)))
      .filter((a) => inWindow(a.date, a.time, now) && !bookedTooRecently(a));
    const fixed = (await repo.fixedFor(today))
      .filter((f) => f.phone && inWindow(today, f.time, now));
    if (!appts.length && !fixed.length) return 0;

    // Solo mandar si el WhatsApp está vinculado (si no, no se gastan intentos)
    const st = await wa.status();
    if (st !== 'WORKING') {
      if (st !== lastStatus) console.warn(`[recordatorios] WhatsApp no está listo (estado: ${st || 'sin respuesta de WAHA'}). Abre el panel de WAHA y escanea el QR.`);
      lastStatus = st;
      return 0;
    }
    lastStatus = st;

    for (const a of appts) {
      const ok = await sendOne(`a${a.id}`, a.phone, notify.reminderText(a, notify.manageUrl(a)),
        () => repo.markReminderSent(a.id), () => repo.bumpReminderAttempts(a.id));
      if (ok) { sent++; await pause(); }
    }
    const done = await repo.fixedRemindedIds(today);
    for (const f of fixed) {
      if (done.has(f.id)) continue;
      const ok = await sendOne(`f${f.id}-${today}`, f.phone, notify.fixedReminderText(f),
        () => repo.markFixedReminded(f.id, today), async () => {});
      if (ok) { sent++; await pause(); }
    }
    return sent;
  } finally {
    busy = false;
  }
}

async function start() {
  if (!cfg.waha.enabled) return;
  const st = await wa.status();
  console.log(`[recordatorios] activos: ${cfg.waha.reminderMinutes} min antes de la cita · WhatsApp (WAHA): ${st || 'sin respuesta'}`);
  if (st !== 'WORKING') console.warn('[recordatorios] Falta vincular el WhatsApp: abre el panel de WAHA y escanea el QR (ver DEPLOY.md).');
  const run = () => tick().catch((e) => console.error('[recordatorios]', e.message));
  setInterval(run, EVERY_MS).unref();
  run();
}

module.exports = { start, tick };
