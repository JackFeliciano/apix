import http from 'node:http';
import { verify, bearer } from './token.js';
import { ok, fail, send, requestId } from './envelope.js';

const MAX_BODY = 1024 * 1024;

export class Runtime {
  constructor({ secret, modules = [], bus, ledger, files, cors = [], clock = () => new Date() }) {
    if (typeof secret !== 'string' || secret.length < 16) {
      throw new Error('runtime secret must be at least 16 characters');
    }
    this.secret = secret;
    this.modules = [];
    this.bus = bus;
    this.ledger = ledger;
    this.files = files;
    this.cors = new Set(cors);
    this.clock = clock;
    this.failures = [];
    for (const module of modules) this.mount(module);
  }

  mount(module) {
    this.modules.push(module);
  }

  // One rule for permissions, read off the manifest. A module never checks a token.
  route(method, path) {
    for (const module of this.modules) {
      for (const route of module.routes) {
        if (route.method !== method) continue;
        const params = matchPath(route.path, path);
        if (params) return { module, route, params };
      }
    }
    return null;
  }

  listener() {
    return http.createServer((req, res) => this.handle(req, res));
  }

  async handle(req, res) {
    const id = requestId();
    const meta = { request_id: id, at: this.clock().toISOString() };

    const origin = req.headers.origin;
    const corsHeaders = {};
    if (origin && this.cors.has(origin)) {
      corsHeaders['access-control-allow-origin'] = origin;
      corsHeaders['access-control-allow-credentials'] = 'true';
      corsHeaders['vary'] = 'origin';
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders,
        'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type, x-request-id',
        'access-control-max-age': '600',
      });
      res.end();
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const found = this.route(req.method, url.pathname);
    if (!found) {
      send(res, 404, fail('route_not_found', `no route for ${req.method} ${url.pathname}`, null, meta), corsHeaders);
      return;
    }

    const token = bearer(req.headers.authorization);
    const checked = verify(token, this.secret);
    if (!checked.ok) {
      send(res, 401, fail(checked.code, 'the token did not verify', null, meta), corsHeaders);
      return;
    }

    const { claims } = checked;
    if (!grants(claims, found.route.permission)) {
      send(res, 403, fail('permission_denied', `missing permission ${found.route.permission}`, null, meta), corsHeaders);
      return;
    }

    let body = null;
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      try {
        body = await readJson(req);
      } catch (error) {
        send(res, 400, fail(error.code ?? 'bad_json', error.message, null, meta), corsHeaders);
        return;
      }
    }

    const ctx = {
      request_id: id,
      at: this.clock(),
      tenant: claims.tenant,
      subject: claims.sub,
      claims,
      params: found.params,
      query: Object.fromEntries(url.searchParams),
      body,
      store: this.store,
      ledger: this.ledger,
      bus: this.bus,
      files: this.files,
      runtime: this,
    };

    try {
      const result = await found.route.handler(ctx);
      const payload = result && typeof result === 'object' && 'data' in result
        ? result
        : ok(result ?? null);
      payload.meta = { ...payload.meta, ...meta };
      send(res, 200, payload, corsHeaders);
    } catch (error) {
      const status = error.status ?? 500;
      const code = error.code ?? 'internal_error';
      this.failures.push({ request_id: id, code, at: meta.at, route: `${req.method} ${url.pathname}` });
      send(res, status, fail(code, error.message ?? 'request failed', null, meta), corsHeaders);
    }
  }
}

function grants(claims, permission) {
  const list = Array.isArray(claims.perms) ? claims.perms : [];
  return list.includes(permission) || list.includes('*');
}

function matchPath(pattern, actual) {
  const p = pattern.split('/').filter(Boolean);
  const a = actual.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i += 1) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        const error = new Error('body too large');
        error.code = 'body_too_large';
        error.status = 413;
        req.destroy();
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        const error = new Error('body is not valid json');
        error.code = 'bad_json';
        error.status = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}
