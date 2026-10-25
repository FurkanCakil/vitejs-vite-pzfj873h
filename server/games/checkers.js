import { requireAction } from '../errors.js';
import { createInitialCheckersBoard, getValidCheckersMoves, checkCheckersWinner } from '../../src/games/checkers/logic.js';

export function freshCheckers(players, scores, whiteUid) {
  return { board: createInitialCheckersBoard(), playerColors: Object.fromEntries(players.map(uid => [uid, uid === whiteUid ? 'w' : 'b'])),
    turn: whiteUid ?? null, startingPlayer: whiteUid ?? null, multiJumpIdx: null, winner: null, rematchRequestedBy: null,
    scores: Object.fromEntries(players.map(uid => [uid, scores?.[uid] ?? 0])) };
}

export function applyCheckersMove(room, uid, from, to) {
  requireAction(room?.schemaVersion === 2 && room.gameType === 'dama', 409, 'unsupported_room');
  requireAction(Array.isArray(room.players) && room.players.length === 2 && room.players[0] !== room.players[1], 409, 'invalid_room');
  requireAction(room.players.includes(uid), 403, 'not_a_player');
  requireAction(room.status === 'playing' && !room.winner, 409, 'game_not_playing');
  requireAction(room.turn === uid, 409, 'not_your_turn');
  requireAction([from, to].every(index => Number.isInteger(index) && index >= 0 && index < 64), 400, 'invalid_cell');
  const color = room.playerColors?.[uid], opponent = room.players.find(id => id !== uid);
  requireAction(['w', 'b'].includes(color) && room.playerColors?.[opponent] === (color === 'w' ? 'b' : 'w'), 409, 'invalid_room');
  const count = { w: 0, b: 0 };
  requireAction(Array.isArray(room.board) && room.board.length === 64 && room.board.every((piece, index) => {
    if (piece === null) return true;
    if (!piece || typeof piece !== 'object' || Array.isArray(piece) || piece.type !== 'man'
      || !['w', 'b'].includes(piece.color) || typeof piece.isKing !== 'boolean'
      || Object.keys(piece).length !== 3 || (Math.floor(index / 8) + index % 8) % 2 !== 1) return false;
    count[piece.color]++; return true;
  }) && count.w > 0 && count.b > 0 && count.w <= 12 && count.b <= 12, 409, 'invalid_board');
  requireAction(room.players.every(id => Number.isSafeInteger(room.scores?.[id]) && room.scores[id] >= 0
    && room.scores[id] < Number.MAX_SAFE_INTEGER), 409, 'invalid_scores');
  const chain = room.multiJumpIdx ?? null;
  requireAction(chain === null || (Number.isInteger(chain) && chain >= 0 && chain < 64
    && room.board[chain]?.color === color && getValidCheckersMoves(room.board, chain, chain).length > 0), 409, 'invalid_chain');
  requireAction(room.board[from]?.color === color, 409, 'piece_not_owned');
  const move = getValidCheckersMoves(room.board, from, chain).find(item => item.to === to);
  requireAction(move, 409, 'illegal_move');
  const board = room.board.map(piece => piece && { ...piece });
  const piece = board[from];
  if ((color === 'w' && to < 8) || (color === 'b' && to >= 56)) piece.isKing = true;
  board[to] = piece; board[from] = null;
  if (move.isJump) board[move.capturedIdx] = null;
  const multiJumpIdx = move.isJump && getValidCheckersMoves(board, to, to).length ? to : null;
  let winner = checkCheckersWinner(board) ? uid : null;
  if (!winner && multiJumpIdx === null && !board.some((other, index) => other?.color !== color
    && other && getValidCheckersMoves(board, index).length > 0)) winner = uid;
  return { board, multiJumpIdx: winner ? null : multiJumpIdx, winner,
    turn: winner ? null : multiJumpIdx !== null ? uid : opponent,
    scores: { ...room.scores, ...(winner ? { [uid]: room.scores[uid] + 1 } : {}) } };
}
