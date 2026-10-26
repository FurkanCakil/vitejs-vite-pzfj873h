import { ActionError, requireAction } from '../errors.js';
import { createInitialChessBoard, getBoardStateString, isSquareAttacked } from '../../src/games/chess/logic.js';
import { getChessMoveUpdate } from '../../src/games/chess/move.js';

export function freshChess(players, scores, whiteUid) {
  const board = createInitialChessBoard();
  return { board, playerColors: Object.fromEntries(players.map(uid => [uid, uid === whiteUid ? 'w' : 'b'])),
    turn: whiteUid ?? null, startingPlayer: whiteUid ?? null,
    captured: { w: [], b: [] }, halfmoveClock: 0, positionHistory: [getBoardStateString(board, null, 'w')],
    enPassantTarget: null, lastMove: null, previousState: null, chessMoves: [], notationStartFen: null,
    winner: null, drawReason: null, winReason: null, drawOffer: null, takebackOffer: null, rematchRequestedBy: null,
    scores: Object.fromEntries(players.map(uid => [uid, scores?.[uid] ?? 0])) };
}

function requirePlayers(room, uid) {
  requireAction(room?.schemaVersion === 2 && room.gameType === 'satranc', 409, 'unsupported_room');
  requireAction(Array.isArray(room.players) && room.players.length === 2 && room.players[0] !== room.players[1], 409, 'invalid_room');
  requireAction(room.players.includes(uid), 403, 'not_a_player');
  requireAction(room.status === 'playing' && !room.winner, 409, 'game_not_playing');
  const color = room.playerColors?.[uid], opponent = room.players.find(id => id !== uid);
  requireAction(['w', 'b'].includes(color) && room.playerColors?.[opponent] === (color === 'w' ? 'b' : 'w'), 409, 'invalid_room');
  requireAction(room.players.every(id => Number.isSafeInteger(room.scores?.[id]) && room.scores[id] >= 0
    && room.scores[id] < Number.MAX_SAFE_INTEGER), 409, 'invalid_scores');
  return { color, opponent };
}

export function applyChessMove(room, uid, from, to, promotion = null) {
  const { color } = requirePlayers(room, uid);
  requireAction(room.turn === uid, 409, 'not_your_turn');
  const counts = { w: { k: 0, p: 0, total: 0 }, b: { k: 0, p: 0, total: 0 } };
  requireAction(Array.isArray(room.board) && room.board.length === 64 && room.board.every((piece, index) => {
    if (piece === null) return true;
    if (!piece || typeof piece !== 'object' || Array.isArray(piece) || Object.keys(piece).length !== 3
      || !['p', 'n', 'b', 'r', 'q', 'k'].includes(piece.type) || !['w', 'b'].includes(piece.color)
      || typeof piece.hasMoved !== 'boolean' || (piece.type === 'p' && (index < 8 || index >= 56))) return false;
    const count = counts[piece.color]; count.total++; if (piece.type === 'k' || piece.type === 'p') count[piece.type]++;
    return true;
  }) && Object.values(counts).every(count => count.k === 1 && count.p <= 8 && count.total <= 16), 409, 'invalid_board');
  // A valid side-to-move cannot already be attacking the other king.
  const otherKing = room.board.findIndex(piece => piece?.type === 'k' && piece.color !== color);
  requireAction(!isSquareAttacked(room.board, otherKing, color), 409, 'invalid_board');
  requireAction(Number.isInteger(room.halfmoveClock) && room.halfmoveClock >= 0 && room.halfmoveClock < 100
    && Array.isArray(room.positionHistory) && room.positionHistory.length <= 100 && room.positionHistory.every(key => typeof key === 'string' && key.length <= 256)
    && Array.isArray(room.chessMoves) && room.chessMoves.length < 20_000 && room.chessMoves.every(san => typeof san === 'string' && san.length <= 16), 409, 'invalid_history');
  requireAction(room.enPassantTarget === null || (Number.isInteger(room.enPassantTarget)
    && Math.floor(room.enPassantTarget / 8) === (color === 'w' ? 2 : 5) && room.board[room.enPassantTarget] === null
    && room.board[room.enPassantTarget + (color === 'w' ? 8 : -8)]?.type === 'p'
    && room.board[room.enPassantTarget + (color === 'w' ? 8 : -8)]?.color !== color), 409, 'invalid_board');
  requireAction(['w', 'b'].every(c => Array.isArray(room.captured?.[c]) && room.captured[c].length <= 30
    && room.captured[c].every(type => ['p', 'n', 'b', 'r', 'q'].includes(type))), 409, 'invalid_board');
  try { return getChessMoveUpdate(room, from, to, promotion); }
  catch (error) {
    if (['game_not_playing', 'piece_not_owned', 'illegal_move', 'invalid_cell', 'invalid_promotion'].includes(error.code)) {
      throw new ActionError(['invalid_cell', 'invalid_promotion'].includes(error.code) ? 400 : 409, error.code);
    }
    throw error;
  }
}

export function resignChess(room, uid) {
  const { opponent } = requirePlayers(room, uid);
  return { winner: opponent, winReason: 'resign', drawReason: null, turn: null,
    scores: { ...room.scores, [opponent]: room.scores[opponent] + 1 }, drawOffer: null, takebackOffer: null };
}

export function applyChessOffer(room, uid, kind, decision) {
  requirePlayers(room, uid);
  requireAction(['draw', 'takeback'].includes(kind) && ['request', 'accept', 'reject'].includes(decision), 400, 'invalid_offer');
  const key = kind === 'draw' ? 'drawOffer' : 'takebackOffer';
  const offer = room[key];
  if (decision === 'request') {
    requireAction(!offer || offer === uid, 409, 'offer_pending');
    if (kind === 'takeback') requireAction(room.turn !== uid && room.previousState?.turn === uid && room.lastMove, 409, 'invalid_takeback');
    return { [key]: uid };
  }
  requireAction(offer && offer !== uid && room.players.includes(offer), 409, 'invalid_offer');
  if (decision === 'reject') return { [key]: null };
  if (kind === 'draw') return { winner: 'Draw', drawReason: 'agreement', winReason: null, turn: null, drawOffer: null, takebackOffer: null };
  requireAction(room.turn === uid && room.previousState?.turn === offer && room.lastMove, 409, 'invalid_takeback');
  // Restore only the last server-derived position, never a supplied snapshot,
  // score or identity; consume the snapshot so it cannot be accepted twice.
  return { ...structuredClone(room.previousState), previousState: null, drawOffer: null, takebackOffer: null,
    winner: null, winReason: null, drawReason: null };
}
