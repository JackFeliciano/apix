// The data store. Every query goes through here and every query carries the tenant.
// There is no method that reads or writes a row without a tenant argument.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SAFE_NAME = /^[a-z][a-z0-9_]*$/;

export class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.files = new Map();
  }

  file(collection) {
    if (!SAFE_NAME.test(collection)) throw new Error(`bad collection name: ${collection}`);
    const full = path.join(this.dir, `${collection}.json`);
    if (!this.files.has(full)) this.files.set(full, this.#load(full));
    return this.files.get(full);
  }

  #load(full) {
    if (!fs.existsSync(full)) return { rows: [] };
    const raw = fs.readFileSync(full, 'utf8');
    return raw.trim() === '' ? { rows: [] } : JSON.parse(raw);
  }

  #flush(collection) {
    const full = path.join(this.dir, `${collection}.json`);
    fs.writeFileSync(full, JSON.stringify(this.file(collection), null, 1));
  }

  // Reads. A tenant is mandatory and the returned rows belong to it alone.
  list(collection, tenant, filter = null) {
    requireTenant(tenant);
    const rows = this.file(collection).rows.filter((r) => r.tenant === tenant);
    return filter ? rows.filter(filter) : rows;
  }

  get(collection, tenant, id) {
    requireTenant(tenant);
    return this.file(collection).rows.find((r) => r.tenant === tenant && r.id === id) ?? null;
  }

  // Writes. The tenant on the row comes from the caller, never from the body.
  insert(collection, tenant, row) {
    requireTenant(tenant);
    const stored = { id: row.id ?? crypto.randomUUID(), tenant, ...row };
    stored.tenant = tenant;
    this.file(collection).rows.push(stored);
    this.#flush(collection);
    return stored;
  }

  update(collection, tenant, id, patch) {
    requireTenant(tenant);
    const rows = this.file(collection).rows;
    const index = rows.findIndex((r) => r.tenant === tenant && r.id === id);
    if (index === -1) return null;
    const next = { ...rows[index], ...patch, id: rows[index].id, tenant };
    rows[index] = next;
    this.#flush(collection);
    return next;
  }

  // Every row a caller can reach, across tenants. Reserved for the ledger's
  // own reconciliation and for admin routes, never for a module route.
  allForAdmin(collection) {
    return this.file(collection).rows;
  }
}

export function requireTenant(tenant) {
  if (typeof tenant !== 'string' || tenant.trim() === '') {
    throw new Error('tenant required: refusing a query with no tenant');
  }
  if (tenant.includes('/') || tenant.includes('..')) {
    throw new Error(`bad tenant: ${tenant}`);
  }
  return tenant;
}
