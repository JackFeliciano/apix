import { ok } from '../../src/envelope.js';
import { defineModule } from '../../src/manifest.js';

export const fakeLedger = defineModule({
  name: 'fake_ledger',
  version: '0.1.0',
  description: 'A sample module: reads the ledger and the balance for one account, and listens to the shop.',
  permissions: ['ledger.read'],
  events: [],
  routes: [
    {
      method: 'GET',
      path: '/v1/ledger/entries',
      permission: 'ledger.read',
      handler: (ctx) => ok({ entries: ctx.ledger.entries(ctx.tenant) }),
    },
    {
      method: 'GET',
      path: '/v1/ledger/balance/:account',
      permission: 'ledger.read',
      handler: (ctx) => ok({
        account: ctx.params.account,
        amount: ctx.ledger.balance(ctx.tenant, ctx.params.account),
      }),
    },
  ],
});

// Wired in the server, this is the other half of the event bus: the shop
// publishes, this module listens, and neither imports the other.
export function listenToShop(bus) {
  return bus.on('shop.order.created', async (event) => {
    console.log(`[fake_ledger] saw ${event.topic} in ${event.tenant}: ${event.payload.amount}`);
  });
}
