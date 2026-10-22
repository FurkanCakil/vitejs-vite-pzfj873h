import { randomBytes, randomInt } from 'node:crypto';
import { requireAction } from '../errors.js';
import {
  createTileSet, RACK_SLOTS, SETUP_DURATION_MS, TURN_DURATION_MS, TURN_TIMEOUT_GRACE_MS,
  computeOkeyInfo, effectiveTile, isOkeyTile, mergeRackLayout, pruneGroups,
} from '../../src/games/okey101/tiles.js';
import {
  getNextTurnUid, getPrevTurnUid, validateGroup, isValidPairTiles, orderGroupTiles,
  canTackTile, findJokerReplacements, findTackableSpotsForTile, computeRoundEnd,
  isExemptFromFoldBarrier, requiredPairsToOpen, canPlayerLayPairs, canPlayerLayMelds,
  anyPairsOnTable, pickPairsHostUid, addScoreDelta, pairsOpenBonus, seriesOpenBonus,
  OPEN_THRESHOLD, PENALTY_POINTS, SIDE_TAKE_SERIES_MULTIPLIER, SIDE_TAKE_PAIRS_MULTIPLIER,
} from '../../src/games/okey101/gameLogic.js';
import { buildSeriesArrangement } from '../../src/games/okey101/assist.js';
import {
  pickBotMelds, pickBotPairs, canOpenedBotUseTile, shouldTakeDiscardToOpen,
  findTackOpportunities, pickDiscardTile, pickSmallestSafeDiscard,
} from '../../src/games/okey101/botAI.js';

// The room service transactionally persists state, projections and receipts;
// the Okey route remains disabled unless its separate rollout flag is enabled.
const tileId = id => typeof id === 'string' && /^T(?:[0-9]|[1-9][0-9]|10[0-5])$/.test(id);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length
  && Object.keys(value).every(key => keys.includes(key));
const keyId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
const ids = (value, min, max) => Array.isArray(value) && value.length >= min && value.length <= max
  && value.every(tileId) && new Set(value).size === value.length;
const commands = {
  'okey.layout': ['rack', 'groups'], 'okey.draw': ['source', 'targetIndex', 'turnNumber'],
  'okey.cancel': ['turnNumber'], 'okey.discard': ['tileId', 'turnNumber'],
  'okey.open': ['melds', 'mode', 'turnNumber'],
  'okey.tack': ['tileId', 'targetUid', 'groupIndex', 'side', 'replaceTileId', 'turnNumber'],
  'okey.tick': [], 'okey.newRound': [],
};

export function validateOkeyCommand(input) {
  requireAction(plain(input) && Object.hasOwn(commands, input.type), 400, 'unsupported_action');
  const keys = ['type', 'roundId', ...commands[input.type]];
  requireAction(exact(input, keys), 400, 'invalid_fields');
  requireAction(typeof input.roundId === 'string' && /^[a-f0-9]{24}$/.test(input.roundId), 400, 'invalid_round');
  if (keys.includes('turnNumber')) requireAction(Number.isSafeInteger(input.turnNumber) && input.turnNumber >= 0, 400, 'invalid_turn');
  if (keys.includes('tileId')) requireAction(tileId(input.tileId), 400, 'invalid_tile');
  if (input.type === 'okey.draw') {
    requireAction(['pile', 'discard'].includes(input.source), 400, 'invalid_source');
    requireAction(input.targetIndex === null || (Number.isInteger(input.targetIndex) && input.targetIndex >= 0 && input.targetIndex < RACK_SLOTS), 400, 'invalid_slot');
  }
  if (input.type === 'okey.layout') {
    requireAction(Array.isArray(input.rack) && input.rack.length === RACK_SLOTS
      && input.rack.every(id => id === null || tileId(id)), 400, 'invalid_layout');
    const filled = input.rack.filter(id => id !== null);
    requireAction(new Set(filled).size === filled.length, 400, 'invalid_layout');
    requireAction(plain(input.groups) && Object.keys(input.groups).length <= 15, 400, 'invalid_groups');
    const all = [];
    for (const [gid, group] of Object.entries(input.groups)) {
      requireAction(keyId(gid) && !['__proto__', 'constructor', 'prototype'].includes(gid) && ids(group, 2, 13), 400, 'invalid_groups');
      all.push(...group);
    }
    requireAction(new Set(all).size === all.length && all.every(id => filled.includes(id)), 400, 'invalid_groups');
  }
  if (input.type === 'okey.open') {
    requireAction(['series', 'pairs'].includes(input.mode) && Array.isArray(input.melds)
      && input.melds.length >= 1 && input.melds.length <= 14
      && input.melds.every(group => ids(group, 2, 13)), 400, 'invalid_melds');
    const used = input.melds.flat();
    requireAction(used.length <= 29 && new Set(used).size === used.length, 400, 'duplicate_tile');
  }
  if (input.type === 'okey.tack') {
    requireAction(typeof input.targetUid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(input.targetUid), 400, 'invalid_target');
    requireAction(Number.isInteger(input.groupIndex) && input.groupIndex >= 0 && input.groupIndex < 106, 400, 'invalid_target');
    requireAction(['left', 'right'].includes(input.side) && (input.replaceTileId === null || tileId(input.replaceTileId)), 400, 'invalid_target');
  }
  return structuredClone(input);
}

const bot = (data, uid) => data.isBotPlayer?.[uid] === true;
const rackTiles = (data, uid) => data.racks[uid].filter(Boolean);
const bumpDeadline = (data, now) => { data.turnDeadline = Math.max(data.turnDeadline ?? 0, now) + 15_000; };
const score = (data, uid, delta) => { data.scores = addScoreDelta(data, uid, delta).scores; };
const sideValue = (tile, okey) => isOkeyTile(tile, okey) ? 13 : effectiveTile(tile, okey).number;
const newRoundId = () => randomBytes(12).toString('hex');

export function secureShuffle(tiles) {
  const result = [...tiles];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function dealOkeyRound(room, now = Date.now(), starter = null) {
  requireAction(Array.isArray(room.players) && room.players.length === 4 && new Set(room.players).size === 4, 409, 'four_players_required');
  const data = structuredClone(room);
  if (data.rules?.gameType === '2v2') {
    const a = data.teams?.A ?? [], b = data.teams?.B ?? [];
    const ordered = [a[0], b[0], a[1], b[1]];
    requireAction(a.length === 2 && b.length === 2 && new Set(ordered).size === 4
      && ordered.every(uid => data.players.includes(uid)), 409, 'teams_incomplete');
    data.players = ordered;
    // Team scores must have a single canonical total before the first deal.
    requireAction(a.every(uid => (data.scores?.[uid] ?? 0) === (data.scores?.[a[0]] ?? 0))
      && b.every(uid => (data.scores?.[uid] ?? 0) === (data.scores?.[b[0]] ?? 0)), 409, 'invalid_team_scores');
  }
  starter ??= data.players[randomInt(data.players.length)];
  requireAction(data.players.includes(starter), 409, 'invalid_starter');
  const pile = secureShuffle(createTileSet());
  const racks = Object.fromEntries(data.players.map(uid => {
    const rack = Array(RACK_SLOTS).fill(null);
    const count = uid === starter ? 22 : 21;
    for (let i = 0; i < count; i++) rack[i] = pile.pop();
    return [uid, rack];
  }));
  const index = pile.findIndex(tile => !tile.isJoker);
  const [indicator] = pile.splice(index, 1);
  const groups = Object.fromEntries(data.players.map(uid => [uid, {}]));
  const okey = computeOkeyInfo(indicator);
  if (data.rules?.assistedEnabled) for (const uid of data.players) {
    if (bot(data, uid)) continue;
    const arranged = buildSeriesArrangement(racks[uid], okey);
    if (arranged) { racks[uid] = arranged.rack; groups[uid] = arranged.groups; }
  }
  const setupPhase = !data.rules?.assistedEnabled;
  return {
    ...data, status: 'playing', roundId: newRoundId(), turnNumber: 0, playVersion: 0,
    racks, groups, drawPile: pile, indicator, okey,
    discardPiles: Object.fromEntries(data.players.map(uid => [uid, []])),
    openedHands: Object.fromEntries(data.players.map(uid => [uid, []])),
    hasOpened: Object.fromEntries(data.players.map(uid => [uid, false])),
    openedWithPairs: Object.fromEntries(data.players.map(uid => [uid, false])),
    scores: Object.fromEntries(data.players.map(uid => [uid, data.scores?.[uid] ?? 0])),
    roundStartScores: { ...data.scores }, setupPhase,
    setupEndsAt: setupPhase ? now + SETUP_DURATION_MS : null,
    turnDeadline: now + (setupPhase ? SETUP_DURATION_MS : 0) + TURN_DURATION_MS,
    botReadyAt: now + (setupPhase ? SETUP_DURATION_MS : 0) + 2000,
    turn: starter, starterUid: starter, hasDrawnThisTurn: true,
    sideTake: null, forcedPileDraw: false, roundEnded: false, roundResult: null,
    centerDiscard: null, openedBeforeCurrentTurn: false, tackHint: null,
    foldBarrier: null, foldPairsBarrier: null, takenOkeys: {}, foldMultiplier: data.foldMultiplier ?? 1,
  };
}

function finish(data, winner = null, lastTile = null) {
  const wonByOkey = !!lastTile && isOkeyTile(lastTile, data.okey);
  const fromHand = !!winner && !data.openedBeforeCurrentTurn && !!data.hasOpened[winner];
  const result = computeRoundEnd({ ...data, okeyInfo: data.okey }, winner, wonByOkey, fromHand);
  Object.assign(data, { scores: result.newScores, roundResult: result.roundResult,
    roundEnded: true, turn: null, turnDeadline: null, botReadyAt: null,
    hasDrawnThisTurn: false, sideTake: null, forcedPileDraw: false, tackHint: null });
  if (lastTile) data.centerDiscard = lastTile;
}

function layout(data, uid, action) {
  const byId = new Map(rackTiles(data, uid).map(tile => [tile.id, tile]));
  // Unknown IDs are rejected. Omitted newly drawn tiles are preserved by merge.
  requireAction(action.rack.every(id => id === null || byId.has(id)), 409, 'tile_not_owned');
  const desired = action.rack.map(id => id === null ? null : byId.get(id));
  data.racks[uid] = mergeRackLayout(data.racks[uid], desired);
  data.groups[uid] = pruneGroups(action.groups, data.racks[uid]);
}

function draw(data, uid, source, targetIndex) {
  requireAction(!data.hasDrawnThisTurn, 409, 'already_drawn');
  requireAction(source !== 'discard' || !data.forcedPileDraw, 409, 'pile_draw_required');
  const fromUid = getPrevTurnUid(data.players, uid);
  const pile = source === 'pile' ? data.drawPile : data.discardPiles[fromUid];
  if (!pile.length && source === 'pile') { finish(data); return; }
  requireAction(pile.length, 409, 'empty_discard');
  const rack = data.racks[uid];
  const index = targetIndex !== null && rack[targetIndex] === null ? targetIndex : rack.indexOf(null);
  requireAction(index >= 0, 409, 'rack_full');
  const tile = pile.pop();
  rack[index] = tile;
  data.hasDrawnThisTurn = true;
  if (source === 'discard') data.sideTake = {
    uid, fromUid, tileId: tile.id, tileValue: sideValue(tile, data.okey), penalized: !data.hasOpened[uid],
  };
}

function cancelSide(data, uid) {
  const st = data.sideTake;
  requireAction(st?.uid === uid && data.hasDrawnThisTurn, 409, 'no_side_take');
  const rack = data.racks[uid], index = rack.findIndex(tile => tile?.id === st.tileId);
  requireAction(index >= 0, 503, 'invalid_private_state');
  data.discardPiles[st.fromUid].push(rack[index]); rack[index] = null;
  const pruned = pruneGroups(data.groups[uid], rack);
  const byId = new Map(rack.filter(Boolean).map(tile => [tile.id, tile]));
  data.groups[uid] = Object.fromEntries(Object.entries(pruned).filter(([, group]) => {
    const tiles = group.map(id => byId.get(id));
    return tiles.length === 2 ? isValidPairTiles(...tiles, data.okey) : validateGroup(tiles, data.okey).valid;
  }));
  data.sideTake = null; data.hasDrawnThisTurn = false; data.forcedPileDraw = true;
}

function discard(data, uid, id, now) {
  requireAction(data.hasDrawnThisTurn, 409, 'draw_required');
  requireAction(!data.sideTake, 409, 'side_tile_unused');
  const rack = data.racks[uid], index = rack.findIndex(tile => tile?.id === id);
  requireAction(index >= 0, 409, 'tile_not_owned');
  const tile = rack[index]; rack[index] = null;
  data.groups[uid] = pruneGroups(data.groups[uid], rack);
  if (!rack.some(Boolean)) { finish(data, uid, tile); return {}; }
  data.discardPiles[uid].push(tile);
  const discardedOkey = isOkeyTile(tile, data.okey);
  const spots = discardedOkey ? [] : findTackableSpotsForTile(tile, data.openedHands, data.okey);
  if (discardedOkey || spots.length) score(data, uid, PENALTY_POINTS);
  if (!data.drawPile.length) finish(data);
  else {
    data.turn = getNextTurnUid(data.players, uid); data.turnNumber++;
    data.hasDrawnThisTurn = false; data.sideTake = null; data.forcedPileDraw = false;
    data.openedBeforeCurrentTurn = !!data.hasOpened[data.turn];
    data.turnDeadline = now + TURN_DURATION_MS; data.botReadyAt = now + 2000;
    data.tackHint = spots.length ? { tileId: id, spots, expiresAt: now + 2800 } : null;
  }
  return { discardedOkey, discardedTackable: !!spots.length };
}

function open(data, uid, meldIds, pairs, now) {
  requireAction(data.hasDrawnThisTurn, 409, 'draw_required');
  requireAction(pairs ? canPlayerLayPairs(uid, data.hasOpened, data.openedWithPairs)
    : canPlayerLayMelds(uid, data.openedWithPairs), 409, 'opening_mode_locked');
  const byId = new Map(rackTiles(data, uid).map(tile => [tile.id, tile]));
  const used = meldIds.flat();
  requireAction(new Set(used).size === used.length && used.every(id => byId.has(id)), 409, 'tile_not_owned');
  requireAction(used.length < byId.size, 409, 'must_keep_tile');
  const alreadyOpened = data.hasOpened[uid];
  const melds = meldIds.map(group => group.map(id => byId.get(id)));
  const checked = melds.map(tiles => pairs
    ? { valid: tiles.length === 2 && isValidPairTiles(...tiles, data.okey, alreadyOpened ? null : data.indicator), type: 'cift', value: 0 }
    : validateGroup(tiles, data.okey));
  requireAction(checked.every(group => group.valid), 409, 'invalid_melds');
  const st = data.sideTake;
  requireAction(!st || st.uid !== uid || used.includes(st.tileId), 409, 'side_tile_unused');
  const total = checked.reduce((sum, group) => sum + group.value, 0);
  const barrier = data.rules?.foldingEnabled ? data.foldBarrier : null;
  const pairBarrier = data.rules?.foldingEnabled ? data.foldPairsBarrier : null;
  if (pairs) requireAction(alreadyOpened || melds.length >= requiredPairsToOpen(pairBarrier,
    isExemptFromFoldBarrier(uid, pairBarrier, data.rules, data.teams)), 409, 'not_enough_pairs');
  // An under-threshold series attempt is a legal penalized action, not a
  // failed transaction; the future receipt must record it exactly once.
  if (!pairs && !alreadyOpened && (total < OPEN_THRESHOLD || (barrier && byId.size - used.length > 1
    && !isExemptFromFoldBarrier(uid, barrier, data.rules, data.teams) && total <= barrier.total))) {
    score(data, uid, PENALTY_POINTS);
    return { opened: false, penalized: true, total };
  }
  const host = pairs && alreadyOpened ? (pickPairsHostUid(uid, data.openedWithPairs, data.rules, data.teams,
    () => randomInt(0x1000000) / 0x1000000) ?? uid) : uid;
  for (let i = 0; i < melds.length; i++) data.openedHands[host].push({
    tiles: orderGroupTiles(melds[i], checked[i].type, data.okey), type: checked[i].type,
  });
  const usedSet = new Set(used);
  data.racks[uid] = data.racks[uid].map(tile => tile && usedSet.has(tile.id) ? null : tile);
  data.groups[uid] = pruneGroups(data.groups[uid], data.racks[uid]);
  data.hasOpened[uid] = true;
  if (!alreadyOpened && pairs) data.openedWithPairs[uid] = true;
  bumpDeadline(data, now);
  if (!alreadyOpened && data.rules?.foldingEnabled) {
    if (pairs && (!pairBarrier || melds.length > pairBarrier.count)) data.foldPairsBarrier = { count: melds.length, uid };
    if (!pairs && (!barrier || total > barrier.total)) data.foldBarrier = { total, uid };
  }
  let penaltyAmount = 0;
  if (st?.uid === uid) {
    if (st.penalized) {
      penaltyAmount = st.tileValue * (pairs ? SIDE_TAKE_PAIRS_MULTIPLIER : SIDE_TAKE_SERIES_MULTIPLIER);
      score(data, st.fromUid, penaltyAmount);
    }
    data.sideTake = null;
  }
  const openBonus = alreadyOpened ? 0 : pairs ? pairsOpenBonus(melds.length) : seriesOpenBonus(total);
  if (openBonus) score(data, uid, openBonus);
  return { opened: true, total, count: melds.length, openBonus, penaltyAmount };
}

function tack(data, uid, action) {
  requireAction(data.hasDrawnThisTurn && data.hasOpened[uid], 409, 'opening_required');
  requireAction(data.players.includes(action.targetUid), 409, 'invalid_target');
  const rack = data.racks[uid], index = rack.findIndex(tile => tile?.id === action.tileId);
  requireAction(index >= 0, 409, 'tile_not_owned');
  const tile = rack[index], target = data.openedHands[action.targetUid], group = target[action.groupIndex];
  requireAction(group, 409, 'invalid_target');
  if (action.replaceTileId) {
    requireAction(!isOkeyTile(tile, data.okey), 409, 'invalid_replacement');
    const jokerIndex = group.tiles.findIndex(t => t.id === action.replaceTileId);
    requireAction(jokerIndex >= 0 && isOkeyTile(group.tiles[jokerIndex], data.okey), 409, 'invalid_replacement');
    const replacement = findJokerReplacements(group.tiles, group.type, tile, data.okey).find(item => item.jokerIdx === jokerIndex);
    requireAction(replacement, 409, 'invalid_replacement');
    const joker = group.tiles[jokerIndex]; rack[index] = joker;
    target[action.groupIndex] = { ...group, tiles: replacement.newTiles };
    data.takenOkeys[uid] = [...new Set([...(data.takenOkeys[uid] ?? []), joker.id])];
    const team = data.rules?.gameType === '2v2' && [data.teams?.A ?? [], data.teams?.B ?? []]
      .some(members => members.includes(uid) && members.includes(action.targetUid));
    if (action.targetUid !== uid && !team) score(data, action.targetUid, PENALTY_POINTS);
  } else {
    requireAction(rackTiles(data, uid).length > 1, 409, 'must_keep_tile');
    const result = canTackTile(group.tiles, group.type, tile, action.side, data.okey);
    requireAction(result.valid, 409, 'invalid_tack');
    target[action.groupIndex] = { ...group, tiles: orderGroupTiles(result.newTiles, group.type, data.okey) };
    rack[index] = null;
  }
  data.groups[uid] = pruneGroups(data.groups[uid], rack);
  if (data.sideTake?.uid === uid && data.sideTake.tileId === tile.id) data.sideTake = null;
}

function trimMelds(melds, count) {
  let used = 0;
  return [...melds].sort((a, b) => b.value - a.value).filter(meld => {
    if (used + meld.tiles.length >= count) return false;
    used += meld.tiles.length; return true;
  });
}

function botTurn(data, uid, now) {
  // Only this bot's rack and public table enter the decision helpers. Neither
  // the closed pile order nor another player's rack is passed to the AI.
  if (!data.hasDrawnThisTurn) {
    const prev = getPrevTurnUid(data.players, uid), top = data.discardPiles[prev].at(-1);
    const barrier = data.rules?.foldingEnabled ? data.foldBarrier : null;
    const pairBarrier = data.rules?.foldingEnabled ? data.foldPairsBarrier : null;
    const requiredTotal = barrier && !isExemptFromFoldBarrier(uid, barrier, data.rules, data.teams) ? barrier.total + 1 : OPEN_THRESHOLD;
    const requiredPairs = requiredPairsToOpen(pairBarrier, isExemptFromFoldBarrier(uid, pairBarrier, data.rules, data.teams));
    const take = !data.forcedPileDraw && top && (data.hasOpened[uid]
      ? canOpenedBotUseTile(rackTiles(data, uid), top, data.okey, data.openedHands, { pairsAllowed: data.openedWithPairs[uid] || anyPairsOnTable(data.openedWithPairs) })
      : shouldTakeDiscardToOpen(rackTiles(data, uid), top, data.okey, requiredTotal, requiredPairs));
    draw(data, uid, take ? 'discard' : 'pile', null);
  }
  if (data.roundEnded) return;
  const attemptOpen = () => {
    const already = data.hasOpened[uid];
    const tryMelds = (melds, pairs) => {
      if (!melds.length) return;
      if (data.sideTake && !melds.some(meld => meld.tiles.some(tile => tile.id === data.sideTake.tileId))) return;
      open(data, uid, melds.map(meld => meld.tiles.map(tile => tile.id)), pairs, now);
    };
    if (!already) {
      const barrier = data.rules?.foldingEnabled ? data.foldBarrier : null;
      const pairBarrier = data.rules?.foldingEnabled ? data.foldPairsBarrier : null;
      const min = requiredPairsToOpen(pairBarrier, isExemptFromFoldBarrier(uid, pairBarrier, data.rules, data.teams));
      const hand = rackTiles(data, uid), pairs = pickBotPairs(hand, data.okey, min);
      if (pairs.length >= min && hand.length > pairs.length * 2) { tryMelds(pairs, true); return; }
      const melds = pickBotMelds(hand, data.okey), used = melds.reduce((n, meld) => n + meld.tiles.length, 0);
      const target = barrier && hand.length - used > 1 && !isExemptFromFoldBarrier(uid, barrier, data.rules, data.teams) ? barrier.total + 1 : OPEN_THRESHOLD;
      if (hand.length > used && melds.reduce((n, meld) => n + meld.value, 0) >= target) tryMelds(melds, false);
    } else {
      if (!data.openedWithPairs[uid]) tryMelds(trimMelds(pickBotMelds(rackTiles(data, uid), data.okey), rackTiles(data, uid).length), false);
      if (canPlayerLayPairs(uid, data.hasOpened, data.openedWithPairs)) tryMelds(trimMelds(pickBotPairs(rackTiles(data, uid), data.okey), rackTiles(data, uid).length), true);
    }
  };
  const attemptTacks = () => {
    if (!data.hasOpened[uid]) return;
    for (let i = 0; i < 29 && rackTiles(data, uid).length > 1; i++) {
      const spots = findTackOpportunities(rackTiles(data, uid), data.openedHands, data.okey);
      const spot = spots.find(item => item.tile.id === data.sideTake?.tileId) ?? spots[0];
      if (!spot) break;
      tack(data, uid, { tileId: spot.tile.id, targetUid: spot.targetUid, groupIndex: spot.groupIndex, side: spot.side, replaceTileId: null });
    }
  };
  attemptOpen(); attemptTacks();
  if (data.sideTake) {
    cancelSide(data, uid); draw(data, uid, 'pile', null);
    if (data.roundEnded) return;
    attemptOpen(); attemptTacks();
  }
  const chosen = pickDiscardTile(rackTiles(data, uid), data.okey, data.openedHands);
  requireAction(chosen, 503, 'invalid_private_state');
  discard(data, uid, chosen.id, now);
}

export function applyOkeyAction(state, uid, input, now = Date.now()) {
  const action = validateOkeyCommand(input);
  requireAction(state.players.includes(uid) && !bot(state, uid), 403, 'not_a_player');
  requireAction(state.status === 'playing', 409, 'game_not_playing');
  requireAction(state.roundId === action.roundId, 409, 'stale_round');
  const data = structuredClone(state);
  let result = {};
  if (action.type === 'okey.newRound') {
    requireAction(data.host === uid && data.roundEnded, 409, 'cannot_start_round');
    return { state: dealOkeyRound(data, now, getNextTurnUid(data.players, data.starterUid)), result };
  }
  requireAction(!data.roundEnded, 409, 'round_finished');
  if (action.type === 'okey.layout') layout(data, uid, action);
  else if (action.type === 'okey.tick') {
    if (data.setupPhase) {
      requireAction(now >= data.setupEndsAt, 409, 'too_early');
      data.setupPhase = false;
    } else if (bot(data, data.turn) && now >= data.botReadyAt) botTurn(data, data.turn, now);
    else {
      requireAction(now >= data.turnDeadline + TURN_TIMEOUT_GRACE_MS, 409, 'too_early');
      const actor = data.turn;
      // An already-opened player's unconsumed side tile must also be returned.
      if (data.sideTake) cancelSide(data, actor);
      if (!data.hasDrawnThisTurn) draw(data, actor, 'pile', null);
      if (!data.roundEnded) {
        const tile = pickSmallestSafeDiscard(rackTiles(data, actor), data.okey, data.openedHands, data.groups[actor]);
        requireAction(tile, 503, 'invalid_private_state');
        discard(data, actor, tile.id, now);
      }
    }
  } else {
    requireAction(!data.setupPhase, 409, 'setup_locked');
    requireAction(data.turn === uid, 409, 'not_your_turn');
    requireAction(data.turnNumber === action.turnNumber, 409, 'stale_turn');
    requireAction(now < data.turnDeadline + TURN_TIMEOUT_GRACE_MS, 409, 'turn_expired');
    if (action.type === 'okey.draw') draw(data, uid, action.source, action.targetIndex);
    if (action.type === 'okey.cancel') cancelSide(data, uid);
    if (action.type === 'okey.discard') result = discard(data, uid, action.tileId, now);
    if (action.type === 'okey.open') result = open(data, uid, action.melds, action.mode === 'pairs', now);
    if (action.type === 'okey.tack') tack(data, uid, action);
  }
  return { state: data, result };
}

// All projections use allowlists: adding a new server-only field cannot
// accidentally make it readable. The closed deck is never projected.
const publicFields = [
  'schemaVersion', 'gameType', 'gameId', 'version', 'host', 'players', 'spectators', 'playerNames',
  'status', 'isPublic', 'rules', 'teams', 'isBotPlayer', 'scores', 'roundStartScores',
  'abandonedBy', 'abandonReason', 'createdAt', 'updatedAt', 'closedBy', 'seatRequests', 'countdownStartedAt',
  'roundId', 'turnNumber', 'playVersion', 'handVersions', 'indicator', 'okey', 'discardPiles', 'openedHands', 'hasOpened', 'openedWithPairs',
  'setupPhase', 'setupEndsAt', 'turn', 'starterUid', 'turnDeadline', 'botReadyAt', 'hasDrawnThisTurn',
  'sideTake', 'forcedPileDraw', 'roundEnded', 'roundResult', 'centerDiscard', 'openedBeforeCurrentTurn',
  'tackHint', 'foldBarrier', 'foldPairsBarrier', 'foldMultiplier',
];
export function publicOkeyState(state) {
  const projection = Object.fromEntries(publicFields.filter(key => Object.hasOwn(state, key)).map(key => [key, state[key]]));
  projection.rackCounts = Object.fromEntries(state.players.map(uid => [uid, (state.racks?.[uid] ?? []).filter(Boolean).length]));
  projection.drawPileCount = state.drawPile?.length ?? 0;
  projection.hasDealt = !!state.racks;
  return structuredClone(projection);
}
export function privateOkeyView(state, uid) {
  requireAction(state.players.includes(uid) && !bot(state, uid), 403, 'not_a_player');
  return structuredClone({ roundId: state.roundId, rack: state.racks[uid], groups: state.groups[uid] });
}
