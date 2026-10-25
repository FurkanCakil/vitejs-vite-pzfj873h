import { requireAction } from '../errors.js';
import { CONNECT4_COLS, CONNECT4_ROWS, createInitialConnect4Board, findDropRow,
  checkConnect4Winner, isConnect4BoardFull } from '../../src/games/connect4/logic.js';

export function freshConnect4(players, scores, starter) {
  return { board: createInitialConnect4Board(), turn: starter, startingPlayer: starter,
    lastMove: null, winner: null, winningLine: null, rematchRequestedBy: null,
    scores: Object.fromEntries(players.map(uid => [uid, scores?.[uid] ?? 0])) };
}

export function applyConnect4Move(room, uid, col) {
  requireAction(room?.schemaVersion === 2 && room.gameType === 'connect4', 409, 'unsupported_room');
  requireAction(Array.isArray(room.players) && room.players.length === 2
    && room.players[0] !== room.players[1], 409, 'invalid_room');
  const seat = room.players.indexOf(uid);
  requireAction(seat !== -1, 403, 'not_a_player');
  requireAction(room.status === 'playing' && !room.winner, 409, 'game_not_playing');
  requireAction(room.turn === uid, 409, 'not_your_turn');
  requireAction(Number.isInteger(col) && col >= 0 && col < CONNECT4_COLS, 400, 'invalid_column');
  requireAction(Array.isArray(room.board) && room.board.length === CONNECT4_COLS * CONNECT4_ROWS
    && room.board.every(cell => cell === null || cell === 'red' || cell === 'blue'), 409, 'invalid_board');
  const counts = { red: 0, blue: 0 };
  for (let c = 0; c < CONNECT4_COLS; c++) {
    let empty = false;
    for (let r = CONNECT4_ROWS - 1; r >= 0; r--) {
      const cell = room.board[r * CONNECT4_COLS + c];
      if (cell === null) { empty = true; continue; }
      requireAction(!empty && !checkConnect4Winner(room.board, r, c), 409, 'invalid_board');
      counts[cell]++;
    }
  }
  const first = room.players.indexOf(room.startingPlayer);
  requireAction(first !== -1, 409, 'invalid_room');
  const colors = ['red', 'blue'];
  const lead = counts[colors[first]], follow = counts[colors[1 - first]];
  requireAction((lead === follow && seat === first) || (lead === follow + 1 && seat !== first), 409, 'invalid_board');
  requireAction(room.players.every(id => Number.isSafeInteger(room.scores?.[id])
    && room.scores[id] >= 0 && room.scores[id] < Number.MAX_SAFE_INTEGER), 409, 'invalid_scores');
  const row = findDropRow(room.board, col);
  requireAction(row !== null, 409, 'column_full');
  const board = [...room.board];
  board[row * CONNECT4_COLS + col] = colors[seat];
  const win = checkConnect4Winner(board, row, col);
  const winner = win?.winner ?? (isConnect4BoardFull(board) ? 'Draw' : null);
  return { board, lastMove: { row, col }, winner, winningLine: win?.line ?? null,
    turn: winner ? null : room.players[1 - seat],
    scores: { ...room.scores, ...(win ? { [uid]: room.scores[uid] + 1 } : {}) } };
}
