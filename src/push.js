'use strict';
// Notificaciones push al celular/navegador de los admin (Web Push) cuando entra una cita.
// Las claves VAPID se generan solas la primera vez y quedan en la base de datos (tabla settings).
// Nunca lanza errores hacia afuera: si una notificación falla, la reserva sigue normal.
const webpush = require('web-push');
const cfg = require('./config');
const repo = require('./db');
const { formatDateEs, format12 } = require('./schedule');

let keys = null;

async function ensureKeys() {
  if (keys) return keys;
  let pub = process.env.VAPID_PUBLIC_KEY || '';
  let priv = process.env.VAPID_PRIVATE_KEY || '';
  if (!pub || !priv) {
    const fresh = webpush.generateVAPIDKeys();
    pub = await repo.initSetting('vapid_public', fresh.publicKey);
    priv = await repo.initSetting('vapid_private', fresh.privateKey);
  }
  const subject = cfg.publicUrl.startsWith('https://') ? cfg.publicUrl : 'mailto:admin@sebas-barber.com';
  webpush.setVapidDetails(subject, pub, priv);
  keys = { publicKey: pub };
  return keys;
}

const publicKey = async () => (await ensureKeys()).publicKey;

/** Valida y guarda la suscripción que manda el navegador. */
async function subscribe(sub, user) {
  const endpoint = String(sub?.endpoint || '');
  const p256dh = String(sub?.keys?.p256dh || '');
  const auth = String(sub?.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    return false;
  }
  await repo.savePushSub({ endpoint, p256dh, auth }, user);
  return true;
}

const unsubscribe = (endpoint) => repo.deletePushSub(String(endpoint || ''));

/** Manda la notificación a todos los dispositivos suscritos. Devuelve cuántos la aceptaron. */
async function sendAll(payload) {
  let ok = 0;
  try {
    await ensureKeys();
    const subs = await repo.listPushSubs();
    const body = JSON.stringify(payload);
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body,
          { TTL: 6 * 3600, urgency: 'high' });
        ok++;
      } catch (err) {
        // 404/410: el navegador anuló la suscripción (desinstalado, permisos quitados...): se borra
        if (err && (err.statusCode === 404 || err.statusCode === 410)) await repo.deletePushSub(s.endpoint).catch(() => {});
        else console.error('[push]', err && (err.statusCode || err.message));
      }
    }));
  } catch (err) {
    console.error('[push]', err.message);
  }
  return ok;
}

const when = (a) => `${formatDateEs(a.date)} a las ${format12(a.time)}`;

/** Aviso de cita nueva (o cambiada / cancelada por el cliente desde su link). */
function notifyAppointment(a, kind = 'new') {
  const title = kind === 'changed' ? '🔄 Cita cambiada' : kind === 'cancelled' ? '❌ Cita cancelada' : '💈 Nueva cita';
  const body = [`${a.name} · ${when(a)}`, a.service || ''].filter(Boolean).join('\n');
  // sin await: la respuesta al cliente no espera a la notificación
  return sendAll({ title, body, tag: `cita-${a.id}`, url: '/admin/' });
}

module.exports = { publicKey, subscribe, unsubscribe, sendAll, notifyAppointment };
