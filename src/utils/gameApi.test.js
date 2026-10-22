import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameApi } from './gameApi.js';

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
