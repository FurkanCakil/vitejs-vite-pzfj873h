import test from 'node:test';
import assert from 'node:assert/strict';
import { getGameState, createInitialChessBoard, getBoardStateString, getStrictLegalMoves } from './logic.js';
import { uciMoveToIndices } from './fen.js';

test('checkmate takes precedence over the fifty-move counter', () => {
  const board = Array(64).fill(null);
  board[0] = { type: 'k', color: 'b', hasMoved: true };
  board[9] = { type: 'q', color: 'w', hasMoved: true };
  board[18] = { type: 'k', color: 'w', hasMoved: true };
  assert.equal(getGameState(board, 'b', 100), 'mate');
  assert.equal(getGameState(createInitialChessBoard(), 'w', 100), 'draw_50move');
});

test('invalid UCI engine output never creates invalid board coordinates', () => {
  for (const value of ['0000', '(none)', 'e9e4', 'e0e4', 'e2e4k', 'e2e4extra', {}, null]) {
    assert.equal(uciMoveToIndices(value), null);
  }
  assert.deepEqual(uciMoveToIndices('e7e8q'), { from: 12, to: 4, promotion: 'q' });
});

test('repetition ignores unavailable en passant and irrelevant rook movement', () => {
  const board = createInitialChessBoard();
  board[28] = { ...board[12], hasMoved: true }; board[12] = null;
  assert.equal(getBoardStateString(board, 20, 'w'), getBoardStateString(board, null, 'w'));
  board[60].hasMoved = true;
  const before = getBoardStateString(board, null, 'w');
  board[63].hasMoved = true;
  assert.equal(getBoardStateString(board, null, 'w'), before);
  board[60].hasMoved = false;
  assert.notEqual(getBoardStateString(board, null, 'w'), before);
});

test('repetition still recognizes saved histories from the previous version', () => {
  const board = createInitialChessBoard();
  const legacy = board.map(p => p ? p.color + p.type + (['k', 'r'].includes(p.type) ? '0' : '') : '.').join('') + '_ep:-_t:w';
  assert.equal(getGameState(board, 'w', 8, [legacy, legacy, getBoardStateString(board, null, 'w')]), 'draw_repetition');
});

test('legal opening move counts match chess perft reference through three plies', () => {
  function count(board, color, ep, depth) {
    if (!depth) return 1;
    let total = 0;
    board.forEach((piece, from) => {
      if (piece?.color !== color) return;
      for (const to of getStrictLegalMoves(board, from, ep)) {
        const next = [...board]; next[from] = null; next[to] = { ...piece, hasMoved: true };
        const nextEp = piece.type === 'p' && Math.abs(to - from) === 16 ? (to + from) / 2 : null;
        total += count(next, color === 'w' ? 'b' : 'w', nextEp, depth - 1);
      }
    });
    return total;
  }
  const board = createInitialChessBoard();
  assert.equal(count(board, 'w', null, 1), 20);
  assert.equal(count(board, 'w', null, 2), 400);
  assert.equal(count(board, 'w', null, 3), 8902);
});
