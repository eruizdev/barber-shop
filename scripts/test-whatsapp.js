'use strict';
// Manda un mensaje de prueba por WAHA para comprobar que el WhatsApp quedó vinculado.
// En el servidor:   docker compose exec app node scripts/test-whatsapp.js 3001234567
const wa = require('../src/whatsapp');
const cfg = require('../src/config');

(async () => {
  const phone = process.argv[2];
  const st = await wa.status();
  console.log(`Estado de WhatsApp en WAHA: ${st || 'sin respuesta'}`);
  if (st !== 'WORKING') {
    console.log('Todavía no está vinculado: abre el panel de WAHA y escanea el QR (DEPLOY.md, sección 4).');
    process.exit(1);
  }
  if (!phone) { console.log('Está listo. Para mandar una prueba: node scripts/test-whatsapp.js 3001234567'); return; }
  await wa.sendText(phone, `Prueba de ${cfg.name}: si ves este mensaje, los recordatorios por WhatsApp funcionan ✅`);
  console.log(`Mensaje enviado a ${wa.toChatId(phone)}`);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
