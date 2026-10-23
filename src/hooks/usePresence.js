import { useEffect } from 'react';
import { getDoc, runTransaction, setDoc, deleteField, serverTimestamp } from 'firebase/firestore';
import { db, auth, appId } from '../firebase/config.js';
import { HEARTBEAT_MS, sessionTime } from '../utils/presence.js';
import { SERVER_PRESENCE_ENABLED } from '../utils/gameApi.js';
import { presenceCounterRef } from './presenceStore.js';
import { startServerPresence } from './serverPresence.js';
export { countActiveSessions } from '../utils/presence.js';

const PRUNE_MS = 10 * 60_000;

export default function usePresence(uid, playerId, roomCode) {
  useEffect(() => {
    if (!uid) return undefined;
    if (SERVER_PRESENCE_ENABLED) {
      const identity = auth.currentUser;
      if (identity?.uid !== uid) return undefined;
      return startServerPresence({ roomCode,
        getToken: refresh => identity.getIdToken(refresh),
        onError: error => console.warn('Oyuncu bağlantısı güncellenemedi:', error.code || 'connection_failed'),
      });
    }
    let current = null;
    let disposed = false;
    let nextPruneAt = 0;
    const expired = (value) => !Number.isFinite(sessionTime(value)) || Date.now() - sessionTime(value) > PRUNE_MS;
    const prune = async () => {
      if (Date.now() < nextPruneAt) return;
      nextPruneAt = Date.now() + 5 * 60_000;
      const snapshot = await getDoc(presenceCounterRef);
      if (!Object.values(snapshot.data()?.sessions || {}).some(expired)) return;
      await runTransaction(db, async (t) => {
        const latest = await t.get(presenceCounterRef);
        const stale = Object.fromEntries(Object.entries(latest.data()?.sessions || {})
          .filter(([, value]) => expired(value)).map(([id]) => [id, deleteField()]));
        if (Object.keys(stale).length) t.set(presenceCounterRef, { sessions: stale }, { merge: true });
      });
    };

    const remove = (session) => {
      if (session.token) {
        const field = encodeURIComponent('sessions.`' + session.id + '`');
        const url = `https://firestore.googleapis.com/v1/projects/${appId}/databases/(default)/documents/artifacts/${appId}/public/data/serverStatus/info?updateMask.fieldPaths=${field}`;
        return fetch(url, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
          body: '{}', keepalive: true,
        }).catch(() => {});
      }
      return setDoc(presenceCounterRef, { sessions: { [session.id]: deleteField() } }, { merge: true }).catch(() => {});
    };

    const beat = async () => {
      const session = current;
      if (!session || session.stopped || session.writing) return;
      session.writing = true;
      try {
        session.token = await auth.currentUser?.getIdToken();
        if (session.stopped) return;
        // Each heartbeat touches only its own entry: no read/compare retry
        // when another player updates the shared document at the same time.
        await setDoc(presenceCounterRef, { sessions: {
          [session.id]: { uid, playerId, roomCode: roomCode || null, lastSeen: serverTimestamp() },
        }, activeUsers: deleteField() }, { merge: true });
        if (!disposed && !session.stopped) void prune().catch(() => {});
      } catch (error) {
        if (!session.stopped) console.warn('Oyuncu bağlantısı güncellenemedi:', error.code || error.message);
      } finally {
        session.writing = false;
        // An in-flight write can finish after cleanup; remove that session again.
        if (session.stopped) void remove(session);
      }
    };

    const leave = () => {
      if (!current || current.stopped) return;
      current.stopped = true;
      void remove(current);
    };
    const resume = () => {
      if (disposed) return;
      if (!current || current.stopped) {
        const suffix = crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
        current = { id: `${uid}_${suffix}`, stopped: false, writing: false, token: null };
      }
      void beat();
    };
    const visible = () => { if (document.visibilityState === 'visible') resume(); };
    resume();
    const interval = setInterval(beat, HEARTBEAT_MS);
    window.addEventListener('beforeunload', leave);
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', resume);
    window.addEventListener('offline', leave);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true;
      clearInterval(interval);
      window.removeEventListener('beforeunload', leave);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('offline', leave);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', visible);
      leave();
    };
  }, [uid, playerId, roomCode]);
}
