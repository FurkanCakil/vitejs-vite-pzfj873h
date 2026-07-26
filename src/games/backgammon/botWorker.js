import { getBotFullTurn } from './bot.js';

// Mesaj protokolü:
//   -> { requestId, board, color, dice, bar, borneOff, difficulty }
//   <- { requestId, path } | { requestId, path: null }  (oynanabilir hamle yoksa)
//   <- { requestId, error }  (beklenmeyen bir hata olursa)
self.onmessage = (e) => {
  const { requestId, board, color, dice, bar, borneOff, difficulty } = e.data;
  try {
    const turn = getBotFullTurn(board, color, dice, bar, borneOff, difficulty);
    self.postMessage({ requestId, path: turn ? turn.path : null });
  } catch (err) {
    self.postMessage({ requestId, error: err?.message || String(err) });
  }
};
