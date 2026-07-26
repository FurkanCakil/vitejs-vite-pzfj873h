import { getValidCheckersMoves, checkCheckersWinner } from './logic.js';

export const BOT_UID = 'BOT_PLAYER';

export const DIFFICULTY_LABELS = { easy: 'Kolay', medium: 'Orta', hard: 'Zor' };

const getPiecesOfColor = (board, color) => {
  const list = [];
  for (let i = 0; i < 64; i++) { if (board[i]?.color === color) list.push(i); }
  return list;
};

function applyMove(board, from, move) {
  const newBoard = board.slice();
  const piece = { ...newBoard[from] };
  const targetRow = Math.floor(move.to / 8);
  if (piece.color === 'w' && targetRow === 0) piece.isKing = true;
  if (piece.color === 'b' && targetRow === 7) piece.isKing = true;
  newBoard[move.to] = piece;
  newBoard[from] = null;
  if (move.isJump) newBoard[move.capturedIdx] = null;
  return newBoard;
}

// Bir atlama zincirinin devamındaki tüm olası son-durumları (atlama bitene kadar) üretir.
function buildJumpChains(board, index) {
  const jumps = getValidCheckersMoves(board, index, index).filter(m => m.isJump);
  if (jumps.length === 0) return [{ board, path: [] }];
  const results = [];
  for (const move of jumps) {
    const nextBoard = applyMove(board, index, move);
    for (const sub of buildJumpChains(nextBoard, move.to)) {
      results.push({ board: sub.board, path: [{ from: index, ...move }, ...sub.path] });
    }
  }
  return results;
}

// `color` için oynanabilecek tüm tam "el"leri (zorunlu yeme zinciri dahil, tek atomik hamle olarak) üretir.
export function getAllTurns(board, color) {
  const turns = [];
  for (const index of getPiecesOfColor(board, color)) {
    for (const move of getValidCheckersMoves(board, index, null)) {
      if (move.isJump) {
        const firstBoard = applyMove(board, index, move);
        for (const chain of buildJumpChains(firstBoard, move.to)) {
          turns.push({ board: chain.board, path: [{ from: index, ...move }, ...chain.path] });
        }
      } else {
        turns.push({ board: applyMove(board, index, move), path: [{ from: index, ...move }] });
      }
    }
  }
  return turns;
}

const getRandomTurn = (board, color) => {
  const turns = getAllTurns(board, color);
  return turns.length ? turns[Math.floor(Math.random() * turns.length)] : null;
};

const captureCount = (turn) => turn.path.filter((p) => p.isJump).length;

function getMediumTurn(board, botColor, humanColor) {
  const turns = getAllTurns(board, botColor);
  if (turns.length === 0) return null;
  const maxCaptures = Math.max(...turns.map(captureCount));
  const candidates = maxCaptures > 0 ? turns.filter((t) => captureCount(t) === maxCaptures) : turns;

  let best = null; let bestScore = -Infinity;
  for (const t of candidates) {
    const oppTurns = getAllTurns(t.board, humanColor);
    const oppMaxCaptures = oppTurns.length ? Math.max(...oppTurns.map(captureCount)) : 0;
    const score = evaluateBoard(t.board, botColor, humanColor) - oppMaxCaptures * 1.5;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

function evaluateBoard(board, botColor, humanColor) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p) continue;
    const r = Math.floor(i / 8);
    const value = (p.isKing ? 3 : 1) + (r >= 2 && r <= 5 ? 0.1 : 0);
    score += p.color === botColor ? value : -value;
  }
  return score;
}

function minimax(board, depth, isMaximizing, botColor, humanColor, alpha, beta) {
  const winnerColor = checkCheckersWinner(board);
  if (winnerColor) return (winnerColor === botColor ? 1 : -1) * (1000 + depth);

  const color = isMaximizing ? botColor : humanColor;
  const turns = getAllTurns(board, color);
  if (turns.length === 0) return (isMaximizing ? -1 : 1) * (1000 + depth);
  if (depth === 0) return evaluateBoard(board, botColor, humanColor);

  if (isMaximizing) {
    let best = -Infinity;
    for (const t of turns) {
      best = Math.max(best, minimax(t.board, depth - 1, false, botColor, humanColor, alpha, beta));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const t of turns) {
    best = Math.min(best, minimax(t.board, depth - 1, true, botColor, humanColor, alpha, beta));
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

function getBestTurn(board, botColor, humanColor, depth = 4) {
  const turns = getAllTurns(board, botColor);
  if (turns.length === 0) return null;
  let bestScore = -Infinity; let bestTurn = null;
  for (const t of turns) {
    const score = minimax(t.board, depth - 1, false, botColor, humanColor, -Infinity, Infinity);
    if (score > bestScore) { bestScore = score; bestTurn = t; }
  }
  return bestTurn;
}

// Dönüş: { board, path } — path içindeki her adım { from, to, isJump, capturedIdx? }.
// `board` botun elini oynadıktan sonraki (zincir dahil) nihai tahta durumudur.
export function getBotTurn(board, difficulty, botColor, humanColor) {
  if (difficulty === 'easy') return getRandomTurn(board, botColor);
  if (difficulty === 'medium') return getMediumTurn(board, botColor, humanColor);
  return getBestTurn(board, botColor, humanColor, 4);
}
