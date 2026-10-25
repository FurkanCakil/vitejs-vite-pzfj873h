import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { executeRoomAction, CONNECTION_TTL } from './xox-rooms.js';

const projectId = 'demo-oyun-portali';
let sequence = 0;
const action = (type, fields = {}) => ({ type, actionId: `connect_test_${String(++sequence).padStart(8, '0')}`, ...fields });
const sessionId = 'connect_session_1';
test('Connect 4 server lifecycle and access rules', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
  const authClient = new OAuth2Client(); authClient.setCredentials({ access_token: 'owner', expiry_date: Date.now() + 3_600_000 });
  const db = new Firestore({ projectId, authClient, preferRest: true });
  const root = `artifacts/${projectId}`;
  const ref = id => db.doc(`${root}/public/data/roomsV2/${id}`);
  const load = async id => (await ref(id).get()).data();
  const now = 7_000_000;
  const run = (uid, input, time = now, code = 'CUNUSD', enabled = true) => executeRoomAction(db, projectId, uid, input, time, () => code, { connect4Enabled: enabled });
  const create = (uid, code, isPublic = false) => run(uid, action('connect4.create', { sessionId, nickname: uid.slice(0, 15), isPublic }), now, code);
  const join = (uid, roomId) => run(uid, action('room.join', { sessionId, nickname: uid.slice(0, 15), roomId }));
  const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
  const move = async (id, column) => { const state = await load(id); return run(state.turn, action('connect4.move', { roomId: id, column, expectedVersion: state.version })); };
  try {
    await t.test('disabled rollout rejects creation and existing-room actions; game prefixes cannot cross', async () => {
      await rejects(run('cf-off', action('connect4.create', { sessionId, nickname: 'Off', isPublic: false }), now, 'CFOFF1', false), 'server_not_enabled');
      assert.equal((await ref('CFOFF1').get()).exists, false);
      await create('cf-off', 'CFOFF1');
      await rejects(run('cf-guest', action('room.join', { roomId: 'CFOFF1', sessionId, nickname: 'Guest' }), now, 'CUNUSD', false), 'server_not_enabled');
      await join('cf-guest', 'CFOFF1');
      await rejects(run('cf-off', action('xox.move', { roomId: 'CFOFF1', expectedVersion: 1, cell: 0 })), 'unsupported_room');
      await run('cf-xox', action('room.create', { sessionId, nickname: 'XOX', isPublic: false }), now, 'CFXOX1');
      await rejects(run('cf-xox', action('connect4.move', { roomId: 'CFXOX1', expectedVersion: 0, column: 0 })), 'unsupported_room');
    });
    await t.test('duplicate winning request commits one disc and one point', async () => {
      await create('cf-win-a', 'CFWIN1'); await join('cf-win-b', 'CFWIN1');
      for (const col of [0, 6, 1, 6, 2, 5]) await move('CFWIN1', col);
      const before = await load('CFWIN1');
      const request = action('connect4.move', { roomId: 'CFWIN1', expectedVersion: before.version, column: 3 });
      const result = await Promise.all([run('cf-win-a', request), run('cf-win-a', request)]);
      assert.deepEqual(result[0], result[1]);
      const saved = await load('CFWIN1'); assert.equal(saved.version, before.version + 1);
      assert.equal(saved.board.filter(Boolean).length, 7); assert.equal(saved.winner, 'red'); assert.equal(saved.scores['cf-win-a'], 1);
      await rejects(run('cf-win-a', { ...request, column: 4 }), 'action_id_reused');
    });
    await t.test('competing actions cannot replace each other at the same version', async () => {
      await create('cf-race-a', 'CFRAC1'); await join('cf-race-b', 'CFRAC1');
      const before = await load('CFRAC1');
      const results = await Promise.allSettled([0, 1].map(column => run('cf-race-a', action('connect4.move', { roomId: 'CFRAC1', expectedVersion: before.version, column }))));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(results.find(r => r.status === 'rejected').reason.code, 'stale_version');
      assert.equal((await load('CFRAC1')).board.filter(Boolean).length, 1);
    });
    await t.test('spectators, wrong turns and forged fields cannot mutate a room', async () => {
      await run('cf-viewer', action('room.spectate', { roomId: 'CFRAC1', sessionId }));
      const before = await load('CFRAC1');
      const request = action('connect4.move', { roomId: 'CFRAC1', expectedVersion: before.version, column: 2 });
      await rejects(run('cf-viewer', request), 'not_a_player');
      await rejects(run('cf-race-a', request), 'not_your_turn');
      await rejects(run('cf-race-b', { ...request, scores: { 'cf-race-b': 99 } }), 'invalid_fields');
      await rejects(run('cf-race-b', { ...request, column: 7 }), 'invalid_column');
      assert.deepEqual(await load('CFRAC1'), before);
    });
    await t.test('full column rejects the seventh disc and preserves turn/version', async () => {
      await create('cf-full-a', 'CFFUL1'); await join('cf-full-b', 'CFFUL1');
      for (let i = 0; i < 6; i++) await move('CFFUL1', 2);
      const before = await load('CFFUL1');
      await rejects(move('CFFUL1', 2), 'column_full'); assert.deepEqual(await load('CFFUL1'), before);
    });
    await t.test('rematch requires opponent consent, preserves scores and clears last move', async () => {
      let state = await load('CFWIN1');
      await run('cf-win-a', action('connect4.rematch.request', { roomId: 'CFWIN1', expectedVersion: state.version }));
      state = await load('CFWIN1');
      await rejects(run('cf-win-a', action('connect4.rematch.accept', { roomId: 'CFWIN1', expectedVersion: state.version })), 'invalid_rematch');
      await run('cf-win-b', action('connect4.rematch.accept', { roomId: 'CFWIN1', expectedVersion: state.version }));
      state = await load('CFWIN1'); assert.equal(state.turn, 'cf-win-b'); assert.equal(state.startingPlayer, 'cf-win-b');
      assert.equal(state.board.filter(Boolean).length, 0); assert.equal(state.lastMove, null); assert.equal(state.scores['cf-win-a'], 1);
      await rejects(run('cf-win-a', action('connect4.rematch.request', { roomId: 'CFWIN1', expectedVersion: state.version })), 'game_not_finished');
    });
    await t.test('simultaneous matchmaking pairs users once and expires stale host leases', async () => {
      const results = await Promise.all(['cf-match-a', 'cf-match-b'].map((uid, i) => run(uid, action('connect4.match', { sessionId, nickname: uid }), now, `CFMAT${i}`)));
      assert.equal(results[0].roomId, results[1].roomId);
      assert.equal((await load(results[0].roomId)).players.length, 2);
      await create('cf-stale', 'CFSTL1', true);
      const next = await run('cf-fresh', action('connect4.match', { sessionId, nickname: 'Fresh' }), now + CONNECTION_TTL + 1, 'CFFRE1');
      assert.equal(next.roomId, 'CFFRE1');
      const queue = (await db.doc(`${root}/public/data/connect4Lobby/queue`).get()).data().entries;
      assert.equal(queue.some(entry => entry.roomId === 'CFSTL1'), false);
    });
    await t.test('multiple tabs, leave/wait and same-player return preserve exact board and last move', async () => {
      await create('cf-return-a', 'CFRET1'); await join('cf-return-b', 'CFRET1'); await move('CFRET1', 4);
      await run('cf-return-b', action('room.heartbeat', { roomId: 'CFRET1', sessionId: 'connect_session_2' }));
      await run('cf-return-b', action('room.disconnect', { roomId: 'CFRET1', sessionId: 'connect_session_2' }));
      const before = await load('CFRET1'); assert.equal(before.status, 'playing');
      await run('cf-return-b', action('room.leave', { roomId: 'CFRET1', sessionId }));
      let state = await load('CFRET1'); assert.equal(state.abandonReason, 'left');
      await rejects(run('cf-return-b', action('connect4.move', { roomId: 'CFRET1', expectedVersion: state.version, column: 2 })), 'player_disconnected');
      await run('cf-return-a', action('room.wait', { roomId: 'CFRET1', expectedVersion: state.version }));
      await join('cf-replacement', 'CFRET1'); assert.equal((await load('CFRET1')).lastMove, null);
      await run('cf-replacement', action('room.leave', { roomId: 'CFRET1', sessionId }));
      state = await load('CFRET1');
      await run('cf-return-a', action('room.wait', { roomId: 'CFRET1', expectedVersion: state.version }));
      await join('cf-return-b', 'CFRET1'); state = await load('CFRET1');
      assert.deepEqual(state.board, before.board); assert.deepEqual(state.lastMove, before.lastMove); assert.equal(state.turn, before.turn);
      await run('cf-return-b', action('room.leave', { roomId: 'CFRET1', sessionId }));
      await run('cf-return-a', action('room.close', { roomId: 'CFRET1', expectedVersion: (await load('CFRET1')).version }));
      assert.equal((await load('CFRET1')).status, 'closed');
    });
    await t.test('real Auth can read own room and queue, but cannot forge scores, list rooms or read private state', async () => {
      const signup = async () => (await (await fetch('http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })).json());
      const [a, b] = await Promise.all([signup(), signup()]);
      await create(a.localId, 'CFAUT1');
      const api = `http://127.0.0.1:8180/v1/projects/${projectId}/databases/(default)/documents/${root}`;
      const path = 'public/data/roomsV2/CFAUT1';
      const headers = { Authorization: `Bearer ${a.idToken}`, 'Content-Type': 'application/json' };
      assert.equal((await fetch(`${api}/${path}`, { headers })).status, 200);
      assert.equal((await fetch(`${api}/${path}`, { headers: { Authorization: `Bearer ${b.idToken}` } })).status, 403);
      assert.equal((await fetch(`${api}/${path}`)).status, 403);
      assert.equal((await fetch(`${api}/${path}`, { method: 'PATCH', headers, body: JSON.stringify({ fields: {} }) })).status, 403);
      for (const collection of ['public/data/roomsV2', 'serverRoomActors', 'serverRoomPresence']) assert.equal((await fetch(`${api}/${collection}`, { headers })).status, 403);
      assert.equal((await fetch(`${api}/public/data/connect4Lobby/queue`, { headers })).status, 200);
      assert.equal((await fetch(`${api}/public/data/connect4Lobby/queue`)).status, 403);
      assert.equal((await fetch(`${api}/public/data/connect4Lobby/queue`, { method: 'PATCH', headers, body: JSON.stringify({ fields: {} }) })).status, 403);
    });
  } finally { await db.terminate(); }
});
