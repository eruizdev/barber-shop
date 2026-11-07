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
  // Días que se guarda una cita después de su fecha; luego se borra sola.
  historyDays: Math.max(0, num(process.env.HISTORY_DAYS, 3)),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  trustProxy: process.env.TRUST_PROXY === 'true',
  sessionSecret,
  // URL pública del sitio, para los links que se envían por WhatsApp. Ej: https://sebasbarber.com
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'sebasbarber.db'),
  wa: {
    enabled: process.env.WHATSAPP_ENABLED === 'true',
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    template: process.env.WHATSAPP_TEMPLATE || 'recordatorio_cita',
    // Plantilla que se envía al reservar o reprogramar, con el link de la cita.
    confirmTemplate: process.env.WHATSAPP_CONFIRM_TEMPLATE || 'confirmacion_cita',
    lang: process.env.WHATSAPP_LANG || 'es',
    hoursBefore: num(process.env.REMINDER_HOURS_BEFORE, 24),
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
  },
};
