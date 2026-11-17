'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cfg = require('./config');

const COOKIE = 'sb_admin';
// La sesión no se cierra sola: dura 400 días (el máximo que permiten los navegadores para una cookie)
// y se renueva en cada visita si ya pasó un día. Solo se cierra con "Salir".
const MAX_AGE_DAYS = 400;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 3600 * 1000;
const RENEW_AFTER_S = 24 * 3600;

// Usuarios admin desde el .env: ADMIN1_USER / ADMIN1_PASS ... ADMIN5_USER / ADMIN5_PASS
const users = new Map();
for (let i = 1; i <= 5; i++) {
  const u = (process.env[`ADMIN${i}_USER`] || '').trim().toLowerCase();
  const p = process.env[`ADMIN${i}_PASS`];
  if (u && p) users.set(u, bcrypt.hashSync(p, 10)); // en memoria solo queda el hash
}
if (users.size === 0) {
  throw new Error('No hay administradores: define ADMIN1_USER y ADMIN1_PASS en el .env');
}
const DUMMY_HASH = bcrypt.hashSync('no-existe', 10);

async function verifyLogin(user, pass) {
  const key = String(user || '').trim().toLowerCase();
  const hash = users.get(key) || DUMMY_HASH; // mismo costo exista o no el usuario
  const ok = await bcrypt.compare(String(pass || ''), hash);
  return ok && users.has(key) ? key : null;
}

function setSession(res, user) {
  const token = jwt.sign({ sub: user }, cfg.sessionSecret, { expiresIn: `${MAX_AGE_DAYS}d` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: cfg.cookieSecure,
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}
const clearSession = (res) => res.clearCookie(COOKIE, { path: '/' });

function requireAdmin(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies[COOKIE] || '', cfg.sessionSecret);
    if (!users.has(payload.sub)) throw new Error('usuario ya no existe');
    req.admin = payload.sub;
    if (Date.now() / 1000 - payload.iat > RENEW_AFTER_S) setSession(res, payload.sub); // sesión deslizante
    return next();
  } catch (_) {
    return res.status(401).json({ error: 'Sesión no válida' });
  }
}

module.exports = { verifyLogin, setSession, clearSession, requireAdmin };
