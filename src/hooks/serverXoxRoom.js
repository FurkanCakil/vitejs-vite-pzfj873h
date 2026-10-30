import { doc, onSnapshot } from 'firebase/firestore';
import { createGameApi, randomRequestId } from '../utils/gameApi.js';
import { startRoomConnection } from './roomConnection.js';
import { gamePerformance } from '../utils/gamePerformance.js';

// Each page has its own lease, including tabs cloned with sessionStorage.
// Refreshing preserves the Firebase UID, never a publicly displayed player ID.
let tabId;
export function xoxSessionId() {
  if (tabId) return tabId;
  tabId = randomRequestId();
  return tabId;
}

export function xoxApi(user) {
  return createGameApi(refresh => user.getIdToken(refresh));
}

export function subscribeXoxRoom({ db, appId, user, roomId, onData, onError }) {
  const api = xoxApi(user);
  let stopped = false;
  const unsubscribe = onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'roomsV2', roomId), snapshot => {
    if (!stopped) {
      const data = snapshot.exists() ? snapshot.data() : null;
      gamePerformance.snapshot(roomId, data, user.uid, snapshot.metadata.fromCache);
      onData(data);
    }
  }, error => { if (!stopped) onError(error); });
  const stopConnection = startRoomConnection({ api, roomId, getSessionId: xoxSessionId,
    renewSessionId: () => (tabId = randomRequestId()), onError });
  return () => {
    stopped = true; stopConnection(); unsubscribe();
  };
}
