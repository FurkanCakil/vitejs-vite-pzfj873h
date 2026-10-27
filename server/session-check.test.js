import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelfAccountLookup, createSessionCheck } from './session-check.js';
import { ActionError } from './errors.js';

const identity = { uid: 'alice', auth_time: 100, exp: 3600 };
const fails = (promise, code) => assert.rejects(promise, error => error.code === code);

test('self lookup sends only the caller token to its fixed issuer and discards profile fields', async () => {
  const lookup = createSelfAccountLookup({ apiKey: 'public key', fetcher: async (url, options) => {
    assert.equal(url, 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=public%20key');
    assert.deepEqual(JSON.parse(options.body), { idToken: 'signed-token' });
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ users: [{ localId: 'alice', validSince: '99', email: 'not-retained@example.com' }] });
  } });
  assert.deepEqual(await lookup('signed-token', 'alice'), { validSince: 99 });
});

test('disabled/deleted/expired tokens are rejected but configuration, throttling and outages are availability errors', async () => {
  for (const [status, message, code] of [[400, 'USER_DISABLED', 'invalid_token'], [400, 'USER_NOT_FOUND', 'invalid_token'],
    [400, 'TOKEN_EXPIRED', 'invalid_token'], [400, 'INVALID_ID_TOKEN', 'invalid_token'],
    [400, 'API_KEY_INVALID', 'authentication_unavailable'], [429, 'TOO_MANY_ATTEMPTS_TRY_LATER', 'authentication_unavailable'],
    [503, 'private-provider-details', 'authentication_unavailable']]) {
    const lookup = createSelfAccountLookup({ apiKey: 'public', fetcher: async () => Response.json({ error: { message } }, { status }) });
    await fails(lookup('token', 'alice'), code);
  }
  await fails(createSelfAccountLookup({ apiKey: '', fetcher: () => assert.fail('missing configuration cannot send') })('token', 'alice'), 'authentication_unavailable');
  await fails(createSelfAccountLookup({ apiKey: 'public', fetcher: async () => { throw Error('private-network-error'); } })('token', 'alice'), 'authentication_unavailable');
});

test('self lookup fails closed on mismatched/malformed accounts and accepts a new anonymous account without validSince', async () => {
  for (const users of [[], [{ localId: 'someone-else' }], [{ localId: 'alice', validSince: 'bad' }],
    [{ localId: 'alice', disabled: 'false' }], [{ localId: 'alice' }, { localId: 'bob' }]]) {
    const lookup = createSelfAccountLookup({ apiKey: 'public', fetcher: async () => Response.json({ users }) });
    await fails(lookup('token', 'alice'), 'authentication_unavailable');
  }
  const lookup = createSelfAccountLookup({ apiKey: 'public', fetcher: async () => Response.json({ users: [{ localId: 'alice' }] }) });
  assert.deepEqual(await lookup('token', 'alice'), { validSince: 0 });
  await fails(createSelfAccountLookup({ apiKey: 'public', fetcher: async () => Response.json({ users: [{ localId: 'alice', disabled: true }] }) })('token', 'alice'), 'invalid_token');
});

test('account checks deduplicate concurrent work, cache for one minute and recheck after expiry', async () => {
  let time = 200_000, calls = 0, release;
  const check = createSessionCheck({ now: () => time, lookup: async () => {
    calls++; await new Promise(resolve => { release = resolve; }); return { validSince: 0 };
  } });
  const first = check('token', identity), second = check('token', identity);
  await Promise.resolve(); assert.equal(calls, 1); release(); await Promise.all([first, second]);
  await check('token', identity); assert.equal(calls, 1);
  time += 60_000;
  const third = check('token', identity); await Promise.resolve(); assert.equal(calls, 2); release(); await third;
});

test('token refresh cannot borrow another token check; a revocation boundary uses auth_time, not iat', async () => {
  let calls = 0;
  const check = createSessionCheck({ now: () => 200_000, lookup: async () => { calls++; return { validSince: 101 }; } });
  await fails(check('old-token', { ...identity, iat: 199 }), 'invalid_token');
  await fails(check('old-token', identity), 'invalid_token'); assert.equal(calls, 1);
  await check('fresh-token', { ...identity, auth_time: 101 }); assert.equal(calls, 2);
});

test('short rejection cache expires and provider outages never cache an unchecked identity', async () => {
  let time = 200_000, fail = true, calls = 0;
  const check = createSessionCheck({ now: () => time, lookup: async () => {
    calls++; if (fail) throw new ActionError(401, 'invalid_token'); return { validSince: 0 };
  } });
  await fails(check('token', identity), 'invalid_token'); fail = false;
  await fails(check('token', identity), 'invalid_token'); assert.equal(calls, 1);
  time += 10_000; await check('token', identity); assert.equal(calls, 2);
  let unavailable = true;
  const recovering = createSessionCheck({ now: () => time, lookup: async () => {
    if (unavailable) throw Error('upstream'); return { validSince: 0 };
  } });
  await fails(recovering('token', identity), 'authentication_unavailable'); unavailable = false; await recovering('token', identity);
});

test('cache capacity evicts old entries and in-flight saturation denies new work without evicting a pending check', async () => {
  let calls = 0;
  const check = createSessionCheck({ maxEntries: 2, now: () => 200_000, lookup: async () => { calls++; return { validSince: 0 }; } });
  for (const token of ['a', 'b', 'c', 'a']) await check(token, identity);
  assert.equal(calls, 4);
  let release, pendingCalls = 0;
  const busy = createSessionCheck({ maxPending: 1, now: () => 200_000, lookup: async () => {
    pendingCalls++; await new Promise(resolve => { release = resolve; }); return { validSince: 0 };
  } });
  const first = busy('a', identity), duplicate = busy('a', identity); await Promise.resolve();
  await fails(busy('b', identity), 'authentication_unavailable'); assert.equal(pendingCalls, 1);
  release(); await Promise.all([first, duplicate]);
});

test('expiry and malformed verified identity never reach the lookup or reuse an old cache hit', async () => {
  let time = 200_000, calls = 0;
  const check = createSessionCheck({ now: () => time, lookup: async () => { calls++; return { validSince: 0 }; } });
  await check('token', { ...identity, exp: 201 });
  time = 201_000;
  await fails(check('token', { ...identity, exp: 201 }), 'invalid_token');
  await fails(check('bad', { uid: 'alice', exp: 3600 }), 'invalid_token'); assert.equal(calls, 1);
});
