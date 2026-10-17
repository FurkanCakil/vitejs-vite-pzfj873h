import { getStrictLegalMoves } from './logic.js';

export const BOT_UID = 'BOT_PLAYER';

export const DIFFICULTY_LABELS = { easy: 'Kolay', medium: 'Orta', hard: 'Zor' };

// Stockfish'in "Skill Level" (0-20) ve arama derinliği (depth) ayarları.
export const DIFFICULTY_CONFIG = {
  easy: { skillLevel: 0, depth: 2, randomMoveChance: 0.10 },
  medium: { skillLevel: 10, depth: 8 },
  hard: { skillLevel: 20, depth: 16 },
};
// Occasional unplanned moves make easy mode forgiving. Use the same legal
// move generator as the board so checks, castling and en passant stay valid.
export function chooseEasyMove(board, color, enPassantTarget = null, random = Math.random) {
  if (random() >= DIFFICULTY_CONFIG.easy.randomMoveChance) return null;
  const moves = [];
  board.forEach((piece, from) => {
    if (piece?.color !== color) return;
    for (const to of getStrictLegalMoves(board, from, enPassantTarget)) {
      const promotion = piece.type === 'p' && (to < 8 || to >= 56) ? 'q' : undefined;
      moves.push({ from, to, promotion });
    }
  });
  return moves.length ? moves[Math.floor(random() * moves.length)] : null;
}
