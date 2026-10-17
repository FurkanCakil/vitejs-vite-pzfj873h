const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export function getCastlingRights(board) {
  let rights = '';
  for (const [color, king, left, right, queenSide, kingSide] of [
    ['w', 60, 56, 63, 'Q', 'K'], ['b', 4, 0, 7, 'q', 'k'],
  ]) {
    if (board[king]?.type !== 'k' || board[king].color !== color || board[king].hasMoved) continue;
    if (board[right]?.type === 'r' && board[right].color === color && !board[right].hasMoved) rights += kingSide;
    if (board[left]?.type === 'r' && board[left].color === color && !board[left].hasMoved) rights += queenSide;
  }
  return rights || '-';
}

// Board dizimiz zaten FEN sırasıyla aynı (index 0..7 = 8. sıra, 56..63 = 1. sıra),
// bu yüzden satır satır sıkıştırıp '/' ile birleştirmek yeterli.
export function boardToFEN(board, turnColor, enPassantTarget, halfmoveClock = 0, fullmoveNumber = 1) {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = ''; let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = board[r * 8 + c];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p.color === 'w' ? p.type.toUpperCase() : p.type;
    }
    if (empty) row += empty;
    rows.push(row);
  }

  const castling = getCastlingRights(board);

  let ep = '-';
  if (enPassantTarget !== null && enPassantTarget !== undefined) {
    const r = Math.floor(enPassantTarget / 8); const c = enPassantTarget % 8;
    ep = FILES[c] + (8 - r);
  }

  return `${rows.join('/')} ${turnColor} ${castling} ${ep} ${halfmoveClock} ${fullmoveNumber}`;
}

// "e2e4" / "e7e8q" gibi bir UCI hamlesini tahta index'lerine çevirir.
export function uciMoveToIndices(uciMove) {
  if (typeof uciMove !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uciMove)) return null;
  const fromCol = FILES.indexOf(uciMove[0]); const fromRow = 8 - parseInt(uciMove[1], 10);
  const toCol = FILES.indexOf(uciMove[2]); const toRow = 8 - parseInt(uciMove[3], 10);
  if (fromCol < 0 || toCol < 0) return null;
  return { from: fromRow * 8 + fromCol, to: toRow * 8 + toCol, promotion: uciMove[4] || null };
}
