export const HEARTBEAT_MS = 20_000;
export const FRESH_MS = 75_000;

export function sessionTime(session) {
  const value = typeof session === 'number' ? session : session?.lastSeen;
  return typeof value === 'number' ? value : value?.toMillis?.() ?? NaN;
}

export function isFreshSession(session, now = Date.now()) {
  const age = now - sessionTime(session);
  return Number.isFinite(age) && age >= -5_000 && age < FRESH_MS;
}

export function countActiveSessions(sessions, now = Date.now()) {
  const entries = Object.entries(sessions || {}).filter(([, s]) => isFreshSession(s, now));
  const identities = new Map(entries.filter(([, s]) => s?.uid && s?.playerId).map(([, s]) => [s.uid, s.playerId]));
  return new Set(entries.map(([id, s]) => {
    // Older clients wrote uid_randomSuffix -> milliseconds.
    const uid = s?.uid || id.slice(0, id.lastIndexOf('_')) || id;
    return s?.playerId || identities.get(uid) || uid;
  })).size;
}

// Display and matchmaking both require a live host in this exact room.
export function waitingPlayers(room, code, sessions, selfUid, now = Date.now()) {
  if (!room?.isPublic || room.status !== 'waiting' || !room.gameId) return [];
  const players = [...new Set(room.players || [])];
  if (players.includes(selfUid) || players.length >= (room.maxPlayers || 2)) return [];
  const live = new Set(Object.values(sessions || {}).filter(s =>
    s?.roomCode === code && isFreshSession(s, now),
  ).map(s => s.uid));
  if (!live.has(room.host)) return [];
  return players.filter(uid => live.has(uid) && !room.isBotPlayer?.[uid]);
}
