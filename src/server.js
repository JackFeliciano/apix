import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Runtime } from './runtime.js';
import { Bus } from './bus.js';
import { Ledger } from './ledger.js';
import { FileStore } from './files.js';
import { Store } from './store.js';
import { tokenCommand } from './cli.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const SECRET = process.env.APIX_SECRET ?? 'apix-dev-secret-change-me';
const PORT = Number(process.env.APIX_PORT ?? 8080);
const DATA = process.env.APIX_DATA ?? path.join(root, '.data');
const CORS = (process.env.APIX_CORS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export async function buildRuntime({ secret = SECRET, data = DATA, cors = CORS } = {}) {
  fs.mkdirSync(data, { recursive: true });
  const store = new Store(path.join(data, 'store'));
  const bus = new Bus();
  const ledger = new Ledger(store);
  const files = new FileStore(path.join(data, 'files'));

  const { shop } = await import('../modules/fake_shop/index.js');
  const { fakeLedger, listenToShop } = await import('../modules/fake_ledger/index.js');
  listenToShop(bus);

  const runtime = new Runtime({ secret, modules: [shop, fakeLedger], bus, ledger, files, cors });
  runtime.store = store;
  runtime.storeDir = path.join(data, 'store');
  return runtime;
}

// The issuer. A module never mints a token, so this lives with the server.
export async function issue({ tenant, sub, perms, ttl = 900 }) {
  const { sign } = await import('./token.js');
  return sign({ tenant, sub, perms }, SECRET, ttl);
}

if (process.argv[2] === 'token') {
  await tokenCommand();
} else if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const runtime = await buildRuntime();
  const server = runtime.listener();
  server.listen(PORT, () => {
    console.log(`apix listening on http://localhost:${PORT}`);
    for (const module of runtime.modules) {
      console.log(`  module ${module.name}@${module.version}`);
      for (const route of module.routes) {
        console.log(`    ${route.method.padEnd(6)} ${route.path}  (${route.permission})`);
      }
    }
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export { http };
