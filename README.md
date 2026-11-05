# APIX

API-X (API extended) is a shared runtime for HTTP applications. It provides the infrastructure most products need: authentication, permissions, tenant isolation, transaction records, events, file storage and a consistent API response format.

Applications integrate with APIX through modules. Each module declares its routes, required permissions and published events in a manifest. The runtime loads the manifest and uses it to configure and enforce the module's access to the APIX services.

Routes must be declared and assigned a permission before they can be mounted. Requests are authenticated and authorized by the runtime before reaching their handlers.

The repository includes two working modules: a sample shop and a ledger reader. They run on the same infrastructure without depending on each other.

## Architecture

APIX provides seven shared capabilities:

| Layer | Responsibility |
|---|---|
| Identity | Authenticates requests and identifies their subjects. |
| Permissions | Controls access to routes and operations. |
| Tenancy | Associates requests and data with a tenant. |
| Ledger | Records transactions and derives account balances. |
| Events | Publishes and delivers application events. |
| Files | Stores and retrieves tenant-associated files. |
| Response | Standardizes successful responses and errors. |

These services are available to every registered module through its request context.

## Repository

| Path | Description |
|---|---|
| `src/token.js` | Signed tokens using HS256. No external dependencies. |
| `src/envelope.js` | Standard success and error responses. |
| `src/runtime.js` | Routing, authentication, authorization, CORS and request IDs. |
| `src/manifest.js` | Module definitions and route validation. |
| `src/store.js` | Tenant-scoped data access. |
| `src/ledger.js` | Double-entry postings, idempotency and account balances. |
| `src/bus.js` | Tenant-aware event publishing and subscriptions. |
| `src/files.js` | Content-addressed file storage, organized by tenant. |
| `connectors/` | JSON reader and database adapter. |
| `modules/fake_shop/` | Sample commerce module. |
| `modules/fake_ledger/` | Sample ledger reader. |
| `modules/showroom/` | Interactive demonstration of APIX capabilities. |
| `demo/` | The showroom page, the small server that serves it, and its test. |
| `conformance/` | Module and connector conformance tests. |
| `PROTOCOL.md` | The wire protocol, version 1: token, manifest, envelope, tenancy, events. |
| `ROADMAP.md` | The work I intend to do next, and what each item fixes. |

## Getting started

Requirements: Node.js 20 or later.

No dependencies need to be installed.

```bash
node src/server.js
```

The server mounts the registered routes and prints their required permissions. By default, it listens on port `8080` and stores data in `./.data`.

## Authentication and requests

The APIX server issues the tokens. Modules never sign their own.

```bash
export APIX_SECRET='a-secret-of-at-least-sixteen-characters'

TOKEN=$(node src/server.js token --tenant acme --perms shop.read,shop.checkout,ledger.read,ledger.write)
```

List products:

```bash
curl -s \
  -H "authorization: Bearer $TOKEN" \
  http://localhost:8080/v1/shop/products
```

Create a product:

```bash
curl -s -X POST \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Widget","price":2500}' \
  http://localhost:8080/v1/shop/products
```

Read an account balance:

```bash
curl -s \
  -H "authorization: Bearer $TOKEN" \
  http://localhost:8080/v1/ledger/balance/cash
```

Unauthenticated requests receive `401`. Requests with insufficient permissions receive `403`. Data queries are scoped to the tenant identified by the token.

## Response format

All API responses follow the same envelope.

Successful response:

```json
{
  "data": {},
  "meta": {
    "request_id": "req_...",
    "at": "2026-11-03T21:16:02.363Z"
  }
}
```

Error response:

```json
{
  "error": {
    "code": "permission_denied",
    "message": "..."
  },
  "meta": {
    "request_id": "req_...",
    "at": "..."
  }
}
```

The request ID is also returned in the `x-request-id` header and can be used to correlate client requests with server logs.

## Modules and manifests

A module is registered through `defineModule`. Its manifest specifies its name, version, permissions, published events and routes.

Each route declares its HTTP method, path, required permission and handler.

Example:

```javascript
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
    handler: (ctx) => ok({
      things: ctx.store.list('mine_things', ctx.tenant)
    })
  }]
});
```

The runtime validates the manifest when registering the module. Routes without a declared permission are rejected. Requests are authenticated and checked against the route's permission before the handler executes.

Handlers receive a context containing:

- `tenant`: the tenant identified by the token.
- `subject`: the authenticated identity.
- `claims`: the token's permission claims.
- `body`: the parsed request body.
- `query`: the request query parameters.
- `store`, `ledger`, `bus` and `files`: the available APIX services.

The tenant is taken from the authenticated token, not from request data. Store operations require an explicit tenant argument.

## Security and isolation

APIX enforces authentication, route permissions and tenant-scoped data access at runtime.

The default store uses JSON files, with tenant filtering applied to collection queries. Every store operation requires a tenant context. Queries without one throw an error.

The connector you supply to `dbConnector` decides database isolation. An application that
needs a schema or a database per tenant implements that inside its adapter.

Modules currently execute in the same Node.js process and share the same filesystem. The runtime provides each handler with its registered services, but this is not process-level isolation: a module that imports internal runtime components can bypass those boundaries.

The current conformance suite does not test protection against such direct imports. Separate-process execution would be required for stronger module isolation.

## Ledger

The ledger records double-entry postings. Each posting contains:

- Debit and credit accounts.
- An integer amount in minor currency units.
- A reference.
- An idempotency key.

Account balances are calculated from the postings.

The ledger rejects negative or fractional amounts and postings where the debit and credit accounts are identical. Repeated requests with the same idempotency key return the original posting without creating another entry.

## Events

Modules can publish and subscribe to events through the shared event bus. Events carry their tenant identifier, allowing subscribers to retain tenant context when processing them.

Published event names are declared in the module manifest.

## Files

APIX provides content-addressed file storage, organized by tenant. Modules access files through the file service rather than managing storage paths independently.

## Interactive demonstration

Run:

```bash
npm run demo
```

Open `http://127.0.0.1:8091/`.

The showroom demonstrates the APIX layers through real HTTP requests. Each capability has an allowed operation and a corresponding operation that the runtime rejects.

The demo uses a fixed, public signing secret and binds to the loopback interface. It is intended for local evaluation only.

The showroom module is also covered by `conformance/showroom.js`, which starts the server on a separate port and exercises its routes over HTTP.

## Conformance tests

Run the test suites:

```bash
node conformance/run.js
node conformance/connectors.js
npm test
```

The suites run offline against temporary storage and exercise the modules through a real HTTP server.

They cover:

- Authentication and expired tokens.
- Route permission enforcement.
- Required response envelopes and request IDs.
- Tenant-scoped data access.
- Rejection of store queries without a tenant.
- Ledger idempotency and balance consistency.
- Tenant-aware event delivery.
- CORS origin validation.
- Manifest route validation.
- Connector consistency across JSON and database sources.

The conformance kit can also be run against independently developed modules.

The rules the suite checks live in `PROTOCOL.md`, separately from the code. A client written in another language satisfies them by passing the same suite.

## Connectors

APIX includes two connectors for accessing company data: a JSON reader and a database adapter.

```javascript
import { jsonConnector, dbConnector } from './connectors/index.js';

const store = jsonConnector('/srv/company/exports');
const { rows } = await store.fetch('acme');

const db = dbConnector({
  adapter: {
    query: (sql, params) => pool.query(sql, params)
  },
  sql: 'select * from accounts where tenant = ?'
});
```

Both connectors return tenant-associated rows.

The connector kit does not include database drivers or connection credentials. Applications supply their own adapters and connection settings.

## Configuration

Copy `.env.example` to `.env`.

The repository does not include deployment credentials, host addresses or client-specific configuration.

- `APIX_SECRET`: Token signing secret. Must contain at least 16 characters.
- `APIX_CORS`: Comma-separated list of browser origins allowed to access the API cross-origin. An empty list allows no origins.

For convenience, `src/server.js` provides a development fallback secret. This secret is public and must never be used outside local development. Set `APIX_SECRET` explicitly before deploying APIX.

## Scope

APIX provides shared application infrastructure. It does not include database drivers, email or telephony services, or payment processors. These remain the responsibility of the applications integrating with it.

The runtime provides the common services those applications use, while each module retains its own business logic and routes.

## Licence

MIT. See [LICENSE](LICENSE).
