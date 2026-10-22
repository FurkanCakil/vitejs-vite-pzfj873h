import { requireAction } from './errors.js';

const common = ['type', 'actionId'];
const room = ['roomId'];
const session = ['sessionId'];
const version = ['expectedVersion'];
const fields = {
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
};

export function validateAction(input) {
  requireAction(input !== null && typeof input === 'object' && !Array.isArray(input), 400, 'invalid_action');
  requireAction(Object.hasOwn(fields, input.type), 400, 'unsupported_action');
  const keys = [...common, ...fields[input.type]];
  requireAction(Object.keys(input).length === keys.length && Object.keys(input).every(key => keys.includes(key)), 400, 'invalid_fields');
  requireAction(typeof input.actionId === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(input.actionId), 400, 'invalid_action_id');
  if (keys.includes('roomId')) requireAction(typeof input.roomId === 'string' && /^[A-Z0-9]{6}$/.test(input.roomId), 400, 'invalid_room_id');
  if (keys.includes('sessionId')) requireAction(typeof input.sessionId === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(input.sessionId), 400, 'invalid_session_id');
  if (keys.includes('expectedVersion')) requireAction(Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 0 && input.expectedVersion < Number.MAX_SAFE_INTEGER, 400, 'invalid_version');
  if (keys.includes('cell')) requireAction(Number.isInteger(input.cell) && input.cell >= 0 && input.cell < 9, 400, 'invalid_cell');
  if (keys.includes('nickname')) requireAction(typeof input.nickname === 'string' && input.nickname.trim().length >= 1 && input.nickname.length <= 15 && [...input.nickname].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127), 400, 'invalid_nickname');
  if (keys.includes('isPublic')) requireAction(typeof input.isPublic === 'boolean', 400, 'invalid_visibility');
  return Object.fromEntries(keys.map(key => [key, key === 'nickname' ? input[key].trim() : input[key]]));
}
