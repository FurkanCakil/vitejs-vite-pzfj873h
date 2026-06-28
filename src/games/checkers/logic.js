export function createInitialCheckersBoard() {
  const board = Array(64).fill(null);
  for (let i = 0; i < 64; i++) {
    const r = Math.floor(i / 8); const c = i % 8;
    if ((r + c) % 2 === 1) {
      if (r < 3) board[i] = { type: 'man', color: 'b', isKing: false };
      else if (r > 4) board[i] = { type: 'man', color: 'w', isKing: false };
    }
  }
  return board;
}

// Sadece tek bir taşın yapabileceği hamleleri bulur (Kurallara bakmadan)
function getPieceMoves(board, index) {
  const piece = board[index];
  if (!piece) return [];
  const moves = [];
  const r = Math.floor(index / 8); const c = index % 8;

  const moveDirs = piece.color === 'w' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
  if (piece.isKing) moveDirs.push(...(piece.color === 'w' ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]]));

  moveDirs.forEach(([dr, dc]) => {
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
      const targetIdx = nr * 8 + nc;
      if (!board[targetIdx]) {
        moves.push({ to: targetIdx, isJump: false });
      } else if (board[targetIdx].color !== piece.color) {
        const jumpR = nr + dr, jumpC = nc + dc;
        if (jumpR >= 0 && jumpR <= 7 && jumpC >= 0 && jumpC <= 7) {
          const jumpIdx = jumpR * 8 + jumpC;
          if (!board[jumpIdx]) {
            moves.push({ to: jumpIdx, isJump: true, capturedIdx: targetIdx });
          }
        }
      }
    }
  });
  return moves;
}

// Ana fonksiyon: Zorunlu yeme ve zincirleme (multi-jump) kontrolleri eklendi
export function getValidCheckersMoves(board, index, mustJumpWithIdx = null) {
  const piece = board[index];
  if (!piece) return [];

  // Eğer çoklu yeme (zincir) modundaysak, SADECE o anki taş seçilebilir ve YEMEK ZORUNDADIR.
  if (mustJumpWithIdx !== null && index !== mustJumpWithIdx) return [];

  const myMoves = getPieceMoves(board, index);

  // Zincirleme reaksiyondaysak sadece atlama hamlelerini ver
  if (mustJumpWithIdx !== null) {
    return myMoves.filter(m => m.isJump);
  }

  // Normal sıra: Tahtada kullanıcının HERHANGİ BİR taşı yeme işlemi yapabiliyor mu kontrol et (Zorunlu Yeme Kuralı)
  let hasGlobalJump = false;
  for (let i = 0; i < 64; i++) {
    if (board[i]?.color === piece.color) {
       const pMoves = getPieceMoves(board, i);
       if (pMoves.some(m => m.isJump)) {
         hasGlobalJump = true;
         break;
       }
    }
  }

  // Eğer tahtada bir yeme ihtimali varsa, SADECE atlama hamlelerini geçerli kıl
  if (hasGlobalJump) {
    return myMoves.filter(m => m.isJump);
  }

  return myMoves;
}

export function checkCheckersWinner(board) {
  let wCount = 0; let bCount = 0;
  board.forEach(p => {
    if (p?.color === 'w') wCount++;
    if (p?.color === 'b') bCount++;
  });
  if (wCount === 0) return 'b';
  if (bCount === 0) return 'w';
  return null;
}