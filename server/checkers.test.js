import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCheckersMove, freshCheckers } from './games/checkers.js';
import { validateAction } from './room-schema.js';

const man = (color, isKing = false) => ({ type: 'man', color, isKing });
const state = (pieces, patch = {}) => ({ schemaVersion: 2, gameType: 'dama', status: 'playing', players: ['alice', 'bob'],
  ...freshCheckers(['alice', 'bob'], undefined, 'alice'), ...(pieces ? { board: Array.from({ length: 64 }, (_, i) => pieces[i] ?? null) } : {}), ...patch });
const fail = (fn, code) => assert.throws(fn, error => error.code === code);
const input = { type: 'checkers.move', actionId: 'checkers_action_0001', roomId: 'DTEST1', expectedVersion: 1, from: 40, to: 33 };

test('Checkers accepts only source/destination and rejects forged captures, kings, identities and scores', () => {
  assert.deepEqual(validateAction(input), input);
  for (const field of ['board', 'capturedIdx', 'isKing', 'winner', 'scores', 'uid', 'multiJumpIdx', 'playerColors']) fail(() => validateAction({ ...input, [field]: 'forged' }), 'invalid_fields');
  for (const index of [-1, 64, 1.5, '2', null]) for (const field of ['from', 'to']) fail(() => validateAction({ ...input, [field]: index }), 'invalid_cell');
});

test('Checkers initial colors determine the white starter and retain scores', () => {
  const fresh = freshCheckers(['alice', 'bob'], { alice: 2, bob: 1 }, 'bob');
  assert.deepEqual(fresh.playerColors, { alice: 'b', bob: 'w' }); assert.equal(fresh.turn, 'bob');
  assert.equal(fresh.board.filter(Boolean).length, 24); assert.deepEqual(fresh.scores, { alice: 2, bob: 1 });
  assert.equal(fresh.multiJumpIdx, null);
});

test('Checkers normal move preserves input and rejects backward moves by an uncrowned piece', () => {
  const room = state(), before = structuredClone(room), result = applyCheckersMove(room, 'alice', 40, 33);
  assert.deepEqual(room, before); assert.equal(result.board[40], null); assert.deepEqual(result.board[33], man('w'));
  assert.equal(result.turn, 'bob'); assert.equal(result.winner, null);
  fail(() => applyCheckersMove(state({ 33: man('w'), 10: man('b') }), 'alice', 33, 40), 'illegal_move');
});

test('Checkers mandatory capture is global and a chain cannot switch pieces or stop early', () => {
  const room = state({ 40: man('w'), 44: man('w'), 33: man('b'), 17: man('b'), 7: man('b') });
  fail(() => applyCheckersMove(room, 'alice', 44, 35), 'illegal_move');
  const first = { ...room, ...applyCheckersMove(room, 'alice', 40, 26) };
  assert.equal(first.board[33], null); assert.equal(first.multiJumpIdx, 26); assert.equal(first.turn, 'alice');
  fail(() => applyCheckersMove(first, 'alice', 44, 35), 'illegal_move');
  fail(() => applyCheckersMove(first, 'alice', 26, 19), 'illegal_move');
  const second = applyCheckersMove(first, 'alice', 26, 8);
  assert.equal(second.board[17], null); assert.equal(second.multiJumpIdx, null); assert.equal(second.turn, 'bob');
});

test('Checkers promotion preserves the existing ability to continue jumping as a king', () => {
  const room = state({ 17: man('w'), 10: man('b'), 12: man('b'), 46: man('b') });
  const promoted = { ...room, ...applyCheckersMove(room, 'alice', 17, 3) };
  assert.equal(promoted.board[3].isKing, true); assert.equal(promoted.multiJumpIdx, 3);
  const result = applyCheckersMove(promoted, 'alice', 3, 21);
  assert.equal(result.board[12], null); assert.equal(result.board[21].isKing, true); assert.equal(result.turn, 'bob');
  const king = state({ 26: man('w', true), 46: man('b') });
  assert.equal(applyCheckersMove(king, 'alice', 26, 35).board[35].isKing, true);
});

test('Checkers last capture awards one point and an immobile opponent loses', () => {
  const room = state({ 40: man('w'), 33: man('b') });
  const won = { ...room, ...applyCheckersMove(room, 'alice', 40, 26) };
  assert.equal(won.winner, 'alice'); assert.equal(won.scores.alice, 1); assert.equal(won.turn, null);
  fail(() => applyCheckersMove(won, 'alice', 26, 19), 'game_not_playing');
  const blocked = applyCheckersMove(state({ 40: man('w'), 56: man('b') }), 'alice', 40, 33);
  assert.equal(blocked.winner, 'alice'); assert.equal(blocked.scores.alice, 1);
});

test('Checkers rejects spectators, wrong colors/turns, unsupported rooms and unplayable statuses', () => {
  fail(() => applyCheckersMove(state(), 'viewer', 40, 33), 'not_a_player');
  fail(() => applyCheckersMove(state(), 'bob', 17, 24), 'not_your_turn');
  fail(() => applyCheckersMove(state(), 'alice', 17, 24), 'piece_not_owned');
  fail(() => applyCheckersMove(state(null, { playerColors: { alice: 'w', bob: 'w' } }), 'alice', 40, 33), 'invalid_room');
  fail(() => applyCheckersMove(state(null, { gameType: 'xox' }), 'alice', 40, 33), 'unsupported_room');
  for (const status of ['waiting', 'abandoned', 'closed']) fail(() => applyCheckersMove(state(null, { status }), 'alice', 40, 33), 'game_not_playing');
});

test('Checkers rejects corrupt boards, impossible chain state and unsafe scores', () => {
  for (const pieces of [{ 0: man('w'), 17: man('b') }, { 40: { ...man('w'), isKing: 'yes' }, 17: man('b') }, { 40: man('w') }]) {
    fail(() => applyCheckersMove(state(pieces), 'alice', 40, 33), 'invalid_board');
  }
  fail(() => applyCheckersMove(state(null, { multiJumpIdx: 40 }), 'alice', 40, 33), 'invalid_chain');
  for (const score of [-1, NaN, Number.MAX_SAFE_INTEGER]) fail(() => applyCheckersMove(state(null, { scores: { alice: score, bob: 0 } }), 'alice', 40, 33), 'invalid_scores');
});
