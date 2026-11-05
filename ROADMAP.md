# Roadmap

This file lists the work I intend to do on APIX. Each item names what hurts today and what
the repository looks like when the item closes. Hours are mine to spend and the estimates
are working figures.

APIX runs seven services behind one manifest: identity, permissions, tenancy, the ledger,
events, files and the response envelope. The code is small on purpose. 1,221 lines across
ten source files, three sample modules and a conformance suite that drives the runtime over
real HTTP. The items below are the places where that smallness shows.

## Near term

### Isolate modules from one another

Today every module shares one process, one global object and one import graph. A module can
reach another module's internals if its author chooses to, which makes the manifest a
contract by convention rather than by force. I want the runtime to load a module in its own
worker and pass it only its declared interfaces, so a module that names nothing cannot
touch anything. The conformance suite gains a case that tries to reach across and must fail.

Work involved: a loader, a message bridge for the route calls, a decision on how much state
a worker keeps between requests, and tests that measure the boundary from the inside.

Estimate: 5 hours.

### Store transactions and concurrent writes

`src/store.js` reads a collection file, mutates the array in memory and writes the whole
file back. Two writers racing on the same collection lose one of them. A product with real
traffic will hit this on its first busy afternoon. The store needs a lock around the
read-modify-write, a write that lands atomically through a temporary file and a rename, and
a documented answer for what a caller sees when a write loses.

Estimate: 3 hours.

### Durable events

The bus keeps every event in an array in memory. A restart erases the log and any request
that asks what it missed gets an answer that cannot be trusted. Events need to land in the
store with the tenant, a sequence number per tenant and a replay call that returns
everything after a stated point.

Estimate: 3 hours.

### A database adapter that is not a toy

`connectors/index.js` ships `memoryAdapter` for the tests and an adapter contract that any
database can satisfy. Nothing exercises a real driver. I want one adapter against Postgres
and one against SQLite, both driven by the same conformance case so the contract is proved
twice and the second adapter does not quietly diverge.

Estimate: 3 hours.

## Later

### A static analysis pass over manifests

The runtime refuses a route the manifest does not name. It does not refuse a manifest that
contradicts itself, such as a route declared twice or a permission no handler uses. A check
that runs before the server binds and reports those contradictions would catch a class of
mistake at boot instead of at three in the morning.

### Files on object storage

`src/files.js` stores bytes on the local disk, content addressed by sha256, deduplicated per
tenant. A product that runs in more than one place needs the bytes somewhere both places
can reach. The interface stays the same and a second backend moves the bytes out.

### A published conformance package

The suite that proves the runtime also proves an adapter. Publishing it as its own package
lets anyone who writes a connector run the same checks I run, and the contract stops living
only in this repository.

### Documentation of the envelope, separately

Written down in `PROTOCOL.md` §5, which names every error code and the status that carries
it. What remains is a caller's page: what to do next after each code, in the order a client
meets them.

### A client outside JavaScript

The document exists and the suite defines compliance. The proof that this is a protocol is a
second implementation in another language that passes `conformance/` unchanged, with no fork
and no exception granted for it.

Estimate: 6 hours.

### A remote module over HTTPS

`PROTOCOL.md` says version 1 delivers events only inside one process and leaves client
credentials out. The work is a client id and a hashed secret per client, `POST /token`
exchanging them for a short access token, and `httpConnector` in the kit returning the same
`{ rows, source }` shape the file and database connectors return. Version 2 changes the
document when this lands.

Estimate: 8 hours.

## How an item closes

An item closes when the code lands, the conformance suite grows a case that would have
failed before, and the README still describes what the code does. I run `npm test` before
every commit. It is 34 checks today and it moves up with each item.
