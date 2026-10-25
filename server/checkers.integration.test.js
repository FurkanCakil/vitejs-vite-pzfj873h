import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { executeRoomAction, CONNECTION_TTL } from './xox-rooms.js';
import { getValidCheckersMoves } from '../src/games/checkers/logic.js';

const projectId = 'demo-oyun-portali';
let sequence = 0;
const action = (type, fields = {}) => ({ type, actionId: `check_test_${String(++sequence).padStart(8, '0')}`, ...fields });
const sessionId = 'checkers_session_1';
const man = (color, isKing = false) => ({ type: 'man', color, isKing });
test('Checkers server lifecycle, captures and access rules', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
  const authClient = new OAuth2Client(); authClient.setCredentials({ access_token: 'owner', expiry_date: Date.now() + 3_600_000 });
  const db = new Firestore({ projectId, authClient, preferRest: true });
  const root = `artifacts/${projectId}`;
  const ref = id => db.doc(`${root}/public/data/roomsV2/${id}`);
  const load = async id => (await ref(id).get()).data();
  const now = 8_000_000;
  const run = (uid, input, time = now, code = 'DUNUSD', enabled = true) => executeRoomAction(db, projectId, uid, input, time, () => code, { checkersEnabled: enabled, connect4Enabled: true });
  const create = (uid, code, isPublic = false) => run(uid, action('checkers.create', { sessionId, nickname: uid.slice(0, 15), isPublic }), now, code);
  const join = (uid, roomId) => run(uid, action('room.join', { sessionId, nickname: uid.slice(0, 15), roomId }));
  const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
  const legal = state => state.board.flatMap((piece, from) => piece?.color === state.playerColors[state.turn]
    ? getValidCheckersMoves(state.board, from, state.multiJumpIdx).map(move => ({ from, to: move.to })) : []);
  const move = async (roomId, step) => { const state = await load(roomId); return run(state.turn, action('checkers.move', { roomId, expectedVersion: state.version, ...step })); };
  const seed = async (roomId, pieces) => {
    const state = await load(roomId), white = state.players.find(uid => state.playerColors[uid] === 'w');
    await ref(roomId).update({ board: Array.from({ length: 64 }, (_, i) => pieces[i] ?? null), turn: white, startingPlayer: white, multiJumpIdx: null });
    return white;
  };
  try {
    await t.test('disabled rollout rejects creates and joins without changing other games', async () => {
      await rejects(run('d-off', action('checkers.create', { sessionId, nickname: 'Off', isPublic: false }), now, 'DOFF12', false), 'server_not_enabled');
      assert.equal((await ref('DOFF12').get()).exists, false);
      await create('d-off', 'DOFF12');
      await rejects(run('d-off-b', action('room.join', { roomId: 'DOFF12', sessionId, nickname: 'Guest' }), now, 'DUNUSD', false), 'server_not_enabled');
      await run('d-other', action('connect4.create', { sessionId, nickname: 'Other', isPublic: false }), now, 'DOTH12', false);
      await rejects(run('d-other', action('checkers.move', { roomId: 'DOTH12', expectedVersion: 0, from: 40, to: 33 })), 'unsupported_room');
    });
    await t.test('joining preserves random host color and always starts white; cross-game actions are denied', async () => {
      await create('d-open-a', 'DOPEN1'); const hostColor = (await load('DOPEN1')).playerColors['d-open-a'];
      await join('d-open-b', 'DOPEN1'); const state = await load('DOPEN1');
      assert.equal(state.playerColors['d-open-a'], hostColor); assert.notEqual(state.playerColors['d-open-b'], hostColor);
      assert.equal(state.playerColors[state.turn], 'w'); assert.equal(state.turn, state.startingPlayer);
      assert.equal(state.board.filter(Boolean).length, 24);
      await rejects(run(state.turn, action('xox.move', { roomId: 'DOPEN1', expectedVersion: state.version, cell: 0 })), 'unsupported_room');
      await rejects(run(state.turn, action('connect4.move', { roomId: 'DOPEN1', expectedVersion: state.version, column: 0 })), 'unsupported_room');
    });
    await t.test('competing moves commit one version and spectators, wrong turns or forged state cannot play', async () => {
      await run('d-viewer', action('room.spectate', { roomId: 'DOPEN1', sessionId }));
      const before = await load('DOPEN1'), steps = legal(before), other = before.players.find(uid => uid !== before.turn);
      const request = action('checkers.move', { roomId: 'DOPEN1', expectedVersion: before.version, ...steps[0] });
      await rejects(run('d-viewer', request), 'not_a_player'); await rejects(run(other, request), 'not_your_turn');
      await rejects(run(before.turn, { ...request, scores: { [before.turn]: 999 } }), 'invalid_fields');
      const results = await Promise.allSettled(steps.slice(0, 2).map(step => run(before.turn, action('checkers.move', { roomId: 'DOPEN1', expectedVersion: before.version, ...step }))));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(results.find(result => result.status === 'rejected').reason.code, 'stale_version');
      assert.equal((await load('DOPEN1')).version, before.version + 1);
    });
    await t.test('mandatory and chained captures are server enforced; changing pieces cannot escape the chain', async () => {
      await create('d-chain-a', 'DCHN12'); await join('d-chain-b', 'DCHN12');
      const white = await seed('DCHN12', { 40: man('w'), 44: man('w'), 33: man('b'), 17: man('b'), 7: man('b') });
      let state = await load('DCHN12');
      await rejects(run(white, action('checkers.move', { roomId: 'DCHN12', expectedVersion: state.version, from: 44, to: 35 })), 'illegal_move');
      await move('DCHN12', { from: 40, to: 26 }); state = await load('DCHN12');
      assert.equal(state.turn, white); assert.equal(state.multiJumpIdx, 26); assert.equal(state.board[33], null);
      await rejects(run(white, action('checkers.move', { roomId: 'DCHN12', expectedVersion: state.version, from: 44, to: 35 })), 'illegal_move');
      await move('DCHN12', { from: 26, to: 8 }); state = await load('DCHN12');
      assert.equal(state.multiJumpIdx, null); assert.notEqual(state.turn, white); assert.equal(state.board[17], null);
    });
    await t.test('promotion continues a legal king capture and duplicate final captures score exactly once', async () => {
      await create('d-win-a', 'DWIN12'); await join('d-win-b', 'DWIN12');
      const white = await seed('DWIN12', { 17: man('w'), 10: man('b'), 12: man('b') });
      await move('DWIN12', { from: 17, to: 3 }); let state = await load('DWIN12');
      assert.equal(state.board[3].isKing, true); assert.equal(state.turn, white); assert.equal(state.multiJumpIdx, 3);
      const final = action('checkers.move', { roomId: 'DWIN12', expectedVersion: state.version, from: 3, to: 21 });
      const results = await Promise.all([run(white, final), run(white, final)]); assert.deepEqual(results[0], results[1]);
      state = await load('DWIN12'); assert.equal(state.winner, white); assert.equal(state.scores[white], 1);
      assert.equal(state.board.filter(Boolean).length, 1); assert.equal(state.multiJumpIdx, null);
      await rejects(run(white, { ...final, to: 17 }), 'action_id_reused');
    });
    await t.test('rematch needs opponent consent, keeps scores, swaps colors and clears chain', async () => {
      const state = await load('DWIN12'), white = state.winner, other = state.players.find(uid => uid !== white);
      await run(white, action('checkers.rematch.request', { roomId: 'DWIN12', expectedVersion: state.version }));
      let next = await load('DWIN12');
      await rejects(run(white, action('checkers.rematch.accept', { roomId: 'DWIN12', expectedVersion: next.version })), 'invalid_rematch');
      await run(other, action('checkers.rematch.accept', { roomId: 'DWIN12', expectedVersion: next.version })); next = await load('DWIN12');
      assert.equal(next.turn, other); assert.equal(next.playerColors[other], 'w'); assert.equal(next.playerColors[white], 'b');
      assert.equal(next.scores[white], 1); assert.equal(next.multiJumpIdx, null); assert.equal(next.board.filter(Boolean).length, 24);
    });
    await t.test('matchmaking is atomic, isolated by game and excludes stale hosts', async () => {
      const results = await Promise.all(['d-match-a', 'd-match-b'].map((uid, i) => run(uid, action('checkers.match', { sessionId, nickname: uid }), now, `DMAT${i}1`)));
      assert.equal(results[0].roomId, results[1].roomId); assert.equal((await load(results[0].roomId)).players.length, 2);
      await create('d-stale', 'DSTL12', true);
      const fresh = await run('d-fresh', action('checkers.match', { sessionId, nickname: 'Fresh' }), now + CONNECTION_TTL + 1, 'DFRE12');
      assert.equal(fresh.roomId, 'DFRE12');
    });
    await t.test('multiple tabs and leave/wait preserve exact color, chain and board for a returning UID pair', async () => {
      await seed('DCHN12', { 40: man('w'), 44: man('w'), 33: man('b'), 17: man('b'), 7: man('b') });
      await move('DCHN12', { from: 40, to: 26 });
      const before = await load('DCHN12'), leaver = before.turn, host = before.players.find(uid => uid !== leaver);
      assert.equal(before.multiJumpIdx, 26);
      await run(leaver, action('room.heartbeat', { roomId: 'DCHN12', sessionId: 'checkers_session_2' }));
      await run(leaver, action('room.disconnect', { roomId: 'DCHN12', sessionId: 'checkers_session_2' }));
      assert.equal((await load('DCHN12')).status, 'playing');
      await run(leaver, action('room.leave', { roomId: 'DCHN12', sessionId }));
      await run(host, action('room.wait', { roomId: 'DCHN12', expectedVersion: (await load('DCHN12')).version }));
      await join('d-replacement', 'DCHN12'); assert.equal((await load('DCHN12')).board.filter(Boolean).length, 24);
      await run('d-replacement', action('room.leave', { roomId: 'DCHN12', sessionId }));
      await run(host, action('room.wait', { roomId: 'DCHN12', expectedVersion: (await load('DCHN12')).version }));
      await join(leaver, 'DCHN12'); const after = await load('DCHN12');
      for (const key of ['board', 'multiJumpIdx', 'playerColors', 'turn', 'scores']) assert.deepEqual(after[key], before[key]);
    });
    await t.test('real Auth permits only room members and read-only queue access, denying direct scores and private records', async () => {
      const signup = async () => (await (await fetch('http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })).json());
      const [a, b] = await Promise.all([signup(), signup()]); await create(a.localId, 'DAUTH1');
      const url = `http://127.0.0.1:8180/v1/projects/${projectId}/databases/(default)/documents/${root}`;
      const headers = { Authorization: `Bearer ${a.idToken}`, 'Content-Type': 'application/json' }, room = `${url}/public/data/roomsV2/DAUTH1`;
      assert.equal((await fetch(room, { headers })).status, 200);
      assert.equal((await fetch(room, { headers: { Authorization: `Bearer ${b.idToken}` } })).status, 403);
      assert.equal((await fetch(room)).status, 403);
      assert.equal((await fetch(room, { method: 'PATCH', headers, body: JSON.stringify({ fields: {} }) })).status, 403);
      for (const path of ['public/data/roomsV2', 'serverRoomActors', 'serverRoomPresence']) assert.equal((await fetch(`${url}/${path}`, { headers })).status, 403);
      assert.equal((await fetch(`${url}/public/data/checkersLobby/queue`, { headers })).status, 200);
      assert.equal((await fetch(`${url}/public/data/checkersLobby/queue`)).status, 403);
      assert.equal((await fetch(`${url}/public/data/checkersLobby/queue`, { method: 'PATCH', headers, body: JSON.stringify({ fields: {} }) })).status, 403);
    });
  } finally { await db.terminate(); }
});
