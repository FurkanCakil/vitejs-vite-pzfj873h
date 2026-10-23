import { createHash } from 'node:crypto';
import { requireAction } from './errors.js';
import { validateAction } from './room-schema.js';
import { FRESH_MS, PRESENCE_SHARDS } from '../src/utils/presenceProtocol.js';

const RETIRED_MS = 120_000;
const MAX_MEMBERS = 128, MAX_ACTIVE_TABS = 8, MAX_SESSIONS = 16;
const fresh = (at, now, ttl) => Number.isFinite(at) && at <= now && now - at < ttl;
export const presenceShardId = uid => String(createHash('sha256').update(uid).digest().readUInt32BE(0) % PRESENCE_SHARDS).padStart(2, '0');

function pruneMembers(source, now) {
  const members = {};
  for (const [uid, value] of Object.entries(source ?? {})) {
    if (!fresh(value.seenAt, now, RETIRED_MS)) continue;
    const sessions = Object.fromEntries(Object.entries(value.sessions ?? {}).filter(([, session]) =>
      fresh(session.at, now, session.closed ? RETIRED_MS : FRESH_MS)));
    Object.defineProperty(members, uid, { value: { ...value, sessions }, enumerable: true, writable: true, configurable: true });
  }
  return members;
}

export function projectPresence(members, previous, now) {
  const projection = {};
  for (const [uid, member] of Object.entries(members)) {
    const active = Object.values(member.sessions).filter(session => !session.closed && fresh(session.at, now, FRESH_MS));
    if (!active.length) continue;
    const rooms = {};
    for (const session of active) if (session.roomCode) rooms[session.roomCode] = Math.max(rooms[session.roomCode] ?? 0, session.at);
    const next = { lastSeen: Math.max(...active.map(session => session.at)), rooms };
    const old = Object.hasOwn(previous ?? {}, uid) ? previous[uid] : null;
    // Several tabs need not republish the same identity every few milliseconds.
    // New/removed rooms and expired identities still appear immediately.
    const sameRooms = old && Object.keys(old.rooms ?? {}).sort().join(',') === Object.keys(rooms).sort().join(',');
    const coalesce = old && fresh(old.lastSeen, now, 15_000) && sameRooms
      && Object.entries(rooms).every(([code, at]) => at - old.rooms[code] < 15_000);
    Object.defineProperty(projection, uid, { value: coalesce ? old : next, enumerable: true });
  }
  return { members: projection };
}

// Reuses the verified bearer identity and existing Production-only OIDC path.
// The client never supplies a UID, clock, count, display ID or shard number.
export async function executePresenceAction(db, projectId, uid, input, now = Date.now(),
  { enabled = process.env.PRESENCE_API_ENABLED === 'true' } = {}) {
  requireAction(enabled, 503, 'server_not_enabled');
  requireAction(typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid)
    && !['__proto__', 'constructor', 'prototype'].includes(uid), 401, 'invalid_identity');
  const action = validateAction(input);
  requireAction(action.type.startsWith('presence.'), 400, 'unsupported_action');
  const root = `artifacts/${projectId}`, shard = presenceShardId(uid);
  const privateRef = db.doc(`${root}/serverPresence/${shard}`);
  const publicRef = db.doc(`${root}/public/data/presenceV2/${shard}`);
  const fingerprint = createHash('sha256').update(JSON.stringify(action)).digest('hex');
  return db.runTransaction(async tx => {
    const [privateSnap, publicSnap] = await tx.getAll(privateRef, publicRef);
    const previous = publicSnap.data() ?? { members: {} };
    const members = pruneMembers(privateSnap.data()?.members, now);
    const member = Object.hasOwn(members, uid) ? members[uid] : { sessions: {}, recent: [] };
    const receipt = member.recent.find(item => item.actionId === action.actionId);
    if (receipt) {
      requireAction(receipt.fingerprint === fingerprint, 409, 'action_id_reused');
      return receipt.result;
    }
    const sameWindow = fresh(member.windowStart, now, 10_000);
    const count = sameWindow ? member.count : 0;
    requireAction(count < 30, 429, 'too_many_actions');
    requireAction(Object.hasOwn(members, uid) || Object.keys(members).length < MAX_MEMBERS, 503, 'presence_capacity');
    let roomCode = null;
    if (action.type === 'presence.heartbeat' && action.roomCode) {
      const [v2, legacy] = await tx.getAll(db.doc(`${root}/public/data/roomsV2/${action.roomCode}`), db.doc(`${root}/public/data/rooms/${action.roomCode}`));
      const room = v2.exists ? v2.data() : legacy.data();
      // The counter needs no private/playing room codes. Legacy quick matching
      // needs only verified members of public waiting rooms.
      if (room?.isPublic === true && room.status === 'waiting' && Array.isArray(room.players) && room.players.includes(uid)) roomCode = action.roomCode;
    }
    const held = Object.hasOwn(member.sessions, action.sessionId) ? member.sessions[action.sessionId] : null;
    const retired = action.type === 'presence.heartbeat' && held?.closed === true;
    if (!retired) {
      if (!held) requireAction(Object.keys(member.sessions).length < MAX_SESSIONS, 429, 'too_many_tabs');
      if (action.type === 'presence.heartbeat' && !held) requireAction(Object.values(member.sessions)
        .filter(session => !session.closed).length < MAX_ACTIVE_TABS, 429, 'too_many_tabs');
      member.sessions[action.sessionId] = action.type === 'presence.leave' ? { at: now, closed: true }
        : { at: now, roomCode };
    }
    const result = { serverNow: now, retired };
    Object.assign(member, { seenAt: now, windowStart: sameWindow ? member.windowStart : now, count: count + 1,
      recent: [...member.recent.slice(-7), { actionId: action.actionId, fingerprint, result }] });
    members[uid] = member;
    requireAction(Buffer.byteLength(JSON.stringify({ members })) <= 700_000, 503, 'presence_capacity');
    const projected = projectPresence(members, previous.members, now);
    tx.set(privateRef, { members });
    if (JSON.stringify(previous) !== JSON.stringify(projected)) tx.set(publicRef, projected);
    return result;
  });
}
