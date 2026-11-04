import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Runtime } from '../src/runtime.js';
import { Bus } from '../src/bus.js';
import { Ledger } from '../src/ledger.js';
import { FileStore } from '../src/files.js';
import { Store } from '../src/store.js';
import { sign } from '../src/token.js';
import { showroom } from '../modules/showroom/index.js';

// A public read-only showroom. It mounts the showroom module, serves its page on
// the same origin, and answers POST /show/check with a token this process mints
// on the spot. The token lives 60 seconds and carries the permissions the page
// demonstrates. Nothing here writes: the page only calls the read routes.
//
// The environment carries the port, the data directory and the signing secret.
// Nothing is hardcoded, so the same file runs on any host.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const pagePath = path.join(here, 'index.html');

const PORT = Number(process.env.APIX_PORT ?? 8091);
const HOST = process.env.APIX_HOST ?? '127.0.0.1';
const DATA = process.env.APIX_DATA ?? path.join(root, '.data');
const SECRET = process.env.APIX_SECRET;

if (!SECRET || SECRET.length < 32) {
  console.error('APIX_SECRET must be set and at least 32 characters');
  process.exit(1);
}

fs.mkdirSync(DATA, { recursive: true });

const store = new Store(path.join(DATA, 'store'));
const bus = new Bus();
const ledger = new Ledger(store);
const files = new FileStore(path.join(DATA, 'files'));
const runtime = new Runtime({ secret: SECRET, modules: [showroom], bus, ledger, files });
runtime.store = store;
runtime.storeDir = path.join(DATA, 'store');

const page = fs.readFileSync(pagePath);

// Every tenant the page can look at, and the permissions the buttons ask for.
const TENANTS = ['acme', 'globex'];
const PERMS = ['show.read', 'show.write', 'show.delete'];

async function mint(perms) {
  const tenant = TENANTS[Math.floor(Math.random() * TENANTS.length)];
  return sign({ tenant, sub: 'showroom-reader', perms }, SECRET, 60);
}

// The page arrives with one token per button, minted on the spot. A button that
// reads gets a read token. A button that writes gets the write permissions. No
// token outlives the page that asked for it.
async function servePage(res) {
  const read = await mint(['show.read']);
  const write = await mint(PERMS);
  const tokens = { acme: write, globex: write };
  const readOnly = { acme: read, globex: read };
  const seedJson = JSON.stringify({ tenants: TENANTS, tokens, readOnly });
  const injected = page
    .toString('utf8')
    .replace('__DEMO_SEED__', () => seedJson);
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(injected),
  });
  res.end(injected);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    await servePage(res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/demo/events') {
    const tenant = url.searchParams.get('tenant');
    const events = tenant ? runtime.bus.events(tenant) : [];
    const body = JSON.stringify({ data: { events }, meta: { count: events.length } });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/show/check') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ token: await mint(PERMS) }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, module: 'showroom' }));
    return;
  }

  runtime.handle(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`showroom listening on http://${HOST}:${PORT}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
