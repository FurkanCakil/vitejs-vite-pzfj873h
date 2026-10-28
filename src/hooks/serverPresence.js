import { createGameApi, randomRequestId } from '../utils/gameApi.js';
import { HEARTBEAT_MS } from '../utils/presenceProtocol.js';
import { beginServerTiming, updateServerClock } from '../utils/serverClock.js';

// Only the lifecycle is local. UID, room membership, time and public counts are
// derived by the existing authenticated server, never by these request fields.
export function startServerPresence({ getToken, roomCode, onError, api = createGameApi(getToken) }) {
  let disposed = false, parked = false, offline = window.navigator?.onLine === false, current;
  const newSession = id => ({ id: id || randomRequestId(), retired: false, writing: false });
  const retire = session => api({ type: 'presence.leave', sessionId: session.id }, { keepalive: true }).catch(() => {});
  const beat = async () => {
    const session = current;
    if (!session || session.retired || session.writing || disposed || parked || offline) return;
    session.writing = true;
    const timing = beginServerTiming();
    try {
      const result = await api({ type: 'presence.heartbeat', sessionId: session.id, roomCode: roomCode || null });
      if (!session.retired && !disposed && !parked && !offline && current === session) {
        updateServerClock(result.serverNow, timing);
        if (result.retired) { current = undefined; resume(); }
      }
    } catch (error) { if (!session.retired && !disposed && !parked && !offline && current === session) onError(error); }
    finally {
      session.writing = false;
      // A slow heartbeat must not bring a closed page/session back online.
      if (session.retired) void retire(session);
    }
  };
  const leave = () => {
    parked = true;
    if (current && !current.retired) { current.retired = true; void retire(current); }
  };
  const resume = () => {
    if (disposed || parked || offline) return;
    if (!current || current.retired) current = newSession();
    void beat();
  };
  // Network loss is not a departed page. Preserve the bounded server session;
  // a fresh local request holder lets recovery bypass an old pending fetch.
  const wentOffline = () => { offline = true; };
  const wentOnline = () => {
    if (disposed) return;
    if (offline && current && !current.retired) current = newSession(current.id);
    offline = false; resume();
  };
  const shown = () => { parked = false; resume(); };
  const visible = () => { if (document.visibilityState === 'visible') resume(); };
  resume();
  const timer = setInterval(beat, HEARTBEAT_MS);
  window.addEventListener('pagehide', leave);
  window.addEventListener('pageshow', shown);
  window.addEventListener('offline', wentOffline);
  window.addEventListener('online', wentOnline);
  document.addEventListener('visibilitychange', visible);
  return () => {
    disposed = true; clearInterval(timer); leave();
    window.removeEventListener('pagehide', leave);
    window.removeEventListener('pageshow', shown);
    window.removeEventListener('offline', wentOffline);
    window.removeEventListener('online', wentOnline);
    document.removeEventListener('visibilitychange', visible);
  };
}
