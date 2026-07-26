const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

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

  const wKing = board[60]; const bKing = board[4];
  const wRookK = board[63]; const wRookQ = board[56];
  const bRookK = board[7]; const bRookQ = board[0];
  let castling = '';
  if (wKing?.type === 'k' && !wKing.hasMoved) {
    if (wRookK?.type === 'r' && !wRookK.hasMoved) castling += 'K';
    if (wRookQ?.type === 'r' && !wRookQ.hasMoved) castling += 'Q';
  }
  if (bKing?.type === 'k' && !bKing.hasMoved) {
    if (bRookK?.type === 'r' && !bRookK.hasMoved) castling += 'k';
    if (bRookQ?.type === 'r' && !bRookQ.hasMoved) castling += 'q';
  }
  if (!castling) castling = '-';

  let ep = '-';
  if (enPassantTarget !== null && enPassantTarget !== undefined) {
    const r = Math.floor(enPassantTarget / 8); const c = enPassantTarget % 8;
    ep = FILES[c] + (8 - r);
  }

  return `${rows.join('/')} ${turnColor} ${castling} ${ep} ${halfmoveClock} ${fullmoveNumber}`;
}

// "e2e4" / "e7e8q" gibi bir UCI hamlesini tahta index'lerine çevirir.
export function uciMoveToIndices(uciMove) {
  if (!uciMove || uciMove.length < 4) return null;
  const fromCol = FILES.indexOf(uciMove[0]); const fromRow = 8 - parseInt(uciMove[1], 10);
  const toCol = FILES.indexOf(uciMove[2]); const toRow = 8 - parseInt(uciMove[3], 10);
  if (fromCol < 0 || toCol < 0) return null;
  return { from: fromRow * 8 + fromCol, to: toRow * 8 + toCol, promotion: uciMove[4] || null };
}
