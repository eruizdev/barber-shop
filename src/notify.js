'use strict';
// Mensajes por WhatsApp (vía WAHA, desde tu WhatsApp Business).
const cfg = require('./config');
const wa = require('./whatsapp');
const { formatDateEs, format12 } = require('./schedule');

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/** URL base del sitio: PUBLIC_URL o, si no está, la del request. */
function baseUrl(req) {
  if (cfg.publicUrl) return cfg.publicUrl;
  return req ? `${req.protocol}://${req.get('host')}` : '';
}

/** Link privado de la cita ('' si no se sabe la dirección pública del sitio). */
function manageUrl(appt, req) {
  const base = baseUrl(req);
  return base ? `${base}/cita/${appt.manage_token}` : '';
}

const confirmationText = (appt, link, changed) => [
  `Hola ${firstName(appt.name)} 👋`,
  changed ? 'Tu cita en Sebas Barber fue cambiada:' : 'Tu cita en Sebas Barber quedó confirmada:',
  `📅 ${formatDateEs(appt.date)} a las ${format12(appt.time)}`,
  appt.service ? `✂️ ${appt.service}` : '',
  link ? `\nDesde este link puedes ver, cambiar o cancelar tu cita:\n${link}` : '',
  link ? '\n📌 *Importante:* guarda este mensaje. El link es la única forma de cambiar o cancelar tu cita; si lo pierdes, tendrás que escribirnos.' : '',
  '\n¡Te esperamos!',
].filter((l) => l !== '').join('\n');

const reminderText = (appt, link) => [
  `Hola ${firstName(appt.name)} 👋`,
  `Te recordamos tu cita de hoy en Sebas Barber a las ${format12(appt.time)}.`,
  appt.service ? `✂️ ${appt.service}` : '',
  link ? `\nSi no puedes asistir, cámbiala o cancélala aquí:\n${link}` : '',
  '\n¡Te esperamos!',
].filter((l) => l !== '').join('\n');

const fixedReminderText = (fixed) => [
  `Hola ${firstName(fixed.name)} 👋`,
  `Te recordamos tu turno de hoy en Sebas Barber a las ${format12(fixed.time)}.`,
  '\n¡Te esperamos!',
].join('\n');

/**
 * Confirmación al reservar (o al reprogramar, con changed: true).
 * Nunca lanza: devuelve true si WhatsApp la aceptó.
 */
async function sendConfirmation(appt, req, { changed = false } = {}) {
  if (!wa.isConfigured()) return false;
  try {
    await wa.sendText(appt.phone, confirmationText(appt, manageUrl(appt, req), changed));
    return true;
  } catch (err) {
    console.error('[whatsapp confirmación]', err.message);
    return false;
  }
}

module.exports = { manageUrl, sendConfirmation, reminderText, fixedReminderText };
