'use strict';
const { holidayName } = require('./holidays');

// Colombia es UTC-5 todo el año (sin horario de verano).
const OFFSET_MS = 5 * 3600 * 1000;
const SLOT_MIN = 60; // 1 reserva = 1 hora

// Lunes a miércoles y festivos: 8-11 y 14-20
const RANGES_MON_WED = [[8 * 60, 11 * 60], [14 * 60, 20 * 60]];
// Jueves a sábado: continuo 8-20
const RANGES_THU_SAT = [[8 * 60, 20 * 60]];
// Domingo: cerrado (salvo que sea festivo: usa el horario de festivos)

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const pad = (n) => String(n).padStart(2, '0');

function isDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const isTimeStr = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** Fecha y minutos actuales en hora de Colombia. */
function nowParts(nowMs = Date.now()) {
  const d = new Date(nowMs - OFFSET_MS);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const dayOfWeek = (dateStr) => new Date(dateStr + 'T00:00:00Z').getUTCDay();

/** Instante UTC (ms) de una cita en hora Colombia. */
function startMs(dateStr, time) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, mi) + OFFSET_MS;
}

/** Horario base de un día: festivo, día de semana, horas de inicio posibles. */
function dayInfo(dateStr) {
  const holiday = holidayName(dateStr);
  const dow = dayOfWeek(dateStr);
  let ranges = [];
  if (holiday || (dow >= 1 && dow <= 3)) ranges = RANGES_MON_WED;
  else if (dow >= 4 && dow <= 6) ranges = RANGES_THU_SAT;

  const starts = [];
  for (const [a, b] of ranges) {
    for (let t = a; t + SLOT_MIN <= b; t += SLOT_MIN) starts.push(toTime(t));
  }
  return { date: dateStr, dow, holiday, open: starts.length > 0, starts };
}

/**
 * Ventana de reservas: bloques de 14 días (lunes a domingo x2) contados desde
 * `anchor` (un lunes). Domingo por medio, a la hora `openTime` (hora Colombia),
 * se abre el bloque siguiente: el domingo antes de que empiece.
 * nowMinutes: minutos del día actual en hora Colombia.
 */
function bookingWindow(todayStr, anchorStr, nowMinutes = 0, openTime = '08:00') {
  // Desde la hora de apertura del domingo ya cuenta el bloque que empieza el lunes.
  const effective = nowMinutes >= toMin(openTime) ? addDays(todayStr, 1) : todayStr;
  const idx = Math.floor(daysBetween(anchorStr, effective) / 14);
  const start = addDays(anchorStr, idx * 14);
  const end = addDays(start, 13);
  return {
    start,
    end,
    firstBookable: todayStr > start ? todayStr : start,
    nextUnlock: end,          // domingo en que se abre el siguiente bloque
    nextUnlockTime: openTime, // a esta hora
  };
}

/**
 * Estado de cada hora de un día.
 * busyTimes: horas de citas activas ('HH:MM'); blocks: [{time|null}].
 */
function computeSlots(dateStr, { busyTimes = [], blocks = [], nowMs = Date.now(), minLeadMin = 60 } = {}) {
  const info = dayInfo(dateStr);
  const wholeDayBlocked = blocks.some((b) => !b.time);
  const blocked = blocks.filter((b) => b.time).map((b) => toMin(b.time));
  const busy = busyTimes.map(toMin);
  const limit = nowMs + minLeadMin * 60000;

  return info.starts.map((time) => {
    const s = toMin(time);
    let reason = null;
    if (wholeDayBlocked) reason = 'blocked';
    else if (startMs(dateStr, time) < limit) reason = 'past';
    else if (busy.some((b) => Math.abs(b - s) < SLOT_MIN)) reason = 'taken';
    else if (blocked.some((b) => Math.abs(b - s) < SLOT_MIN)) reason = 'blocked';
    return { time, available: !reason, reason };
  });
}

function formatDateEs(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

function format12(time) {
  let [h, m] = time.split(':').map(Number);
  const ap = h >= 12 ? 'p. m.' : 'a. m.';
  h = h % 12 || 12;
  return `${h}:${pad(m)} ${ap}`;
}

module.exports = {
  SLOT_MIN, OFFSET_MS,
  isDateStr, isTimeStr, toMin, toTime,
  nowParts, addDays, daysBetween, dayOfWeek, startMs,
  dayInfo, bookingWindow, computeSlots,
  formatDateEs, format12,
};
