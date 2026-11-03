import { ok } from '../../src/envelope.js';
import { defineModule } from '../../src/manifest.js';

export const shop = defineModule({
  name: 'fake_shop',
  version: '0.1.0',
  description: 'A sample module: a catalogue of products and a checkout that posts to the ledger.',
  permissions: ['shop.read', 'shop.checkout'],
  events: ['shop.order.created'],
  routes: [
    {
      method: 'GET',
      path: '/v1/shop/products',
      permission: 'shop.read',
      handler: (ctx) => ok({ products: ctx.store.list('shop_products', ctx.tenant) }),
    },
    {
      method: 'POST',
      path: '/v1/shop/products',
      permission: 'shop.checkout',
      handler: (ctx) => {
        const { name, price } = ctx.body ?? {};
        if (typeof name !== 'string' || !Number.isInteger(price) || price <= 0) {
          throw Object.assign(new Error('name and a positive integer price are required'), {
            code: 'shop_bad_product',
            status: 400,
          });
        }
        return ok(ctx.store.insert('shop_products', ctx.tenant, { name, price }));
      },
    },
    {
      method: 'POST',
      path: '/v1/shop/checkout',
      permission: 'shop.checkout',
      handler: async (ctx) => {
        const { product_id: productId, key } = ctx.body ?? {};
        const product = ctx.store.get('shop_products', ctx.tenant, productId);
        if (!product) {
          throw Object.assign(new Error('no such product in this tenant'), {
            code: 'shop_no_product',
            status: 404,
          });
        }
        const { posting, duplicate } = ctx.ledger.post(ctx.tenant, {
          amount: product.price,
          debit: 'cash',
          credit: 'revenue',
          reference: product.id,
          key,
        });
        if (!duplicate) {
          await ctx.bus.publish('shop.order.created', ctx.tenant, {
            posting_id: posting.id,
            product: product.id,
            amount: product.price,
          });
        }
        return ok({ posting, duplicate });
      },
    },
  ],
});
