import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialChessBoard } from './logic.js';
import { boardToFEN } from './fen.js';
import { INITIAL_FEN, moveToSAN, moveRows, gameToPGN } from './notation.js';
import { freshMatchState } from '../../utils/matchState.js';

const square = name => (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]);
function position(pieces) {
  const board = Array(64).fill(null);
  for (const [name, piece] of Object.entries(pieces)) board[square(name)] = { color: piece[0], type: piece[1], hasMoved: true };
  return board;
}
function move(before, source, target, { promotion, ep = null, mate = false } = {}) {
  const from = square(source), to = square(target);
  const after = before.map(p => p && { ...p });
  const piece = { ...after[from], hasMoved: true };
  if (piece.type === 'p' && to === ep) after[piece.color === 'w' ? to + 8 : to - 8] = null;
  if (promotion) piece.type = promotion;
  after[to] = piece; after[from] = null;
  if (piece.type === 'k' && Math.abs(from - to) === 2) {
    const rookFrom = to > from ? from + 3 : from - 4;
    after[to > from ? from + 1 : from - 1] = after[rookFrom]; after[rookFrom] = null;
  }
  return { after, san: moveToSAN(before, after, from, to, ep, null, mate) };
}

test('initial board matches standard FEN; SAN opening and captures', () => {
  let board = createInitialChessBoard();
  assert.equal(boardToFEN(board, 'w', null), INITIAL_FEN);
  for (const [from, to, expected] of [['e2', 'e4', 'e4'], ['d7', 'd5', 'd5'], ['e4', 'd5', 'exd5'], ['g8', 'f6', 'Nf6']]) {
    const played = move(board, from, to); assert.equal(played.san, expected); board = played.after;
  }
});
test('both castles, en passant and capture promotion', () => {
  const castle = position({ e1: 'wk', a1: 'wr', h1: 'wr', e8: 'bk' });
  assert.equal(move(castle, 'e1', 'g1').san, 'O-O');
  assert.equal(move(castle, 'e1', 'c1').san, 'O-O-O');
  assert.equal(move(position({ e1: 'wk', e8: 'bk', e5: 'wp', d5: 'bp' }), 'e5', 'd6', { ep: square('d6') }).san, 'exd6');
  assert.equal(move(position({ e1: 'wk', e8: 'bk', g7: 'wp', h8: 'br' }), 'g7', 'h8', { promotion: 'n' }).san, 'gxh8=N');
});
test('check and checkmate suffixes', () => {
  assert.equal(move(position({ a1: 'wk', e8: 'bk', d1: 'wr' }), 'd1', 'e1').san, 'Re1+');
  let board = createInitialChessBoard();
  for (const [from, to] of [['f2','f3'], ['e7','e5'], ['g2','g4']]) board = move(board, from, to).after;
  assert.equal(move(board, 'd8', 'h4', {mate: true}).san, 'Qh4#');
});
test('disambiguates pieces by file, rank or both', () => {
  assert.equal(move(position({ h1: 'wk', h8: 'bk', b1: 'wn', f1: 'wn' }), 'b1', 'd2').san, 'Nbd2');
  assert.equal(move(position({ h1: 'wk', h8: 'bk', a1: 'wr', a3: 'wr' }), 'a1', 'a2').san, 'R1a2');
  assert.equal(move(position({ h1: 'wk', h8: 'bk', b1: 'wn', b3: 'wn', f1: 'wn' }), 'b1', 'd2').san, 'Nb1d2');
});
test('a pinned piece does not cause false disambiguation', () => {
  assert.equal(move(position({ e1: 'wk', a8: 'bk', e8: 'br', e2: 'wn', a2: 'wn' }), 'a2', 'c3').san, 'Nc3');
});
test('full PGN uses standard headers, SAN and result', () => {
  const pgn = gameToPGN({moves:['f3','e5','g4','Qh4#'], startFen:INITIAL_FEN, white:'A', black:'B', result:'0-1'});
  assert.ok(pgn.includes('[Result "0-1"]'));
  assert.ok(pgn.endsWith('1. f3 e5 2. g4 Qh4# 0-1'));
  assert.ok(!pgn.includes('[FEN'));
});
test('partial existing games export their starting position and black move number', () => {
  const startFen = '4k3/8/8/8/8/8/8/4K3 b - - 0 12';
  assert.deepEqual(moveRows(['Kd7','Kd2','Ke6'],startFen), [{number:12,white:'',black:'Kd7'}, {number:13,white:'Kd2',black:'Ke6'}]);
  const pgn = gameToPGN({moves:['Kd7'],startFen,white:'A',black:'B'});
  assert.ok(pgn.includes('[SetUp "1"]'));
  assert.ok(pgn.includes(`[FEN "${startFen}"]`));
  assert.ok(pgn.endsWith('12... Kd7 *'));
});
test('PGN escapes user names and new games have empty notation', () => {
  assert.ok(gameToPGN({moves:[],white:'A"\\\nB',black:'B'}).includes('[White "A\\"\\\\ B"]'));
  const state = freshMatchState('satranc',['a','b']);
  assert.deepEqual(state.chessMoves, []);
  assert.equal(state.notationStartFen, null);
});
