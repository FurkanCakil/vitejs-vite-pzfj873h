import { useEffect } from 'react';
import { auth } from '../firebase/config.js';
import { SERVER_PRESENCE_ENABLED } from '../utils/gameApi.js';
import { startServerPresence } from './serverPresence.js';

export default function usePresence(uid, roomCode = null) {
  useEffect(() => {
    if (!uid || !SERVER_PRESENCE_ENABLED) return undefined;
    const identity = auth.currentUser;
    if (identity?.uid !== uid) return undefined;
    return startServerPresence({ roomCode,
      getToken: refresh => identity.getIdToken(refresh),
      onError: error => console.warn('Oyuncu bağlantısı güncellenemedi:', error.code || 'connection_failed'),
    });
  }, [uid, roomCode]);
}
