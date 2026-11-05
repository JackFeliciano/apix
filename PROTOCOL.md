# APIX wire protocol, version 1

Status: proposed, 2026-11-05. Written against `src/envelope.js`, `src/token.js`,
`src/runtime.js` and `src/manifest.js` as they stand in commit `a9149bb`.

This document carries the rules. The JavaScript in this repository is one
implementation of them. A client written in another language satisfies this
document by passing the conformance suite, and the suite is the definition of
compliant.

## 1. Versioning

The protocol version travels in two places and both must agree.

- The token header carries `typ: "APIX"` and a `ver` claim of `1`.
- The manifest carries `apix: 1`.

A host receiving a token or a manifest with a version it does not implement
answers `426 Upgrade Required` with `error.code: "protocol_version_unsupported"`.
Version 1 defines the whole of this document, and a later version changes the
number.

## 2. Transport

HTTPS only. Plain HTTP is allowed on loopback for a host talking to a module in
the same process, and nowhere else.

Every request carries `authorization: Bearer <token>` and `content-type:
application/json` when it has a body. The maximum body is 1 MiB, and a larger
one closes with `413` and `error.code: "body_too_large"`.

## 3. The token

A signed compact token, three base64url parts separated by dots.

    header = { "alg": "HS256", "typ": "APIX", "ver": 1 }
    claims = { "sub": "...", "tenant": "...", "perms": ["..."], "iat": N, "exp": N }

`alg` is HS256 and no other value is valid in version 1. `tenant` is required
and non-empty. `perms` is an array of permission strings, and `*` grants all.
`iat` and `exp` are seconds since the epoch, and `exp` defaults to 900 seconds
after `iat`.

The verifier must compare the signature in constant time.

Failure codes, in the order a verifier checks them:

| code | condition |
|---|---|
| token_malformed | not three parts, or the parts do not decode |
| token_bad_signature | the mac does not match |
| token_bad_alg | `alg` is anything other than HS256 |
| token_expired | `exp` is in the past |
| token_no_tenant | `tenant` is absent or empty |

The runtime answers `401` for every one of them, and puts the code in
`error.code`.

## 4. The manifest

A module publishes what it joins with:

    {
      "apix": 1,
      "name": "shop",
      "version": "1.0.0",
      "description": "...",
      "permissions": ["orders.read", "orders.write"],
      "events": ["order.created"],
      "routes": [
        { "method": "GET", "path": "/orders/:id", "permission": "orders.read" }
      ]
    }

A route without a permission is invalid and the host refuses to mount the
module. Paths start with a slash, and a `:name` segment is a parameter read from
the same position in the request path.

A host publishes its mounted manifests at `GET /.well-known/apix`, which needs no
token and no tenant. That route is the only one outside the permission rule.

## 5. The envelope

Success:

    { "data": <any>, "meta": { "request_id": "req_<uuid>", "at": "<ISO 8601>" } }

Failure:

    { "error": { "code": "<string>", "message": "<string>", "details": <any, optional> },
      "meta": { "request_id": "req_<uuid>", "at": "<ISO 8601>" } }

`meta.request_id` appears in the body and in the `x-request-id` response header
and the two are equal. A handler that returns a bare value gets it wrapped as
`data`.

Status codes carry meaning:

| status | meaning |
|---|---|
| 200 | the handler answered |
| 400 | the body did not parse |
| 401 | the token failed, see §3 |
| 403 | permission_denied, the token verified and lacks the route permission |
| 404 | route_not_found, no module declares `method` and `path` |
| 413 | body_too_large |
| 426 | protocol_version_unsupported |
| 500 | the handler threw without a status |

Error codes other than the ones listed above come from the handler and the
client treats an unknown code as a failure of that call.

## 6. Tenancy

Every claim set carries one tenant. Every query a module runs takes that tenant
as a parameter. A store call without a tenant is a programming error and throws
inside the runtime, so it reaches the client as `500` and never as rows.

A tenant never reads another tenant's rows, files or ledger entries. A client
that passes another tenant in a query string gets its own tenant in the context
regardless, and the runtime reads the tenant from the token alone.

## 7. Permissions

The permission named on the route is the permission the token must carry. The
handler never checks a token. A host reads `perms` and nothing else when it
decides access.

## 8. Events

An event is published with `evt_<uuid>` as its id and carries the tenant. A
subscriber receives the event object in the shape the manifest declared.

Version 1 defines delivery to subscribers in the same process. Delivery across
hosts is not part of version 1.

## 9. Conformance

A client is compliant when it passes every assertion in `conformance/` with no
change to the suite. A host is compliant when it passes the same suite and
publishes `/.well-known/apix`.

The suite runs offline and needs no credentials. It opens two runtimes on
ephemeral ports and asserts the envelope, the token failures, the permission
refusal, the tenant isolation and the request id echo.

## 10. What version 1 leaves out

Client credentials and remote modules. `GET /.well-known/apix` names the routes,
and a client still needs a token the host issued directly. The work to exchange a
client id and secret for a token, and to call a module across the network, sits
in issue 5 and changes this document when it lands.
