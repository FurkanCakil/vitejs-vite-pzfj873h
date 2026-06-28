export function createInitialCheckersBoard() {
    const board = Array(64).fill(null);
    for (let i = 0; i < 64; i++) {
      const r = Math.floor(i / 8); const c = i % 8;
      // Dama sadece koyu renkli karelerde oynanır
      if ((r + c) % 2 === 1) {
        if (r < 3) board[i] = { type: 'man', color: 'b', isKing: false };
        else if (r > 4) board[i] = { type: 'man', color: 'w', isKing: false };
      }
    }
    return board;
  }
  
  export function getValidCheckersMoves(board, index) {
    const piece = board[index];
    if (!piece) return [];
    const moves = [];
    const r = Math.floor(index / 8); const c = index % 8;
    const directions = [];
  
    // Yönleri belirle (Normal taşlar tek yön, damalar her yöne çapraz)
    if (piece.color === 'w' || piece.isKing) directions.push([-1, -1], [-1, 1]); // Yukarı
    if (piece.color === 'b' || piece.isKing) directions.push([[1, -1], [1, 1]]); // Aşağı (Düzeltme: Dizi içi dizi yapısını aşağıda düzeltelim)
    
    const moveDirs = piece.color === 'w' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
    if (piece.isKing) moveDirs.push(...(piece.color === 'w' ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]]));
  
    moveDirs.forEach(([dr, dc]) => {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
        const targetIdx = nr * 8 + nc;
        if (!board[targetIdx]) {
          // Boş kareye normal hamle
          moves.push({ to: targetIdx, isJump: false });
        } else if (board[targetIdx].color !== piece.color) {
          // Rakip taş varsa üstünden atlamayı kontrol et
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