import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { executeRoomAction, CONNECTION_TTL } from './xox-rooms.js';
import { validateFleet } from './games/battleship.js';

const projectId = 'demo-oyun-portali';
const fleet = () => ['carrier', 'cruiser', 'submarine', 'destroyer', 'patrol']
  .map((id, i) => ({ id, row: i * 2, col: 0, orientation: 'H' }));
let sequence = 0;
const request = (type, fields = {}) => ({ type, actionId: `battle_test_${String(++sequence).padStart(8, '0')}`, ...fields });
const sessionId = 'battle_session_1';

test('Battleship server lifecycle and fleet privacy', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: 'owner', expiry_date: Date.now() + 3_600_000 });
  const db = new Firestore({ projectId, authClient, preferRest: true });
  const root = `artifacts/${projectId}`;
  const ref = id => db.doc(`${root}/public/data/roomsV2/${id}`);
  const own = (id, uid) => ref(id).collection('playerData').doc(uid);
  const secret = id => db.doc(`${root}/serverBattleFleets/${id}`);
  const now = 5_000_000;
  const run = (uid, input, time = now, code = 'BTST12', enabled = true) => executeRoomAction(db, projectId, uid, input, time, () => code, { battleshipEnabled: enabled });
  const create = (uid, code, isPublic = false) => run(uid, request('battleship.create', { nickname: uid.slice(0, 15), sessionId, isPublic }), now, code);
  const join = (uid, roomId) => run(uid, request('room.join', { roomId, nickname: uid.slice(0, 15), sessionId }));
  const ready = async (uid, roomId, roundId) => run(uid, request('battleship.ready', { roomId, roundId, fleet: fleet() }));
  const load = async id => (await ref(id).get()).data();
  const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
  const noFleets = data => {
    assert.equal(Object.hasOwn(data, 'ships'), false);
    assert.deepEqual(data.revealedShips, {});
    assert.equal(JSON.stringify(data.history).includes('"cells"'), false);
    assert.equal(JSON.stringify(data).includes('"carrier"'), false);
  };
  try {
    await t.test('disabled rollout rejects create and existing-room actions without changing XOX', async () => {
      const input = request('battleship.create', { nickname: 'Disabled', sessionId, isPublic: false });
      await rejects(run('off', input, now, 'BOFF12', false), 'server_not_enabled');
      assert.equal((await ref('BOFF12').get()).exists, false);
      await create('off-host', 'BOFF12');
      await rejects(run('off-guest', request('room.join', { roomId: 'BOFF12', sessionId, nickname: 'Guest' }), now, 'UNUSED', false), 'server_not_enabled');
      assert.equal((await load('BOFF12')).players.length, 1);
    });
    await t.test('concurrent ready starts once and public data never includes an unfinished fleet', async () => {
      await create('ready-host', 'BRDY12'); await join('ready-guest', 'BRDY12');
      const state = await load('BRDY12');
      await Promise.all([ready('ready-host', 'BRDY12', state.roundId), ready('ready-guest', 'BRDY12', state.roundId)]);
      const saved = await load('BRDY12');
      assert.equal(saved.setupPhase, false); assert.equal(saved.turn, 'ready-host');
      assert.equal(saved.version, state.version + 2); noFleets(saved);
      assert.equal((await own('BRDY12', 'ready-host').get()).data().ships.length, 5);
      await rejects(run('ready-host', request('battleship.cancel', { roomId: 'BRDY12', roundId: state.roundId })), 'setup_locked');
      await rejects(run('ready-host', request('xox.move', { roomId: 'BRDY12', expectedVersion: saved.version, cell: 0 })), 'unsupported_room');
    });
    await t.test('ready cancellation keeps own placement, rejects invalid/replayed round fleets and never changes opponent state', async () => {
      await create('cancel-host', 'BCAN12'); await join('cancel-guest', 'BCAN12');
      const state = await load('BCAN12');
      const invalid = fleet(); invalid[0].row = 2;
      await rejects(run('cancel-host', request('battleship.ready', { roomId: 'BCAN12', roundId: state.roundId, fleet: invalid })), 'invalid_fleet');
      await ready('cancel-host', 'BCAN12', state.roundId);
      await rejects(ready('cancel-host', 'BCAN12', state.roundId), 'setup_locked');
      await run('cancel-host', request('battleship.cancel', { roomId: 'BCAN12', roundId: state.roundId }));
      assert.equal((await load('BCAN12')).readyPlayers['cancel-host'], false);
      assert.equal((await own('BCAN12', 'cancel-host').get()).data().ships.length, 5);
      assert.deepEqual((await own('BCAN12', 'cancel-guest').get()).data().ships, []);
      await rejects(ready('cancel-host', 'BCAN12', 'f'.repeat(24)), 'stale_round');
      noFleets(await load('BCAN12'));
    });
    await t.test('duplicate/competing shots do not repeat points, preserve hit turns and reject spectators', async () => {
      let state = await load('BRDY12');
      await run('battle-viewer', request('room.spectate', { roomId: 'BRDY12', sessionId }));
      state = await load('BRDY12');
      await rejects(run('battle-viewer', request('battleship.shot', { roomId: 'BRDY12', expectedVersion: state.version, row: 0, col: 0 })), 'not_a_player');
      const shot = request('battleship.shot', { roomId: 'BRDY12', expectedVersion: state.version, row: 0, col: 0 });
      const results = await Promise.all([run('ready-host', shot), run('ready-host', shot)]);
      assert.deepEqual(results[0], results[1]); assert.equal(results[0].hit, true);
      state = await load('BRDY12'); assert.equal(state.shots['ready-host'].length, 1); assert.equal(state.turn, 'ready-host');
      await rejects(run('ready-host', request('battleship.shot', { roomId: 'BRDY12', expectedVersion: state.version, row: 0, col: 0 })), 'already_shot');
      const finalCells = validateFleet(fleet()).flatMap(ship => ship.cells).slice(1);
      for (const [index, cell] of finalCells.entries()) {
        const next = request('battleship.shot', { roomId: 'BRDY12', expectedVersion: state.version, ...cell });
        await Promise.all(index === finalCells.length - 1 ? [run('ready-host', next), run('ready-host', next)] : [run('ready-host', next)]);
        state = await load('BRDY12');
        if (!state.winner) noFleets(state);
      }
      assert.equal(state.winner, 'ready-host'); assert.equal(state.scores['ready-host'], 1);
      assert.equal(state.revealedShips['ready-guest'].length, 5);
      await create('race-host', 'BRCE12'); await join('race-guest', 'BRCE12');
      const raceRound = (await load('BRCE12')).roundId;
      await ready('race-host', 'BRCE12', raceRound); await ready('race-guest', 'BRCE12', raceRound);
      const raceVersion = (await load('BRCE12')).version;
      const competing = await Promise.allSettled([0, 1].map(col => run('race-host', request('battleship.shot', {
        roomId: 'BRCE12', expectedVersion: raceVersion, row: 0, col,
      }))));
      assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(competing.find(result => result.status === 'rejected').reason.code, 'stale_version');
      assert.equal((await load('BRCE12')).shots['race-host'].length, 1);
    });
    await t.test('rematch requires opponent consent, alternates starter and clears private/public old fleet views', async () => {
      let state = await load('BRDY12'); const oldRound = state.roundId;
      await run('ready-host', request('battleship.rematch.request', { roomId: 'BRDY12', expectedVersion: state.version }));
      state = await load('BRDY12');
      await rejects(run('ready-host', request('battleship.rematch.accept', { roomId: 'BRDY12', expectedVersion: state.version })), 'invalid_rematch');
      await run('ready-guest', request('battleship.rematch.accept', { roomId: 'BRDY12', expectedVersion: state.version }));
      state = await load('BRDY12'); assert.notEqual(state.roundId, oldRound); assert.equal(state.setupPhase, true);
      assert.equal(state.scores['ready-host'], 1); noFleets(state);
      assert.deepEqual((await own('BRDY12', 'ready-host').get()).data(), { roundId: state.roundId, ships: [] });
      await rejects(ready('ready-host', 'BRDY12', oldRound), 'stale_round');
      await ready('ready-host', 'BRDY12', state.roundId); await ready('ready-guest', 'BRDY12', state.roundId);
      assert.equal((await load('BRDY12')).turn, 'ready-guest');
    });
    await t.test('leave/wait/new pair cannot see old fleets, while the same UID pair restores private state', async () => {
      const state = await load('BRDY12'), roundId = state.roundId;
      await run('ready-guest', request('room.leave', { roomId: 'BRDY12', sessionId }));
      await run('ready-host', request('room.wait', { roomId: 'BRDY12', expectedVersion: (await load('BRDY12')).version }));
      noFleets(await load('BRDY12'));
      await join('replacement', 'BRDY12');
      const replacementRound = (await load('BRDY12')).roundId;
      assert.notEqual(replacementRound, roundId);
      assert.deepEqual((await own('BRDY12', 'replacement').get()).data().ships, []);
      assert.deepEqual((await own('BRDY12', 'ready-host').get()).data().ships, []);
      await run('replacement', request('room.leave', { roomId: 'BRDY12', sessionId }));
      await run('ready-host', request('room.wait', { roomId: 'BRDY12', expectedVersion: (await load('BRDY12')).version }));
      await join('ready-guest', 'BRDY12');
      assert.equal((await load('BRDY12')).roundId, roundId);
      assert.equal((await own('BRDY12', 'ready-guest').get()).data().ships.length, 5);
      assert.equal((await secret('BRDY12').get()).data().history.length, 2); noFleets(await load('BRDY12'));
    });
    await t.test('game-specific queues never match XOX and Battleship together and stale hosts expire', async () => {
      const match = uid => run(uid, request('battleship.match', { nickname: uid, sessionId }), now, uid === 'battle-m1' ? 'BMAT12' : 'BMAT34');
      const pair = await Promise.all([match('battle-m1'), match('battle-m2')]);
      assert.equal(pair[0].roomId, pair[1].roomId);
      await create('stale-battle', 'BSTA12', true);
      const xox = await run('xox-match', request('room.match', { nickname: 'XOX', sessionId }), now, 'BXOX12');
      assert.equal((await load(xox.roomId)).gameType, 'xox');
      const fresh = await run('battle-m3', request('battleship.match', { nickname: 'Fresh', sessionId }), now + CONNECTION_TTL + 1, 'BNEW12');
      assert.equal(fresh.roomId, 'BNEW12'); assert.equal((await load(fresh.roomId)).gameType, 'amiralbatti');
    });
    await t.test('real Auth rules allow own fleet only; opponent, spectator, listing and server history reads are denied', async () => {
      const signIn = async () => {
        const response = await fetch('http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
        return response.json();
      };
      const a = await signIn(), b = await signIn(), c = await signIn();
      await create(a.localId, 'BAUT12'); await join(b.localId, 'BAUT12');
      await ready(a.localId, 'BAUT12', (await load('BAUT12')).roundId);
      await run(c.localId, request('room.spectate', { roomId: 'BAUT12', sessionId }));
      const api = `http://127.0.0.1:8180/v1/projects/${projectId}/databases/(default)/documents/${root}`;
      const path = 'public/data/roomsV2/BAUT12';
      const headers = token => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
      assert.equal((await fetch(`${api}/${path}/playerData/${a.localId}`, { headers: headers(a.idToken) })).status, 200);
      for (const actor of [b, c]) assert.equal((await fetch(`${api}/${path}/playerData/${a.localId}`, { headers: headers(actor.idToken) })).status, 403);
      for (const blocked of [`${path}/playerData`, 'serverBattleFleets/BAUT12']) assert.equal((await fetch(`${api}/${blocked}`, { headers: headers(a.idToken) })).status, 403);
      assert.equal((await fetch(`${api}/${path}/playerData/${a.localId}`, { method: 'PATCH', headers: headers(a.idToken), body: JSON.stringify({ fields: {} }) })).status, 403);
      assert.equal((await fetch(`${api}/public/data/battleshipLobby/queue`, { headers: headers(c.idToken) })).status, 200);
      assert.equal((await fetch(`${api}/public/data/battleshipLobby/queue`)).status, 403);
      await run(b.localId, request('room.leave', { roomId: 'BAUT12', sessionId }));
      await run(a.localId, request('room.wait', { roomId: 'BAUT12', expectedVersion: (await load('BAUT12')).version }));
      assert.equal((await fetch(`${api}/${path}/playerData/${b.localId}`, { headers: headers(b.idToken) })).status, 403);
    });
  } finally { await db.terminate(); }
});
