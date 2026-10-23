import { createGameApi, randomRequestId } from '../utils/gameApi.js';
import { HEARTBEAT_MS, estimatePresenceClock } from '../utils/presenceProtocol.js';

// Only the lifecycle is local. UID, room membership, time and public counts are
// derived by the existing authenticated server, never by these request fields.
export function startServerPresence({ getToken, roomCode, onError, api = createGameApi(getToken) }) {
  let disposed = false, current;
  const retire = session => api({ type: 'presence.leave', sessionId: session.id }, { keepalive: true }).catch(() => {});
  const beat = async () => {
    const session = current;
    if (!session || session.stopped || session.writing) return;
    session.writing = true;
    const sentAt = Date.now();
    try {
      const result = await api({ type: 'presence.heartbeat', sessionId: session.id, roomCode: roomCode || null });
      if (!session.stopped && !disposed) {
        estimatePresenceClock(result.serverNow, sentAt);
        if (result.retired) { session.stopped = true; resume(); }
      }
    } catch (error) { if (!session.stopped && !disposed) onError(error); }
    finally {
      session.writing = false;
      // A slow heartbeat must not bring a closed page/session back online.
      if (session.stopped) void retire(session);
    }
  };
  const leave = () => {
    if (current && !current.stopped) { current.stopped = true; void retire(current); }
  };
  const resume = () => {
    if (disposed) return;
    if (!current || current.stopped) current = { id: randomRequestId(), stopped: false, writing: false };
    void beat();
  };
  const visible = () => { if (document.visibilityState === 'visible') resume(); };
  resume();
  const timer = setInterval(beat, HEARTBEAT_MS);
  window.addEventListener('pagehide', leave);
  window.addEventListener('pageshow', resume);
  window.addEventListener('offline', leave);
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', visible);
  return () => {
    disposed = true; clearInterval(timer); leave();
    window.removeEventListener('pagehide', leave);
    window.removeEventListener('pageshow', resume);
    window.removeEventListener('offline', leave);
    window.removeEventListener('online', resume);
    document.removeEventListener('visibilitychange', visible);
  };
}
