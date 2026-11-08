'use strict';
// Recordatorios por WhatsApp Cloud API (opcional: WHATSAPP_ENABLED=true).
// Plantilla sugerida (categoría UTILITY, idioma es):
//   "Hola {{1}}, te recordamos tu cita en Sebas Barber el {{2}} a las {{3}}.
//    Si no puedes asistir, avísanos por este medio."
const cfg = require('./config');
const repo = require('./db');
const wa = require('./whatsapp');
const { nowParts, startMs, formatDateEs, format12 } = require('./schedule');

const sendReminder = (appt) => wa.sendTemplate({
  to: appt.phone,
  template: cfg.wa.template,
  params: [appt.name.split(' ')[0], formatDateEs(appt.date), format12(appt.time)],
});

async function tick() {
  const now = Date.now();
  const today = nowParts(now).date;
  for (const appt of repo.pendingReminders(today)) {
    const diffH = (startMs(appt.date, appt.time) - now) / 3600000;
    if (diffH <= 0 || diffH > cfg.wa.hoursBefore) continue;
    try {
      await sendReminder(appt);
      repo.db.prepare('UPDATE appointments SET reminder_sent = 1 WHERE id = ?').run(appt.id);
    } catch (err) {
      repo.db.prepare('UPDATE appointments SET reminder_attempts = reminder_attempts + 1 WHERE id = ?').run(appt.id);
      console.error('[recordatorios]', err.message);
    }
  }
}

function start() {
  if (!cfg.wa.enabled) return;
  if (!wa.isConfigured()) {
    console.warn('[recordatorios] WHATSAPP_ENABLED=true pero faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID');
    return;
  }
  console.log('[recordatorios] activos (revisión cada 5 min)');
  setInterval(() => tick().catch((e) => console.error('[recordatorios]', e.message)), 5 * 60 * 1000);
  tick().catch((e) => console.error('[recordatorios]', e.message));
}

module.exports = { start, tick };
