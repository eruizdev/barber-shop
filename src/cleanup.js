'use strict';
// Limpieza automática para no llenar la base de datos:
// borra las citas (y bloqueos) cuya fecha ya pasó hace más de HISTORY_DAYS días.
const cfg = require('./config');
const repo = require('./db');
const { nowParts, addDays } = require('./schedule');

const EVERY_MS = 6 * 3600 * 1000; // cada 6 horas

/** Borra lo anterior a (hoy - HISTORY_DAYS). Devuelve cuántas citas borró. */
function purge(today = nowParts().date) {
  const cutoff = addDays(today, -cfg.historyDays);
  const removed = repo.purgeBefore(cutoff);
  if (removed) console.log(`[limpieza] ${removed} cita(s) anteriores al ${cutoff} borradas`);
  return removed;
}

function start() {
  const run = () => { try { purge(); } catch (e) { console.error('[limpieza]', e.message); } };
  run();
  setInterval(run, EVERY_MS).unref();
}

module.exports = { purge, start };
