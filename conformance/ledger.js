// Ledger checks that do not need the sample modules: arithmetic, idempotency,
// and the two ways a posting is refused.
import { Ledger } from '../src/ledger.js';
import { Store } from '../src/store.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apix-ledger-'));
const ledger = new Ledger(new Store(path.join(dir, 'store')));

let passed = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}

console.log('APIX ledger');

const T = 'tenant_a';
const U = 'tenant_b';

ledger.post(T, { amount: 1000, debit: 'cash', credit: 'revenue', key: 'a1' });
ledger.post(T, { amount: 400, debit: 'fees', credit: 'cash', key: 'a2' });
ledger.post(T, { amount: 250, debit: 'cash', credit: 'revenue', key: 'a3' });

check('a debit raises the account it hits', ledger.balance(T, 'cash') === 1250 - 400,
  `cash ${ledger.balance(T, 'cash')}`);
check('a credit lowers the account that receives it', ledger.balance(T, 'revenue') === -1250,
  `revenue ${ledger.balance(T, 'revenue')}`);
check('the sides of a posting cancel', ledger.entries(T).reduce(
  (sum, p) => sum + (p.debit === 'cash' ? p.amount : 0) - (p.credit === 'cash' ? p.amount : 0), 0) === ledger.balance(T, 'cash'));
check('fees read as a debit of their own', ledger.balance(T, 'fees') === 400,
  `fees ${ledger.balance(T, 'fees')}`);
check('an account with no postings reads zero', ledger.balance(T, 'nothing_here') === 0);
check('one tenant cannot see another tenant\'s postings', ledger.entries(U).length === 0,
  `${ledger.entries(U).length} rows`);

const again = ledger.post(T, { amount: 1000, debit: 'cash', credit: 'revenue', key: 'a1' });
check('the same key returns the first posting and marks it a duplicate', again.duplicate === true);
check('a duplicate key leaves the balance alone', ledger.balance(T, 'cash') === 850);

const noKey = ledger.post(T, { amount: 10, debit: 'cash', credit: 'revenue' });
const noKeyAgain = ledger.post(T, { amount: 10, debit: 'cash', credit: 'revenue' });
check('postings with no key are never treated as duplicates',
  noKey.duplicate === false && noKeyAgain.duplicate === false);

let badAmount = false;
try { ledger.post(T, { amount: 12.5, debit: 'cash', credit: 'revenue' }); } catch { badAmount = true; }
check('a fractional amount is refused', badAmount);

let negative = false;
try { ledger.post(T, { amount: -5, debit: 'cash', credit: 'revenue' }); } catch { negative = true; }
check('a negative amount is refused', negative);

let sameAccount = false;
try { ledger.post(T, { amount: 5, debit: 'cash', credit: 'cash' }); } catch { sameAccount = true; }
check('a posting from an account to itself is refused', sameAccount);

let noTenant = false;
try { ledger.post('', { amount: 5, debit: 'cash', credit: 'revenue' }); } catch { noTenant = true; }
check('a posting with no tenant is refused', noTenant);

check('the postings are the record', ledger.entries(T).length === 5,
  `${ledger.entries(T).length} rows`);

fs.rmSync(dir, { recursive: true, force: true });
console.log('');
console.log(`${passed} checks passed, ${failures.length} failed`);
if (failures.length > 0) process.exitCode = 1;
