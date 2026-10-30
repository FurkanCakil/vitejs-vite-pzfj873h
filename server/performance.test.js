import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerformance } from './performance.js';
import { createActionHandler } from './http.js';

const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const request = (header = '1', type = 'xox.move') => ({ method: 'POST', headers: {
  authorization: 'Bearer header.payload.signature', 'content-type': 'application/json', 'x-game-perf': header,
}, body: { type, roomId: 'ABC123', actionId: 'performance_000001', expectedVersion: 1, cell: 4 } });

test('performance is double opt-in and leaves the normal response and callback arguments unchanged', async () => {
  for (const [enabled, header] of [[false, '1'], [true, undefined], [true, 'invalid']]) {
    const res = response();
    const handler = createActionHandler({ enabled: () => true, performanceEnabled: () => enabled, allowedOrigins: new Set(),
      verifyToken: async (...args) => { assert.equal(args.length, 1); return { uid: 'alice' }; },
      applyAction: async (...args) => { assert.equal(args.length, 2); return { version: 2 }; },
    });
    const req = request(); req.headers['x-game-perf'] = header;
    await handler(req, res);
    assert.equal(res.statusCode, 200); assert.equal(res.headers['Server-Timing'], undefined);
    assert.equal(res.headers['Cache-Control'], 'no-store'); assert.equal(res.body.version, 2);
  }
});

test('measured auth/action failures preserve HTTP semantics and contain only fixed timing labels', async () => {
  for (const fail of [false, true]) {
    const res = response();
    const handler = createActionHandler({ enabled: () => true, performanceEnabled: () => true, allowedOrigins: new Set(), reportFailure: () => {},
      verifyToken: async (_token, metrics) => metrics.measure('auth_verify_ms', async () => ({ uid: 'private-uid' })),
      applyAction: async (_uid, _action, metrics) => {
        assert.ok(metrics); if (fail) throw Error('private game state'); return { version: 2 };
      },
    });
    await handler(request(), res);
    assert.equal(res.statusCode, fail ? 503 : 200);
    assert.match(res.headers['Server-Timing'], /auth_ms;dur=/);
    assert.equal(res.headers['X-Game-Perf-Game'], 'xox');
    assert.doesNotMatch(JSON.stringify(res.headers), /private|ABC123|signature/);
    if (fail) assert.deepEqual(res.body, { ok: false, error: 'service_unavailable' });
  }
});

test('transaction retries preserve receiver/return values and count each attempt, read, and queued write', async () => {
  let at = 0, callbacks = 0;
  const metrics = createPerformance({ now: () => at, region: 'iad1' }); metrics.selectGame('okey101');
  const ref = { path: 'private/path' }, writes = [];
  const tx = {
    async getAll(...refs) { assert.equal(this, tx); at += 10; return refs.map(() => ({ exists: true })); },
    set(r, value) { assert.equal(this, tx); at++; writes.push([r, value]); return this; },
  };
  const db = { doc(path) { assert.equal(this, db); return { path }; }, async runTransaction(fn) {
    at += 2; await fn(tx); at += 5; const result = await fn(tx); at += 7; return result;
  } };
  const result = await metrics.wrapDb(db).runTransaction(async tracked => {
    callbacks++; await tracked.getAll(ref, ref); at += 3; tracked.set(ref, { secret: true }); return 42;
  });
  assert.equal(result, 42); assert.equal(callbacks, 2); assert.equal(writes.length, 2);
  const res = response(); metrics.headers(res);
  const timings = Object.fromEntries(res.headers['Server-Timing'].split(', ').map(item => { const [name, value] = item.split(';dur='); return [name, Number(value)]; }));
  assert.equal(timings.tx_attempts, 2); assert.equal(timings.db_reads, 4); assert.equal(timings.db_writes, 2);
  assert.equal(timings.db_read_ms, 20); assert.equal(timings.db_write_enqueue_ms, 2);
  assert.equal(timings.tx_compute_ms, 6); assert.equal(timings.tx_begin_ms, 2);
  assert.equal(timings.tx_retry_wait_ms, 5); assert.equal(timings.tx_finalize_ms, 7); assert.equal(timings.tx_ms, 42);
  assert.equal(res.headers['X-Game-Region'], 'iad1'); assert.doesNotMatch(JSON.stringify(res.headers), /secret|private/);
});

test('unsupported games and malformed region values never produce a performance header', () => {
  const metrics = createPerformance({ region: 'private-secret' }), res = response();
  metrics.selectGame('satranc'); metrics.headers(res); assert.deepEqual(res.headers, {});
  metrics.selectGame('xox'); metrics.headers(res); assert.equal(res.headers['X-Game-Region'], undefined);
});
