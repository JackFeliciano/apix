// Tests for the showroom demo. The demo is the artefact a reader opens first, so
// it gets the same treatment as the framework: a real server, real HTTP, no mocks.
import { startServer, stopServer, request, showBanner } from '../conformance/harness.js';

const PORT = 8117;

export async function run() {
  showBanner('showroom demo');
  let handle;
  let pass = 0;
  let fail = 0;

  const check = (label, condition, detail = '') => {
    if (condition) {
      pass++;
      console.log(`  ok   ${label}`);
    } else {
      fail++;
      console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
    }
  };

  try {
    handle = await startServer(PORT);
  } catch (error) {
    console.log(`  FAIL the demo server did not start: ${error.message}`);
    return { pass: 0, fail: 1 };
  }

  const base = `http://127.0.0.1:${PORT}`;

  // The page renders with the seed injected and no placeholder left behind.
  const page = await request(base, '/');
  check('the page is served', page.status === 200, `status ${page.status}`);
  check('the page carries the two tenants', page.raw.includes('"tenants":["acme","globex"]'));
  check('the placeholder is gone from the page', !page.raw.includes('__DEMO_SEED__'));

  const seedMatch = page.raw.match(/const seed = (\{.*?\});/s);
  check('the seed parses as JSON', Boolean(seedMatch));
  const seed = seedMatch ? JSON.parse(seedMatch[1]) : { tokens: {}, readOnly: {} };
  check('a full token was minted per tenant', Object.keys(seed.tokens).length === 2);
  check('a read-only token was minted per tenant', Object.keys(seed.readOnly).length === 2);

  // Identity.
  const anonymous = await request(base, '/v1/show/whoami');
  check('no token is refused with 401', anonymous.status === 401, `status ${anonymous.status}`);
  check('the refusal carries a code', anonymous.body?.error?.code === 'token_malformed');

  const who = await request(base, '/v1/show/whoami', { token: seed.tokens.acme });
  check('a token is accepted', who.status === 200, `status ${who.status}`);
  check('the handler reads the tenant from the token', who.body?.data?.tenant === 'acme');
  check('the answer carries a request id', typeof who.body?.meta?.request_id === 'string');

  // Permission.
  const denied = await request(base, '/v1/show/items', {
    method: 'POST',
    token: seed.readOnly.acme,
    body: { label: 'refused' },
  });
  check('a read-only token cannot write', denied.status === 403, `status ${denied.status}`);
  check('the refusal names the missing permission', /show\.write/.test(denied.body?.error?.message ?? ''));

  const written = await request(base, '/v1/show/items', {
    method: 'POST',
    token: seed.tokens.acme,
    body: { label: 'kept' },
  });
  check('a full token writes', written.status === 200, `status ${written.status}`);

  // Tenancy.
  await request(base, '/v1/show/items', {
    method: 'POST',
    token: seed.tokens.globex,
    body: { label: 'globex only' },
  });
  const acmeList = await request(base, '/v1/show/items', { token: seed.tokens.acme });
  const globexList = await request(base, '/v1/show/items', { token: seed.tokens.globex });
  const acmeLabels = (acmeList.body?.data?.items ?? []).map((i) => i.label);
  const globexLabels = (globexList.body?.data?.items ?? []).map((i) => i.label);
  check('acme sees its own rows', acmeLabels.includes('kept'));
  check('acme does not see the other tenant', !acmeLabels.includes('globex only'));
  check('globex sees its own rows', globexLabels.includes('globex only'));
  check('globex does not see the other tenant', !globexLabels.includes('kept'));

  // Money, the same key twice.
  const key = 'demo-check-key';
  const first = await request(base, '/v1/show/move', {
    method: 'POST',
    token: seed.tokens.acme,
    body: { amount: 2500, key },
  });
  const again = await request(base, '/v1/show/move', {
    method: 'POST',
    token: seed.tokens.acme,
    body: { amount: 2500, key },
  });
  check('the first posting is not a duplicate', first.body?.data?.duplicate === false);
  check('the second call is a duplicate', again.body?.data?.duplicate === true);
  check(
    'both calls return the same posting',
    first.body?.data?.posting?.id === again.body?.data?.posting?.id,
  );
  const balance = await request(base, '/v1/show/balance/cash', { token: seed.tokens.acme });
  check('the balance moved once', balance.body?.data?.balance === 2500, `balance ${balance.body?.data?.balance}`);

  // The other tenant's balance is untouched by that posting.
  const otherBalance = await request(base, '/v1/show/balance/cash', { token: seed.tokens.globex });
  check('the other tenant balance stays at zero', otherBalance.body?.data?.balance === 0);

  // Events.
  const events = await request(base, '/demo/events?tenant=acme');
  const topics = (events.body?.data?.events ?? []).map((e) => e.topic);
  check('the item event reached the bus', topics.includes('show.item.kept'));
  check('the money event reached the bus', topics.includes('show.money.moved'));
  check('every event carries its tenant', (events.body?.data?.events ?? []).every((e) => e.tenant === 'acme'));
  const globexEvents = await request(base, '/demo/events?tenant=globex');
  check(
    'the events endpoint does not leak another tenant',
    (globexEvents.body?.data?.events ?? []).every((e) => e.tenant === 'globex'),
  );

  // Files.
  const bytes = 'the same bytes every time';
  const put1 = await request(base, '/v1/show/files', {
    method: 'POST',
    token: seed.tokens.acme,
    body: { text: bytes, name: 'note.txt' },
  });
  const put2 = await request(base, '/v1/show/files', {
    method: 'POST',
    token: seed.tokens.acme,
    body: { text: bytes, name: 'note.txt' },
  });
  check('the first upload writes the file', put1.body?.data?.deduplicated === false);
  check('the second upload lands on the same hash', put1.body?.data?.hash === put2.body?.data?.hash);
  check('the second upload reports the content was already there', put2.body?.data?.deduplicated === true);

  const fileHit = await request(base, `/v1/show/files/${put1.body?.data?.hash}`, { token: seed.tokens.acme });
  check('the hash is readable back', fileHit.status === 200 && fileHit.body?.data?.size === Buffer.byteLength(bytes));
  const fileMiss = await request(base, `/v1/show/files/${put1.body?.data?.hash}`, { token: seed.tokens.globex });
  check('the other tenant cannot read that hash', fileMiss.status === 404, `status ${fileMiss.status}`);

  // The envelope on a route that does not exist.
  const missing = await request(base, '/v1/show/nothing-here', { token: seed.tokens.acme });
  check('an unknown route answers 404', missing.status === 404, `status ${missing.status}`);
  check('the 404 carries a code and a request id', Boolean(missing.body?.error?.code) && Boolean(missing.body?.meta?.request_id));

  await stopServer(handle);
  console.log(`\n  ${pass} passed, ${fail} failed`);
  return { pass, fail };
}
