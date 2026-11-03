// The demo module. It exists so a reader can watch every layer work in one screen.
// Its routes carry no business meaning: each one demonstrates a rule.
import { ok } from '../../src/envelope.js';
import { defineModule } from '../../src/manifest.js';

export const showroom = defineModule({
  name: 'showroom',
  version: '0.1.0',
  description: 'Routes that demonstrate identity, permission, tenancy, ledger, events and files.',
  permissions: ['show.read', 'show.write', 'show.delete'],
  events: ['show.item.kept'],
  routes: [
    {
      method: 'GET',
      path: '/v1/show/whoami',
      permission: 'show.read',
      handler: (ctx) =>
        ok({
          subject: ctx.subject,
          tenant: ctx.tenant,
          permissions: ctx.claims.perms ?? [],
          request_id: ctx.request_id,
        }),
    },
    {
      method: 'GET',
      path: '/v1/show/items',
      permission: 'show.read',
      handler: (ctx) => ok({ items: ctx.store.list('show_items', ctx.tenant) }),
    },
    {
      method: 'POST',
      path: '/v1/show/items',
      permission: 'show.write',
      handler: async (ctx) => {
        const { label } = ctx.body ?? {};
        if (typeof label !== 'string' || label.trim() === '') {
          throw Object.assign(new Error('label is required'), {
            code: 'show_bad_item',
            status: 400,
          });
        }
        const item = ctx.store.insert('show_items', ctx.tenant, { label: label.trim() });
        await ctx.bus.publish('show.item.kept', ctx.tenant, { item: item.id, label: item.label });
        return ok(item);
      },
    },
    {
      method: 'DELETE',
      path: '/v1/show/items/:id',
      permission: 'show.delete',
      handler: (ctx) => {
        const existing = ctx.store.get('show_items', ctx.tenant, ctx.params.id);
        if (!existing) {
          throw Object.assign(new Error('no such item in this tenant'), {
            code: 'show_no_item',
            status: 404,
          });
        }
        return ok({ removed: existing, note: 'The store has no delete, so this route reports only.' });
      },
    },
    {
      method: 'POST',
      path: '/v1/show/move',
      permission: 'show.write',
      handler: (ctx) => {
        const { amount, key } = ctx.body ?? {};
        const { posting, duplicate } = ctx.ledger.post(ctx.tenant, {
          amount,
          debit: 'cash',
          credit: 'revenue',
          reference: 'showroom',
          key,
        });
        if (!duplicate) {
          ctx.bus.publish('show.money.moved', ctx.tenant, { posting_id: posting.id });
        }
        return ok({ posting, duplicate });
      },
    },
    {
      method: 'GET',
      path: '/v1/show/balance/:account',
      permission: 'show.read',
      handler: (ctx) => ok({ account: ctx.params.account, balance: ctx.ledger.balance(ctx.tenant, ctx.params.account) }),
    },
    {
      method: 'POST',
      path: '/v1/show/files',
      permission: 'show.write',
      handler: (ctx) => {
        const { text, name } = ctx.body ?? {};
        if (typeof text !== 'string' || text === '') {
          throw Object.assign(new Error('text is required'), { code: 'show_bad_file', status: 400 });
        }
        return ok(ctx.files.put(ctx.tenant, Buffer.from(text, 'utf8'), name ?? 'note.txt', 'text/plain'));
      },
    },
    {
      method: 'GET',
      path: '/v1/show/files/:hash',
      permission: 'show.read',
      handler: (ctx) => {
        const owned = ctx.files.owns(ctx.tenant, ctx.params.hash);
        if (!owned) {
          throw Object.assign(new Error('no such file in this tenant'), {
            code: 'show_no_file',
            status: 404,
          });
        }
        const bytes = ctx.files.get(ctx.tenant, ctx.params.hash);
        return ok({
          url: `/files/${ctx.tenant}/${ctx.params.hash}`,
          size: bytes.length,
          hash: ctx.params.hash,
        });
      },
    },
  ],
});
