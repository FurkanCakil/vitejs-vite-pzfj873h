import { getStrictLegalMoves, isSquareAttacked } from './logic.js';

export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const file = index => 'abcdefgh'[index % 8];
const rank = index => String(8 - Math.floor(index / 8));

export function moveToSAN(before, after, from, to, enPassantTarget, nextEnPassantTarget, mate = false) {
  const piece = before[from];
  const capture = !!before[to] || (piece.type === 'p' && to === enPassantTarget);
  let san;
  if (piece.type === 'k' && Math.abs(from - to) === 2) {
    san = to > from ? 'O-O' : 'O-O-O';
  } else {
    let disambiguation = '';
    if (piece.type !== 'p') {
      const alternatives = before.flatMap((other, index) =>
        index !== from && other?.color === piece.color && other.type === piece.type &&
        getStrictLegalMoves(before, index, enPassantTarget).includes(to) ? [index] : [],
      );
      if (alternatives.length) {
        disambiguation = alternatives.every(index => file(index) !== file(from)) ? file(from)
          : alternatives.every(index => rank(index) !== rank(from)) ? rank(from) : file(from) + rank(from);
      }
    }
    san = (piece.type === 'p' ? (capture ? file(from) : '') : piece.type.toUpperCase() + disambiguation)
      + (capture ? 'x' : '') + file(to) + rank(to);
    if (piece.type === 'p' && after[to].type !== 'p') san += '=' + after[to].type.toUpperCase();
  }
  const opponent = piece.color === 'w' ? 'b' : 'w';
  const king = after.findIndex(p => p?.type === 'k' && p.color === opponent);
  if (mate) return san + '#';
  return san + (king !== -1 && isSquareAttacked(after, king, piece.color, nextEnPassantTarget) ? '+' : '');
}

export function moveRows(moves, startFen = INITIAL_FEN) {
  const parts = (startFen || INITIAL_FEN).split(' ');
  let number = Number(parts[5]) || 1;
  let color = parts[1] || 'w';
  const rows = [];
  for (const san of moves) {
    if (color === 'w' || !rows.length) rows.push({ number, white: '', black: '' });
    rows[rows.length - 1][color === 'w' ? 'white' : 'black'] = san;
    if (color === 'b') number++;
    color = color === 'w' ? 'b' : 'w';
  }
  return rows;
}

const escapeTag = value => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\t]/g, ' ');

export function gameToPGN({ moves, startFen, white, black, result = '*' }) {
  const tags = { Event: 'Oyun Portali', Site: 'Oyun Portali', Date: '????.??.??', Round: '-', White: white, Black: black, Result: result };
  if (startFen && startFen !== INITIAL_FEN) Object.assign(tags, { SetUp: '1', FEN: startFen });
  const lines = Object.entries(tags).map(([key, value]) => `[${key} "${escapeTag(value)}"]`);
  const text = moveRows(moves, startFen).map(row => row.white
    ? `${row.number}. ${row.white}${row.black ? ' ' + row.black : ''}` : `${row.number}... ${row.black}`);
  return lines.join('\n') + '\n\n' + [...text, result].join(' ');
}
