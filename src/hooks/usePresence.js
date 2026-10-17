import { useEffect } from 'react';
import { doc, runTransaction, setDoc, deleteField, serverTimestamp } from 'firebase/firestore';
import { db, auth, appId } from '../firebase/config.js';
import { HEARTBEAT_MS, sessionTime } from '../utils/presence.js';
export { countActiveSessions } from '../utils/presence.js';

export const presenceCounterRef = doc(db, 'artifacts', appId, 'public', 'data', 'serverStatus', 'info');
const PRUNE_MS = 10 * 60_000;

export default function usePresence(uid, playerId, roomCode) {
  useEffect(() => {
    if (!uid) return undefined;
    let current = null;
    let disposed = false;

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
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(presenceCounterRef);
          if (session.stopped) return;
          const patch = {};
          for (const [id, value] of Object.entries(snap.data()?.sessions || {})) {
            const time = sessionTime(value);
            if (!Number.isFinite(time) || Date.now() - time > PRUNE_MS) patch[id] = deleteField();
          }
          patch[session.id] = { uid, playerId, roomCode: roomCode || null, lastSeen: serverTimestamp() };
          // merge:true retains omitted keys, so stale entries need explicit deletes.
          transaction.set(presenceCounterRef, { sessions: patch, activeUsers: deleteField() }, { merge: true });
        });
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
        current = { id: `${uid}_${crypto.randomUUID()}`, stopped: false, writing: false, token: null };
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
