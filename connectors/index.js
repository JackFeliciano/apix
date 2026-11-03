// The connector kit. A product that reads a company's data needs two things:
// a way to reach the database and a way to read APIX-shaped JSON files.
// Both return rows in the APIX record shape, so the consumer never learns
// where the data came from.
import fs from 'node:fs';
import path from 'node:path';

// Every connector returns { rows, source } and every row carries a tenant.
export function assertRows(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`${label}: connector returned no rows array`);
  for (const [index, row] of rows.entries()) {
    if (typeof row !== 'object' || row === null) throw new Error(`${label}: row ${index} is not an object`);
    if (typeof row.tenant !== 'string' || row.tenant === '') {
      throw new Error(`${label}: row ${index} has no tenant`);
    }
  }
  return rows;
}

// JSON connector. Reads one file or a directory of files, each holding either
// an array of rows or { rows: [...] }.
export function jsonConnector(dirOrFile) {
  const read = (full) => {
    const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    return Array.isArray(raw) ? raw : (raw.rows ?? []);
  };

  return {
    name: 'json',
    source: dirOrFile,
    async fetch(tenant) {
      const stat = fs.statSync(dirOrFile);
      const files = stat.isDirectory()
        ? fs.readdirSync(dirOrFile).filter((f) => f.endsWith('.json')).map((f) => path.join(dirOrFile, f))
        : [dirOrFile];
      const rows = files.flatMap(read).filter((row) => row.tenant === tenant);
      return { rows: assertRows(rows, 'json'), source: dirOrFile };
    },
  };
}

// Database connector. It takes an adapter with one method, query(sql, params),
// so the kit carries no driver and no credentials of its own.
export function dbConnector({ adapter, sql, name = 'db' }) {
  if (!adapter || typeof adapter.query !== 'function') {
    throw new Error('db connector needs an adapter with query(sql, params)');
  }
  if (typeof sql !== 'string' || sql.trim() === '') throw new Error('db connector needs a sql statement');

  return {
    name,
    source: 'adapter',
    async fetch(tenant) {
      const rows = await adapter.query(sql, [tenant]);
      return { rows: assertRows(rows, name), source: name };
    },
  };
}

// A worked adapter over an in-memory table, used by the tests. A real one wraps
// mysql2, pg or sqlite, and holds its credentials in its own settings file.
export function memoryAdapter({ table, tenantColumn = 'tenant' } = {}) {
  if (!Array.isArray(table)) throw new Error('memoryAdapter needs a table');
  return {
    async query(sql, params) {
      const wanted = sql.match(new RegExp(`${tenantColumn}\\s*=\\s*\\?`, 'i'));
      if (!wanted) throw new Error(`memoryAdapter cannot answer: ${sql}`);
      return table.filter((row) => row[tenantColumn] === params[0]);
    },
  };
}
