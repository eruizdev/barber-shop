'use strict';
// Confirmación por WhatsApp con el link privado de la cita.
//
// Plantilla en WhatsApp Manager (categoría UTILITY, idioma es), nombre
// WHATSAPP_CONFIRM_TEMPLATE (por defecto "confirmacion_cita"):
//
//   Hola {{1}}, tu cita en Sebas Barber quedó confirmada para el {{2}} a las {{3}}.
//
//   Desde este link puedes ver, cambiar o cancelar tu cita: {{4}}
//
//   ¡Te esperamos!
//
// (Meta no acepta plantillas que empiecen o terminen con una variable.)
const cfg = require('./config');
const wa = require('./whatsapp');
const { formatDateEs, format12 } = require('./schedule');

/** URL base del sitio: PUBLIC_URL o, si no está, la del request. */
function baseUrl(req) {
  if (cfg.publicUrl) return cfg.publicUrl;
  return req ? `${req.protocol}://${req.get('host')}` : '';
}

const manageUrl = (appt, req) => `${baseUrl(req)}/cita/${appt.manage_token}`;

/**
 * Envía la confirmación (al reservar o al reprogramar).
 * Nunca lanza: devuelve true si WhatsApp la aceptó.
 */
async function sendConfirmation(appt, req) {
  if (!wa.isConfigured()) return false;
  try {
    await wa.sendTemplate({
      to: appt.phone,
      template: cfg.wa.confirmTemplate,
      params: [appt.name.split(' ')[0], formatDateEs(appt.date), format12(appt.time), manageUrl(appt, req)],
    });
    return true;
  } catch (err) {
    console.error('[whatsapp confirmación]', err.message);
    return false;
  }
}

module.exports = { manageUrl, sendConfirmation };
