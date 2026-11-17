'use strict';
// Cliente de WAHA (WhatsApp HTTP API): envía mensajes desde TU WhatsApp Business ya vinculado.
// Docs: https://waha.devlike.pro  ·  WAHA corre en su propio contenedor (ver docker-compose.yml).
const cfg = require('./config');

const isConfigured = () => cfg.waha.enabled && Boolean(cfg.waha.url);

const headers = () => ({
  'Content-Type': 'application/json',
  ...(cfg.waha.apiKey ? { 'X-Api-Key': cfg.waha.apiKey } : {}),
});

/** Celular colombiano -> id de chat de WhatsApp: "300 123 4567" -> "573001234567@c.us" */
function toChatId(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (/^3\d{9}$/.test(d)) d = '57' + d; // todos los números son de Colombia (+57)
  if (d.length < 8) throw new Error(`Celular no válido: "${phone}"`);
  return `${d}@c.us`;
}

/** Envía un mensaje de texto. Lanza error si WAHA no responde o no tiene WhatsApp vinculado. */
async function sendText(phone, text) {
  const res = await fetch(`${cfg.waha.url}/api/sendText`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ session: cfg.waha.session, chatId: toChatId(phone), text }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || `HTTP ${res.status}`;
    throw new Error(`WAHA ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return data.id && (data.id._serialized || data.id);
}

/** Estado de la sesión: WORKING (listo), SCAN_QR_CODE (falta vincular), STOPPED, FAILED... o null si WAHA no responde. */
async function status() {
  try {
    const res = await fetch(`${cfg.waha.url}/api/sessions/${encodeURIComponent(cfg.waha.session)}`, {
      headers: headers(), signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()).status || null;
  } catch (_) {
    return null;
  }
}

module.exports = { isConfigured, sendText, status, toChatId };
