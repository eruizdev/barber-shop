'use strict';
const assert = require('assert');
const { holidaysOf, holidayName } = require('../src/holidays');
const S = require('../src/schedule');

// ---- Festivos Colombia 2026 (calendario oficial)
const esperados2026 = [
  '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01',
  '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07',
  '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25',
];
assert.deepStrictEqual([...holidaysOf(2026).keys()].sort(), esperados2026);

// ---- Festivos 2027 (spot check)
assert.strictEqual(holidayName('2027-03-22'), 'San José');
assert.strictEqual(holidayName('2027-03-25'), 'Jueves Santo');
assert.strictEqual(holidayName('2027-03-26'), 'Viernes Santo');

// ---- Horarios
const lun = S.dayInfo('2026-11-09'); // lunes normal
assert.strictEqual(lun.holiday, null);
assert.deepStrictEqual(lun.starts, ['08:00', '09:00', '10:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00']);

const mie = S.dayInfo('2026-11-11'); // miércoles
assert.deepStrictEqual(mie.starts, lun.starts);

const jue = S.dayInfo('2026-11-12'); // jueves: continuo 8-20
assert.deepStrictEqual(jue.starts, ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19'].map((h) => `${h}:00`));
assert.deepStrictEqual(S.dayInfo('2026-11-14').starts, jue.starts); // sábado

assert.strictEqual(S.dayInfo('2026-11-15').open, false); // domingo cerrado

// Festivo (lunes 16 nov) y festivo entre jueves-sábado (Viernes Santo 3 abr) usan horario L-M-X
const fest = S.dayInfo('2026-11-16');
assert.strictEqual(fest.holiday, 'Independencia de Cartagena');
assert.deepStrictEqual(fest.starts, lun.starts);
assert.deepStrictEqual(S.dayInfo('2026-04-03').starts, lun.starts);
assert.strictEqual(S.dayInfo('2026-12-25').starts.length, 9); // viernes festivo

// ---- Ventana de 2 semanas (ancla lunes 2026-11-02)
let w = S.bookingWindow('2026-11-06', '2026-11-02', 10 * 60);
assert.deepStrictEqual([w.start, w.end, w.firstBookable, w.nextUnlock, w.nextUnlockTime], ['2026-11-02', '2026-11-15', '2026-11-06', '2026-11-15', '08:00']);
w = S.bookingWindow('2026-11-15', '2026-11-02', 7 * 60 + 59); // domingo 7:59 a. m.: aún no abre
assert.deepStrictEqual([w.start, w.end], ['2026-11-02', '2026-11-15']);
w = S.bookingWindow('2026-11-15', '2026-11-02', 8 * 60); // domingo 8:00 a. m.: se abre el siguiente
assert.deepStrictEqual([w.start, w.end, w.firstBookable], ['2026-11-16', '2026-11-29', '2026-11-16']);
w = S.bookingWindow('2026-11-22', '2026-11-02', 9 * 60); // domingo intermedio: no abre nada
assert.deepStrictEqual([w.start, w.end], ['2026-11-16', '2026-11-29']);
w = S.bookingWindow('2026-11-16', '2026-11-02', 0);
assert.deepStrictEqual([w.start, w.end, w.firstBookable], ['2026-11-16', '2026-11-29', '2026-11-16']);
w = S.bookingWindow('2026-10-30', '2026-11-02'); // antes del ancla también funciona
assert.deepStrictEqual([w.start, w.end], ['2026-10-19', '2026-11-01']);

// ---- Hora Colombia (UTC-5)
const utc = Date.UTC(2026, 10, 7, 2, 30); // 2026-11-07 02:30 UTC = 06 nov 21:30 Bogotá
assert.deepStrictEqual(S.nowParts(utc), { date: '2026-11-06', minutes: 21 * 60 + 30 });
assert.strictEqual(S.startMs('2026-11-06', '09:00'), Date.UTC(2026, 10, 6, 14, 0));

// ---- Disponibilidad
const now = S.startMs('2026-11-09', '08:30'); // lunes 8:30 am
let slots = S.computeSlots('2026-11-09', { nowMs: now, minLeadMin: 60 });
assert.strictEqual(slots.find((s) => s.time === '08:00').reason, 'past');
assert.strictEqual(slots.find((s) => s.time === '09:00').reason, 'past'); // menos de 60 min de anticipación
assert.strictEqual(slots.find((s) => s.time === '10:00').available, true);

slots = S.computeSlots('2026-11-10', { nowMs: now, busyTimes: ['09:00'], blocks: [{ time: '14:00' }] });
assert.strictEqual(slots.find((s) => s.time === '09:00').reason, 'taken');
assert.strictEqual(slots.find((s) => s.time === '14:00').reason, 'blocked');
assert.strictEqual(slots.find((s) => s.time === '15:00').available, true);

// una cita admin a las 10:30 ocupa 10:00 (porque se solapa)
slots = S.computeSlots('2026-11-10', { nowMs: now, busyTimes: ['09:30'] });
assert.strictEqual(slots.find((s) => s.time === '09:00').available, false);
assert.strictEqual(slots.find((s) => s.time === '10:00').available, false);
assert.strictEqual(slots.find((s) => s.time === '08:00').available, true);

slots = S.computeSlots('2026-11-10', { nowMs: now, blocks: [{ time: null }] });
assert.ok(slots.every((s) => !s.available));

assert.strictEqual(S.formatDateEs('2026-11-16'), 'lunes 16 de noviembre');
assert.strictEqual(S.format12('14:00'), '2:00 p. m.');
assert.strictEqual(S.format12('08:00'), '8:00 a. m.');

console.log('schedule.test.js OK');
