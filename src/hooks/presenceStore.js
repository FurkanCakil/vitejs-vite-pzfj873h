import { collection, doc, getDoc, getDocs, onSnapshot } from 'firebase/firestore';
import { db, appId } from '../firebase/config.js';
import { SERVER_PRESENCE_ENABLED } from '../utils/gameApi.js';
import { PRESENCE_SHARDS, presenceShardSessions } from '../utils/presenceProtocol.js';

export const presenceCounterRef = doc(db, 'artifacts', appId, 'public', 'data', 'serverStatus', 'info');
const shards = collection(db, 'artifacts', appId, 'public', 'data', 'presenceV2');
export function subscribePresenceSessions(onData, onError) {
  if (!SERVER_PRESENCE_ENABLED) return onSnapshot(presenceCounterRef,
    snap => onData(snap.data({ serverTimestamps: 'estimate' })?.sessions ?? {}), onError);
  return onSnapshot(shards, snap => onData(presenceShardSessions(snap.docs.map(doc => doc.data()))), onError);
}
export async function readPresenceSessions(transaction = null) {
  if (!SERVER_PRESENCE_ENABLED) return ((await (transaction ? transaction.get(presenceCounterRef) : getDoc(presenceCounterRef))).data()?.sessions ?? {});
  if (!transaction) return presenceShardSessions((await getDocs(shards)).docs.map(doc => doc.data()));
  const snapshots = await Promise.all(Array.from({ length: PRESENCE_SHARDS }, (_, index) =>
    transaction.get(doc(shards, String(index).padStart(2, '0')))));
  return presenceShardSessions(snapshots.map(snapshot => snapshot.data()));
}
