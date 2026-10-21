import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { applyRoomAction } from './room-actions.js';

const projectId = 'demo-oyun-portali';
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const authEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const baseRoom = () => ({
  schemaVersion: 2, version: 0, gameType: 'xox', status: 'playing',
  players: ['alice', 'bob'], turn: 'alice', board: Array(9).fill(null),
  winner: null, scores: { alice: 0, bob: 0 },
});
const move = (roomId, patch = {}) => ({
  roomId, actionId: 'request_00000001', expectedVersion: 0, type: 'xox.move', cell: 0, ...patch,
});

test('Firestore emulator: atomic actions and target security rules', { skip: !emulator || !authEmulator }, async t => {
  // This suite must never discover ambient credentials or reach a live project.
  assert.equal(emulator, '127.0.0.1:8180');
  assert.equal(authEmulator, '127.0.0.1:9199');
  // The REST transport still requests credentials in emulator mode. Use the
  // emulator's documented owner token explicitly, never local ADC discovery.
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: 'owner', expiry_date: Date.now() + 3_600_000 });
  const db = new Firestore({ projectId, authClient, preferRest: true });
  const ref = id => db.doc(`artifacts/${projectId}/public/data/roomsV2/${id}`);
  const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
  try {
    await t.test('two simultaneous identical winning moves add exactly one point', async () => {
      await ref('WIN123').set({ ...baseRoom(), board: ['X', 'X', null, 'O', 'O', null, null, null, null] });
      const action = move('WIN123', { cell: 2 });
      const results = await Promise.all([
        applyRoomAction(db, projectId, 'alice', action),
        applyRoomAction(db, projectId, 'alice', action),
      ]);
      assert.deepEqual(results[0], results[1]);
      const saved = (await ref('WIN123').get()).data();
      assert.equal(saved.version, 1);
      assert.equal(saved.scores.alice, 1);
      assert.equal(saved.winner, 'X');
    });
    await t.test('competing different actions cannot both update the same version', async () => {
      await ref('RACE12').set(baseRoom());
      const results = await Promise.allSettled([
        applyRoomAction(db, projectId, 'alice', move('RACE12')),
        applyRoomAction(db, projectId, 'alice', move('RACE12', { actionId: 'request_00000002', cell: 4 })),
      ]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(results.find(result => result.status === 'rejected').reason.code, 'stale_version');
      assert.equal((await ref('RACE12').get()).data().board.filter(Boolean).length, 1);
    });
    await t.test('spectators, fake scores, stale actions and reused IDs cannot mutate state', async () => {
      await ref('SAFE12').set(baseRoom());
      await rejects(applyRoomAction(db, projectId, 'mallory', move('SAFE12')), 'not_a_player');
      await rejects(applyRoomAction(db, projectId, 'alice', { ...move('SAFE12'), scores: { alice: 999 } }), 'invalid_fields');
      await applyRoomAction(db, projectId, 'alice', move('SAFE12'));
      await rejects(applyRoomAction(db, projectId, 'alice', move('SAFE12', { cell: 1 })), 'action_id_reused');
      await rejects(applyRoomAction(db, projectId, 'bob', move('SAFE12', { cell: 4 })), 'stale_version');
      assert.equal((await ref('SAFE12').get()).data().version, 1);
    });
    await t.test('rate limit applies atomically without modifying the room', async () => {
      await ref('RATE12').set(baseRoom());
      const rateRef = db.doc(`artifacts/${projectId}/serverRateLimits/alice`);
      await rateRef.set({ windowStart: 1000, count: 30 });
      await rejects(applyRoomAction(db, projectId, 'alice', move('RATE12'), 1001), 'too_many_actions');
      assert.equal((await ref('RATE12').get()).data().version, 0);
      await applyRoomAction(db, projectId, 'alice', move('RATE12'), 11_001);
      assert.equal((await rateRef.get()).data().count, 1);
    });
    await t.test('client rules deny forged scores, receipt access, room listing and anonymous reads', async () => {
      const signup = await fetch(`http://${authEmulator}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
      });
      assert.equal(signup.status, 200);
      const { idToken } = await signup.json();
      const headers = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };
      const api = `http://${emulator}/v1/projects/${projectId}/databases/(default)/documents`;
      const path = `artifacts/${projectId}/public/data/roomsV2/SAFE12`;
      assert.equal((await fetch(`${api}/${path}`, { headers })).status, 200);
      assert.equal((await fetch(`${api}/${path}`)).status, 403);
      const forged = await fetch(`${api}/${path}?updateMask.fieldPaths=scores`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ fields: { scores: { mapValue: { fields: { alice: { integerValue: '999' } } } } } }),
      });
      assert.equal(forged.status, 403);
      assert.equal((await fetch(`${api}/artifacts/${projectId}/roomActionReceipts/SAFE12/actors/alice`, { headers })).status, 403);
      assert.equal((await fetch(`${api}/artifacts/${projectId}/public/data/roomsV2`, { headers })).status, 403);
      assert.equal((await ref('SAFE12').get()).data().scores.alice, 0);
    });
  } finally {
    await db.terminate();
  }
});
