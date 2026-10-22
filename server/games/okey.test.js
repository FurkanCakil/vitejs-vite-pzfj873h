import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileSet, TURN_DURATION_MS, TURN_TIMEOUT_GRACE_MS, SETUP_DURATION_MS } from '../../src/games/okey101/tiles.js';
import { applyOkeyAction, dealOkeyRound, publicOkeyState, privateOkeyView, validateOkeyCommand } from './okey.js';

const now = 1_000_000;
const players = ['a', 'b', 'c', 'd'];
const tiles = createTileSet();
const tile = (color, number, copy = 0) => tiles.filter(t => t.color === color && t.number === number)[copy];
const room = (extra = {}) => ({ schemaVersion: 2, gameType: 'okey101', gameId: 'okey101', version: 0,
  host: 'a', players, spectators: ['viewer'], playerNames: { a: 'A', b: 'B', c: 'C', d: 'D' },
  rules: { gameType: 'ffa', assistedEnabled: true, foldingEnabled: false, foldToPartnerEnabled: false },
  scores: { a: 0, b: 0, c: 0, d: 0 }, isBotPlayer: {}, ...extra });
const fail = (code, fn) => assert.throws(fn, error => error.code === code);
const cmd = (state, type, extra = {}) => ({ type: `okey.${type}`, roundId: state.roundId,
  ...(['layout', 'tick', 'newRound'].includes(type) ? {} : { turnNumber: state.turnNumber }), ...extra });
const act = (state, uid, type, extra = {}, at = now) => applyOkeyAction(state, uid, cmd(state, type, extra), at);

function fixture(hand = [], extra = {}) {
  const data = dealOkeyRound(room(), now, 'a');
  data.racks = Object.fromEntries(players.map(uid => [uid, Array(30).fill(null)]));
  hand.forEach((t, i) => { data.racks.a[i] = t; });
  data.groups = Object.fromEntries(players.map(uid => [uid, {}]));
  data.indicator = tile('yellow', 12); data.okey = { color: 'yellow', number: 13 };
  Object.assign(data, extra);
  const used = [data.indicator, ...Object.values(data.racks).flat().filter(Boolean),
    ...Object.values(data.openedHands).flat().flatMap(group => group.tiles),
    ...Object.values(data.discardPiles).flat()];
  const usedIds = new Set(used.map(t => t.id));
  assert.equal(used.length, usedIds.size, 'fixture must not duplicate tiles');
  data.drawPile = tiles.filter(t => !usedIds.has(t.id));
  return data;
}
function conservation(state) {
  const all = [state.indicator, ...state.drawPile, ...Object.values(state.racks).flat().filter(Boolean),
    ...Object.values(state.discardPiles).flat(), ...Object.values(state.openedHands).flat().flatMap(g => g.tiles),
    ...(state.centerDiscard ? [state.centerDiscard] : [])];
  assert.equal(all.length, 106);
  assert.equal(new Set(all.map(t => t.id)).size, 106);
  const canonical = new Map(tiles.map(t => [t.id, t]));
  for (const t of all) assert.deepEqual(t, canonical.get(t.id));
}
const series = (color, start, count = 3) => Array.from({ length: count }, (_, i) => tile(color, start + i));

test('secure deals conserve all 106 canonical tiles and give only the starter 22', () => {
  const original = room(), before = structuredClone(original);
  for (let i = 0; i < 32; i++) {
    const state = dealOkeyRound(original, now, 'b');
    conservation(state);
    assert.deepEqual(players.map(uid => state.racks[uid].filter(Boolean).length), [21, 22, 21, 21]);
    assert.equal(state.drawPile.length, 20); assert.equal(state.indicator.isJoker, false);
    assert.equal(state.turn, 'b'); assert.equal(state.hasDrawnThisTurn, true);
    assert.equal(state.setupPhase, false);
  }
  assert.deepEqual(original, before);
  fail('four_players_required', () => dealOkeyRound(room({ players: ['a', 'a', 'c', 'd'] }), now));
});

test('team seating and 25s preparation preserve existing rules with server time', () => {
  const data = dealOkeyRound(room({ rules: { gameType: '2v2', assistedEnabled: false }, teams: { A: ['a', 'b'], B: ['c', 'd'] } }), now, 'a');
  assert.deepEqual(data.players, ['a', 'c', 'b', 'd']);
  assert.equal(data.setupEndsAt, now + SETUP_DURATION_MS);
  assert.equal(data.turnDeadline, now + SETUP_DURATION_MS + TURN_DURATION_MS);
  fail('setup_locked', () => act(data, 'a', 'discard', { tileId: data.racks.a.find(Boolean).id }));
  fail('too_early', () => act(data, 'a', 'tick', {}, data.setupEndsAt - 1));
  const started = act(data, 'b', 'tick', {}, data.setupEndsAt).state;
  assert.equal(started.setupPhase, false); assert.equal(started.turnDeadline, data.turnDeadline);
  fail('teams_incomplete', () => dealOkeyRound(room({ rules: { gameType: '2v2' }, teams: { A: ['a', 'b'], B: ['b', 'd'] } }), now));
});

test('public and own projections exclude every closed deck and opponent hand, including future fields', () => {
  const state = dealOkeyRound(room(), now, 'a');
  state.serverFutureSecret = { rack: state.racks.b }; state.history = [{ racks: state.racks }];
  const pub = publicOkeyState(state), own = privateOkeyView(state, 'a');
  for (const key of ['racks', 'groups', 'drawPile', 'takenOkeys', 'serverFutureSecret', 'history']) assert.equal(Object.hasOwn(pub, key), false);
  assert.deepEqual(Object.keys(own).sort(), ['groups', 'rack', 'roundId']);
  assert.deepEqual(own.rack, state.racks.a);
  assert.deepEqual(pub.rackCounts, { a: 22, b: 21, c: 21, d: 21 }); assert.equal(pub.drawPileCount, 20);
  fail('not_a_player', () => privateOkeyView(state, 'viewer'));
  pub.openedHands.a.push({ tiles: [] }); own.rack[0] = null;
  assert.equal(state.openedHands.a.length, 0); assert.equal(state.racks.a.filter(Boolean).length, 22);
});

test('command schemas reject forged identity, score, tile faces, duplicates, prototypes and excessive input', () => {
  const state = fixture([tile('red', 1)]), good = cmd(state, 'discard', { tileId: 'T0' });
  for (const key of ['uid', 'scores', 'winner', 'racks', 'tile', 'now']) fail('invalid_fields', () => validateOkeyCommand({ ...good, [key]: true }));
  for (const bad of [-1, 1.1, '0', Infinity]) fail('invalid_turn', () => validateOkeyCommand({ ...good, turnNumber: bad }));
  fail('invalid_tile', () => validateOkeyCommand({ ...good, tileId: 'T106' }));
  fail('duplicate_tile', () => validateOkeyCommand(cmd(state, 'open', { mode: 'series', melds: [['T0', 'T2', 'T4'], ['T0', 'T6', 'T8']] })));
  const rack = Array(30).fill(null); rack[0] = 'T0';
  fail('invalid_groups', () => validateOkeyCommand(cmd(state, 'layout', { rack, groups: JSON.parse('{"__proto__":["T0","T2"]}') })));
  fail('invalid_melds', () => validateOkeyCommand(cmd(state, 'open', { mode: 'series', melds: Array(100).fill(['T0', 'T2', 'T4']) })));
  fail('invalid_slot', () => validateOkeyCommand(cmd(state, 'draw', { source: 'pile', targetIndex: 30 })));
});

test('out of turn, old round/turn, spectator and direct bot impersonation cannot play', () => {
  const state = fixture([tile('red', 1), tile('blue', 2)]), before = structuredClone(state);
  fail('not_your_turn', () => act(state, 'b', 'discard', { tileId: state.racks.a[0].id }));
  fail('not_a_player', () => act(state, 'viewer', 'discard', { tileId: 'T0' }));
  fail('stale_round', () => applyOkeyAction(state, 'a', { ...cmd(state, 'discard', { tileId: 'T0' }), roundId: '0'.repeat(24) }, now));
  fail('stale_turn', () => act(state, 'a', 'discard', { tileId: 'T0', turnNumber: 1 }));
  fail('not_a_player', () => act({ ...state, isBotPlayer: { a: true } }, 'a', 'discard', { tileId: 'T0' }));
  assert.deepEqual(state, before);
});

test('drawing derives the secret top tile once and rejects a second draw or a tile not owned', () => {
  let state = fixture([tile('red', 1)], { hasDrawnThisTurn: false });
  const top = state.drawPile.at(-1), before = structuredClone(state);
  state = act(state, 'a', 'draw', { source: 'pile', targetIndex: 29 }).state;
  assert.deepEqual(state.racks.a[29], top); assert.deepEqual(before.drawPile, [...state.drawPile, top]);
  conservation(state);
  fail('already_drawn', () => act(state, 'a', 'draw', { source: 'pile', targetIndex: null }));
  fail('tile_not_owned', () => act(state, 'a', 'discard', { tileId: state.drawPile[0].id }));
});

test('layout only moves canonical owned tiles and preserves a newly drawn tile missing from a stale layout', () => {
  const state = fixture([tile('red', 1), tile('blue', 2)]);
  const rack = Array(30).fill(null); rack[29] = state.racks.a[0].id;
  const moved = act(state, 'a', 'layout', { rack, groups: {} }).state;
  assert.deepEqual(moved.racks.a[29], state.racks.a[0]);
  assert.equal(moved.racks.a.filter(Boolean).length, 2); conservation(moved);
  rack[0] = state.drawPile[0].id;
  fail('tile_not_owned', () => act(state, 'a', 'layout', { rack, groups: {} }));
});

test('side draws must be used or returned even after opening; returning forces pile draw', () => {
  const from = tile('red', 4), state = fixture([tile('blue', 1)], {
    hasDrawnThisTurn: false, hasOpened: { a: true, b: false, c: false, d: false },
    discardPiles: { a: [], b: [], c: [], d: [from] },
  });
  const drawn = act(state, 'a', 'draw', { source: 'discard', targetIndex: null }).state;
  assert.equal(drawn.sideTake.tileId, from.id); assert.equal(drawn.sideTake.penalized, false);
  fail('side_tile_unused', () => act(drawn, 'a', 'discard', { tileId: state.racks.a[0].id }));
  const cancelled = act(drawn, 'a', 'cancel').state;
  conservation(cancelled); assert.equal(cancelled.forcedPileDraw, true);
  assert.deepEqual(cancelled.discardPiles.d, [from]);
  fail('pile_draw_required', () => act(cancelled, 'a', 'draw', { source: 'discard', targetIndex: null }));
  const timed = act(drawn, 'b', 'tick', {}, drawn.turnDeadline + TURN_TIMEOUT_GRACE_MS).state;
  conservation(timed); assert.equal(timed.turn, 'b'); assert.equal(timed.sideTake, null);
});

test('series opening validates canonical melds, applies the threshold penalty and keeps a discard tile', () => {
  const low = series('red', 1), lowState = fixture([...low, tile('blue', 1)]);
  const denied = act(lowState, 'a', 'open', { mode: 'series', melds: [low.map(t => t.id)] });
  assert.equal(denied.result.penalized, true); assert.equal(denied.state.scores.a, -101);
  assert.deepEqual(denied.state.racks, lowState.racks);
  const high = [...series('red', 9, 5), ...series('blue', 9, 5)];
  const state = fixture([...high, tile('black', 1)]);
  const opened = act(state, 'a', 'open', { mode: 'series', melds: [high.slice(0, 5).map(t => t.id), high.slice(5).map(t => t.id)] }).state;
  assert.equal(opened.hasOpened.a, true); assert.equal(opened.racks.a.filter(Boolean).length, 1);
  assert.equal(opened.turnDeadline, state.turnDeadline + 15_000); conservation(opened);
  fail('must_keep_tile', () => act(fixture(high), 'a', 'open', { mode: 'series', melds: [high.slice(0, 5).map(t => t.id), high.slice(5).map(t => t.id)] }));
  fail('invalid_melds', () => act(state, 'a', 'open', { mode: 'series', melds: [[high[0].id, high[1].id, high[3].id]] }));
});

test('fold barriers penalize an insufficient opening and exempt a genuine same-turn hand finish', () => {
  const red = series('red', 9, 5), blue = series('blue', 9, 5), melds = [red.map(t => t.id), blue.map(t => t.id)];
  const settings = { rules: { foldingEnabled: true }, foldBarrier: { total: 150, uid: 'b' } };
  const penalty = act(fixture([...red, ...blue, tile('black', 1), tile('black', 2)], settings), 'a', 'open', { mode: 'series', melds });
  assert.equal(penalty.result.penalized, true); assert.equal(penalty.state.hasOpened.a, false);
  const exemption = act(fixture([...red, ...blue, tile('black', 1)], settings), 'a', 'open', { mode: 'series', melds });
  assert.equal(exemption.result.opened, true); assert.equal(exemption.state.foldBarrier.total, 150);
});

test('seven-pair opening earns one existing bonus and locks further series', () => {
  const pairs = Array.from({ length: 7 }, (_, i) => [tile('red', i + 1), tile('red', i + 1, 1)]);
  const state = fixture([...pairs.flat(), tile('black', 2)]);
  const opened = act(state, 'a', 'open', { mode: 'pairs', melds: pairs.map(group => group.map(t => t.id)) });
  assert.equal(opened.result.openBonus, -101); assert.equal(opened.state.scores.a, 101);
  assert.equal(opened.state.openedWithPairs.a, true); conservation(opened.state);
  fail('opening_mode_locked', () => act(opened.state, 'a', 'open', { mode: 'series', melds: [['T0', 'T2', 'T4']] }));
});

test('only a first pair opening may use the indicator twin as a wildcard', () => {
  const pairs = Array.from({ length: 4 }, (_, i) => [tile('red', i + 1), tile('red', i + 1, 1)]);
  const indicatorTwin = tile('yellow', 12, 1), unmatched = tile('black', 8);
  const melds = [...pairs, [indicatorTwin, unmatched]].map(group => group.map(t => t.id));
  const state = fixture([...pairs.flat(), indicatorTwin, unmatched, tile('black', 1)]);
  const opened = act(state, 'a', 'open', { mode: 'pairs', melds }).state;
  assert.equal(opened.openedWithPairs.a, true); conservation(opened);
  const again = fixture([indicatorTwin, unmatched, tile('black', 1)], { hasOpened: { a: true }, openedWithPairs: { a: true } });
  fail('invalid_melds', () => act(again, 'a', 'open', { mode: 'pairs', melds: [[indicatorTwin.id, unmatched.id]] }));
});

test('team penalties and opening bonuses apply equally to both teammates', () => {
  const red = series('red', 1), settings = { rules: { gameType: '2v2' }, teams: { A: ['a', 'c'], B: ['b', 'd'] } };
  const failed = act(fixture([...red, tile('black', 1)], settings), 'a', 'open', { mode: 'series', melds: [red.map(t => t.id)] }).state;
  assert.deepEqual(failed.scores, { a: -101, b: 0, c: -101, d: 0 });
  const pairs = Array.from({ length: 7 }, (_, i) => [tile('red', i + 1), tile('red', i + 1, 1)]);
  const opened = act(fixture([...pairs.flat(), tile('black', 1)], settings), 'a', 'open', {
    mode: 'pairs', melds: pairs.map(group => group.map(t => t.id)),
  }).state;
  assert.deepEqual(opened.scores, { a: 101, b: 0, c: 101, d: 0 });
});

test('empty pile ends a draw and the final pile tile ends the round after a discard', () => {
  const state = fixture([tile('red', 2)], { hasDrawnThisTurn: false });
  state.discardPiles.d = state.drawPile; state.drawPile = [];
  const ended = act(state, 'a', 'draw', { source: 'pile', targetIndex: null }).state;
  conservation(ended);
  assert.equal(ended.roundEnded, true); assert.equal(ended.roundResult.winnerUid, null);
  const last = fixture([tile('red', 2)], { hasDrawnThisTurn: false });
  last.discardPiles.d = last.drawPile.filter(t => t.id !== tile('blue', 1).id);
  last.drawPile = [tile('blue', 1)];
  const drawn = act(last, 'a', 'draw', { source: 'pile', targetIndex: null }).state;
  assert.equal(drawn.roundEnded, false);
  const discarded = act(drawn, 'a', 'discard', { tileId: tile('blue', 1).id }).state;
  conservation(discarded);
  assert.equal(discarded.roundEnded, true); assert.equal(discarded.roundResult.winnerUid, null);
});

test('side tile must be in the opening; its face value determines the opponent penalty', () => {
  const red = series('red', 9, 5), blue = series('blue', 9, 5), last = tile('black', 1);
  const state = fixture([...red, ...blue, last], { sideTake: { uid: 'a', fromUid: 'd', tileId: last.id, tileValue: 1, penalized: true } });
  fail('side_tile_unused', () => act(state, 'a', 'open', { mode: 'series', melds: [red.map(t => t.id), blue.map(t => t.id)] }));
  state.sideTake = { uid: 'a', fromUid: 'd', tileId: red[0].id, tileValue: 9, penalized: true };
  const opened = act(state, 'a', 'open', { mode: 'series', melds: [red.map(t => t.id), blue.map(t => t.id)] });
  assert.equal(opened.result.penaltyAmount, 90); assert.equal(opened.state.scores.d, -90);
  assert.equal(opened.state.sideTake, null); conservation(opened.state);
});

test('tacking checks membership and order, forbids using the last tile, and derives stolen Okey', () => {
  const meld = series('red', 3), tackTile = tile('red', 6);
  const settings = { openedHands: { a: [], b: [{ tiles: meld, type: 'seri' }], c: [], d: [] }, hasOpened: { a: true } };
  const state = fixture([tackTile, tile('black', 2)], settings);
  const target = { tileId: tackTile.id, targetUid: 'b', groupIndex: 0, side: 'right', replaceTileId: null };
  const tacked = act(state, 'a', 'tack', target).state;
  assert.equal(tacked.openedHands.b[0].tiles.length, 4); conservation(tacked);
  fail('must_keep_tile', () => act(fixture([tackTile], settings), 'a', 'tack', target));
  fail('invalid_tack', () => act(state, 'a', 'tack', { ...target, side: 'left' }));
  const joker = tile('yellow', 13), real = tile('red', 4);
  const steal = fixture([real, tile('black', 2)], { hasOpened: { a: true }, openedHands: {
    a: [], b: [{ tiles: [tile('red', 3), joker, tile('red', 5)], type: 'seri' }], c: [], d: [],
  } });
  const won = act(steal, 'a', 'tack', { ...target, tileId: real.id, replaceTileId: joker.id }).state;
  assert.ok(won.racks.a.some(t => t?.id === joker.id)); assert.deepEqual(won.takenOkeys.a, [joker.id]);
  assert.equal(won.scores.b, -101); conservation(won);
});

test('a finishing discard calculates scores once and new rounds rotate the starter', () => {
  const state = fixture([tile('red', 2)], { hasOpened: { a: true }, openedBeforeCurrentTurn: false });
  const finished = act(state, 'a', 'discard', { tileId: state.racks.a[0].id }).state;
  conservation(finished); assert.equal(finished.roundEnded, true); assert.equal(finished.roundResult.winnerUid, 'a');
  assert.equal(finished.scores.a, 101); assert.equal(finished.scores.b, -404);
  fail('round_finished', () => act(finished, 'a', 'discard', { tileId: state.racks.a[0].id }));
  fail('cannot_start_round', () => act(finished, 'b', 'newRound'));
  const next = act(finished, 'a', 'newRound').state;
  conservation(next); assert.equal(next.starterUid, 'b'); assert.notEqual(next.roundId, state.roundId);
  assert.equal(next.scores.a, 101); assert.equal(next.roundEnded, false);
});

test('expired actions are rejected and an authorized tick advances exactly one turn', () => {
  const state = fixture([tile('red', 2), tile('black', 1)]);
  fail('too_early', () => act(state, 'b', 'tick'));
  const deadline = state.turnDeadline + TURN_TIMEOUT_GRACE_MS;
  fail('turn_expired', () => act(state, 'a', 'discard', { tileId: state.racks.a[0].id }, deadline));
  const advanced = act(state, 'b', 'tick', {}, deadline).state;
  assert.equal(advanced.turn, 'b'); assert.equal(advanced.turnNumber, 1); conservation(advanced);
  fail('too_early', () => act(advanced, 'a', 'tick', {}, deadline));
});

test('repeated full rounds with three bots preserve tiles, finish, and never expose hands', () => {
  for (let game = 0; game < 24; game++) {
    let at = now, state = dealOkeyRound(room({ isBotPlayer: { b: true, c: true, d: true },
      rules: { gameType: game % 2 ? '2v2' : 'ffa', assistedEnabled: !!(game % 4), foldingEnabled: !!(game % 3), foldToPartnerEnabled: !!(game % 5) },
      teams: { A: ['a', 'c'], B: ['b', 'd'] },
    }), at, 'b');
    for (let step = 0; step < 150 && !state.roundEnded; step++) {
      at = state.setupPhase ? state.setupEndsAt : state.isBotPlayer[state.turn] ? Math.max(at, state.botReadyAt) : state.turnDeadline + TURN_TIMEOUT_GRACE_MS;
      const input = state, before = structuredClone(state);
      state = act(input, 'a', 'tick', {}, at).state;
      conservation(state); assert.deepEqual(input, before);
      assert.equal(publicOkeyState(state).racks, undefined);
      assert.equal(publicOkeyState(state).drawPile, undefined);
    }
    assert.equal(state.roundEnded, true, 'bounded closed pile must end the round');
    assert.equal(state.turn, null);
    assert.ok(Object.values(state.scores).every(Number.isSafeInteger));
  }
});
