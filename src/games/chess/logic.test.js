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

test('castling, en passant, checks and underpromotions match standard perft positions', () => {
  // Standard positions used by Stockfish's tests/perft.sh; lower-depth totals:
  // https://www.chessprogramming.org/Perft_Results
  function parse(fen) {
    const [placement, color, rights] = fen.split(' '), board = [];
    for (const char of placement.replaceAll('/', '')) {
      if (/\d/.test(char)) board.push(...Array(Number(char)).fill(null));
      else board.push({ type: char.toLowerCase(), color: char === char.toUpperCase() ? 'w' : 'b', hasMoved: true });
    }
    for (const [right, king, rook] of [['K', 60, 63], ['Q', 60, 56], ['k', 4, 7], ['q', 4, 0]]) {
      if (rights.includes(right)) { board[king].hasMoved = false; board[rook].hasMoved = false; }
    }
    return { board, color };
  }
  function count(board, color, ep, depth) {
    if (!depth) return 1;
    let nodes = 0;
    board.forEach((piece, from) => {
      if (piece?.color !== color) return;
      for (const to of getStrictLegalMoves(board, from, ep)) {
        const choices = piece.type === 'p' && (to < 8 || to >= 56) ? ['q', 'r', 'b', 'n'] : [piece.type];
        for (const type of choices) {
          const next = [...board]; next[from] = null; next[to] = { ...piece, type, hasMoved: true };
          if (piece.type === 'p' && to === ep) next[to + (color === 'w' ? 8 : -8)] = null;
          if (piece.type === 'k' && Math.abs(to - from) === 2) {
            const rookFrom = to > from ? from + 3 : from - 4, rookTo = to > from ? from + 1 : from - 1;
            next[rookTo] = { ...next[rookFrom], hasMoved: true }; next[rookFrom] = null;
          }
          nodes += count(next, color === 'w' ? 'b' : 'w', piece.type === 'p' && Math.abs(to - from) === 16 ? (from + to) / 2 : null, depth - 1);
        }
      }
    });
    return nodes;
  }
  for (const [fen, expected] of [
    ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -', [48, 2039, 97862]],
    ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -', [14, 191, 2812]],
    ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -', [6, 264, 9467]],
    ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -', [44, 1486, 62379]],
    ['r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - -', [46, 2079, 89890]],
  ]) {
    const { board, color } = parse(fen);
    expected.forEach((total, depth) => assert.equal(count(board, color, null, depth + 1), total, `${fen}: depth ${depth + 1}`));
  }
});
