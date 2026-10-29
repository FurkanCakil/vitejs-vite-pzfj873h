import test from 'node:test';
import assert from 'node:assert/strict';
import { resetSavedRoom } from './savedRoomRecovery.js';

test('room recovery preserves identity, preferences and other saved data', () => {
  const session = new Map([['activeRoom', 'stale-room'], ['other-tab-state', 'keep']]);
  const local = new Map([['activeRoom', 'legacy-room'], ['nickname', 'Oyuncu'], ['soundVolume', '0.3']]);
  let reloads = 0, identityAccesses = 0;
  const browser = {
    sessionStorage: { removeItem: key => session.delete(key) },
    localStorage: { removeItem: key => local.delete(key) },
    // Any access can endanger another tab's active anonymous session.
    get indexedDB() { identityAccesses += 1; throw new Error('identity database must not be touched'); },
    location: { reload() { reloads += 1; } },
  };
  resetSavedRoom(browser);
  assert.deepEqual([...session], [['other-tab-state', 'keep']]);
  assert.deepEqual([...local], [['nickname', 'Oyuncu'], ['soundVolume', '0.3']]);
  assert.equal(reloads, 1);
  assert.equal(identityAccesses, 0);
});

test('blocked storage access or removal cannot prevent the recovery reload', () => {
  for (const blocked of ['sessionStorage', 'localStorage']) {
    for (const phase of ['access', 'remove']) {
      let reloads = 0, identityAccesses = 0;
      const removed = [];
      const browser = {
        location: { reload() { reloads += 1; } },
        get indexedDB() { identityAccesses += 1; throw new Error('identity database must not be touched'); },
      };
      for (const name of ['sessionStorage', 'localStorage']) {
        Object.defineProperty(browser, name, { get() {
          if (name === blocked && phase === 'access') throw new Error('SecurityError');
          return { removeItem(key) {
            if (name === blocked && phase === 'remove') throw new Error('QuotaExceededError');
            removed.push([name, key]);
          } };
        } });
      }
      resetSavedRoom(browser);
      assert.equal(reloads, 1);
      assert.equal(identityAccesses, 0);
      assert.deepEqual(removed, [[blocked === 'sessionStorage' ? 'localStorage' : 'sessionStorage', 'activeRoom']]);
    }
  }
});
