import test from 'node:test';
import assert from 'node:assert/strict';
import { createGamePerformance, summarizePerformance, gamePerformance } from './gamePerformance.js';
import { createGameApi } from './gameApi.js';

test('snapshots and render may arrive before HTTP; correlation exports no room, user or hand data', () => {
  let at = 0;
  const perf = createGamePerformance({ enabled: true, now: () => at });
  const trace = perf.start('okey.draw', 'SECRET'); at = 20; perf.execute(trace);
  at = 30; perf.snapshot('SECRET', { gameId: 'okey101', version: 5, roundId: 'private-round', handVersions: { 'private-user': 4 } }, 'private-user', false);
  at = 35; perf.privateSnapshot('SECRET', { roundId: 'private-round', handVersion: 4, rack: ['private-tile'] }, false);
  at = 40; perf.commit('SECRET', 'okey101', 5, 2); at = 50; perf.frame('SECRET', 'okey101', 5);
  at = 60; perf.response(trace, { roomId: 'SECRET', version: 5 });
  perf.add(trace, 'command_snapshot_barrier_ms', 1);
  const report = perf.report(), row = report.samples[0];
  assert.equal(row.outcome, 'ok'); assert.equal(row.metrics.queue_wait_ms, 20);
  assert.equal(row.metrics.public_snapshot_ms, 30); assert.equal(row.metrics.private_snapshot_ms, 35);
  assert.equal(row.metrics.view_commit_ms, 40); assert.equal(row.metrics.next_frame_ms, 50);
  assert.equal(row.metrics.snapshot_wait_after_http_ms, 0); assert.equal(row.metrics.command_snapshot_barrier_ms, 1);
  assert.doesNotMatch(JSON.stringify(report), /SECRET|private-round|private-user|private-tile/);
});

test('cache snapshots and incomplete Okey views do not count as observed completed actions', () => {
  let at = 1; const perf = createGamePerformance({ enabled: true, now: () => at });
  const trace = perf.start('okey.draw', 'SECRET'); at = 10; perf.response(trace, { version: 2 });
  perf.snapshot('SECRET', { gameId: 'okey101', version: 2 }, 'user', true);
  assert.equal(perf.report().samples.length, 0);
  at = 31_001;
  const report = perf.report(); assert.equal(report.pending, 0); assert.equal(report.samples[0].outcome, 'snapshot_unobserved');
  assert.equal(report.samples[0].metrics.public_snapshot_ms, undefined);
});

test('pending work, retained samples, session duration and cancellation are bounded', () => {
  let at = 0; const perf = createGamePerformance({ enabled: true, now: () => at, maxRows: 2, maxPending: 1 });
  const first = perf.start('okey.layout'); assert.equal(perf.start('okey.layout'), null);
  perf.cancel(first, 'coalesced'); perf.fail(perf.start('xox.move')); perf.fail(perf.start('xox.move'));
  assert.equal(perf.report().samples.length, 2);
  at = 600_001; assert.equal(perf.start('xox.move'), null);
  perf.setEnabled(true); assert.ok(perf.start('xox.move')); perf.setEnabled(false); assert.equal(perf.report().pending, 0);
});

test('summary uses nearest-rank percentiles, separates outcomes, and retains missing-metric sample counts', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ game: 'xox', action: 'xox.move', outcome: 'ok', metrics: { http_ms: i + 1 } }));
  rows.push({ game: 'xox', action: 'xox.move', outcome: 'error', metrics: {} });
  const summary = summarizePerformance(rows);
  assert.deepEqual(summary[0].metrics.http_ms, { n: 20, p50: 10, p95: 19, max: 20 });
  assert.equal(summary[1].outcome, 'error'); assert.equal(summary[1].n, 1);
});

test('API measurement is opt-in; payload/retry identity stays identical and telemetry never enters action JSON', async () => {
  try {
    for (const enabled of [false, true]) {
      gamePerformance.clear(); gamePerformance.setEnabled(enabled);
      const requests = [];
      const api = createGameApi(async () => 'private-token', async (_url, options) => {
        requests.push(options);
        if (requests.length === 1) throw Error('lost response');
        return new Response(JSON.stringify({ ok: true, roomId: 'ABC123', version: 2 }), { headers: {
          'X-Game-Perf-Game': 'xox', 'Server-Timing': 'auth_ms;dur=3, private_secret;dur=999, tx_ms;dur=20',
        } });
      });
      await api({ type: 'xox.move', roomId: 'ABC123', expectedVersion: 1, cell: 4 });
      assert.equal(requests[0].body, requests[1].body);
      assert.equal(requests[0].headers['X-Game-Perf'], enabled ? '1' : undefined);
      assert.doesNotMatch(requests[0].body, /trace|timing|metrics/);
      const report = gamePerformance.report();
      if (!enabled) assert.equal(report.pending, 0);
      else {
        gamePerformance.snapshot('ABC123', { gameId: 'xox', version: 2 }, 'user', false);
        gamePerformance.commit('ABC123', 'xox', 2, 1); gamePerformance.frame('ABC123', 'xox', 2);
        const saved = gamePerformance.report().samples[0];
        assert.equal(saved.metrics.attempts, 2); assert.equal(saved.metrics.auth_ms, 3);
        assert.equal(saved.metrics.private_secret, undefined);
        assert.doesNotMatch(JSON.stringify(saved), /private-token|ABC123/);
      }
    }
  } finally { gamePerformance.setEnabled(false); gamePerformance.clear(); }
});
