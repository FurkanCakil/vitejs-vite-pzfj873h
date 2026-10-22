import { doc, onSnapshot } from 'firebase/firestore';
import { createGameApi, randomRequestId } from '../utils/gameApi.js';

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
  const sessionId = xoxSessionId();
  let stopped = false;
  let pending = false;
  const heartbeat = async () => {
    if (pending || stopped) return;
    pending = true;
    try { await api({ type: 'room.heartbeat', roomId, sessionId }); }
    catch (error) { if (!stopped) onError(error); }
    finally { pending = false; }
  };
  const disconnect = () => {
    api({ type: 'room.disconnect', roomId, sessionId }, { keepalive: true }).catch(() => {});
  };
  const unsubscribe = onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'roomsV2', roomId), snapshot => {
    if (!stopped) onData(snapshot.exists() ? snapshot.data() : null);
  }, error => { if (!stopped) onError(error); });
  heartbeat();
  const timer = setInterval(heartbeat, 15_000);
  const visible = () => { if (document.visibilityState === 'visible') heartbeat(); };
  window.addEventListener('pagehide', disconnect);
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('online', heartbeat);
  return () => {
    stopped = true; clearInterval(timer); unsubscribe();
    window.removeEventListener('pagehide', disconnect);
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('online', heartbeat);
  };
}
