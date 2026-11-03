// The event bus. A module publishes, another module listens, and neither knows
// the other's address. Every event carries the tenant it happened in.
import crypto from 'node:crypto';

export class Bus {
  constructor() {
    this.handlers = new Map();
    this.log = [];
  }

  on(topic, handler) {
    if (!this.handlers.has(topic)) this.handlers.set(topic, []);
    this.handlers.get(topic).push(handler);
    return () => this.off(topic, handler);
  }

  off(topic, handler) {
    const list = this.handlers.get(topic);
    if (!list) return;
    this.handlers.set(topic, list.filter((h) => h !== handler));
  }

  async publish(topic, tenant, payload) {
    if (typeof tenant !== 'string' || tenant === '') {
      throw Object.assign(new Error('tenant required on every event'), { code: 'event_no_tenant' });
    }
    const event = {
      id: `evt_${crypto.randomUUID()}`,
      topic,
      tenant,
      payload,
      at: new Date().toISOString(),
    };
    this.log.push(event);
    const results = [];
    for (const handler of this.handlers.get(topic) ?? []) {
      results.push(await handler(event));
    }
    return { event, handled: results.length };
  }

  // Every event this tenant produced. The bus keeps them, the caller reads them.
  events(tenant) {
    if (typeof tenant !== 'string' || tenant === '') {
      throw Object.assign(new Error('tenant required'), { code: 'event_no_tenant' });
    }
    return this.log.filter((e) => e.tenant === tenant);
  }
}
