import test from 'node:test';
import assert from 'node:assert/strict';
import { europeClientOverrides, sessionApiKey } from './firebase-client-config.js';

test('rollback keeps original client settings and session API key without selector', () => {
  assert.deepEqual(europeClientOverrides({ VITE_FIREBASE_API_KEY: 'original' }), {});
  assert.equal(sessionApiKey({ VITE_FIREBASE_API_KEY: 'original' }), 'original');
});
test('Europe selection requires a complete matching client/server project', () => {
  const env = { FIREBASE_CLIENT_TARGET: 'oyun-portali-avrupa', GCP_PROJECT_ID: 'oyun-portali-avrupa' };
  for (const field of ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID']) {
    env[`EUROPE_FIREBASE_${field}`] = field === 'PROJECT_ID' ? 'oyun-portali-avrupa' : `new-${field}`;
  }
  assert.equal(europeClientOverrides(env).VITE_FIREBASE_PROJECT_ID, 'oyun-portali-avrupa');
  assert.equal(sessionApiKey({ ...env, VITE_FIREBASE_API_KEY: 'old' }), 'new-API_KEY');
  for (const patch of [{ GCP_PROJECT_ID: 'oyun-odasi-8ecee' }, { EUROPE_FIREBASE_PROJECT_ID: 'wrong' }, { EUROPE_FIREBASE_API_KEY: '' }, { FIREBASE_CLIENT_TARGET: 'wrong' }]) {
    assert.throws(() => europeClientOverrides({ ...env, ...patch }));
  }
});
