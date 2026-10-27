import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomSessionStorage } from './roomSession.js';

const fixture = (code, protocol) => {
  const values = new Map([['activeRoom', code], ['activeRoomProtocol', protocol]]);
  return { values, storage: createRoomSessionStorage(() => ({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) })) };
};
test('room refresh restores only a normalized v2 session and keeps its stored code', () => {
  const { values, storage } = fixture(' abc123 ', 'v2');
  assert.deepEqual(storage.restore(true), { code: 'ABC123', reason: null }); assert.equal(values.size, 2);
  storage.set('NEW123'); storage.protocol('v2'); assert.equal(storage.get(), 'NEW123'); assert.equal(storage.isServer(), true);
});
test('legacy and unknown protocol sessions are retired instead of read or upgraded', () => {
  for (const protocol of [null, '', 'v1', 'unknown']) {
    const { values, storage } = fixture('OLD123', protocol);
    assert.deepEqual(storage.restore(true), { code: null, reason: 'legacy' }); assert.equal(values.size, 0);
  }
});
test('malformed stored codes and a disabled server environment cannot enter a room', () => {
  for (const code of ['rooms/OLD123', '../OLD123', 'ABC', 'ABC123/secret']) {
    const { values, storage } = fixture(code, 'v2'); assert.equal(storage.restore(true).code, null); assert.equal(values.size, 0);
  }
  const { values, storage } = fixture('NEW123', 'v2');
  assert.deepEqual(storage.restore(false), { code: null, reason: 'unavailable' }); assert.equal(values.size, 0);
});
test('blocked browser storage never crashes login, room entry, exit or restoration', () => {
  const storage = createRoomSessionStorage(() => { throw new Error('Storage blocked'); });
  assert.equal(storage.get(), null); assert.equal(storage.isServer(), false);
  assert.doesNotThrow(() => { storage.set('NEW123'); storage.protocol('v2'); storage.remove(); });
  assert.deepEqual(storage.restore(true), { code: null, reason: null });
});
