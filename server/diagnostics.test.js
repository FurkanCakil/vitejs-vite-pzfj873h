import test from 'node:test';
import assert from 'node:assert/strict';
import { createFailureReporter } from './diagnostics.js';
import { createActionHandler } from './http.js';
import { ActionError } from './errors.js';

test('failure records contain fixed labels and never inspect private SDK details', () => {
  const records = [];
  const report = createFailureReporter({ emit: record => records.push(record) });
  report('action', { code: 8, get message() { throw new Error('must not inspect message'); },
    get stack() { throw new Error('must not inspect stack'); }, get cause() { throw new Error('must not inspect cause'); },
    toJSON() { assert.fail('must not serialize the error'); } });
  report('Bearer secret-token', { code: 'private-room-and-token' });
  assert.deepEqual(records, [
    { event: 'game_api_failure', phase: 'action', category: 'resource_exhausted' },
    { event: 'game_api_failure', phase: 'request', category: 'unknown' },
  ]);
});

test('diagnostics deduplicate failures and cap a burst without retaining arbitrary codes', () => {
  let at = 0;
  const records = [];
  const report = createFailureReporter({ now: () => at, emit: record => records.push(record) });
  for (let i = 0; i < 2000; i++) report('action', { code: `private-${i}` });
  assert.equal(records.length, 1);
  for (const phase of ['request', 'authentication', 'action', 'response']) {
    for (const code of [4, 7, 8, 10, 14, 16]) report(phase, { code });
  }
  assert.equal(records.length, 8);
  at = 59_999; report('action', { code: 8 }); assert.equal(records.length, 8);
  at = 60_000; report('action', { code: 8 }); assert.equal(records.length, 9);
  at = 0; report('action', { code: 8 }); assert.equal(records.length, 10);
});

test('throwing log sinks and unusual error objects cannot break handling', () => {
  const report = createFailureReporter({ emit: () => { throw new Error('sink unavailable'); } });
  assert.doesNotThrow(() => report('action', { code: 14 }));
  assert.doesNotThrow(() => report('action', { get code() { throw new Error('getter'); } }));
  assert.doesNotThrow(() => report(null, null));
});

const request = () => ({ method: 'POST', headers: {
  authorization: 'Bearer header.payload.signature', 'content-type': 'application/json',
  origin: 'https://game.example',
}, body: { type: 'presence.heartbeat', actionId: 'request_00000001', sessionId: 'session_00000001', roomCode: null } });
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; },
  status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });

test('HTTP reports backend failures by phase while preserving generic errors and cache protection', async () => {
  for (const phase of ['authentication', 'action']) {
    const records = [];
    const handler = createActionHandler({ enabled: () => true, allowedOrigins: new Set(['https://game.example']),
      reportFailure: createFailureReporter({ emit: record => records.push(record) }),
      verifyToken: async () => {
        if (phase === 'authentication') throw new ActionError(503, 'authentication_unavailable');
        return { uid: 'private-uid' };
      },
      applyAction: async () => { throw Object.assign(new Error('private-database-and-token'), { code: 8 }); },
    });
    const res = response(); await handler(request(), res);
    assert.equal(res.statusCode, 503); assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.deepEqual(res.body, { ok: false, error: phase === 'authentication' ? 'authentication_unavailable' : 'service_unavailable' });
    assert.deepEqual(records, [{ event: 'game_api_failure', phase,
      category: phase === 'authentication' ? 'authentication_unavailable' : 'resource_exhausted' }]);
    assert.equal(JSON.stringify(records).includes('private'), false);
  }
});

test('normal responses, invalid requests, invalid tokens and disabled previews do not produce failure noise', async () => {
  const records = [];
  for (const mode of ['success', 'invalid-request', 'invalid-token', 'disabled']) {
    const handler = createActionHandler({ enabled: () => mode !== 'disabled', allowedOrigins: new Set(['https://game.example']),
      reportFailure: (...record) => records.push(record),
      verifyToken: async () => { if (mode === 'invalid-token') throw Error('bad token'); return { uid: 'test' }; },
      applyAction: async () => ({ version: 1 }),
    });
    const req = request(); if (mode === 'invalid-request') req.body.scores = { test: 999 };
    const res = response(); await handler(req, res);
    assert.equal(res.statusCode, { success: 200, 'invalid-request': 400, 'invalid-token': 401, disabled: 503 }[mode]);
  }
  assert.deepEqual(records, []);
});

test('a failed diagnostic callback never replaces the intended HTTP response', async () => {
  const handler = createActionHandler({ enabled: () => true, allowedOrigins: new Set(['https://game.example']),
    verifyToken: async () => ({ uid: 'test' }), applyAction: async () => { throw Error('private'); },
    reportFailure: () => { throw Error('sink failed'); },
  });
  const res = response(); await handler(request(), res);
  assert.equal(res.statusCode, 503); assert.deepEqual(res.body, { ok: false, error: 'service_unavailable' });
});
