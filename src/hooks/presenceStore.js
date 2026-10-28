import { collection } from 'firebase/firestore';
import { db, appId } from '../firebase/config.js';
import { SERVER_PRESENCE_ENABLED } from '../utils/gameApi.js';
import { presenceShardSessions } from '../utils/presenceProtocol.js';
import { subscribeServerSummary } from './serverSummary.js';

const shards = collection(db, 'artifacts', appId, 'public', 'data', 'presenceV2');
export function subscribePresenceSessions(onData, onError) {
  if (!SERVER_PRESENCE_ENABLED) {
    onError?.({ code: 'server_not_enabled' });
    return () => {};
  }
  return subscribeServerSummary(shards, snap => presenceShardSessions(snap.docs.map(doc => doc.data())), onData, onError);
}
