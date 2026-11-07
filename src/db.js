'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite'); // SQLite incluido en Node (no requiere compilar)
const cfg = require('./config');
const { toMin, SLOT_MIN } = require('./schedule');

fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
const db = new DatabaseSync(cfg.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/** Igual que better-sqlite3: db.transaction(fn) devuelve una función que corre fn dentro de BEGIN/COMMIT. */
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(...args);
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,                -- YYYY-MM-DD (hora Colombia)
  time TEXT NOT NULL,                -- HH:MM (hora Colombia)
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed','completed','no_show','cancelled')),
  source TEXT NOT NULL DEFAULT 'web',
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  reminder_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Una sola cita activa por fecha+hora (red de seguridad contra doble reserva)
CREATE UNIQUE INDEX IF NOT EXISTS ux_active_slot
  ON appointments(date, time) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS ix_appt_date ON appointments(date);
CREATE INDEX IF NOT EXISTS ix_appt_phone ON appointments(phone);

CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time TEXT,                         -- NULL = todo el día
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_blocks_date ON blocks(date);
`);

// Ya no se guarda historial de actividad (para no llenar la base de datos).
db.exec('DROP TABLE IF EXISTS audit');

// Token privado por cita: va en el link que recibe el cliente (/cita/<token>)
// para ver, reprogramar o cancelar su cita sin crear cuenta.
const newToken = () => crypto.randomBytes(24).toString('base64url');

// Migración: bases creadas antes de existir manage_token
if (!db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get('appointments', 'manage_token')) {
  db.exec('ALTER TABLE appointments ADD COLUMN manage_token TEXT');
}
{
  const missing = db.prepare('SELECT id FROM appointments WHERE manage_token IS NULL').all();
  const set = db.prepare('UPDATE appointments SET manage_token = ? WHERE id = ?');
  for (const { id } of missing) set.run(newToken(), id);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_appt_token ON appointments(manage_token)');

// Migración: servicio elegido al reservar (ej. "Corte premium · $24.000")
if (!db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get('appointments', 'service')) {
  db.exec("ALTER TABLE appointments ADD COLUMN service TEXT NOT NULL DEFAULT ''");
}
// Migración: horas que ocupa la cita (2 si el servicio dura más de 1 h 10 min)
if (!db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get('appointments', 'slots')) {
  db.exec('ALTER TABLE appointments ADD COLUMN slots INTEGER NOT NULL DEFAULT 1');
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    const bytes = crypto.randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (!db.prepare('SELECT 1 FROM appointments WHERE code = ?').get(code)) return code;
  }
}

const stmt = {
  activeTimes: db.prepare(`SELECT time, slots FROM appointments WHERE date = @date AND status <> 'cancelled' AND id <> @ex`),
  blocksFor: db.prepare('SELECT id, date, time, reason FROM blocks WHERE date = ?'),
  countFuturePhone: db.prepare(`SELECT COUNT(*) AS c FROM appointments WHERE phone = ? AND status = 'confirmed' AND date >= ?`),
  insert: db.prepare(`INSERT INTO appointments (code, manage_token, name, phone, service, slots, note, date, time, status, source)
                      VALUES (@code, @token, @name, @phone, @service, @slots, @note, @date, @time, @status, @source)`),
  get: db.prepare('SELECT * FROM appointments WHERE id = ?'),
  getByToken: db.prepare('SELECT * FROM appointments WHERE manage_token = ?'),
  del: db.prepare('DELETE FROM appointments WHERE id = ?'),
  addBlock: db.prepare('INSERT INTO blocks (date, time, reason) VALUES (?, ?, ?)'),
  getBlock: db.prepare('SELECT * FROM blocks WHERE id = ?'),
  delBlock: db.prepare('DELETE FROM blocks WHERE id = ?'),
  purgeAppts: db.prepare('DELETE FROM appointments WHERE date < ?'),
  purgeBlocks: db.prepare('DELETE FROM blocks WHERE date < ?'),
  listBlocks: db.prepare('SELECT * FROM blocks WHERE date >= ? ORDER BY date, time'),
  pendingReminders: db.prepare(`SELECT * FROM appointments
      WHERE status = 'confirmed' AND reminder_sent = 0 AND reminder_attempts < 3 AND date >= ?
      ORDER BY date, time`),
};

/** Citas activas del día: [{ time, slots }] */
const activeTimes = (date, excludeId = 0) =>
  stmt.activeTimes.all({ date, ex: excludeId }).map((r) => ({ time: r.time, slots: Number(r.slots) || 1 }));
const blocksFor = (date) => stmt.blocksFor.all(date);

/** ¿Choca con otra cita activa? (cada cita ocupa `slots` horas) */
function hasConflict(date, time, excludeId = 0, slots = 1) {
  const s = toMin(time);
  const e = s + slots * SLOT_MIN;
  return activeTimes(date, excludeId).some((a) => {
    const as = toMin(a.time);
    return s < as + a.slots * SLOT_MIN && as < e;
  });
}

function insertAppointment(data) {
  const code = newCode();
  const info = stmt.insert.run({
    code,
    token: newToken(),
    name: data.name,
    phone: data.phone,
    service: data.service || '',
    slots: data.slots === 2 ? 2 : 1,
    note: data.note || '',
    date: data.date,
    time: data.time,
    status: data.status || 'confirmed',
    source: data.source || 'web',
  });
  return stmt.get.get(info.lastInsertRowid);
}

const UPDATABLE = ['name', 'phone', 'note', 'date', 'time', 'status'];
function updateAppointment(id, fields) {
  const sets = [];
  const params = { id };
  for (const k of UPDATABLE) {
    if (fields[k] !== undefined) { sets.push(`${k} = @${k}`); params[k] = fields[k]; }
  }
  if (fields.resetReminder) { sets.push('reminder_sent = 0', 'reminder_attempts = 0'); }
  if (!sets.length) return stmt.get.get(id);
  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE appointments SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return stmt.get.get(id);
}

function listAppointments({ from, to, status, q, limit = 500 }) {
  const where = [];
  const params = { limit };
  if (from) { where.push('date >= @from'); params.from = from; }
  if (to) { where.push('date <= @to'); params.to = to; }
  if (status === 'active') where.push("status = 'confirmed'");
  else if (['confirmed', 'completed', 'no_show', 'cancelled'].includes(status)) {
    where.push('status = @status'); params.status = status;
  }
  if (q) {
    const digits = q.replace(/\D/g, '');
    const parts = ['name LIKE @q', 'code LIKE @q'];
    params.q = `%${q}%`;
    if (digits.length >= 3) { parts.push('phone LIKE @qd'); params.qd = `%${digits}%`; }
    where.push(`(${parts.join(' OR ')})`);
  }
  const sql = `SELECT * FROM appointments ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY date, time LIMIT @limit`;
  return db.prepare(sql).all(params);
}

module.exports = {
  db,
  activeTimes, blocksFor, hasConflict,
  countFuturePhone: (phone, today) => stmt.countFuturePhone.get(phone, today).c,
  insertAppointment, updateAppointment, listAppointments,
  getAppointment: (id) => stmt.get.get(id),
  getAppointmentByToken: (token) => (typeof token === 'string' && token ? stmt.getByToken.get(token) : undefined),
  deleteAppointment: (id) => stmt.del.run(id).changes,
  addBlock: (date, time, reason) => stmt.getBlock.get(stmt.addBlock.run(date, time, reason).lastInsertRowid),
  getBlock: (id) => stmt.getBlock.get(id),
  deleteBlock: (id) => stmt.delBlock.run(id).changes,
  /** Borra citas y bloqueos con fecha anterior a `date` (YYYY-MM-DD). Devuelve cuántas citas borró. */
  purgeBefore: (date) => {
    stmt.purgeBlocks.run(date);
    return Number(stmt.purgeAppts.run(date).changes);
  },
  listBlocks: (from) => stmt.listBlocks.all(from),
  pendingReminders: (today) => stmt.pendingReminders.all(today),
};
