// Connector kit checks. The same fake company, read twice: once from JSON files
// on disk, once through a database adapter. Both give the same rows.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jsonConnector, dbConnector, memoryAdapter, assertRows } from '../connectors/index.js';
import { runConformance } from './run.js';

const TENANT = 'fake_company';

const company = [
  { tenant: TENANT, account: 'cash', amount_minor: 125000, currency: 'usd' },
  { tenant: TENANT, account: 'revenue', amount_minor: 480000, currency: 'usd' },
];

// A fake company on disk. Made up names, made up amounts, no client anywhere.
function writeFakeCompany() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apix-fake-'));
  fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify(company, null, 1));
  fs.writeFileSync(path.join(dir, 'empty.json'), JSON.stringify({ rows: [] }));
  return dir;
}

export async function runConnectorChecks() {
  const { shop } = await import('../modules/fake_shop/index.js');
  const { fakeLedger } = await import('../modules/fake_ledger/index.js');

  const result = await runConformance([shop, fakeLedger], {
    extra: async ({ check }) => {
      const dir = writeFakeCompany();

      const fromJson = await jsonConnector(dir).fetch(TENANT);
      check('connectors: the json connector reads the fake company', fromJson.rows.length === 2,
        `got ${fromJson.rows.length} rows`);

      const stranger = await jsonConnector(dir).fetch('tenant_b');
      check('connectors: the json connector gives a stranger nothing', stranger.rows.length === 0);

      const fromDb = await dbConnector({
        adapter: memoryAdapter({ table: company }),
        sql: 'select * from accounts where tenant = ?',
      }).fetch(TENANT);
      check('connectors: the db connector reads the same fake company', fromDb.rows.length === 2,
        `got ${fromDb.rows.length} rows`);

      check('connectors: json and db agree row for row',
        JSON.stringify(fromJson.rows) === JSON.stringify(fromDb.rows));

      let refused = false;
      try { assertRows([{ account: 'cash' }], 'naked'); } catch { refused = true; }
      check('connectors: a row with no tenant is refused', refused);

      let badAdapter = false;
      try { dbConnector({ adapter: {}, sql: 'select 1' }); } catch { badAdapter = true; }
      check('connectors: a db connector with no query method is refused', badAdapter);

      fs.rmSync(dir, { recursive: true, force: true });
    },
  });

  return result;
}

if (process.argv[1] && process.argv[1].endsWith('connectors.js')) {
  const result = await runConnectorChecks();
  console.log('');
  console.log(`${result.passed} checks passed, ${result.failures.length} failed`);
  if (result.failures.length > 0) {
    for (const f of result.failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}
