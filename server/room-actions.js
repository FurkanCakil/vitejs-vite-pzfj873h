export { validateAction } from './room-schema.js';
import { executeRoomAction } from './xox-rooms.js';
import { executePresenceAction } from './presence.js';

export function applyRoomAction(db, projectId, uid, action, ...options) {
  return action.type?.startsWith('presence.') ? executePresenceAction(db, projectId, uid, action, ...options)
    : executeRoomAction(db, projectId, uid, action, ...options);
}
