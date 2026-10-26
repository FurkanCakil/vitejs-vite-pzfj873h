// These timestamps come only from server-written private records/queues, never
// from an action payload. A request may read a newer request's commit after a
// transaction retry. Do not mistake that bounded reordering for a dead lease.
export const MAX_SERVER_REORDER_MS = 60_000;

export function freshServerTime(at, now, ttl) {
  return Number.isFinite(at) && at <= now + MAX_SERVER_REORDER_MS && now - at < ttl;
}

export function monotonicServerTime(previous, now) {
  return Number.isFinite(previous) && previous > now && previous <= now + MAX_SERVER_REORDER_MS ? previous : now;
}
