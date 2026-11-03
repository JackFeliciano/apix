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

## Questions a reader asks first

Six questions decide whether this design holds. The answers below describe the
code in this repository, and you can check each one in the file named.

**How far does the manifest go?** It declares routes. Each route carries a method,
a path, the permission it needs and a handler. It also declares the module's name,
its version, the permission names it uses and the events it publishes. Route and
permission are the unit of enforcement, so a module can hold many routes and
give each one its own permission. See `src/manifest.js`.

**Who enforces?** The runtime. It verifies the token, compares the permission the
route declares against the claim set in the token, and only then calls the handler.
A module author writes no check, and a handler that forgot one cannot leak, because
the runtime never handed it the request. See `src/runtime.js`.

**What does the ledger hold?** Postings, each with a debit account, a credit
account, an integer amount in minor units, a reference and an idempotency key. To
read a balance the ledger sums the postings for an account. The ledger refuses a
negative or fractional amount, and it refuses a posting where debit and credit name
the same account. Post twice with one key and the second call returns the first
posting. See `src/ledger.js`.

**How does tenancy work?** The tenant comes from the token and rides in the request
context. Every store call takes the tenant as its second argument and throws
without one, so a route cannot forget it. The default store keeps one JSON file per
collection and filters on the tenant field. Isolation between databases belongs to
the adapter you pass to `dbConnector`, so a product that needs a schema or a
database per tenant supplies one that does that. See `src/store.js` and
`connectors/index.js`.

**Can someone else write a module?** Yes. A module is an object from
`defineModule`, and the runtime takes a list of them. Nothing marks a module as
first party. The conformance kit is the review: a module author runs it against
their own module on their own machine, and it passes or it does not.

**How isolated are modules?** They share one Node process and one file system. A
handler receives the store, the ledger, the bus and the file store, and it can call
the ones its module was given. A module that imports the runtime's internals
directly can reach past that, so the boundary is a convention the conformance kit
does not test. Running a module in its own process would close that gap, and this
repository does not do it yet.

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

## See it work

    npm run demo

Open `http://127.0.0.1:8091/` and the page shows each layer with two buttons. One
button makes a call the layer allows, and the other makes the call it refuses. The
page talks to the same server process over HTTP, so every answer on screen came
from the code in `src/`.

The demo mounts `modules/showroom/`, whose routes carry no business meaning. Each
route exists to demonstrate one rule, and the page names the rule beside the
answer it produced.

The demo mints the tokens on that page with a fixed secret, so they are public.
The demo server binds to the loopback address, and its own page says so. A real
deployment signs with a secret it holds.

The showroom is also covered by the suite: `conformance/showroom.js` starts the
demo on a spare port and drives every button over real HTTP.

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
