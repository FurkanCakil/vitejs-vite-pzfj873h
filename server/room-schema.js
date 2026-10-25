import { requireAction } from './errors.js';
import { validateFleet } from './games/battleship.js';
import { okeyFields, validateOkeyFields } from './okey-schema.js';

const common = ['type', 'actionId'];
const room = ['roomId'];
const session = ['sessionId'];
const version = ['expectedVersion'];
const fields = {
  'presence.heartbeat': [...session, 'roomCode'],
  'presence.leave': [...session],
  ...okeyFields,
  'room.create': [...session, 'nickname', 'isPublic'],
  'room.match': [...session, 'nickname'],
  'room.join': [...room, ...session, 'nickname'],
  'room.spectate': [...room, ...session],
  'room.heartbeat': [...room, ...session],
  'room.disconnect': [...room, ...session],
  'room.leave': [...room, ...session],
  'room.wait': [...room, ...version],
  'room.close': [...room, ...version],
  'xox.move': [...room, ...version, 'cell'],
  'xox.rematch.request': [...room, ...version],
  'xox.rematch.accept': [...room, ...version],
  'xox.rematch.reject': [...room, ...version],
  'connect4.create': [...session, 'nickname', 'isPublic'],
  'connect4.match': [...session, 'nickname'],
  'connect4.move': [...room, ...version, 'column'],
  'connect4.rematch.request': [...room, ...version],
  'connect4.rematch.accept': [...room, ...version],
  'connect4.rematch.reject': [...room, ...version],
  'battleship.create': [...session, 'nickname', 'isPublic'],
  'battleship.match': [...session, 'nickname'],
  'battleship.ready': [...room, 'roundId', 'fleet'],
  'battleship.cancel': [...room, 'roundId'],
  'battleship.shot': [...room, ...version, 'row', 'col'],
  'battleship.rematch.request': [...room, ...version],
  'battleship.rematch.accept': [...room, ...version],
  'battleship.rematch.reject': [...room, ...version],
};

export function validateAction(input) {
  requireAction(input !== null && typeof input === 'object' && !Array.isArray(input), 400, 'invalid_action');
  requireAction(Object.hasOwn(fields, input.type), 400, 'unsupported_action');
  const keys = [...common, ...fields[input.type]];
  requireAction(Object.keys(input).length === keys.length && Object.keys(input).every(key => keys.includes(key)), 400, 'invalid_fields');
  requireAction(typeof input.actionId === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(input.actionId), 400, 'invalid_action_id');
  if (keys.includes('roomId')) requireAction(typeof input.roomId === 'string' && /^[A-Z0-9]{6}$/.test(input.roomId), 400, 'invalid_room_id');
  if (keys.includes('roomCode')) requireAction(input.roomCode === null || (typeof input.roomCode === 'string' && /^[A-Z0-9]{6}$/.test(input.roomCode)), 400, 'invalid_room_id');
  if (keys.includes('sessionId')) requireAction(typeof input.sessionId === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(input.sessionId), 400, 'invalid_session_id');
  if (keys.includes('expectedVersion')) requireAction(Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 0 && input.expectedVersion < Number.MAX_SAFE_INTEGER, 400, 'invalid_version');
  if (keys.includes('cell')) requireAction(Number.isInteger(input.cell) && input.cell >= 0 && input.cell < 9, 400, 'invalid_cell');
  if (keys.includes('column')) requireAction(Number.isInteger(input.column) && input.column >= 0 && input.column < 7, 400, 'invalid_column');
  if (keys.includes('nickname')) requireAction(typeof input.nickname === 'string' && input.nickname.trim().length >= 1 && input.nickname.length <= 15 && [...input.nickname].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127), 400, 'invalid_nickname');
  if (keys.includes('isPublic')) requireAction(typeof input.isPublic === 'boolean', 400, 'invalid_visibility');
  if (keys.includes('roundId')) requireAction(typeof input.roundId === 'string' && /^[a-f0-9]{24}$/.test(input.roundId), 400, 'invalid_round');
  for (const key of ['row', 'col']) if (keys.includes(key)) requireAction(Number.isInteger(input[key]) && input[key] >= 0 && input[key] < 10, 400, 'invalid_cell');
  if (keys.includes('fleet')) validateFleet(input.fleet);
  if (input.type.startsWith('okey.')) validateOkeyFields(input);
  return Object.fromEntries(keys.map(key => [key, key === 'nickname' ? input[key].trim() : input[key]]));
}
