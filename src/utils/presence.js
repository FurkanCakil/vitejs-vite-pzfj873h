import { FRESH_MS, presenceNow } from './presenceProtocol.js';
export { HEARTBEAT_MS, FRESH_MS } from './presenceProtocol.js';

export function sessionTime(session) {
  const value = typeof session === 'number' ? session : session?.lastSeen;
  return typeof value === 'number' ? value : value?.toMillis?.() ?? NaN;
}

export function isFreshSession(session, now = presenceNow()) {
  const age = now - sessionTime(session);
  return Number.isFinite(age) && age >= -5_000 && age < FRESH_MS;
}

export function countActiveSessions(sessions, now = presenceNow()) {
  const entries = Object.entries(sessions || {}).filter(([, s]) => isFreshSession(s, now));
  const identities = new Map(entries.filter(([, s]) => s?.uid && s?.playerId).map(([, s]) => [s.uid, s.playerId]));
  return new Set(entries.map(([id, s]) => {
    // Older clients wrote uid_randomSuffix -> milliseconds.
    const uid = s?.uid || id.slice(0, id.lastIndexOf('_')) || id;
    return s?.playerId || identities.get(uid) || uid;
  })).size;
}

export function livePlayersByRoom(sessions, now = presenceNow()) {
  const rooms = new Map();
  for (const session of Object.values(sessions || {})) {
    if (!session?.uid || !session.roomCode || !isFreshSession(session, now)) continue;
    if (!rooms.has(session.roomCode)) rooms.set(session.roomCode, new Set());
    rooms.get(session.roomCode).add(session.uid);
  }
  return rooms;
}

// Batch callers build the index once, instead of scanning sessions per room.
export function waitingPlayers(room, code, sessions, selfUid, now = presenceNow(), liveRooms = null) {
  if (!room?.isPublic || room.status !== 'waiting' || !room.gameId) return [];
  const players = [...new Set(room.players || [])];
  if (players.includes(selfUid) || players.length >= (room.maxPlayers || 2)) return [];
  const live = (liveRooms || livePlayersByRoom(sessions, now)).get(code);
  if (!live?.has(room.host)) return [];
  return players.filter(uid => live.has(uid) && !room.isBotPlayer?.[uid]);
}
