import { onSnapshot } from 'firebase/firestore';

// Summaries are hints for people choosing a game, never game authority.
export function subscribeServerSummary(ref, read, onData, onError, listen = onSnapshot) {
  return listen(ref, { includeMetadataChanges: true }, snapshot => {
    const verified = snapshot.metadata?.fromCache === false && !snapshot.metadata.hasPendingWrites;
    onData(verified ? read(snapshot) : null);
  }, onError);
}

export function queueEntries(snapshot) {
  if (!snapshot.exists()) return [];
  const entries = snapshot.data()?.entries;
  return Array.isArray(entries) ? entries : undefined;
}

export function waitingCount(entries, userId, now, countPlayers = false) {
  if (entries === null) return null;
  if (!Array.isArray(entries)) return undefined;
  const fresh = entries.filter(entry => typeof entry?.host === 'string' && entry.host && entry.host !== userId
    && Number.isFinite(entry.updatedAt) && now >= entry.updatedAt && now - entry.updatedAt < 60_000);
  if (!countPlayers) return fresh.length;
  return fresh.reduce((total, entry) => {
    const players = entry.players ?? 1;
    return total + (Number.isInteger(players) && players >= 1 && players <= 4 ? players : 0);
  }, 0);
}
