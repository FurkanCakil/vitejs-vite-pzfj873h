import test from 'node:test';
import assert from 'node:assert/strict';
import { applyConnect4Move, freshConnect4 } from './games/connect4.js';
import { validateAction } from './room-schema.js';

const initial = (starter = 'alice') => ({ schemaVersion: 2, gameType: 'connect4', status: 'playing',
  players: ['alice', 'bob'], ...freshConnect4(['alice', 'bob'], undefined, starter) });
const play = (columns, room = initial()) => columns.reduce((state, col) => ({ ...state, ...applyConnect4Move(state, state.turn, col) }), room);
const fails = (fn, code) => assert.throws(fn, error => error.code === code);
const move = column => ({ type: 'connect4.move', roomId: 'CFOO12', actionId: 'connect_action_0001', expectedVersion: 1, column });

test('Connect 4 schema accepts only a column and rejects forged board, identity, result and score', () => {
  assert.deepEqual(validateAction(move(6)), move(6));
  for (const column of [-1, 7, 0.5, '2', null]) fails(() => validateAction(move(column)), 'invalid_column');
  for (const field of ['board', 'row', 'winner', 'scores', 'uid', 'color', 'turn']) {
    fails(() => validateAction({ ...move(0), [field]: 'forged' }), 'invalid_fields');
  }
});

test('Connect 4 server applies gravity without mutating input and changes the turn', () => {
  const room = initial(), before = structuredClone(room);
  const first = applyConnect4Move(room, 'alice', 3);
  assert.deepEqual(room, before); assert.equal(first.board[38], 'red');
  assert.deepEqual(first.lastMove, { row: 5, col: 3 }); assert.equal(first.turn, 'bob');
  const second = applyConnect4Move({ ...room, ...first }, 'bob', 3);
  assert.equal(second.board[31], 'blue'); assert.equal(second.turn, 'alice');
});

test('Connect 4 server detects horizontal, vertical and diagonal wins and scores once', () => {
  for (const sequence of [[0, 6, 1, 6, 2, 5, 3], [0, 1, 0, 1, 0, 1, 0], [0, 1, 1, 2, 4, 2, 2, 3, 4, 3, 5, 3, 3]]) {
    const room = play(sequence);
    assert.equal(room.winner, 'red'); assert.equal(room.scores.alice, 1); assert.equal(room.turn, null);
    assert.equal(room.winningLine.length, 4);
    fails(() => applyConnect4Move(room, 'alice', 0), 'game_not_playing');
  }
  const blueFirst = play([0, 1, 0, 1, 0, 1, 0], initial('bob'));
  assert.equal(blueFirst.winner, 'blue'); assert.equal(blueFirst.scores.bob, 1);
});

test('Connect 4 full column is rejected without changing the board', () => {
  const room = play([3, 3, 3, 3, 3, 3]), before = structuredClone(room);
  fails(() => applyConnect4Move(room, room.turn, 3), 'column_full'); assert.deepEqual(room, before);
});

test('Connect 4 legal full-board draw adds no score', () => {
  const room = play([1,6,4,6,0,2,6,0,6,3,6,4,3,0,3,4,2,2,3,4,4,0,4,3,3,2,1,5,2,2,5,6,5,5,5,5,0,0,1,1,1,1]);
  assert.equal(room.winner, 'Draw'); assert.equal(room.turn, null); assert.equal(room.board.filter(Boolean).length, 42);
  assert.deepEqual(room.scores, { alice: 0, bob: 0 }); assert.equal(room.winningLine, null);
});

test('Connect 4 rejects spectators, wrong turns, other games and unfinished room states', () => {
  fails(() => applyConnect4Move(initial(), 'viewer', 0), 'not_a_player');
  fails(() => applyConnect4Move(initial(), 'bob', 0), 'not_your_turn');
  fails(() => applyConnect4Move({ ...initial(), gameType: 'xox' }, 'alice', 0), 'unsupported_room');
  for (const status of ['waiting', 'abandoned', 'closed']) fails(() => applyConnect4Move({ ...initial(), status }, 'alice', 0), 'game_not_playing');
});

test('Connect 4 rejects corrupted gravity, values, counts, old winners and unsafe scores', () => {
  const corrupt = initial(); corrupt.board[0] = 'red';
  fails(() => applyConnect4Move(corrupt, 'alice', 0), 'invalid_board');
  for (const board of [Array(41).fill(null), Array(42).fill('green')]) fails(() => applyConnect4Move({ ...initial(), board }, 'alice', 0), 'invalid_board');
  const count = initial(); count.board[35] = 'blue';
  fails(() => applyConnect4Move(count, 'alice', 0), 'invalid_board');
  const won = play([0, 6, 1, 6, 2, 5, 3]);
  fails(() => applyConnect4Move({ ...won, winner: null, turn: 'bob' }, 'bob', 0), 'invalid_board');
  for (const score of [-1, Number.MAX_SAFE_INTEGER, NaN]) fails(() => applyConnect4Move({ ...initial(), scores: { alice: score, bob: 0 } }, 'alice', 0), 'invalid_scores');
});

test('Connect 4 fresh round clears last move and result while retaining scores and changing starter', () => {
  const state = freshConnect4(['alice', 'bob'], { alice: 4, bob: 2 }, 'bob');
  assert.deepEqual(state.scores, { alice: 4, bob: 2 }); assert.equal(state.turn, 'bob');
  assert.equal(state.lastMove, null); assert.equal(state.winner, null); assert.equal(state.board.filter(Boolean).length, 0);
});
