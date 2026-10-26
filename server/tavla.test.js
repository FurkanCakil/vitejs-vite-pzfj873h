import test from 'node:test';
import assert from 'node:assert/strict';
import { freshTavla, rollTavla, resetTavlaOpening, moveTavla, undoTavla, cubeTavla } from './games/tavla.js';
import { getStrictValidMoves } from '../src/games/backgammon/logic.js';
import { remainingTavlaDice, tavlaWinPoints } from '../src/games/backgammon/state.js';
import { validateAction } from './room-schema.js';

const state = patch => ({ schemaVersion: 2, gameType: 'tavla', status: 'playing', players: ['a', 'b'], ...freshTavla(['a', 'b'], undefined, 'a'), ...patch });
const fail = (fn, code) => assert.throws(fn, error => error.code === code);
const roll = (room, uid, dice) => ({ ...room, ...rollTavla(room, uid, dice) });
const moving = () => roll(roll(state(), 'a', [6, 1]), 'b', [3, 1]);
const position = (points, bar = { white: 0, black: 0 }, borneOff = { white: 0, black: 0 }) => ({
  board: Array.from({ length: 24 }, (_, i) => points[i] ? { color: points[i][0], count: points[i][1] } : { color: null, count: 0 }), bar, borneOff,
});
const move = (room, from, to, die) => ({ ...room, ...moveTavla(room, room.turn, from, to, die) });

test('Tavla fresh state has 15 pieces each, opening dice, explicit colors and retained scores', () => {
  const room = freshTavla(['a', 'b'], { a: 4, b: 2 }, 'b');
  for (const color of ['white', 'black']) assert.equal(room.board.reduce((sum, pt) => sum + (pt.color === color ? pt.count : 0), 0), 15);
  assert.deepEqual(room.playerColors, { a: 'black', b: 'white' }); assert.deepEqual(room.scores, { a: 4, b: 2 });
  assert.equal(room.turn, null); assert.equal(room.phase, 'opening'); assert.equal(room.cubeValue, 1);
});

test('Tavla schema rejects supplied dice, identities, board, score and snapshots', () => {
  const base = { actionId: 'tavla_schema_test1', roomId: 'TTEST1', expectedVersion: 2 };
  for (const type of ['tavla.roll', 'tavla.opening.reset', 'tavla.undo', 'tavla.cube.accept', 'tavla.rematch.accept']) {
    const input = { ...base, type }; assert.deepEqual(validateAction(input), input);
    for (const key of ['dice', 'uid', 'scores', 'winner', 'board', 'initialTurnState', 'cubeValue']) fail(() => validateAction({ ...input, [key]: 6 }), 'invalid_fields');
  }
  for (const [from, to] of [[-1, 0], [23, 24], [0, -1]]) assert.deepEqual(validateAction({ ...base, type: 'tavla.move', from, to, die: 6 }), { ...base, type: 'tavla.move', from, to, die: 6 });
  for (const patch of [{ from: -2 }, { from: 24 }, { to: 25 }, { to: 1.2 }]) fail(() => validateAction({ ...base, type: 'tavla.move', from: 0, to: 1, die: 1, ...patch }), 'invalid_cell');
  fail(() => validateAction({ ...base, type: 'tavla.move', from: 0, to: 1, die: 7 }), 'invalid_dice');
});

test('Tavla opening rolls are color-based, cannot reroll, ties require a player reset', () => {
  let room = roll(state(), 'a', [4, 1]); fail(() => rollTavla(room, 'a', [6, 1]), 'already_rolled');
  room = roll(room, 'b', [4, 2]); assert.equal(room.phase, 'opening'); assert.equal(room.turn, null);
  fail(() => resetTavlaOpening(room, 'viewer'), 'not_a_player'); room = { ...room, ...resetTavlaOpening(room, 'b') };
  assert.deepEqual(room.openingRolls, { p1: null, p2: null }); fail(() => resetTavlaOpening(room, 'a'), 'invalid_phase');
  room = roll(roll(room, 'b', [6, 1]), 'a', [2, 1]);
  assert.equal(room.turn, 'b'); assert.equal(room.startingPlayer, 'b'); assert.deepEqual(room.dice, [6, 2]);
  assert.equal(room.phase, 'moving'); assert.deepEqual(room.initialTurnState.board, state().board);
});

test('Tavla roll is immutable and rejects spectators, wrong turn, finished and malformed positions', () => {
  const room = moving(), before = structuredClone(room);
  fail(() => rollTavla(room, 'viewer', [1, 2]), 'not_a_player');
  fail(() => rollTavla({ ...room, phase: 'rolling' }, 'b', [1, 2]), 'not_your_turn');
  fail(() => rollTavla(room, 'a', [1, 2]), 'invalid_phase');
  fail(() => rollTavla({ ...room, winner: 'b' }, 'a', [1, 2]), 'game_not_playing');
  fail(() => rollTavla({ ...room, status: 'abandoned' }, 'a', [1, 2]), 'game_not_playing');
  fail(() => rollTavla({ ...room, board: room.board.slice(1) }, 'a', [1, 2]), 'invalid_board');
  fail(() => rollTavla({ ...room, bar: { white: 1, black: 0 } }, 'a', [1, 2]), 'invalid_board');
  fail(() => rollTavla({ ...room, gameType: 'xox' }, 'a', [1, 2]), 'unsupported_room');
  assert.deepEqual(room, before);
});

test('Tavla doubles have four dice and a blocked roll passes exactly to the opponent', () => {
  let room = roll({ ...state(), phase: 'rolling', turn: 'a' }, 'a', [5, 5]);
  assert.deepEqual(room.dice, [5, 5, 5, 5]);
  const blocked = position({ 0: ['black', 2], 1: ['black', 2], 23: ['white', 14], 12: ['black', 11] }, { white: 1, black: 0 });
  room = roll({ ...state(blocked), phase: 'rolling', turn: 'a' }, 'a', [1, 2]);
  assert.equal(room.turn, 'b'); assert.equal(room.phase, 'rolling'); assert.deepEqual(room.usedDice, [1, 2]); assert.equal(room.initialTurnState, null);
});

test('Tavla only strict legal moves consume the exact available die without changing input', () => {
  const room = moving(), before = structuredClone(room);
  fail(() => moveTavla(room, 'b', 23, 20, 3), 'not_your_turn');
  fail(() => moveTavla(room, 'viewer', 0, 6, 6), 'not_a_player');
  fail(() => moveTavla(room, 'a', 0, 6, 2), 'illegal_move');
  fail(() => moveTavla(room, 'a', 11, 17, 7), 'invalid_cell');
  const next = move(room, 0, 6, 6); assert.equal(next.board[0].count, 1); assert.equal(next.board[6].count, 1);
  assert.deepEqual(next.usedDice, [6]); assert.equal(next.turn, 'a'); assert.deepEqual(room, before);
  fail(() => moveTavla(next, 'a', 0, 6, 6), 'illegal_move');
});

test('Tavla enforces bar entry, hit, maximum dice usage and the higher-die rule', () => {
  const entered = state({ ...position({ 0: ['black', 1], 5: ['black', 14], 23: ['white', 14] }, { white: 1, black: 0 }), phase: 'moving', turn: 'a', dice: [1, 2] });
  fail(() => moveTavla(entered, 'a', 23, 24, 1), 'illegal_move');
  const hit = move(entered, -1, 0, 1); assert.equal(hit.board[0].color, 'white'); assert.equal(hit.bar.black, 1); assert.equal(hit.bar.white, 0);
  const high = state({ ...position({ 23: ['white', 1], 0: ['black', 1] }, { white: 0, black: 0 }, { white: 14, black: 14 }), phase: 'moving', turn: 'a', dice: [1, 6] });
  fail(() => moveTavla(high, 'a', 23, 24, 1), 'illegal_move'); assert.equal(move(high, 23, 24, 6).winner, 'a');
  // Entering with 1 leaves no playable 2; entering with 2 then moving 5->6 uses both.
  const max = state({ ...position({ 2: ['black', 2], 7: ['black', 2], 5: ['white', 14], 12: ['black', 11] }, { white: 1, black: 0 }), phase: 'moving', turn: 'a', dice: [1, 2] });
  fail(() => moveTavla(max, 'a', -1, 0, 1), 'illegal_move');
});

test('Tavla undo restores only this turn snapshot and cannot repeat or undo a completed turn', () => {
  const before = moving(), after = move(before, 0, 6, 6), restored = { ...after, ...undoTavla(after, 'a') };
  for (const key of ['board', 'bar', 'borneOff', 'dice', 'usedDice', 'scores']) assert.deepEqual(restored[key], before[key]);
  fail(() => undoTavla(restored, 'a'), 'invalid_undo');
  fail(() => undoTavla(after, 'b'), 'not_your_turn');
  let finished = after; const legal = getStrictValidMoves(finished.board, 'white', [3], finished.bar, finished.borneOff)[0];
  finished = move(finished, legal.from, legal.to, legal.die); assert.equal(finished.turn, 'b'); assert.equal(finished.initialTurnState, null);
  fail(() => undoTavla(finished, 'a'), 'not_your_turn');
  fail(() => undoTavla({ ...after, initialTurnState: { ...after.initialTurnState, bar: { white: 10, black: 0 } } }, 'a'), 'invalid_board');
});

test('Tavla final bearing off derives normal, gammon, backgammon and multiplied scores once', () => {
  for (const [blackPoint, blackCount, blackBar, blackBorne, multiplier] of [[0,14,0,1,1],[0,15,0,0,2],[18,15,0,0,3],[0,14,1,0,3]]) {
    const room = state({ ...position({ 23: ['white', 1], [blackPoint]: ['black', blackCount] }, { white: 0, black: blackBar }, { white: 14, black: blackBorne }),
      phase: 'moving', turn: 'a', dice: [1, 6], cubeValue: 4, scores: { a: 5, b: 3 } });
    const next = move(room, 23, 24, 6); assert.equal(next.winner, 'a'); assert.equal(next.scores.a, 5 + multiplier * 4); assert.equal(next.scores.b, 3);
    assert.equal(next.turn, null); assert.equal(next.initialTurnState, null); fail(() => moveTavla(next, 'a', 23, 24, 6), 'game_not_playing');
  }
  assert.equal(tavlaWinPoints(position({ 0: ['white', 15] }).board, { white:0, black:0 }, { white:0, black:15 }, 'black'), 3);
});

test('Tavla cube requires ownership before rolling, pauses play and transfers ownership to accepter', () => {
  const room = { ...state(), phase: 'rolling', turn: 'a' }, offer = { ...room, ...cubeTavla(room, 'a', 'request') };
  fail(() => cubeTavla(room, 'b', 'request'), 'not_your_turn');
  fail(() => cubeTavla(offer, 'a', 'accept'), 'invalid_offer');
  fail(() => rollTavla(offer, 'a', [1, 2]), 'offer_pending');
  fail(() => cubeTavla(offer, 'b', 'request'), 'offer_pending');
  fail(() => cubeTavla(offer, 'viewer', 'accept'), 'not_a_player');
  const accepted = { ...offer, ...cubeTavla(offer, 'b', 'accept') }; assert.equal(accepted.cubeValue, 2); assert.equal(accepted.cubeOwner, 'b'); assert.equal(accepted.turn, 'a');
  fail(() => cubeTavla(accepted, 'b', 'accept'), 'invalid_offer'); fail(() => cubeTavla(accepted, 'a', 'request'), 'cube_not_owned');
  assert.equal(roll(accepted, 'a', [1, 2]).phase, 'moving');
});

test('Tavla cube rejection awards the old stake once; no offer and unsafe scores are rejected', () => {
  const room = state({ phase: 'rolling', turn: 'a', cubeValue: 4, cubeOwner: 'a', cubeOfferBy: 'a', scores: { a: 2, b: 7 } });
  const declined = { ...room, ...cubeTavla(room, 'b', 'reject') }; assert.equal(declined.winner, 'a'); assert.deepEqual(declined.scores, { a: 6, b: 7 });
  fail(() => cubeTavla(declined, 'b', 'reject'), 'game_not_playing'); fail(() => cubeTavla({ ...room, cubeOfferBy: null }, 'b', 'reject'), 'invalid_offer');
  fail(() => cubeTavla({ ...room, cubeOfferBy: null, scores: { a: Number.MAX_SAFE_INTEGER, b: 0 } }, 'a', 'request'), 'score_limit');
  fail(() => rollTavla({ ...room, cubeValue: 3 }, 'a', [1, 2]), 'invalid_cube');
  fail(() => rollTavla({ ...room, cubeValue: 2 ** 50 + 1 }, 'a', [1, 2]), 'invalid_cube');
});

test('Tavla malformed dice consumption cannot manufacture an extra move', () => {
  for (const patch of [{ dice: [1,1] }, { dice: [1,1,1] }, { dice: [1,1,1,2] }, { usedDice: [6,6] }, { usedDice: [7] }]) {
    fail(() => moveTavla({ ...moving(), ...patch }, 'a', 0, 6, 6), 'invalid_dice');
  }
  assert.deepEqual(remainingTavlaDice([2,2,2,2], [2,2,2]), [2]);
});

test('Tavla completes an initial-position game with hits, doubles and both colors while conserving all pieces', () => {
  // Deterministic test dice; production randomness is generated only in xox-rooms.
  let seed = 87654321;
  const die = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % 6 + 1; };
  let room = state(), hits = 0, doubles = 0, moves = 0;
  const moved = new Set();
  for (let step = 0; step < 500 && !room.winner; step++) {
    if (room.phase === 'opening') {
      if (room.openingRolls.p1 && room.openingRolls.p1 === room.openingRolls.p2) room = { ...room, ...resetTavlaOpening(room, 'a') };
      else {
        const uid = room.players.find(id => !room.openingRolls[room.playerColors[id] === 'white' ? 'p1' : 'p2']);
        room = roll(room, uid, [die(), die()]);
      }
    } else if (room.phase === 'rolling') {
      const dice = [die(), die()]; if (dice[0] === dice[1]) doubles++;
      room = roll(room, room.turn, dice);
    } else {
      const color = room.playerColors[room.turn];
      const options = getStrictValidMoves(room.board, color, remainingTavlaDice(room.dice, room.usedDice), room.bar, room.borneOff);
      options.sort((a,b) => Number(b.to === 24 || b.to === -1) - Number(a.to === 24 || a.to === -1));
      assert.ok(options.length > 0, 'a moving turn always has an available move');
      const chosen = options[0]; if (room.board[chosen.to]?.color && room.board[chosen.to].color !== color) hits++;
      moved.add(color); room = move(room, chosen.from, chosen.to, chosen.die); moves++;
    }
    for (const color of ['white', 'black']) assert.equal(room.board.reduce((sum, point) => sum + (point.color === color ? point.count : 0), 0) + room.bar[color] + room.borneOff[color], 15);
    assert.equal(Object.values(room.scores).reduce((sum, score) => sum + score, 0), room.winner ? 1 : 0);
  }
  assert.equal(room.winner, 'a'); assert.equal(room.borneOff.white, 15);
  assert.ok(moves > 100 && hits > 0 && doubles > 0); assert.equal(moved.size, 2);
});
