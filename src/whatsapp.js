'use strict';
// Cliente mínimo de WhatsApp Cloud API (Meta).
// Los mensajes que inicia el negocio deben ser plantillas aprobadas en
// WhatsApp Manager (categoría UTILITY). Docs: developers.facebook.com/docs/whatsapp/cloud-api
const cfg = require('./config');

const isConfigured = () => cfg.wa.enabled && Boolean(cfg.wa.token && cfg.wa.phoneNumberId);

/**
 * Envía una plantilla con variables de texto en el cuerpo ({{1}}, {{2}}, ...).
 * Devuelve el id del mensaje de WhatsApp. Lanza error si Meta responde mal.
 */
async function sendTemplate({ to, template, params = [], lang = cfg.wa.lang }) {
  const { token, phoneNumberId, apiVersion } = cfg.wa;
  const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: lang },
        components: params.length
          ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text) })) }]
          : [],
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
    throw new Error(`WhatsApp ${res.status}: ${msg}`);
  }
  return data.messages && data.messages[0] && data.messages[0].id;
}

module.exports = { isConfigured, sendTemplate };
