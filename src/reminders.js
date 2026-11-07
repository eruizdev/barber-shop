'use strict';
// Recordatorios por WhatsApp Cloud API (opcional: WHATSAPP_ENABLED=true).
// Plantilla sugerida (categoría UTILITY, idioma es):
//   "Hola {{1}}, te recordamos tu cita en Sebas Barber el {{2}} a las {{3}}.
//    Si no puedes asistir, avísanos por este medio."
const cfg = require('./config');
const repo = require('./db');
const { nowParts, startMs, formatDateEs, format12 } = require('./schedule');

async function sendTemplate(appt) {
  const { token, phoneNumberId, template, lang, apiVersion } = cfg.wa;
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: appt.phone,
    type: 'template',
    template: {
      name: template,
      language: { code: lang },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: appt.name.split(' ')[0] },
          { type: 'text', text: formatDateEs(appt.date) },
          { type: 'text', text: format12(appt.time) },
        ],
      }],
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`WhatsApp ${res.status}: ${txt.slice(0, 300)}`);
  }
}

async function tick() {
  const now = Date.now();
  const today = nowParts(now).date;
  for (const appt of repo.pendingReminders(today)) {
    const diffH = (startMs(appt.date, appt.time) - now) / 3600000;
    if (diffH <= 0 || diffH > cfg.wa.hoursBefore) continue;
    try {
      await sendTemplate(appt);
      repo.db.prepare('UPDATE appointments SET reminder_sent = 1 WHERE id = ?').run(appt.id);
      repo.audit('sistema', 'recordatorio', `#${appt.id} ${appt.name} ${appt.date} ${appt.time}`);
    } catch (err) {
      repo.db.prepare('UPDATE appointments SET reminder_attempts = reminder_attempts + 1 WHERE id = ?').run(appt.id);
      console.error('[recordatorios]', err.message);
    }
  }
}

function start() {
  if (!cfg.wa.enabled) return;
  if (!cfg.wa.token || !cfg.wa.phoneNumberId) {
    console.warn('[recordatorios] WHATSAPP_ENABLED=true pero faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID');
    return;
  }
  console.log('[recordatorios] activos (revisión cada 5 min)');
  setInterval(() => tick().catch((e) => console.error('[recordatorios]', e.message)), 5 * 60 * 1000);
  tick().catch((e) => console.error('[recordatorios]', e.message));
}

module.exports = { start, tick };
