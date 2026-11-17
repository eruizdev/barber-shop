'use strict';
// Base de datos: PostgreSQL (driver "pg"). Todas las funciones son asíncronas.
const crypto = require('crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool, types } = require('pg');
const cfg = require('./config');
const { toMin, SLOT_MIN, dayOfWeek, daysBetween } = require('./schedule');

types.setTypeParser(20, (v) => parseInt(v, 10)); // COUNT(*) y bigint como número

let pool = null;
const als = new AsyncLocalStorage(); // dentro de tx(), todas las consultas usan la misma conexión

const q = (text, params) => (als.getStore() || pool).query(text, params);

/**
 * Corre fn dentro de una transacción (BEGIN ... COMMIT; si lanza error, ROLLBACK).
 * Las funciones de este módulo que se llamen dentro de fn usan esa misma transacción.
 */
async function tx(fn) {
  if (als.getStore()) return fn(); // ya estamos dentro de una transacción
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await als.run(client, fn);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* conexión caída */ }
    throw e;
  } finally {
    client.release();
  }
}

/** Bloquea el día mientras dura la transacción: dos reservas del mismo día no se pisan. */
const lockDay = (date) => q('SELECT pg_advisory_xact_lock(hashtext($1))', [`sebasbarber-dia:${date}`]);

// Token privado por cita: va en el link que recibe el cliente (/cita/<token>)
const newToken = () => crypto.randomBytes(24).toString('base64url');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  manage_token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  service TEXT NOT NULL DEFAULT '',
  slots INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,                -- YYYY-MM-DD (hora Colombia)
  time TEXT NOT NULL,                -- HH:MM (hora Colombia)
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed','completed','no_show','cancelled')),
  source TEXT NOT NULL DEFAULT 'web',
  reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Una sola cita activa por fecha+hora (red de seguridad contra doble reserva)
CREATE UNIQUE INDEX IF NOT EXISTS ux_active_slot ON appointments(date, time) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS ix_appt_date ON appointments(date);
CREATE INDEX IF NOT EXISTS ix_appt_phone ON appointments(phone);

CREATE TABLE IF NOT EXISTS blocks (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT,                         -- NULL = todo el día
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_blocks_date ON blocks(date);

-- Turnos fijos: clientes con siempre la misma hora (cada semana o cada 2 semanas)
CREATE TABLE IF NOT EXISTS fixed_slots (
  id SERIAL PRIMARY KEY,
  dow INTEGER NOT NULL CHECK (dow BETWEEN 0 AND 6),        -- 0 domingo ... 6 sábado
  time TEXT NOT NULL,                                      -- HH:MM
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  every INTEGER NOT NULL DEFAULT 1 CHECK (every IN (1, 2)),
  start_date TEXT NOT NULL                                 -- primera fecha (mismo día de la semana)
);
-- Días sueltos en que el admin libera un turno fijo
CREATE TABLE IF NOT EXISTS fixed_skips (
  fixed_id INTEGER NOT NULL REFERENCES fixed_slots(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY (fixed_id, date)
);
-- Recordatorios ya enviados a turnos fijos (uno por fecha)
CREATE TABLE IF NOT EXISTS fixed_reminders (
  fixed_id INTEGER NOT NULL REFERENCES fixed_slots(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY (fixed_id, date)
);
`;

// Turnos fijos iniciales (solo la primera vez que se crea la tabla)
const FRI = '2026-11-06'; const SAT = '2026-11-07'; const SAT_2W = '2026-11-14';
const FIXED_SEED = [
  [5, '09:00', 'Hijo de Mariana Jorge', 1, FRI],
  [5, '10:00', 'Andreus', 1, FRI],
  [5, '11:00', 'Andreus', 1, FRI],
  [5, '13:00', 'Correa', 1, FRI],
  [5, '15:00', 'Esteban', 1, FRI],
  [5, '17:00', 'Camilo Parra', 1, FRI],
  [5, '18:00', 'Juan Alzate Osorio', 1, FRI],
  [5, '19:00', 'Coscu', 1, FRI],
  [6, '09:00', 'Miguel', 1, SAT],
  [6, '10:00', 'Zúñiga', 2, SAT_2W],
  [6, '12:00', 'Felipe G', 2, SAT_2W],
  [6, '14:00', 'Edward', 1, SAT],
  [6, '15:00', 'Mauricio Buitrago', 1, SAT],
  [6, '16:00', 'Iván', 1, SAT],
  [6, '17:00', 'Jorge', 1, SAT],
  [6, '18:00', 'Santi', 1, SAT],
  [6, '19:00', 'Yei', 1, SAT],
];

/** Conecta y crea las tablas si faltan. Llamar una vez al arrancar (antes de atender peticiones). */
async function init() {
  if (pool) return;
  if (!cfg.databaseUrl) throw new Error('Falta DATABASE_URL (ej. postgres://usuario:clave@localhost:5432/sebasbarber)');
  pool = new Pool({ connectionString: cfg.databaseUrl, max: cfg.dbPoolMax });
  pool.on('error', (e) => console.error('[db] conexión inactiva con error:', e.message));
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(7301)'); // si arrancan dos copias, una espera a la otra
    const had = (await client.query("SELECT to_regclass('public.fixed_slots') AS t")).rows[0].t;
    await client.query(SCHEMA);
    if (!had) {
      for (const r of FIXED_SEED) {
        await client.query('INSERT INTO fixed_slots (dow, time, name, every, start_date) VALUES ($1, $2, $3, $4, $5)', [r[0], r[1], r[2], r[3], r[4]]);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(7301)').catch(() => {});
    client.release();
  }
}

async function close() {
  if (!pool) return;
  const p = pool; pool = null;
  await p.end();
}

const ping = async () => { await q('SELECT 1'); return true; };

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
async function newCode() {
  for (;;) {
    const bytes = crypto.randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    const { rowCount } = await q('SELECT 1 FROM appointments WHERE code = $1', [code]);
    if (!rowCount) return code;
  }
}

// ---------- disponibilidad ----------
/** Citas activas del día: [{ time, slots }] */
async function activeTimes(date, excludeId = 0) {
  const { rows } = await q(
    "SELECT time, slots FROM appointments WHERE date = $1 AND status <> 'cancelled' AND id <> $2", [date, excludeId]);
  return rows.map((r) => ({ time: r.time, slots: Number(r.slots) || 1 }));
}

const blocksFor = async (date) => (await q('SELECT id, date, time, reason FROM blocks WHERE date = $1', [date])).rows;

/**
 * Turnos fijos que tocan en `date` (mismo día de la semana y, si es cada 2 semanas,
 * la semana que corresponde). Con includeSkipped también los liberados ese día (skipped: true).
 */
async function fixedFor(date, { includeSkipped = false } = {}) {
  const { rows } = await q(
    `SELECT f.*, EXISTS (SELECT 1 FROM fixed_skips s WHERE s.fixed_id = f.id AND s.date = $2) AS skipped
       FROM fixed_slots f WHERE f.dow = $1 AND f.start_date <= $2 ORDER BY f.time`,
    [dayOfWeek(date), date]);
  return rows
    .filter((f) => (daysBetween(f.start_date, date) / 7) % f.every === 0)
    .filter((f) => includeSkipped || !f.skipped);
}

/** Todo lo que ocupa horas ese día: citas activas + turnos fijos (con fixed: true). */
async function busyFor(date, excludeId = 0) {
  const [appts, fixed] = await Promise.all([activeTimes(date, excludeId), fixedFor(date)]);
  return [...appts, ...fixed.map((f) => ({ time: f.time, slots: 1, fixed: true, name: f.name }))];
}

/** ¿Choca con otra cita activa o con un turno fijo? (cada cita ocupa `slots` horas) */
async function hasConflict(date, time, excludeId = 0, slots = 1) {
  const s = toMin(time);
  const e = s + slots * SLOT_MIN;
  return (await busyFor(date, excludeId)).some((a) => {
    const as = toMin(a.time);
    return s < as + a.slots * SLOT_MIN && as < e;
  });
}

const countFuturePhone = async (phone, today) => (await q(
  "SELECT COUNT(*) AS c FROM appointments WHERE phone = $1 AND status = 'confirmed' AND date >= $2", [phone, today])).rows[0].c;

// ---------- citas ----------
async function insertAppointment(data) {
  const code = await newCode();
  const { rows } = await q(
    `INSERT INTO appointments (code, manage_token, name, phone, service, slots, note, date, time, status, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [code, newToken(), data.name, data.phone, data.service || '', data.slots === 2 ? 2 : 1, data.note || '',
      data.date, data.time, data.status || 'confirmed', data.source || 'web']);
  return rows[0];
}

const UPDATABLE = ['name', 'phone', 'note', 'date', 'time', 'status'];
async function updateAppointment(id, fields) {
  const sets = [];
  const params = [];
  for (const k of UPDATABLE) {
    if (fields[k] !== undefined) { params.push(fields[k]); sets.push(`${k} = $${params.length}`); }
  }
  if (fields.resetReminder) sets.push('reminder_sent = FALSE', 'reminder_attempts = 0');
  if (!sets.length) return getAppointment(id);
  sets.push('updated_at = now()');
  params.push(id);
  const { rows } = await q(`UPDATE appointments SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  return rows[0];
}

async function listAppointments({ from, to, status, q: search, limit = 500 }) {
  const where = [];
  const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  if (from) where.push(`date >= ${add(from)}`);
  if (to) where.push(`date <= ${add(to)}`);
  if (status === 'active') where.push("status = 'confirmed'");
  else if (['confirmed', 'completed', 'no_show', 'cancelled'].includes(status)) where.push(`status = ${add(status)}`);
  if (search) {
    const like = add(`%${search}%`);
    const parts = [`name ILIKE ${like}`, `code ILIKE ${like}`];
    const digits = search.replace(/\D/g, '');
    if (digits.length >= 3) parts.push(`phone LIKE ${add(`%${digits}%`)}`);
    where.push(`(${parts.join(' OR ')})`);
  }
  const sql = `SELECT * FROM appointments ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY date, time LIMIT ${add(limit)}`;
  return (await q(sql, params)).rows;
}

const getAppointment = async (id) => (await q('SELECT * FROM appointments WHERE id = $1', [id])).rows[0];
const getAppointmentByToken = async (token) => (typeof token === 'string' && token
  ? (await q('SELECT * FROM appointments WHERE manage_token = $1', [token])).rows[0] : undefined);
const deleteAppointment = async (id) => (await q('DELETE FROM appointments WHERE id = $1', [id])).rowCount;

// ---------- bloqueos ----------
const addBlock = async (date, time, reason) => (await q(
  'INSERT INTO blocks (date, time, reason) VALUES ($1, $2, $3) RETURNING *', [date, time, reason])).rows[0];
const getBlock = async (id) => (await q('SELECT * FROM blocks WHERE id = $1', [id])).rows[0];
const deleteBlock = async (id) => (await q('DELETE FROM blocks WHERE id = $1', [id])).rowCount;
const listBlocks = async (from) => (await q('SELECT * FROM blocks WHERE date >= $1 ORDER BY date, time', [from])).rows;

// ---------- turnos fijos ----------
const listFixed = async () => (await q('SELECT * FROM fixed_slots ORDER BY dow, time')).rows;
const getFixed = async (id) => (await q('SELECT * FROM fixed_slots WHERE id = $1', [id])).rows[0];
const addFixed = async (f) => (await q(
  `INSERT INTO fixed_slots (dow, time, name, phone, every, start_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
  [f.dow, f.time, f.name, f.phone, f.every, f.start_date])).rows[0];
const updateFixed = async (id, f) => (await q(
  `UPDATE fixed_slots SET dow = $1, time = $2, name = $3, phone = $4, every = $5, start_date = $6 WHERE id = $7 RETURNING *`,
  [f.dow, f.time, f.name, f.phone, f.every, f.start_date, id])).rows[0];
const deleteFixed = async (id) => (await q('DELETE FROM fixed_slots WHERE id = $1', [id])).rowCount;
const skipFixed = (id, date) => q('INSERT INTO fixed_skips (fixed_id, date) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, date]);
const unskipFixed = (id, date) => q('DELETE FROM fixed_skips WHERE fixed_id = $1 AND date = $2', [id, date]);

// ---------- recordatorios ----------
/** Citas confirmadas con recordatorio pendiente, de hoy y mañana. */
const pendingReminders = async (today, tomorrow) => (await q(
  `SELECT * FROM appointments
    WHERE status = 'confirmed' AND NOT reminder_sent AND reminder_attempts < 5 AND date >= $1 AND date <= $2
    ORDER BY date, time`, [today, tomorrow])).rows;
const markReminderSent = (id) => q('UPDATE appointments SET reminder_sent = TRUE WHERE id = $1', [id]);
const bumpReminderAttempts = (id) => q('UPDATE appointments SET reminder_attempts = reminder_attempts + 1 WHERE id = $1', [id]);
const fixedRemindedIds = async (date) => new Set((await q('SELECT fixed_id FROM fixed_reminders WHERE date = $1', [date])).rows.map((r) => r.fixed_id));
const markFixedReminded = (id, date) => q('INSERT INTO fixed_reminders (fixed_id, date) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, date]);

// ---------- limpieza ----------
/** Borra citas, bloqueos y marcas de turnos fijos con fecha anterior a `date`. Devuelve cuántas citas borró. */
async function purgeBefore(date) {
  await q('DELETE FROM blocks WHERE date < $1', [date]);
  await q('DELETE FROM fixed_skips WHERE date < $1', [date]);
  await q('DELETE FROM fixed_reminders WHERE date < $1', [date]);
  return (await q('DELETE FROM appointments WHERE date < $1', [date])).rowCount;
}

module.exports = {
  init, close, ping, tx, lockDay,
  activeTimes, blocksFor, fixedFor, busyFor, hasConflict, countFuturePhone,
  insertAppointment, updateAppointment, listAppointments, getAppointment, getAppointmentByToken, deleteAppointment,
  addBlock, getBlock, deleteBlock, listBlocks,
  listFixed, getFixed, addFixed, updateFixed, deleteFixed, skipFixed, unskipFixed,
  pendingReminders, markReminderSent, bumpReminderAttempts, fixedRemindedIds, markFixedReminded,
  purgeBefore,
};
