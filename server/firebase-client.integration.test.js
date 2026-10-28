import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, onSnapshot, terminate, disableNetwork, enableNetwork } from 'firebase/firestore';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { subscribeServerSummary, queueEntries } from '../src/hooks/serverSummary.js';

// The browser bundle does not include undici or gRPC. These tests exercise the
// Node SDK paths whose pinned dependencies need narrowly scoped overrides.
test('Firebase client Node transports retain authentication, snapshots and rule enforcement', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST,
}, async t => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
  const projectId = 'demo-oyun-portali';
  const app = initializeApp({ apiKey: 'emulator-only', projectId }, 'dependency-client-test');
  const auth = getAuth(app), client = getFirestore(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true });
  connectFirestoreEmulator(client, '127.0.0.1', 8180);
  const credential = new OAuth2Client();
  credential.setCredentials({ access_token: 'owner', expiry_date: Date.now() + 3_600_000 });
  const server = new Firestore({ projectId, authClient: credential, preferRest: true });
  const path = `artifacts/${projectId}/public/data/roomsV2/SDK123`;
  let uid;
  try {
    await t.test('anonymous sign-in and forced token refresh preserve the authenticated UID', async () => {
      const result = await signInAnonymously(auth);
      uid = result.user.uid;
      assert.ok(uid);
      const claims = JSON.parse(Buffer.from((await result.user.getIdToken(true)).split('.')[1], 'base64url'));
      assert.equal(claims.sub, uid);
      assert.equal(auth.currentUser.uid, uid);
    });
    await t.test('gRPC reads/listens receive member state while outsider, legacy and direct writes are denied', async () => {
      const ref = doc(client, path);
      await server.doc(path).set({ schemaVersion: 2, version: 0, players: [uid], spectators: [] });
      assert.equal((await getDoc(ref)).data().version, 0);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { unsubscribe(); reject(new Error('SDK snapshot timeout')); }, 10_000);
        const unsubscribe = onSnapshot(ref, snap => {
          if (snap.data()?.version !== 1) return;
          clearTimeout(timer); unsubscribe(); resolve();
        }, error => { clearTimeout(timer); unsubscribe(); reject(error); });
        server.doc(path).update({ version: 1 }).catch(error => { clearTimeout(timer); unsubscribe(); reject(error); });
      });
      await assert.rejects(setDoc(ref, { version: 999 }), error => error.code === 'permission-denied');
      await assert.rejects(getDoc(doc(client, `artifacts/${projectId}/public/data/rooms/SDKOLD`)), error => error.code === 'permission-denied');
      await server.doc(path).update({ players: ['another-player'] });
      await assert.rejects(getDoc(ref), error => error.code === 'permission-denied');
      assert.equal((await server.doc(path).get()).data().version, 1);
    });
    await t.test('summary cache is unknown until metadata confirms the server, including unchanged data and reconnect', async () => {
      // An isolated artifact keeps this seeded queue separate from real game
      // matchmaking fixtures in the same combined emulator run.
      const summaryPath = 'artifacts/sdk-summary-read/public/data/xoxLobby/queue';
      const ref = doc(client, summaryPath), saved = [{ host: 'sdk-summary-host', updatedAt: 1000 }];
      await server.doc(summaryPath).set({ entries: saved });
      assert.deepEqual((await getDoc(ref)).data().entries, saved);
      await disableNetwork(client);
      let unsubscribe = () => {}, waiter;
      const observe = (predicate, action) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiter = null; reject(new Error('summary confirmation timeout')); }, 10_000);
        waiter = { predicate, done: value => { clearTimeout(timer); waiter = null; resolve(value); },
          fail: error => { clearTimeout(timer); waiter = null; reject(error); } };
        Promise.resolve().then(action).catch(error => waiter?.fail(error));
      });
      try {
        await observe(value => value === null, () => {
          unsubscribe = subscribeServerSummary(ref, queueEntries, value => {
            if (waiter?.predicate(value)) waiter.done(value);
          }, error => waiter?.fail(error));
        });
        assert.deepEqual(await observe(value => Array.isArray(value), () => enableNetwork(client)), saved,
          'unchanged cached data needs the metadata-only server confirmation');
        await observe(value => value === null, () => disableNetwork(client));
        await server.doc(summaryPath).set({ entries: [] });
        assert.deepEqual(await observe(value => Array.isArray(value), () => enableNetwork(client)), []);
      } finally { unsubscribe(); await disableNetwork(client); }
    });
  } finally {
    await terminate(client); await deleteApp(app); await server.terminate();
  }
});
