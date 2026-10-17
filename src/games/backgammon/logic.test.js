import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialBoard, getBaseValidMoves, getStrictValidMoves, applyMove } from './logic.js';

// Independent exhaustive enumerator checks the optimized early-exit search.
function fullPaths(board, color, dice, bar, borne) {
  const moves = getBaseValidMoves(board, color, dice, bar[color], borne[color]);
  if (!moves.length) return [[]];
  return moves.flatMap(move => {
    const next = applyMove(board, bar, borne, color, move.from, move.to);
    const rest = [...dice]; rest.splice(rest.indexOf(move.die), 1);
    return fullPaths(next.board, color, rest, next.bar, next.borneOff).map(path => [move, ...path]);
  });
}

test('optimized tavla search preserves maximal dice use and larger-die rule', () => {
  const positions = [
    { board: createInitialBoard(), bar: { white: 0, black: 0 }, borne: { white: 0, black: 0 } },
    { board: Array.from({ length: 24 }, (_, i) => i === 23 ? { count: 2, color: 'white' } : i === 0 ? { count: 2, color: 'black' } : { count: 0, color: null }), bar: { white: 0, black: 0 }, borne: { white: 13, black: 13 } },
  ];
  for (const { board, bar, borne } of positions) for (const color of ['white', 'black']) for (const dice of [[1, 2], [2, 6], [3, 3, 3, 3], [6, 6, 6, 6]]) {
    const paths = fullPaths(board, color, dice, bar, borne);
    const length = Math.max(...paths.map(path => path.length));
    let firsts = paths.filter(path => path.length === length && length).map(path => path[0]);
    if (length === 1 && new Set(dice).size > 1) {
      const max = Math.max(...firsts.map(move => move.die));
      firsts = firsts.filter(move => move.die === max);
    }
    const keys = moves => [...new Set(moves.map(move => JSON.stringify(move)))].sort();
    assert.deepEqual(keys(getStrictValidMoves(board, color, dice, bar, borne)), keys(firsts));
  }
});
