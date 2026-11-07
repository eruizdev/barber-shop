'use strict';
// Festivos de Colombia (Ley 51 de 1983 "Ley Emiliani"), calculados por año.

const pad = (n) => String(n).padStart(2, '0');
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

// Si el festivo no cae lunes, se traslada al lunes siguiente.
function nextMonday(d) {
  const dow = d.getUTCDay(); // 0 = domingo
  return addDays(d, dow === 1 ? 0 : (8 - dow) % 7);
}

// Domingo de Pascua (algoritmo de Meeus/Jones/Butcher)
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(y, month, day);
}

const cache = new Map();

function holidaysOf(y) {
  if (cache.has(y)) return cache.get(y);
  const map = new Map();
  const add = (d, name) => map.set(fmt(d), name);

  // Fijos
  add(utc(y, 1, 1), 'Año Nuevo');
  add(utc(y, 5, 1), 'Día del Trabajo');
  add(utc(y, 7, 20), 'Día de la Independencia');
  add(utc(y, 8, 7), 'Batalla de Boyacá');
  add(utc(y, 12, 8), 'Inmaculada Concepción');
  add(utc(y, 12, 25), 'Navidad');

  // Trasladados al lunes
  add(nextMonday(utc(y, 1, 6)), 'Reyes Magos');
  add(nextMonday(utc(y, 3, 19)), 'San José');
  add(nextMonday(utc(y, 6, 29)), 'San Pedro y San Pablo');
  add(nextMonday(utc(y, 8, 15)), 'Asunción de la Virgen');
  add(nextMonday(utc(y, 10, 12)), 'Día de la Raza');
  add(nextMonday(utc(y, 11, 1)), 'Todos los Santos');
  add(nextMonday(utc(y, 11, 11)), 'Independencia de Cartagena');

  // Dependen de la Pascua
  const e = easter(y);
  add(addDays(e, -3), 'Jueves Santo');
  add(addDays(e, -2), 'Viernes Santo');
  add(nextMonday(addDays(e, 39)), 'Ascensión del Señor');
  add(nextMonday(addDays(e, 60)), 'Corpus Christi');
  add(nextMonday(addDays(e, 68)), 'Sagrado Corazón');

  cache.set(y, map);
  return map;
}

/** Devuelve el nombre del festivo para 'YYYY-MM-DD' o null. */
function holidayName(dateStr) {
  const y = Number(dateStr.slice(0, 4));
  return holidaysOf(y).get(dateStr) || null;
}

module.exports = { holidayName, holidaysOf };
