import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChessMove, freshChess, resignChess } from './games/chess.js';
import { getStrictLegalMoves, getBoardStateString, isSquareAttacked } from '../src/games/chess/logic.js';
import { gameToPGN } from '../src/games/chess/notation.js';

const sq = name => (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]);
const fail = (fn, code) => assert.throws(fn, error => error.code === code && [400, 403, 409].includes(error.status));
const state = (pieces, patch = {}) => {
  const data = { schemaVersion: 2, gameType: 'satranc', status: 'playing', players: ['alice', 'bob'], ...freshChess(['alice', 'bob'], undefined, 'alice'), ...patch };
  if (pieces) {
    data.board = Array(64).fill(null);
    for (const [name, piece] of Object.entries(pieces)) data.board[sq(name)] = { color: piece[0], type: piece[1], hasMoved: true };
    data.positionHistory = [getBoardStateString(data.board, data.enPassantTarget, data.playerColors[data.turn])];
  }
  return data;
};
const play = (room, from, to, promotion) => ({ ...room, ...applyChessMove(room, room.turn, sq(from), sq(to), promotion) });

test('Chess creates a complete initial state with white to move and scores retained', () => {
  const fresh = freshChess(['alice', 'bob'], { alice: 3, bob: 2 }, 'bob');
  assert.equal(fresh.turn, 'bob'); assert.equal(fresh.playerColors.bob, 'w');
  assert.equal(fresh.board.filter(Boolean).length, 32); assert.deepEqual(fresh.scores, { alice: 3, bob: 2 });
  assert.deepEqual(fresh.chessMoves, []); assert.equal(fresh.previousState, null);
});

test('Chess move is immutable, records SAN and stores only one previous state', () => {
  const room = state(), before = structuredClone(room), next = play(room, 'e2', 'e4');
  assert.deepEqual(room, before); assert.equal(next.turn, 'bob'); assert.equal(next.enPassantTarget, sq('e3'));
  assert.deepEqual(next.chessMoves, ['e4']); assert.equal(next.previousState.board[sq('e2')].type, 'p');
  assert.equal(next.board[sq('e4')].hasMoved, true); assert.equal(next.board[sq('e2')], null);
  const second = play(next, 'e7', 'e5'); assert.equal(Object.hasOwn(second.previousState, 'previousState'), false);
});

test('Chess denies spectators, wrong turns, other games, finished rooms and illegal coordinates', () => {
  fail(() => applyChessMove(state(), 'viewer', 52, 36), 'not_a_player');
  fail(() => applyChessMove(state(), 'bob', 12, 28), 'not_your_turn');
  fail(() => applyChessMove(state(), 'alice', 12, 28), 'piece_not_owned');
  fail(() => applyChessMove(state(), 'alice', 52, 28), 'illegal_move');
  for (const value of [-1, 64, 1.5, '52', null]) fail(() => applyChessMove(state(), 'alice', value, 36), 'invalid_cell');
  for (const status of ['waiting', 'abandoned', 'closed']) fail(() => applyChessMove(state(null, { status }), 'alice', 52, 36), 'game_not_playing');
  fail(() => applyChessMove(state(null, { winner: 'bob' }), 'alice', 52, 36), 'game_not_playing');
  fail(() => applyChessMove(state(null, { gameType: 'dama' }), 'alice', 52, 36), 'unsupported_room');
});

test('Chess rejects corrupt kings, pawns, scores, histories and en passant state', () => {
  for (const pieces of [{ e1: 'wk', e2: 'bk' }, { e1: 'wk', a1: 'wp', e8: 'bk' }, { e1: 'wk', e8: 'bk', d8: 'wk' }]) {
    fail(() => applyChessMove(state(pieces), 'alice', sq('e1'), sq('d1')), 'invalid_board');
  }
  const corrupt = state(); corrupt.board[0].hasMoved = 'no';
  fail(() => applyChessMove(corrupt, 'alice', 52, 36), 'invalid_board');
  fail(() => applyChessMove(state(null, { enPassantTarget: 19 }), 'alice', 52, 36), 'invalid_board');
  for (const score of [-1, NaN, Number.MAX_SAFE_INTEGER]) fail(() => applyChessMove(state(null, { scores: { alice: score, bob: 0 } }), 'alice', 52, 36), 'invalid_scores');
  fail(() => applyChessMove(state(null, { halfmoveClock: 100 }), 'alice', 52, 36), 'invalid_history');
});

test('Chess checkmate scores exactly once and exports a complete standard PGN', () => {
  let room = state();
  for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) room = play(room, from, to);
  assert.equal(room.winner, 'bob'); assert.equal(room.turn, null); assert.deepEqual(room.scores, { alice: 0, bob: 1 });
  assert.deepEqual(room.chessMoves, ['f3', 'e5', 'g4', 'Qh4#']);
  assert.ok(gameToPGN({ moves: room.chessMoves, startFen: room.notationStartFen, white: 'A', black: 'B', result: '0-1' }).endsWith('1. f3 e5 2. g4 Qh4# 0-1'));
  fail(() => applyChessMove(room, 'bob', 39, 52), 'game_not_playing');
});

test('Chess en passant captures the actual last double-step pawn and expires after one reply', () => {
  let room = state();
  for (const [from, to] of [['e2', 'e4'], ['a7', 'a6'], ['e4', 'e5'], ['d7', 'd5']]) room = play(room, from, to);
  const next = play(room, 'e5', 'd6');
  assert.equal(next.board[sq('d5')], null); assert.equal(next.board[sq('d6')].color, 'w');
  assert.deepEqual(next.captured.w, ['p']); assert.equal(next.chessMoves.at(-1), 'exd6'); assert.equal(next.enPassantTarget, null);
  room = play(room, 'g1', 'f3'); room = play(room, 'a6', 'a5');
  fail(() => play(room, 'e5', 'd6'), 'illegal_move');
});

test('Chess refuses phantom en passant, wrong-colored adjacent pawns and captures that uncover check', () => {
  const noPawn = state({ e1: 'wk', e8: 'bk', e5: 'wp' }).board;
  assert.equal(getStrictLegalMoves(noPawn, sq('e5'), sq('d6')).includes(sq('d6')), false);
  noPawn[sq('d5')] = { type: 'p', color: 'w', hasMoved: true };
  assert.equal(getStrictLegalMoves(noPawn, sq('e5'), sq('d6')).includes(sq('d6')), false);
  const pinned = state({ h5: 'wk', a8: 'bk', g5: 'wp', f5: 'bp', a5: 'br' }, { enPassantTarget: sq('f6') });
  fail(() => play(pinned, 'g5', 'f6'), 'illegal_move');
});

test('Chess castling moves the rook too; lost rights and attacked transit squares prevent it', () => {
  for (const [uid, color, king, rook, target, rookTarget, san] of [
    ['alice', 'w', 'e1', 'h1', 'g1', 'f1', 'O-O'], ['alice', 'w', 'e1', 'a1', 'c1', 'd1', 'O-O-O'],
    ['bob', 'b', 'e8', 'h8', 'g8', 'f8', 'O-O'], ['bob', 'b', 'e8', 'a8', 'c8', 'd8', 'O-O-O'],
  ]) {
    const room = state(color === 'w' ? { e1: 'wk', e8: 'bk', [rook]: 'wr' } : { e1: 'wk', e8: 'bk', [rook]: 'br' }, { turn: uid });
    room.board[sq(king)].hasMoved = false; room.board[sq(rook)].hasMoved = false;
    const next = play(room, king, target);
    assert.equal(next.board[sq(rook)], null); assert.equal(next.board[sq(rookTarget)].type, 'r'); assert.equal(next.board[sq(rookTarget)].hasMoved, true);
    assert.equal(next.chessMoves.at(-1), san);
    room.board[sq(rook)].hasMoved = true; fail(() => play(room, king, target), 'illegal_move');
  }
  const attacked = state({ e1: 'wk', h1: 'wr', a8: 'bk', f8: 'br' });
  attacked.board[60].hasMoved = false; attacked.board[63].hasMoved = false;
  fail(() => play(attacked, 'e1', 'g1'), 'illegal_move');
});

test('Chess promotion requires a legal chosen piece and capture promotion keeps SAN and captures', () => {
  for (const promotion of ['q', 'r', 'b', 'n']) {
    const room = state({ a1: 'wk', e8: 'bk', g7: 'wp', h8: 'br' }), before = structuredClone(room);
    const next = play(room, 'g7', 'h8', promotion);
    assert.equal(next.board[7].type, promotion); assert.deepEqual(next.captured.w, ['r']); assert.equal(next.halfmoveClock, 0);
    assert.ok(next.chessMoves.at(-1).startsWith(`gxh8=${promotion.toUpperCase()}`)); assert.deepEqual(room, before);
  }
  for (const promotion of [null, 'k', 'p', {}, 'Q']) fail(() => play(state({ a1: 'wk', e8: 'bk', g7: 'wp' }), 'g7', 'g8', promotion), 'invalid_promotion');
  fail(() => play(state(), 'e2', 'e4', 'q'), 'invalid_promotion');
});

test('Chess legal move lists never capture a king but attack maps still detect check', () => {
  const board = state({ e1: 'wk', e8: 'bk', e7: 'wq' }).board;
  assert.equal(getStrictLegalMoves(board, sq('e7')).includes(sq('e8')), false);
  assert.equal(isSquareAttacked(board, sq('e8'), 'w'), true);
});

test('Chess keeps existing automatic repetition and fifty-move draws without adding score', () => {
  let room = state();
  for (let i = 0; i < 2; i++) for (const [from, to] of [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']]) room = play(room, from, to);
  assert.equal(room.winner, 'Draw'); assert.equal(room.drawReason, 'repetition'); assert.deepEqual(room.scores, { alice: 0, bob: 0 });
  const fifty = play(state({ a1: 'wk', h8: 'bk', b1: 'wr' }, { halfmoveClock: 99 }), 'b1', 'b2');
  assert.equal(fifty.winner, 'Draw'); assert.equal(fifty.drawReason, '50move');
});

test('Chess stalemate and insufficient material are draws; resignation gives the opponent one point', () => {
  const stale = play(state({ c6: 'wk', a8: 'bk', c7: 'wq' }), 'c7', 'b6');
  assert.equal(stale.winner, 'Draw'); assert.equal(stale.drawReason, 'stalemate');
  const material = play(state({ a1: 'wk', h8: 'bk', c1: 'wb', d2: 'br' }), 'c1', 'd2');
  assert.equal(material.winner, 'Draw'); assert.equal(material.drawReason, 'material');
  const room = state(), result = resignChess(room, 'alice'); assert.equal(result.winner, 'bob'); assert.equal(result.scores.bob, 1);
  fail(() => resignChess({ ...room, ...result }, 'alice'), 'game_not_playing');
  fail(() => resignChess(room, 'viewer'), 'not_a_player');
});
