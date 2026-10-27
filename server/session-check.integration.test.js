import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createSelfAccountLookup, createSessionCheck } from './session-check.js';
import { createActionHandler } from './http.js';

test('self-account checks reject disabled, revoked and deleted emulator accounts before game writes', {
  skip: !process.env.FIREBASE_AUTH_EMULATOR_HOST,
}, async t => {
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  assert.ok(!process.env.VERCEL_ENV);
  const projectId = 'demo-oyun-portali', root = 'http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1';
  const app = initializeApp({ projectId }, 'session-check-test'), auth = getAuth(app);
  const call = async (path, body, admin = false) => {
    const response = await fetch(`${root}/${path}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer owner' } : {}) },
      body: JSON.stringify(body) });
    assert.equal(response.status, 200, `emulator ${path}`);
    return response.json();
  };
  let clock = Date.now(), lookups = 0, writes = 0, sequence = 0;
  const lookup = createSelfAccountLookup({ apiKey: 'emulator-only', fetcher: (url, options) => {
    assert.equal(url, 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=emulator-only');
    lookups++;
    return fetch(`${root}/accounts:lookup?key=emulator-only`, options);
  } });
  const checkSession = createSessionCheck({ lookup, now: () => clock });
  const handler = createActionHandler({ enabled: () => true, allowedOrigins: new Set(['https://game.example']),
    allowUnsignedEmulatorTokens: true,
    verifyToken: async token => {
      const identity = await auth.verifyIdToken(token); await checkSession(token, identity); return identity;
    },
    applyAction: async () => { writes++; return { serverNow: clock }; },
  });
  const send = async token => {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
      status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://game.example', authorization: `Bearer ${token}` },
      body: { type: 'presence.heartbeat', actionId: `session_test_${String(++sequence).padStart(8, '0')}`, sessionId: 'session_check_test1', roomCode: null } }, res);
    return res;
  };
  let account;
  try {
    await t.test('real anonymous tokens pass and repeated game actions share a bounded account lookup', async () => {
      account = await call('accounts:signUp?key=emulator-only', { returnSecureToken: true });
      assert.equal((await send(account.idToken)).statusCode, 200);
      assert.equal((await send(account.idToken)).statusCode, 200);
      assert.equal(lookups, 1); assert.equal(writes, 2);
    });
    await t.test('disabling the account stops its still-unexpired token after the one-minute cache bound', async () => {
      await call(`projects/${projectId}/accounts:update`, { localId: account.localId, disableUser: true }, true);
      clock += 60_001;
      const res = await send(account.idToken);
      assert.equal(res.statusCode, 401); assert.equal(res.body.error, 'invalid_token'); assert.equal(writes, 2);
    });
    await t.test('reenabling an account recovers after the short rejection cache; a revocation boundary rejects the old token', async () => {
      await call(`projects/${projectId}/accounts:update`, { localId: account.localId, disableUser: false }, true);
      clock += 10_001; assert.equal((await send(account.idToken)).statusCode, 200); assert.equal(writes, 3);
      const claims = await auth.verifyIdToken(account.idToken);
      await call(`projects/${projectId}/accounts:update`, { localId: account.localId, validSince: String(claims.iat + 1) }, true);
      clock += 60_001; assert.equal((await send(account.idToken)).statusCode, 401); assert.equal(writes, 3);
    });
    await t.test('deleting a disposable demo account invalidates its old JWT at the API boundary', async () => {
      const removed = await call('accounts:signUp?key=emulator-only', { returnSecureToken: true });
      assert.equal((await send(removed.idToken)).statusCode, 200); assert.equal(writes, 4);
      await call(`projects/${projectId}/accounts:delete`, { localId: removed.localId }, true);
      clock += 60_001; assert.equal((await send(removed.idToken)).statusCode, 401); assert.equal(writes, 4);
    });
  } finally { await deleteApp(app); }
});
