// Browser lifecycle for the shared room lease; game state stays on the server.
export function startRoomConnection({ api, roomId, getSessionId, renewSessionId, onError }) {
  let current = { id: getSessionId(), pending: false, retired: false };
  let stopped = false, paused = false;
  let offline = window.navigator?.onLine === false;
  const disconnect = session => {
    api({ type: 'room.disconnect', roomId, sessionId: session.id }, { keepalive: true }).catch(() => {});
  };
  const heartbeat = async () => {
    const session = current;
    if (session.pending || stopped || paused || offline) return;
    session.pending = true;
    try { await api({ type: 'room.heartbeat', roomId, sessionId: session.id }); }
    catch (error) { if (!stopped && !session.retired && current === session && !offline) onError(error); }
    finally {
      session.pending = false;
      // A late request may have recreated the old lease after pagehide.
      // Retire only that lease; a restored document uses a different ID.
      if (session.retired) disconnect(session);
    }
  };
  const pause = () => {
    if (stopped || current.retired) return;
    paused = true; current.retired = true; disconnect(current);
  };
  const resume = () => {
    if (stopped || offline) return;
    if (paused) current = { id: current.retired ? renewSessionId() : current.id, pending: false, retired: false };
    paused = false;
    void heartbeat();
  };
  // A network flap is not a departed page. Reuse its lease so repeated mobile
  // reconnects do not consume Okey's bounded eight-tab grace period.
  const wentOffline = () => { offline = true; paused = true; };
  const wentOnline = () => { offline = false; resume(); };
  heartbeat();
  const timer = setInterval(heartbeat, 15_000);
  // Switching tabs alone is not a departure; keep the normal server grace.
  const visible = () => { if (document.visibilityState === 'visible') resume(); };
  window.addEventListener('pagehide', pause);
  window.addEventListener('pageshow', resume);
  window.addEventListener('offline', wentOffline);
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('online', wentOnline);
  return () => {
    stopped = true; clearInterval(timer);
    window.removeEventListener('pagehide', pause);
    window.removeEventListener('pageshow', resume);
    window.removeEventListener('offline', wentOffline);
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('online', wentOnline);
  };
}
