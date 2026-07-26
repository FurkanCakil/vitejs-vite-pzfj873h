export const BOT_UID = 'BOT_PLAYER';

export const DIFFICULTY_LABELS = { easy: 'Kolay', medium: 'Orta', hard: 'Zor' };

// Stockfish'in "Skill Level" (0-20) ve arama derinliği (depth) ayarları.
export const DIFFICULTY_CONFIG = {
  easy: { skillLevel: 1, depth: 3 },
  medium: { skillLevel: 10, depth: 8 },
  hard: { skillLevel: 20, depth: 16 },
};
