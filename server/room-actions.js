import { createHash } from 'node:crypto';
import { requireAction } from './errors.js';
import { applyXoxMove } from './games/xox.js';

const KEYS = ['roomId', 'actionId', 'expectedVersion', 'type', 'cell'];

export function validateAction(input) {
  requireAction(input !== null && typeof input === 'object' && !Array.isArray(input), 400, 'invalid_action');
  requireAction(Object.keys(input).length === KEYS.length
    && Object.keys(input).every(key => KEYS.includes(key)), 400, 'invalid_fields');
  requireAction(typeof input.roomId === 'string' && /^[A-Z0-9]{6}$/.test(input.roomId), 400, 'invalid_room_id');
  requireAction(typeof input.actionId === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(input.actionId), 400, 'invalid_action_id');
  requireAction(Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 0
    && input.expectedVersion < Number.MAX_SAFE_INTEGER, 400, 'invalid_version');
  requireAction(input.type === 'xox.move', 400, 'unsupported_action');
  requireAction(Number.isInteger(input.cell) && input.cell >= 0 && input.cell < 9, 400, 'invalid_cell');
  // Canonical field order makes retried JSON with reordered keys identical.
  return Object.fromEntries(KEYS.map(key => [key, input[key]]));
}

export async function applyRoomAction(db, projectId, uid, input, now = Date.now()) {
  const action = validateAction(input);
  requireAction(typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid), 401, 'invalid_identity');
  const fingerprint = createHash('sha256').update(JSON.stringify(action)).digest('hex');
  const root = `artifacts/${projectId}`;
  const roomRef = db.doc(`${root}/public/data/roomsV2/${action.roomId}`);
  // Receipts and rate limits are server-only, never part of the public room.
  const receiptRef = db.doc(`${root}/roomActionReceipts/${action.roomId}/actors/${uid}`);
  const rateRef = db.doc(`${root}/serverRateLimits/${uid}`);

  return db.runTransaction(async transaction => {
    const [roomSnapshot, receiptSnapshot, rateSnapshot] = await transaction.getAll(roomRef, receiptRef, rateRef);
    requireAction(roomSnapshot.exists, 404, 'room_not_found');
    const room = roomSnapshot.data();
    requireAction(room.players?.includes(uid), 403, 'not_a_player');
    const receipts = receiptSnapshot.data()?.recent ?? [];
    const previous = receipts.find(receipt => receipt.actionId === action.actionId);
    if (previous) {
      requireAction(previous.fingerprint === fingerprint, 409, 'action_id_reused');
      return previous.result;
    }
    requireAction(room.version === action.expectedVersion, 409, 'stale_version');
    const patch = applyXoxMove(room, uid, action.cell);
    const rate = rateSnapshot.data();
    const sameWindow = rate && now >= rate.windowStart && now - rate.windowStart < 10_000;
    const count = sameWindow ? rate.count : 0;
    requireAction(count < 30, 429, 'too_many_actions');
    const version = room.version + 1;
    const result = { roomId: action.roomId, version, winner: patch.winner };
    transaction.update(roomRef, { ...patch, version, updatedAt: now });
    transaction.set(receiptRef, {
      recent: [...receipts.slice(-31), { actionId: action.actionId, fingerprint, result }],
    });
    transaction.set(rateRef, { windowStart: sameWindow ? rate.windowStart : now, count: count + 1 });
    return result;
  });
}
