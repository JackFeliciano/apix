// The demo server. It mounts the showroom module and serves one page on the same
// origin, so a reader can open it and press the buttons without a build step.
//
//   node demo/server.js
//
// The demo minting secret is fixed and public on purpose: this server is for
// showing what the layers do. Never run it where anyone real can reach it.
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

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const pagePath = path.join(here, 'index.html');

const SECRET = 'showroom-demo-signing-secret';
const TENANTS = ['acme', 'globex'];
const PERMS = ['show.read', 'show.write', 'show.delete'];

function buildDemo() {
  const data = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? root), 'apix-demo-'));
  const store = new Store(path.join(data, 'store'));
  const bus = new Bus();
  const ledger = new Ledger(store);
  const files = new FileStore(path.join(data, 'files'));

  // The demo keeps a log of every event the bus carried, so the page can show them.
  const log = [];
  for (const topic of ['show.item.kept', 'show.money.moved']) {
    bus.on(topic, (event) => log.push(event));
  }

  const runtime = new Runtime({ secret: SECRET, modules: [showroom], bus, ledger, files });
  runtime.store = store;
  runtime.events = log;
  runtime.dataDir = data;
  return runtime;
}

function tokenFor(tenant, perms) {
  return sign({ tenant, sub: `demo_${perms.length}`, perms }, SECRET, 3600);
}

function servePage(res, runtime) {
  const html = fs.readFileSync(pagePath, 'utf8');
  const tokens = Object.fromEntries(TENANTS.map((t) => [t, tokenFor(t, PERMS)]));
  const readOnly = Object.fromEntries(TENANTS.map((t) => [t, tokenFor(t, ['show.read'])]));
  const seed = { tenants: TENANTS, tokens, readOnly };
  const injected = html.replace('__DEMO_SEED__', JSON.stringify(seed));
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(injected),
  });
  res.end(injected);
}

export function start(port = Number(process.env.APIX_DEMO_PORT ?? 8090)) {
  const runtime = buildDemo();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      servePage(res, runtime);
      return;
    }
    if (url.pathname === '/demo/events') {
      const tenant = url.searchParams.get('tenant');
      const events = tenant ? runtime.bus.events(tenant) : [];
      const body = JSON.stringify({ data: { events }, meta: { count: events.length } });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(body);
      return;
    }
    runtime.handle(req, res);
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, runtime, port: server.address().port }));
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const { port, runtime } = await start();
  console.log(`showroom demo listening on http://127.0.0.1:${port}`);
  console.log(`  data in ${runtime.dataDir}`);
  for (const module of runtime.modules) {
    console.log(`  module ${module.name}@${module.version}`);
    for (const route of module.routes) {
      console.log(`    ${route.method.padEnd(6)} ${route.path}  (${route.permission})`);
    }
  }
}
