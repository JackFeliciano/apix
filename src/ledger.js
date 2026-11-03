// The ledger. One place where money moves and posts once.
// A posting carries an idempotency key. The same key twice returns the first posting.
import crypto from 'node:crypto';
import { Store, requireTenant } from './store.js';

export class Ledger {
  constructor(store = new Store('.data')) {
    this.store = store;
  }

  // accounts: { debit: 'cash', credit: 'revenue' }, amount in integer minor units.
  post(tenant, { amount, currency = 'usd', debit, credit, reference, key }) {
    requireTenant(tenant);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw Object.assign(new Error('amount must be a positive integer in minor units'), {
        code: 'ledger_bad_amount',
      });
    }
    if (!debit || !credit || debit === credit) {
      throw Object.assign(new Error('debit and credit must name two different accounts'), {
        code: 'ledger_bad_accounts',
      });
    }
    const idempotency = key ?? crypto.randomUUID();
    const existing = this.store
      .list('ledger_postings', tenant)
      .find((p) => p.key === idempotency);
    if (existing) return { posting: existing, duplicate: true };

    const posting = this.store.insert('ledger_postings', tenant, {
      key: idempotency,
      amount,
      currency,
      debit,
      credit,
      reference: reference ?? null,
      posted_at: new Date().toISOString(),
    });
    return { posting, duplicate: false };
  }

  entries(tenant, filter = null) {
    requireTenant(tenant);
    return this.store.list('ledger_postings', tenant, filter);
  }

  balance(tenant, account) {
    requireTenant(tenant);
    let debits = 0;
    let credits = 0;
    for (const p of this.entries(tenant)) {
      if (p.debit === account) debits += p.amount;
      if (p.credit === account) credits += p.amount;
    }
    return debits - credits;
  }
}
