import { getCastlingRights } from './fen.js';

export function createInitialChessBoard() {
  const board = Array(64).fill(null);
  const order = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let i = 0; i < 8; i++) {
    board[i] = { type: order[i], color: 'b', hasMoved: false }; board[i + 8] = { type: 'p', color: 'b', hasMoved: false };
    board[48 + i] = { type: 'p', color: 'w', hasMoved: false }; board[56 + i] = { type: order[i], color: 'w', hasMoved: false };
  }
  return board;
}

// `includeOwnPieceSquares`: SADECE ön-hamle (premove) hedefi üretirken true
// geçilir. Sıra bizde değilken, rakip henüz hamlesini yapmadığı için o anki
// tahtada hâlâ KENDİ taşımızın durduğu bir kareyi (örn. bir taş değiş
// tokuşunda rakibin az sonra alacağı taşımızın yerini) de hedef olarak
// seçebilmemiz gerekir — "yerini alacağım" ön-hamlesi. Gerçek hamle anında
// (getStrictLegalMoves, bu parametreyi hiç kullanmaz) böyle bir hedef zaten
// yasa dışı sayılıp elenir; bu bayrak yalnızca ÖN-HAMLE seçimini genişletir,
// gerçek kural ihlaline asla izin vermez.
export function getPseudoLegalMoves(board, index, checkCastling = true, enPassantTarget = null, attacksOnly = false, includeOwnPieceSquares = false) {
  const piece = board[index]; if (!piece) return [];
  const moves = []; const r = Math.floor(index / 8); const c = index % 8;

  const add = (nr, nc) => {
    if (nr < 0 || nr > 7 || nc < 0 || nc > 7) return false;
    const targetIdx = nr * 8 + nc; const target = board[targetIdx];
    if (!target) { moves.push(targetIdx); return true; }
    if (target.color !== piece.color || attacksOnly || includeOwnPieceSquares) moves.push(targetIdx);
    return false;
  };

  if (piece.type === 'p') {
    const dir = piece.color === 'w' ? -1 : 1; const startRow = piece.color === 'w' ? 6 : 1;
    if (!attacksOnly) {
      if (r + dir >= 0 && r + dir <= 7 && !board[(r + dir) * 8 + c]) {
        moves.push((r + dir) * 8 + c);
        if (r === startRow && !board[(r + 2 * dir) * 8 + c]) moves.push((r + 2 * dir) * 8 + c);
      }
    }
    if (r + dir >= 0 && r + dir <= 7) {
      const checkCapture = (nc) => {
        if (nc >= 0 && nc <= 7) {
          const targetIdx = (r + dir) * 8 + nc;
          if (attacksOnly) { moves.push(targetIdx); }
          else {
            if (board[targetIdx]?.color && (board[targetIdx].color !== piece.color || includeOwnPieceSquares)) moves.push(targetIdx);
            else if (!board[targetIdx] && targetIdx === enPassantTarget && r === (piece.color === 'w' ? 3 : 4)
              && board[r * 8 + nc]?.type === 'p' && board[r * 8 + nc].color !== piece.color) moves.push(targetIdx);
          }
        }
      };
      checkCapture(c - 1); checkCapture(c + 1);
    }
  } else if (piece.type === 'n') { [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]].forEach(([dr, dc]) => add(r + dr, c + dc));
  } else if (piece.type === 'k') {
    [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]].forEach(([dr, dc]) => add(r + dr, c + dc));
    if (checkCastling && !piece.hasMoved && !attacksOnly && index === (piece.color === 'w' ? 60 : 4)) {
      const enemyColor = piece.color === 'w' ? 'b' : 'w';
      if (!isSquareAttacked(board, index, enemyColor, enPassantTarget)) {
        const rookRight = board[index + 3];
        if (rookRight && rookRight.type === 'r' && rookRight.color === piece.color && !rookRight.hasMoved) { if (!board[index + 1] && !board[index + 2] && !isSquareAttacked(board, index + 1, enemyColor, enPassantTarget) && !isSquareAttacked(board, index + 2, enemyColor, enPassantTarget)) moves.push(index + 2); }
        const rookLeft = board[index - 4];
        if (rookLeft && rookLeft.type === 'r' && rookLeft.color === piece.color && !rookLeft.hasMoved) { if (!board[index - 1] && !board[index - 2] && !board[index - 3] && !isSquareAttacked(board, index - 1, enemyColor, enPassantTarget) && !isSquareAttacked(board, index - 2, enemyColor, enPassantTarget)) moves.push(index - 2); }
      }
    }
  } else {
    const dirs = []; if (piece.type === 'r' || piece.type === 'q') dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]); if (piece.type === 'b' || piece.type === 'q') dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
    dirs.forEach(([dr, dc]) => { let nr = r + dr, nc = c + dc; while (add(nr, nc)) { nr += dr; nc += dc; } });
  }
  return moves;
}

export function isSquareAttacked(board, targetIdx, attackerColor, enPassantTarget = null) {
  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (piece && piece.color === attackerColor) {
      const moves = getPseudoLegalMoves(board, i, false, enPassantTarget, true); 
      if (moves.includes(targetIdx)) return true;
    }
  }
  return false;
}

export function getStrictLegalMoves(board, index, enPassantTarget = null) {
  const piece = board[index]; if (!piece) return [];
  const pseudo = getPseudoLegalMoves(board, index, true, enPassantTarget, false); const legal = [];
  for (const target of pseudo) {
    // The king is checked/mated, never captured. Attack maps still include it.
    if (board[target]?.type === 'k') continue;
    const newBoard = [...board]; newBoard[target] = newBoard[index]; newBoard[index] = null;
    if (piece.type === 'p' && target === enPassantTarget) { const captureIdx = piece.color === 'w' ? target + 8 : target - 8; newBoard[captureIdx] = null; }
    if (piece.type === 'k' && Math.abs(target - index) === 2) {
      const rookFrom = target > index ? index + 3 : index - 4, rookTo = target > index ? index + 1 : index - 1;
      newBoard[rookTo] = newBoard[rookFrom]; newBoard[rookFrom] = null;
    }
    let kingIdx = -1;
    for (let i = 0; i < 64; i++) { if (newBoard[i]?.type === 'k' && newBoard[i]?.color === piece.color) { kingIdx = i; break; } }
    const enemyColor = piece.color === 'w' ? 'b' : 'w';
    // FIX: Burada null yerine enPassantTarget parametresini geçiriyoruz
    if (kingIdx !== -1 && !isSquareAttacked(newBoard, kingIdx, enemyColor, enPassantTarget)) legal.push(target);
  }
  return legal;
}

export function isInsufficientMaterial(board) {
  const pieces = board.filter(p => p !== null); if (pieces.length === 2) return true; 
  if (pieces.length === 3) return pieces.some(p => p.type === 'n' || p.type === 'b');
  const bishops = pieces.filter(p => p.type === 'b'); const others = pieces.filter(p => p.type !== 'b' && p.type !== 'k');
  if (others.length === 0 && bishops.length >= 2) {
     let colorSet = new Set();
     for (let i = 0; i < 64; i++) { if (board[i]?.type === 'b') { colorSet.add((Math.floor(i / 8) + (i % 8)) % 2); } }
     if (colorSet.size === 1) return true;
  }
  return false;
}

export function getBoardStateString(board, enPassantTarget, turn) {
  // Only a legally available en passant capture distinguishes a repetition.
  const epAvailable = enPassantTarget != null && board.some((p, index) =>
    p?.type === 'p' && p.color === turn && getStrictLegalMoves(board, index, enPassantTarget).includes(enPassantTarget));
  return board.map(p => p ? p.color + p.type : '.').join('') +
    `_castle:${getCastlingRights(board)}_ep:${epAvailable ? enPassantTarget : '-'}_t:${turn || '-'}`;
}

// Keep histories from already-open rooms usable after this key correction.
function normalizePositionKey(key) {
  if (typeof key !== 'string' || key.includes('_castle:')) return key;
  const match = key.match(/^(.*)_ep:(-|\d+)_t:([wb])$/);
  if (!match) return key;
  const cells = match[1].match(/\.|[wb][pnbrqk][01]?/g) || [];
  if (cells.length !== 64 || cells.join('') !== match[1]) return key;
  const board = cells.map(cell => cell === '.' ? null : { color: cell[0], type: cell[1], hasMoved: cell[2] === '1' });
  return getBoardStateString(board, match[2] === '-' ? null : Number(match[2]), match[3]);
}

export function getGameState(board, nextTurnColor, halfmoveClock = 0, history = [], enPassantTarget = null) {
  let hasMoves = false, kingIdx = -1;
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p && p.color === nextTurnColor) {
      if (p.type === 'k') kingIdx = i;
      if (!hasMoves && getStrictLegalMoves(board, i, enPassantTarget).length > 0) hasMoves = true;
    }
  }
  if (!hasMoves) {
    const enemyColor = nextTurnColor === 'w' ? 'b' : 'w';
    if (kingIdx !== -1 && isSquareAttacked(board, kingIdx, enemyColor, enPassantTarget)) return 'mate';
    return 'draw_stalemate';
  }
  // A mating move ends the game before a draw counter can take precedence.
  if (isInsufficientMaterial(board)) return 'draw_material';
  if (halfmoveClock >= 100) return 'draw_50move';
  const currentStateStr = getBoardStateString(board, enPassantTarget, nextTurnColor);
  if (history.filter(h => normalizePositionKey(h) === currentStateStr).length >= 3) return 'draw_repetition';
  return 'active';
}
