'use strict';
// Postgres para las pruebas.
// - Con TEST_DATABASE_URL usa esa base (ej. un Postgres de Docker).
// - Sin ella, levanta un Postgres real temporal (paquete embedded-postgres) y lo borra al terminar.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});

async function startTestDb() {
  if (process.env.TEST_DATABASE_URL) return { url: process.env.TEST_DATABASE_URL, stop: async () => {} };
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pg-'));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dir, user: 'postgres', password: 'test', port, persistent: false,
    onLog: () => {}, onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('sebasbarber');
  return {
    url: `postgres://postgres:test@127.0.0.1:${port}/sebasbarber`,
    stop: async () => { try { await pg.stop(); } catch (_) { /* ya parado */ } fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

module.exports = { startTestDb };
