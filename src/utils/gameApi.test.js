import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameApi } from './gameApi.js';
import { serverNow } from './serverClock.js';
import { countActiveSessions } from './presence.js';

test('lost responses retry with the identical action ID and payload', async () => {
  const requests = [];
  const send = createGameApi(async () => 'verified.token.here', async (_, options) => {
    requests.push(options);
    if (requests.length === 1) throw Error('connection lost after commit');
    return { ok: true, status: 200, json: async () => ({ ok: true, roomId: 'ABC123', version: 1 }) };
  });
  await send({ type: 'xox.move', roomId: 'ABC123', expectedVersion: 0, cell: 4 });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body, requests[1].body);
  assert.equal(requests[1].headers.Authorization, 'Bearer verified.token.here');
});

test('expired authentication refreshes once; rejected game actions are never retried', async () => {
  const refreshes = [];
  let attempts = 0;
  const send = createGameApi(async refresh => { refreshes.push(refresh); return 'token'; }, async () => {
    attempts++;
    return { ok: false, status: attempts === 1 ? 401 : 409,
      json: async () => ({ ok: false, error: attempts === 1 ? 'invalid_token' : 'stale_version' }) };
  });
  await assert.rejects(send({ type: 'xox.move' }), error => error.code === 'stale_version');
  assert.deepEqual(refreshes, [false, true]);
  assert.equal(attempts, 2);
});

test('a plain-text firewall rate limit is reported once without refreshing auth or retrying', async () => {
  let calls = 0;
  const refreshes = [];
  const send = createGameApi(async refresh => { refreshes.push(refresh); return 'token'; }, async () => {
    calls++;
    return new Response('Too Many Requests', { status: 429 });
  });
  await assert.rejects(send({ type: 'room.join' }), error => error.code === 'too_many_actions');
  assert.equal(calls, 1);
  assert.deepEqual(refreshes, [false]);
});

test('JSON rate-limit reasons remain intact and are never retried', async () => {
  let calls = 0;
  const send = createGameApi(async () => 'token', async () => {
    calls++;
    return Response.json({ ok: false, error: 'too_many_rooms' }, { status: 429 });
  });
  await assert.rejects(send({ type: 'room.create' }), error => error.code === 'too_many_rooms');
  assert.equal(calls, 1);
});

test('non-JSON security and service errors do not amplify requests or reveal response HTML', async () => {
  for (const [status, code] of [[403, 'security_check_required'], [503, 'service_unavailable']]) {
    let calls = 0;
    const send = createGameApi(async () => 'token', async () => {
      calls++;
      return new Response('<html>private upstream details</html>', { status });
    });
    await assert.rejects(send({ type: 'room.join' }), error => error.code === code && !error.message.includes('private'));
    assert.equal(calls, 1);
  }
});

test('an unreadable successful response still retries with the same action ID for safe recovery', async () => {
  const bodies = [];
  const send = createGameApi(async () => 'token', async (_, options) => {
    bodies.push(options.body);
    return { ok: true, status: 200, json: async () => {
      if (bodies.length === 1) throw Error('response stream disconnected after commit');
      return { ok: true, roomId: 'ABC123' };
    } };
  });
  assert.equal((await send({ type: 'room.join' })).roomId, 'ABC123');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
});

test('a disabled account during token refresh stops before a second HTTP request', async () => {
  let calls = 0;
  const send = createGameApi(async refresh => {
    if (refresh) throw Object.assign(new Error('private auth details'), { code: 'auth/user-disabled' });
    return 'old-token';
  }, async () => { calls++; return Response.json({ ok: false, error: 'invalid_token' }, { status: 401 }); });
  await assert.rejects(send({ type: 'room.join' }), error => error.code === 'invalid_token' && !error.message.includes('private'));
  assert.equal(calls, 1);
});

test('token service failures are temporary authentication errors and never send an unchecked request', async () => {
  const send = createGameApi(async () => { throw Error('private network details'); }, () => assert.fail('no request without token'));
  await assert.rejects(send({ type: 'room.join' }), error => error.code === 'authentication_unavailable');
});

test('successful API replies calibrate the display clock without sending a client time', async t => {
  t.mock.method(Date, 'now', () => 20_000_000);
  const send = createGameApi(async () => 'token', async (_, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body).sort(), ['actionId', 'roomId', 'sessionId', 'type']);
    return Response.json({ ok: true, serverNow: 1_000_000, version: 2 });
  });
  assert.equal((await send({ type: 'room.heartbeat', roomId: 'ABC123', sessionId: 'test_session_001' })).version, 2);
  assert.ok(serverNow() >= 1_000_000 && serverNow() < 1_001_000);
  const sessions = { host: { uid: 'host', lastSeen: 1_000_000 } };
  assert.equal(countActiveSessions(sessions), 1);
  t.mock.method(Date, 'now', () => 1);
  assert.equal(countActiveSessions(sessions), 1, 'the lobby count must share the calibrated monotonic clock');
  const before = serverNow();
  const denied = createGameApi(async () => 'token', async () => Response.json({ ok: false, error: 'stale_version', serverNow: 999_000_000 }, { status: 409 }));
  await assert.rejects(denied({ type: 'xox.move' }));
  assert.ok(serverNow() >= before && serverNow() < before + 1000);
});
