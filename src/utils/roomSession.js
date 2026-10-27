import { normalizeRoomCode } from './roomCode.js';

// Storage can be blocked on mobile browsers. Only v2 is restorable; changing a
// local protocol marker never grants membership (the server still checks it).
export function createRoomSessionStorage(getStorage) {
  const attempt = (operation, fallback = null) => {
    try { return operation(getStorage()); } catch { return fallback; }
  };
  const storage = {
    get: () => attempt(store => store.getItem('activeRoom')),
    set: value => attempt(store => store.setItem('activeRoom', value)),
    protocol: value => attempt(store => store.setItem('activeRoomProtocol', value)),
    isServer: () => attempt(store => store.getItem('activeRoomProtocol') === 'v2', false),
    remove: () => attempt(store => { store.removeItem('activeRoom'); store.removeItem('activeRoomProtocol'); }),
    restore: enabled => {
      const code = normalizeRoomCode(storage.get());
      if (!code) { storage.remove(); return { code: null, reason: null }; }
      const reason = !storage.isServer() ? 'legacy' : !enabled ? 'unavailable' : null;
      if (reason) { storage.remove(); return { code: null, reason }; }
      return { code, reason: null };
    },
  };
  return storage;
}
