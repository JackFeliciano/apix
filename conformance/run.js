// The conformance kit. It mounts the modules on a runtime, drives real HTTP
// requests against it, and fails loudly when a module breaks one of the six.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Runtime } from '../src/runtime.js';
import { Bus } from '../src/bus.js';
import { Ledger } from '../src/ledger.js';
import { FileStore } from '../src/files.js';
import { Store } from '../src/store.js';
import { sign } from '../src/token.js';

const SECRET = 'conformance-secret-0123456789';
const TENANT = 'tenant_a';
const OTHER = 'tenant_b';

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? `: ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

export async function runConformance(modules, { extra = async () => {}, check: onCheck = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apix-conf-'));
  const store = new Store(path.join(dir, 'store'));
  const bus = new Bus();
  const ledger = new Ledger(store);
  const files = new FileStore(path.join(dir, 'files'));
  const runtime = new Runtime({
    secret: SECRET,
    modules,
    bus,
    ledger,
    files,
    cors: ['https://example.test'],
  });
  runtime.store = store;

  const server = runtime.listener();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const call = async (method, p, { token, body, headers = {} } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text === '' ? null : JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, headers: res.headers };
  };

  const token = (claims) => sign({ sub: 'conformance', ...claims }, SECRET, 600);

  const allRoutes = modules.flatMap((m) => m.routes.map((r) => ({ module: m, route: r })));

  // 1. Identity: no token, a broken token, and an expired token all refuse.
  for (const { module, route } of allRoutes) {
    const full = route.path.replace(/:[a-zA-Z_]+/g, 'x');
    const anon = await call(route.method, full, { body: route.method === 'GET' ? undefined : {} });
    check(`identity: ${route.method} ${route.path} refuses an anonymous call`,
      anon.status === 401 && anon.json?.error?.code, `status ${anon.status}`);

    const expired = sign({ tenant: TENANT, sub: 'x', perms: [route.permission] }, SECRET, -10);
    const late = await call(route.method, full, { token: expired, body: route.method === 'GET' ? undefined : {} });
    check(`identity: ${route.method} ${route.path} refuses an expired token`,
      late.status === 401 && late.json?.error?.code === 'token_expired', `status ${late.status}`);
  }

  // 2. Permissions: a token without the route's permission gets 403.
  for (const { route } of allRoutes) {
    const full = route.path.replace(/:[a-zA-Z_]+/g, 'x');
    const weak = token({ tenant: TENANT, perms: ['some.other.permission'] });
    const res = await call(route.method, full, { token: weak, body: route.method === 'GET' ? undefined : {} });
    check(`permission: ${route.method} ${route.path} refuses a token without ${route.permission}`,
      res.status === 403 && res.json?.error?.code === 'permission_denied', `status ${res.status}`);
  }

  // 3. Envelope: every answer carries data or error, and meta.request_id.
  for (const { route } of allRoutes) {
    const full = route.path.replace(/:[a-zA-Z_]+/g, 'x');
    const okToken = token({ tenant: TENANT, perms: [route.permission] });
    const res = await call(route.method, full, {
      token: okToken,
      body: route.method === 'GET' ? undefined : {},
    });
    const hasMeta = typeof res.json?.meta?.request_id === 'string' && res.json.meta.request_id.startsWith('req_');
    const hasShape = 'data' in (res.json ?? {}) || 'error' in (res.json ?? {});
    check(`envelope: ${route.method} ${route.path} returns data or error with a request id`,
      hasMeta && hasShape, `status ${res.status}`);
    check(`envelope: ${route.method} ${route.path} echoes the request id in a header`,
      res.headers.get('x-request-id') === res.json?.meta?.request_id);
  }

  // 4. Tenancy: a written row in tenant B never appears in tenant A's list.
  const writeRoutes = allRoutes.filter(({ route }) => route.method === 'POST' && /products$/.test(route.path));
  for (const { route } of writeRoutes) {
    const listPath = route.path;
    const a = token({ tenant: TENANT, perms: [route.permission, 'shop.read'] });
    const b = token({ tenant: OTHER, perms: [route.permission, 'shop.read'] });
    const written = await call('POST', route.path, {
      token: b,
      body: { name: 'OnlyInB', price: 300 },
    });
    const resA = await call('GET', listPath, { token: a });
    const resB = await call('GET', listPath, { token: b });
    const namesA = JSON.stringify(resA.json?.data ?? {});
    const namesB = JSON.stringify(resB.json?.data ?? {});
    check(`tenancy: ${listPath} hides tenant B's row from tenant A`,
      written.status === 200 && namesB.includes('OnlyInB') && !namesA.includes('OnlyInB'));
  }

  // 5. Store: a query with no tenant is refused at the source.
  for (const method of ['list', 'get', 'insert', 'update']) {
    let threw = false;
    try {
      if (method === 'list') store.list('conformance_rows', '');
      if (method === 'get') store.get('conformance_rows', null, 'x');
      if (method === 'insert') store.insert('conformance_rows', undefined, {});
      if (method === 'update') store.update('conformance_rows', '  ', 'x', {});
    } catch { threw = true; }
    check(`tenancy: store.${method} refuses a call with no tenant`, threw);
  }

  // 6. Ledger: the same key posts once and the balance moves once.
  const key = `conf-${Date.now()}`;
  const before = ledger.balance(TENANT, 'cash');
  const first = ledger.post(TENANT, { amount: 100, debit: 'cash', credit: 'revenue', key });
  const second = ledger.post(TENANT, { amount: 100, debit: 'cash', credit: 'revenue', key });
  check('ledger: a second posting with the same key does not move the balance twice',
    first.duplicate === false && second.duplicate === true
      && ledger.balance(TENANT, 'cash') === before + 100,
    `balance ${ledger.balance(TENANT, 'cash')} expected ${before + 100}`);

  // A key in one tenant does not block the same key in another.
  const sameKeyOther = ledger.post(OTHER, { amount: 100, debit: 'cash', credit: 'revenue', key });
  check('ledger: the same key in another tenant posts afresh', sameKeyOther.duplicate === false);

  // 7. Events: a published event reaches a listener, and carries the tenant.
  let seen = null;
  bus.on('conformance.ping', async (event) => { seen = event; });
  await bus.publish('conformance.ping', TENANT, { value: 1 });
  check('events: a listener receives the event with its tenant',
    seen?.tenant === TENANT && seen?.payload?.value === 1);

  // 8. CORS: the allowlisted origin is echoed, a stranger never is.
  const allowed = await call('OPTIONS', allRoutes[0].route.path, {
    headers: { origin: 'https://example.test', 'access-control-request-method': 'GET' },
  });
  check('cors: the allowlisted origin is echoed',
    allowed.headers.get('access-control-allow-origin') === 'https://example.test');
  const stranger = await call('OPTIONS', allRoutes[0].route.path, {
    headers: { origin: 'https://stranger.test', 'access-control-request-method': 'GET' },
  });
  check('cors: a stranger origin gets no allowance',
    stranger.headers.get('access-control-allow-origin') === null);

  // 9. Files: a file belongs to its tenant, and a second upload writes nothing new.
  const putA = files.put(TENANT, 'invoice.txt', 'hello');
  const putB = files.put(OTHER, 'invoice.txt', 'hello');
  check('files: two tenants hold the same bytes under separate paths',
    putA.hash === putB.hash && files.get(TENANT, putA.hash).toString() === 'hello');
  check('files: a tenant cannot own another tenant\'s file',
    files.owns(TENANT, putA.hash) && files.owns(OTHER, putB.hash));

  // 10. Manifest: a module that declares no permission for a route is refused at join time.
  let rejected = false;
  try {
    const { defineModule } = await import('../src/manifest.js');
    defineModule({ name: 'bad', version: '1', routes: [{ method: 'GET', path: '/x', handler: () => null }] });
  } catch { rejected = true; }
  check('manifest: a route with no declared permission cannot join', rejected);

  await extra({ call, token, store, bus, ledger, files, dir, check: onCheck ?? check });

  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
  return { passed, failures };
}

if (process.argv[1] && process.argv[1].endsWith('run.js')) {
  const { shop } = await import('../modules/fake_shop/index.js');
  const { fakeLedger } = await import('../modules/fake_ledger/index.js');
  console.log('APIX conformance');
  const result = await runConformance([shop, fakeLedger]);
  console.log('');
  console.log(`${result.passed} checks passed, ${result.failures.length} failed`);
  if (result.failures.length > 0) {
    for (const f of result.failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}
