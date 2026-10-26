import { getStrictLegalMoves, getBoardStateString, getGameState } from './logic.js';
import { boardToFEN } from './fen.js';
import { moveToSAN } from './notation.js';

const reject = code => { throw Object.assign(new Error(code), { code }); };

// The browser and the server use the same immutable chess transition. Identity,
// room membership, versions and persistence are checked by the server wrapper.
export function getChessMoveUpdate(state, from, to, promotion = null) {
  const before = state.board, uid = state.turn, color = state.playerColors?.[uid];
  if (!['w', 'b'].includes(color) || state.winner) reject('game_not_playing');
  if (![from, to].every(index => Number.isInteger(index) && index >= 0 && index < 64)) reject('invalid_cell');
  const original = before[from];
  if (original?.color !== color) reject('piece_not_owned');
  if (!getStrictLegalMoves(before, from, state.enPassantTarget).includes(to)) reject('illegal_move');
  const promotes = original.type === 'p' && (to < 8 || to >= 56);
  if (promotes ? !['q', 'r', 'b', 'n'].includes(promotion) : promotion !== null) reject('invalid_promotion');

  const board = before.map(piece => piece && { ...piece });
  let target = board[to];
  if (original.type === 'p' && to === state.enPassantTarget) {
    const capturedIndex = color === 'w' ? to + 8 : to - 8;
    target = board[capturedIndex]; board[capturedIndex] = null;
  }
  board[to] = { ...original, type: promotion ?? original.type, hasMoved: true }; board[from] = null;
  if (original.type === 'k' && Math.abs(to - from) === 2) {
    const rookFrom = to > from ? from + 3 : from - 4, rookTo = to > from ? from + 1 : from - 1;
    board[rookTo] = { ...board[rookFrom], hasMoved: true }; board[rookFrom] = null;
  }
  const enPassantTarget = original.type === 'p' && Math.abs(to - from) === 16 ? (from + to) / 2 : null;
  const captured = { w: [...(state.captured?.w ?? [])], b: [...(state.captured?.b ?? [])] };
  if (target) captured[color].push(target.type);
  const resetsClock = original.type === 'p' || !!target;
  const halfmoveClock = resetsClock ? 0 : (state.halfmoveClock ?? 0) + 1;
  const nextColor = color === 'w' ? 'b' : 'w';
  const positionHistory = [...(resetsClock ? [] : (state.positionHistory ?? [])),
    getBoardStateString(board, enPassantTarget, nextColor)].slice(-100);
  const result = getGameState(board, nextColor, halfmoveClock, positionHistory, enPassantTarget);
  const winner = result === 'mate' ? uid : result.startsWith('draw_') ? 'Draw' : null;
  const notationStartFen = state.notationStartFen || boardToFEN(before, color, state.enPassantTarget, state.halfmoveClock ?? 0, 1);
  return {
    board, captured, enPassantTarget, halfmoveClock, positionHistory,
    chessMoves: [...(state.chessMoves ?? []), moveToSAN(before, board, from, to, state.enPassantTarget, enPassantTarget, result === 'mate')],
    notationStartFen, lastMove: { from, to }, winner,
    turn: winner ? null : state.players.find(id => id !== uid) ?? null,
    drawReason: winner === 'Draw' ? result.slice(5) : null, winReason: null,
    drawOffer: null, takebackOffer: null,
    scores: { ...state.scores, ...(winner && winner !== 'Draw' ? { [uid]: (state.scores?.[uid] ?? 0) + 1 } : {}) },
    // One move only; never embed previousState recursively in Firestore.
    previousState: {
      board: before, turn: uid, captured: state.captured ?? { w: [], b: [] },
      halfmoveClock: state.halfmoveClock ?? 0, positionHistory: state.positionHistory ?? [],
      chessMoves: state.chessMoves ?? [], notationStartFen: state.notationStartFen ?? null,
      enPassantTarget: state.enPassantTarget ?? null, lastMove: state.lastMove ?? null,
    },
  };
}
