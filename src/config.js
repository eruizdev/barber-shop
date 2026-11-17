'use strict';
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const num = (v, d) => {
  if (v === undefined || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Falta SESSION_SECRET en el .env (obligatorio en producción).');
  }
  sessionSecret = crypto.randomBytes(32).toString('hex'); // solo desarrollo
}

module.exports = {
  port: num(process.env.PORT, 3000),
  name: process.env.BUSINESS_NAME || 'Sebas Barber',
  whatsapp: (process.env.BUSINESS_WHATSAPP || '').replace(/\D/g, ''),
  // Lunes desde el que se cuentan los bloques de 2 semanas del calendario.
  anchor: process.env.BOOKING_ANCHOR || '2026-11-02',
  // Hora (Colombia) del domingo en que se abre el siguiente bloque de 2 semanas.
  openTime: process.env.BOOKING_OPEN_TIME || '08:00',
  minLeadMin: num(process.env.MIN_LEAD_MINUTES, 60),
  maxActivePerPhone: num(process.env.MAX_ACTIVE_PER_PHONE, 2),
  // Reservas por hora que puede hacer una misma conexión (anti-abuso)
  bookLimitPerHour: num(process.env.BOOK_LIMIT_PER_HOUR, 12),
  // Días que se guarda una cita después de su fecha; luego se borra sola.
  historyDays: Math.max(0, num(process.env.HISTORY_DAYS, 3)),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  trustProxy: process.env.TRUST_PROXY === 'true',
  sessionSecret,
  // URL pública del sitio, para los links que se envían por WhatsApp. Ej: https://sebasbarber.com
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  // PostgreSQL. Ej: postgres://usuario:clave@localhost:5432/sebasbarber
  databaseUrl: process.env.DATABASE_URL || '',
  dbPoolMax: Math.max(1, num(process.env.DB_POOL_MAX, 10)),
  // WAHA: envía mensajes desde tu WhatsApp Business (confirmación al reservar y recordatorio)
  waha: {
    enabled: process.env.WHATSAPP_ENABLED === 'true',
    url: (process.env.WAHA_URL || 'http://waha:3000').replace(/\/+$/, ''),
    session: process.env.WAHA_SESSION || 'default',
    apiKey: process.env.WAHA_API_KEY || '',
    // Minutos antes de la cita en que se manda el recordatorio
    reminderMinutes: num(process.env.REMINDER_MINUTES_BEFORE, 60),
    // 0 (por defecto) = el recordatorio se manda siempre que la cita esté dentro de la última hora,
    // aunque se haya agendado hace poco (ej. a las 10:15 p. m. para las 11:00 p. m.: sale de una vez).
    // Si pones N > 0, no se manda a citas agendadas (o cambiadas) con menos de N minutos de anticipación.
    skipIfBookedWithinMin: num(process.env.REMINDER_SKIP_IF_BOOKED_WITHIN_MIN, 0),
    // A quién avisar por WhatsApp cuando un cliente reserva, cambia o cancela (uno o varios, separados por coma).
    // Vacío = al BUSINESS_WHATSAPP. "off" = no avisar por WhatsApp.
    adminNotify: (() => {
      const raw = (process.env.ADMIN_NOTIFY_WHATSAPP || '').trim();
      if (raw.toLowerCase() === 'off') return [];
      const list = raw ? raw.split(',') : [process.env.BUSINESS_WHATSAPP || ''];
      return list.map((p) => p.replace(/\D/g, '')).filter((p) => p.length >= 10);
    })(),
    // Pausa (aprox.) entre un mensaje y otro cuando hay varios, para no parecer un robot
    pauseMs: num(process.env.REMINDER_PAUSE_MS, 2500),
  },
};
