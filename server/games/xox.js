import { checkWinner } from '../../src/games/xox/bot.js';
import { requireAction } from '../errors.js';

// Only the server chooses symbols, turn, outcome and scores. The request contains
// a cell, never a replacement board or a score supplied by the player.
export function applyXoxMove(room, uid, cell) {
  requireAction(room?.schemaVersion === 2 && room.gameType === 'xox', 409, 'unsupported_room');
  requireAction(Array.isArray(room.players) && room.players.length === 2
    && room.players[0] !== room.players[1], 409, 'invalid_room');
  const seat = room.players.indexOf(uid);
  requireAction(seat !== -1, 403, 'not_a_player');
  requireAction(room.status === 'playing' && !room.winner, 409, 'game_not_playing');
  requireAction(room.turn === uid, 409, 'not_your_turn');
  requireAction(Number.isInteger(cell) && cell >= 0 && cell < 9, 400, 'invalid_cell');
  requireAction(Array.isArray(room.board) && room.board.length === 9
    && room.board.every(value => value === null || value === 'X' || value === 'O')
    && !checkWinner(room.board), 409, 'invalid_board');
  requireAction(room.board[cell] === null, 409, 'occupied_cell');
  requireAction(room.players.every(id => Number.isSafeInteger(room.scores?.[id])
    && room.scores[id] >= 0 && room.scores[id] < Number.MAX_SAFE_INTEGER), 409, 'invalid_scores');

  const board = [...room.board];
  board[cell] = seat === 0 ? 'X' : 'O';
  const win = checkWinner(board);
  const winner = win?.winner ?? (board.every(Boolean) ? 'Draw' : null);
  const scores = { ...room.scores };
  if (win) scores[uid] += 1;
  return {
    board,
    turn: winner ? null : room.players[1 - seat],
    winner,
    winningLine: win?.line ?? null,
    scores,
  };
}
