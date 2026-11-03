# APIX

APIX is the set of layers that most HTTP products rebuild from nothing: identity,
permissions, tenancy, a ledger, events, files, and one response shape. A product joins APIX by declaring a manifest. The runtime
reads the manifest, enforces what it says, and refuses anything the manifest does
not name.

Two modules ship with the repository as working samples. One is a shop and one
reads the ledger. Neither imports the other.

## What is here

    src/token.js        signed tokens, HS256, no dependencies
    src/envelope.js     data + meta on success, error + meta on failure
    src/runtime.js      routing, identity, permissions, CORS, request ids
    src/manifest.js     defineModule: a route without a permission cannot join
    src/store.js        every query carries a tenant, and a query without one throws
    src/ledger.js       postings with idempotency keys, balances from the postings
    src/bus.js          publish and subscribe, every event carries its tenant
    src/files.js        content-addressed files, one directory per tenant
    connectors/         the connector kit: a JSON reader and a database adapter
    modules/fake_shop/  a sample module that sells a product and posts to the ledger
    modules/fake_ledger/ a sample module that reads the ledger
    conformance/run.js  the kit that proves a module honours every layer
    conformance/connectors.js  the connector kit against one fake company

## Run it

Node 20 or later. There are no dependencies to install.

    node src/server.js

The server prints every route it mounted, with the permission each route needs.
It listens on port 8080 and keeps its data in `./.data`.

## Mint a token, then call it

The issuer signs tokens. A module never does.

    export APIX_SECRET='a-secret-of-at-least-sixteen-characters'
    TOKEN=$(node src/server.js token --tenant acme --perms shop.read,shop.checkout,ledger.read,ledger.write)

    curl -s -H "authorization: Bearer $TOKEN" http://localhost:8080/v1/shop/products

    curl -s -X POST -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
      -d '{"name":"Widget","price":2500}' http://localhost:8080/v1/shop/products

    curl -s -H "authorization: Bearer $TOKEN" http://localhost:8080/v1/ledger/balance/cash

A call with no token returns 401 and a code. A token missing the route's
permission returns 403. A token for another tenant sees that tenant's rows only.

## The response shape

Success:

    {"data":{...},"meta":{"request_id":"req_...","at":"2026-11-03T21:16:02.363Z"}}

Failure:

    {"error":{"code":"permission_denied","message":"..."},
     "meta":{"request_id":"req_...","at":"..."}}

The request id rides in the `x-request-id` header as well, so a client can quote
it and support can find the line.

## A module

    import { defineModule } from '../../src/manifest.js';
    import { ok } from '../../src/envelope.js';

    export const mine = defineModule({
      name: 'mine',
      version: '0.1.0',
      permissions: ['mine.read'],
      events: ['mine.thing.happened'],
      routes: [{
        method: 'GET',
        path: '/v1/mine/things',
        permission: 'mine.read',
        handler: (ctx) => ok({ things: ctx.store.list('mine_things', ctx.tenant) }),
      }],
    });

The handler receives a context with the tenant, the subject, the claim set, the
parsed body, the query, and the store, ledger, bus and file store. The tenant in
the context comes from the token, never from the body. `ctx.store.list` and
`ctx.store.get` take the tenant as their second argument and throw without it,
so a route cannot forget it.

## The conformance kit

    node conformance/run.js
    node conformance/connectors.js
    npm test

Both run offline against a temporary directory. They mount the sample modules on
a real server, drive real HTTP requests at it, and check every rule: an anonymous
call is refused, an expired token is refused, a token without the declared
permission is refused, every answer carries a request id and the shape, a row
written by one tenant never appears in another tenant's list, the store refuses a
query with no tenant, a second ledger posting with the same key does not move the
balance, an event reaches its listener with the tenant, the allowlisted origin is
echoed and a stranger origin is not, a route with no declared permission cannot
join, and the two connectors read the same fake company identically.

A module author runs the same kit against their own module before shipping.

## The connector kit

A product that reads a company's data needs a way to reach the database and a way
to read APIX-shaped files. Both connectors return rows carrying a tenant.

    import { jsonConnector, dbConnector } from './connectors/index.js';

    const store = jsonConnector('/srv/company/exports');
    const { rows } = await store.fetch('acme');

    const db = dbConnector({
      adapter: { query: (sql, params) => pool.query(sql, params) },
      sql: 'select * from accounts where tenant = ?',
    });

The kit carries no driver and no credentials. Your product owns the adapter and
the settings file that holds the connection string.

## Settings

Copy `.env.example` to `.env`. Every key in it is named and empty, and the
repository holds no key, no host and no client address. `APIX_SECRET` signs the
tokens and needs at least 16 characters. `APIX_CORS` lists the browser origins
allowed to call the API cross-origin, and an empty list allows nobody.

`src/server.js` falls back to a development secret so a first run works without
configuration. Set `APIX_SECRET` before anything real touches it, and set it in
production, because the fallback signs a token anyone can forge.

## What this is not

APIX carries no database driver, no mail transport, no telephony provider and no
payment processor. Those belong to the products that use them. APIX gives them a
place to stand: an identity, a permission, a tenant, a ledger that posts once,
events that carry the tenant, files that belong to someone, and one response
shape a client can rely on.

## Licence

MIT. See LICENSE.
