import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShotUpdate, SHIP_DEFS, getShipCells } from './logic.js';

const fleet = SHIP_DEFS.map((def, row) => ({ ...def, cells: getShipCells({ row, col: 0 }, 'H', def.length) }));
const room = () => ({ players: ['a', 'b'], status: 'playing', setupPhase: false, turn: 'a', ships: { b: fleet }, shots: {}, scores: { a: 2 } });

test('shots preserve a hit turn, pass a miss, and reject stale or duplicate moves', () => {
  const data = room();
  const hit = buildShotUpdate(data, 'a', 0, 0);
  assert.equal(hit.hit, true);
  assert.equal(hit.patch.turn, undefined);
  data.shots.a = hit.patch['shots.a'];
  assert.equal(buildShotUpdate(data, 'a', 0, 0), null);
  assert.equal(buildShotUpdate(data, 'a', 9, 9).patch.turn, 'b');
  for (const patch of [{ turn: 'b' }, { status: 'abandoned' }, { setupPhase: true }, { winner: 'a' }]) {
    assert.equal(buildShotUpdate({ ...data, ...patch }, 'a', 9, 9), null);
  }
  assert.equal(buildShotUpdate(data, 'spectator', 1, 1), null);
  assert.equal(buildShotUpdate(data, 'a', -1, 0), null);
});

test('last hit increments score once and preserves all previous shots', () => {
  const data = room();
  const cells = fleet.flatMap((ship) => ship.cells);
  const last = cells.pop();
  data.shots.a = cells.map((cell) => ({ ...cell, hit: true }));
  const result = buildShotUpdate(data, 'a', last.row, last.col);
  assert.equal(result.patch.winner, 'a');
  assert.equal(result.patch.scores.a, 3);
  assert.equal(result.patch['shots.a'].length, 17);
  assert.equal(buildShotUpdate({ ...data, ...result.patch }, 'a', last.row, last.col), null);
});
