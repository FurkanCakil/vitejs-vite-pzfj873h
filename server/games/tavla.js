import { requireAction } from '../errors.js';
import { createInitialBoard, getStrictValidMoves, applyMove } from '../../src/games/backgammon/logic.js';
import { remainingTavlaDice, tavlaWinPoints, tavlaTurnSnapshot, tavlaNextPhase } from '../../src/games/backgammon/state.js';

export function freshTavla(players, scores, whiteUid) {
  return { board: createInitialBoard(), bar: { white: 0, black: 0 }, borneOff: { white: 0, black: 0 },
    playerColors: Object.fromEntries(players.map(uid => [uid, uid === whiteUid ? 'white' : 'black'])),
    dice: [], usedDice: [], phase: 'opening', openingRolls: { p1: null, p2: null },
    turn: null, startingPlayer: null, winner: null, rematchRequestedBy: null,
    cubeValue: 1, cubeOwner: null, cubeOfferBy: null, initialTurnState: null,
    scores: Object.fromEntries(players.map(uid => [uid, scores?.[uid] ?? 0])) };
}

function requirePosition(state) {
  const integer = value => Number.isInteger(value) && value >= 0 && value <= 15;
  requireAction(Array.isArray(state.board) && state.board.length === 24 && state.board.every(point =>
    point && Object.keys(point).length === 2 && integer(point.count)
      && (point.count === 0 ? point.color === null : ['white', 'black'].includes(point.color))), 409, 'invalid_board');
  requireAction(['white', 'black'].every(color => integer(state.bar?.[color]) && integer(state.borneOff?.[color])
    && state.board.reduce((total, point) => total + (point.color === color ? point.count : 0), 0)
      + state.bar[color] + state.borneOff[color] === 15), 409, 'invalid_board');
}

function requirePlayers(room, uid) {
  requireAction(room?.schemaVersion === 2 && room.gameType === 'tavla', 409, 'unsupported_room');
  requireAction(Array.isArray(room.players) && room.players.length === 2 && room.players[0] !== room.players[1], 409, 'invalid_room');
  requireAction(room.players.includes(uid), 403, 'not_a_player');
  requireAction(room.status === 'playing' && !room.winner, 409, 'game_not_playing');
  const color = room.playerColors?.[uid], opponent = room.players.find(id => id !== uid);
  requireAction(['white', 'black'].includes(color) && room.playerColors?.[opponent] === (color === 'white' ? 'black' : 'white'), 409, 'invalid_room');
  requireAction(room.players.every(id => Number.isSafeInteger(room.scores?.[id]) && room.scores[id] >= 0), 409, 'invalid_scores');
  requireAction(Number.isSafeInteger(room.cubeValue) && room.cubeValue >= 1 && 2 ** Math.floor(Math.log2(room.cubeValue)) === room.cubeValue
    && (room.cubeOwner === null || room.players.includes(room.cubeOwner))
    && (room.cubeOfferBy === null || room.players.includes(room.cubeOfferBy)), 409, 'invalid_cube');
  requirePosition(room);
  return { color, opponent };
}

function requireTurn(room, uid, phase) {
  requireAction(!room.cubeOfferBy, 409, 'offer_pending');
  requireAction(room.turn === uid, 409, 'not_your_turn');
  requireAction(room.phase === phase, 409, 'invalid_phase');
}

function award(room, uid, points) {
  const score = room.scores[uid] + points;
  requireAction(Number.isSafeInteger(points) && points > 0 && Number.isSafeInteger(score), 409, 'score_limit');
  return { winner: uid, turn: null, phase: 'rolling', cubeOfferBy: null, initialTurnState: null,
    scores: { ...room.scores, [uid]: score } };
}

export function rollTavla(room, uid, rolls) {
  const { color } = requirePlayers(room, uid);
  requireAction(Array.isArray(rolls) && rolls.length === 2 && rolls.every(die => Number.isInteger(die) && die >= 1 && die <= 6), 500, 'invalid_server_dice');
  requireAction(!room.cubeOfferBy, 409, 'offer_pending');
  if (room.phase === 'opening') {
    const key = color === 'white' ? 'p1' : 'p2', openingRolls = { ...room.openingRolls };
    requireAction(['p1', 'p2'].every(k => openingRolls[k] === null || (Number.isInteger(openingRolls[k]) && openingRolls[k] >= 1 && openingRolls[k] <= 6)), 409, 'invalid_dice');
    requireAction(openingRolls[key] === null, 409, 'already_rolled');
    openingRolls[key] = rolls[0];
    if (!openingRolls.p1 || !openingRolls.p2 || openingRolls.p1 === openingRolls.p2) return { openingRolls };
    const starterColor = openingRolls.p1 > openingRolls.p2 ? 'white' : 'black';
    const starter = room.players.find(id => room.playerColors[id] === starterColor);
    const dice = [openingRolls.p1, openingRolls.p2].sort((a, b) => b - a);
    return { openingRolls, dice, initialTurnState: tavlaTurnSnapshot(room), startingPlayer: starter,
      ...tavlaNextPhase(room, starterColor, dice, [], starter) };
  }
  requireTurn(room, uid, 'rolling');
  const dice = rolls[0] === rolls[1] ? Array(4).fill(rolls[0]) : [...rolls];
  return { dice, initialTurnState: tavlaTurnSnapshot(room), ...tavlaNextPhase(room, color, dice, [], uid) };
}

export function resetTavlaOpening(room, uid) {
  requirePlayers(room, uid);
  requireAction(room.phase === 'opening' && room.openingRolls?.p1 >= 1 && room.openingRolls.p1 === room.openingRolls.p2, 409, 'invalid_phase');
  return { openingRolls: { p1: null, p2: null } };
}

function remainingDice(room) {
  const die = value => Number.isInteger(value) && value >= 1 && value <= 6;
  requireAction(Array.isArray(room.dice) && [2, 4].includes(room.dice.length) && room.dice.every(die)
    && (room.dice.length === 2 ? room.dice[0] !== room.dice[1] : room.dice.every(value => value === room.dice[0]))
    && Array.isArray(room.usedDice) && room.usedDice.length <= room.dice.length && room.usedDice.every(die), 409, 'invalid_dice');
  const remaining = remainingTavlaDice(room.dice, room.usedDice);
  requireAction(remaining.length === room.dice.length - room.usedDice.length, 409, 'invalid_dice');
  return remaining;
}

export function moveTavla(room, uid, from, to, die) {
  const { color } = requirePlayers(room, uid); requireTurn(room, uid, 'moving');
  const remaining = remainingDice(room);
  requireAction(Number.isInteger(from) && from >= -1 && from <= 23 && Number.isInteger(to) && to >= -1 && to <= 24
    && Number.isInteger(die) && die >= 1 && die <= 6, 400, 'invalid_cell');
  requireAction(getStrictValidMoves(room.board, color, remaining, room.bar, room.borneOff)
    .some(move => move.from === from && move.to === to && move.die === die), 409, 'illegal_move');
  const next = applyMove(room.board, room.bar, room.borneOff, color, from, to), usedDice = [...room.usedDice, die];
  if (next.borneOff[color] === 15) return { ...next, usedDice,
    ...award(room, uid, tavlaWinPoints(next.board, next.bar, next.borneOff, color, room.cubeValue)) };
  return { ...next, ...tavlaNextPhase({ ...room, ...next }, color, room.dice, usedDice, uid) };
}

export function undoTavla(room, uid) {
  requirePlayers(room, uid); requireTurn(room, uid, 'moving'); remainingDice(room);
  requireAction(room.usedDice.length > 0 && room.initialTurnState, 409, 'invalid_undo');
  requirePosition(room.initialTurnState);
  // Only the snapshot generated by this turn's server roll can be restored.
  return { ...tavlaTurnSnapshot(room.initialTurnState), usedDice: [] };
}

export function cubeTavla(room, uid, decision) {
  const { opponent } = requirePlayers(room, uid);
  requireAction(['request', 'accept', 'reject'].includes(decision), 400, 'invalid_offer');
  if (decision === 'request') {
    requireTurn(room, uid, 'rolling');
    requireAction(room.cubeOwner === null || room.cubeOwner === uid, 409, 'cube_not_owned');
    requireAction(Number.isSafeInteger(room.cubeValue * 6)
      && room.players.every(id => Number.isSafeInteger(room.scores[id] + room.cubeValue * 6)), 409, 'score_limit');
    return { cubeOfferBy: uid };
  }
  requireAction(room.phase === 'rolling' && room.cubeOfferBy === opponent && room.turn === opponent, 409, 'invalid_offer');
  if (decision === 'reject') return award(room, opponent, room.cubeValue);
  requireAction(Number.isSafeInteger(room.cubeValue * 2), 409, 'score_limit');
  return { cubeValue: room.cubeValue * 2, cubeOwner: uid, cubeOfferBy: null };
}
