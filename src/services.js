'use strict';
// Catálogo de servicios para el formulario de reserva.
// Las mensualidades no van aquí: se compran por WhatsApp (ver public/index.html).
// Si cambias un precio aquí, cámbialo también en public/index.html (sección de precios).

const SERVICES = [
  { id: 'corte-clasico', group: 'Cortes', name: 'Corte clásico', price: 23000 },
  { id: 'corte-premium', group: 'Cortes', name: 'Corte premium', price: 24000 },
  { id: 'premium-barba', group: 'Cortes', name: 'Premium con barba', price: 26000 },
  { id: 'vip-1', group: 'VIP', name: 'VIP 1', price: 75000 },
  { id: 'vip-clasico', group: 'VIP', name: 'VIP clásico', price: 93000 },
  { id: 'vip-premium', group: 'VIP', name: 'VIP premium', price: 94000 },
  { id: 'vip-premium-barba', group: 'VIP', name: 'VIP premium con barba', price: 96000 },
  { id: 'limpieza-facial', group: 'Otros servicios', name: 'Limpieza facial', price: 75000, noAddon: true },
];

// Adicional que se suma a cualquier corte
const ADDON = { id: 'aerografo', name: 'Diseño con aerógrafo', price: 7000 };

const byId = new Map(SERVICES.map((s) => [s.id, s]));
const money = (n) => '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); // 7000 -> $7.000

/**
 * Valida la elección y devuelve el texto que se guarda en la cita,
 * ej. "Corte premium + Diseño con aerógrafo · $31.000". null si no es válida.
 */
function describeChoice(serviceId, withAddon) {
  const s = byId.get(serviceId);
  if (!s) return null;
  const addon = Boolean(withAddon) && !s.noAddon;
  const total = s.price + (addon ? ADDON.price : 0);
  return `${s.name}${addon ? ` + ${ADDON.name}` : ''} · ${money(total)}`;
}

module.exports = { SERVICES, ADDON, describeChoice };
