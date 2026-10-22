import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAction } from '../room-schema.js';
import { validateFleet, applyBattleShot, freshBattle } from './battleship.js';

export const fleet = () => ['carrier', 'cruiser', 'submarine', 'destroyer', 'patrol']
  .map((id, i) => ({ id, row: i * 2, col: 0, orientation: 'H' }));
const fail = (code, run) => assert.throws(run, error => error.code === code);
const base = () => ({ ...freshBattle(['a', 'b'], undefined, 'a', 'a'.repeat(24)),
  status: 'playing', players: ['a', 'b'], setupPhase: false, turn: 'a' });

test('fleet validation derives the fixed seventeen cells and accepts legal edge placement', () => {
  const input = fleet(), canonical = validateFleet(input);
  assert.deepEqual(canonical.map(ship => ship.cells.length), [5, 4, 3, 3, 2]);
  assert.equal(canonical.flatMap(ship => ship.cells).length, 17);
  assert.deepEqual(input, fleet());
  input[0] = { ...input[0], row: 5, col: 9, orientation: 'V' };
  assert.equal(validateFleet(input)[0].cells.at(-1).row, 9);
});
test('fleet validation rejects missing, duplicate, overlapping, diagonal, forged and out-of-board ships', () => {
  fail('invalid_fleet', () => validateFleet(fleet().slice(1)));
  for (const patch of [{ id: 'patrol' }, { row: 2 }, { row: 0.5 }, { col: 6 },
    { orientation: 'D' }, { cells: [] }, { length: 1 }, { row: -1 }, { col: '0' }]) {
    const input = fleet(); input[0] = { ...input[0], ...patch };
    fail('invalid_fleet', () => validateFleet(input));
  }
});
test('battleship schema binds ready to a round and rejects forged results', () => {
  const ready = { type: 'battleship.ready', actionId: 'request_00000001', roomId: 'ABC123', roundId: 'a'.repeat(24), fleet: fleet() };
  assert.equal(validateAction(ready).fleet.length, 5);
  fail('invalid_round', () => validateAction({ ...ready, roundId: 'old' }));
  for (const key of ['uid', 'hit', 'winner', 'scores', 'ships', 'readyPlayers']) fail('invalid_fields', () => validateAction({ ...ready, [key]: true }));
});
test('shots derive hits without returning ship identity, preserve hit turns and pass misses', () => {
  const before = base(), fleets = { a: validateFleet(fleet()), b: validateFleet(fleet()) };
  const hit = applyBattleShot(before, fleets, 'a', 0, 0);
  assert.equal(hit.hit, true); assert.equal(hit.state.turn, 'a');
  assert.deepEqual(hit.state.shots.a, [{ row: 0, col: 0, hit: true }]);
  assert.deepEqual(hit.state.revealedShips, {}); assert.deepEqual(before.shots, {});
  const miss = applyBattleShot({ ...before, ...hit.state }, fleets, 'a', 9, 9);
  assert.equal(miss.state.turn, 'b'); assert.equal(miss.hit, false);
  fail('not_your_turn', () => applyBattleShot(before, fleets, 'b', 0, 0));
  fail('already_shot', () => applyBattleShot({ ...before, ...hit.state }, fleets, 'a', 0, 0));
  fail('not_a_player', () => applyBattleShot(before, fleets, 'outsider', 0, 0));
});
test('only the final hit awards a point and reveals fleets; a finished round cannot score twice', () => {
  const fleets = { a: validateFleet(fleet()), b: validateFleet(fleet()) };
  let data = base();
  const cells = fleets.b.flatMap(ship => ship.cells);
  for (const [index, cell] of cells.entries()) {
    data = { ...data, ...applyBattleShot(data, fleets, 'a', cell.row, cell.col).state };
    assert.equal(data.scores.a, index === 16 ? 1 : 0);
    if (index < 16) assert.deepEqual(data.revealedShips, {});
  }
  assert.equal(data.winner, 'a'); assert.equal(data.turn, null);
  assert.deepEqual(data.revealedShips, fleets);
  fail('game_not_playing', () => applyBattleShot(data, fleets, 'a', 9, 9));
});
