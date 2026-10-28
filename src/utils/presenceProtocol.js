import { serverNow } from './serverClock.js';

export const PRESENCE_SHARDS = 16;
export const HEARTBEAT_MS = 20_000;
export const FRESH_MS = 75_000;

export const presenceNow = serverNow;

// Server shards contain one authenticated identity, not a chosen display ID.
// Per-room timestamps expire independently of the identity's other tabs.
export function presenceShardSessions(shards) {
  const sessions = {};
  for (const shard of shards) for (const [uid, member] of Object.entries(shard?.members ?? {})) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !Number.isFinite(member?.lastSeen)) continue;
    Object.defineProperty(sessions, uid, { value: { uid, lastSeen: member.lastSeen }, enumerable: true, configurable: true });
    for (const [code, at] of Object.entries(member.rooms ?? {})) {
      if (/^[A-Z0-9]{6}$/.test(code) && Number.isFinite(at)) {
        sessions[`${uid}:${code}`] = { uid, roomCode: code, lastSeen: at };
      }
    }
  }
  return sessions;
}
