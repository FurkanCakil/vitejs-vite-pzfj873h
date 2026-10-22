import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { executeRoomAction } from './xox-rooms.js';
import { publicOkeyState, privateOkeyView } from './games/okey.js';
import { createTileSet } from '../src/games/okey101/tiles.js';

let sequence = 0;
const sessionId = 'okey_test_session_01';
const request = (type, fields = {}) => ({ type, actionId: `okey_test_${String(++sequence).padStart(12, '0')}`, ...fields });
test('Okey room lifecycle, atomic play and private hands', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
  const projectId = 'demo-oyun-portali', root = `artifacts/${projectId}`;
  const authClient = new OAuth2Client(); authClient.setCredentials({ access_token: 'owner', expiry_date: Date.now() + 3_600_000 });
  const db = new Firestore({ projectId, authClient, preferRest: true });
  const pub = id => db.doc(`${root}/public/data/roomsV2/${id}`), secret = id => db.doc(`${root}/serverOkeyRooms/${id}`);
  const own = (id, uid) => pub(id).collection('playerData').doc(uid);
  const load = async id => (await secret(id).get()).data();
  let clock = 10_000_000;
  const run = (uid, input, code = 'UNUSED', enabled = true) => executeRoomAction(db, projectId, uid, input, clock, () => code, { okeyEnabled: enabled });
  const command = async (uid, id, type, fields = {}) => {
    const state = await load(id);
    return run(uid, request(type, { roomId: id,
      ...(['okey.rules', 'okey.team', 'okey.bots', 'okey.start', 'okey.distribute', 'okey.tick', 'okey.seat.resolve', 'room.wait'].includes(type) ? { expectedVersion: state.version } : {}),
      ...(['okey.layout', 'okey.draw', 'okey.discard', 'okey.cancel', 'okey.open', 'okey.tack', 'okey.tick', 'okey.newRound'].includes(type) ? { roundId: state.roundId } : {}),
      ...(['okey.draw', 'okey.discard', 'okey.cancel', 'okey.open', 'okey.tack'].includes(type) ? { turnNumber: state.turnNumber, expectedPlayVersion: state.playVersion } : {}), ...fields }));
  };
  const create = (uid, code, isPublic = false) => run(uid, request('okey.create', { nickname: uid.slice(0, 15), sessionId, isPublic }), code);
  const join = (uid, id) => run(uid, request('room.join', { roomId: id, nickname: uid.slice(0, 15), sessionId }));
  const heartbeat = (uid, id) => run(uid, request('room.heartbeat', { roomId: id, sessionId }));
  const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
  const hidden = data => {
    for (const field of ['racks', 'groups', 'drawPile', '_history', 'takenOkeys']) assert.equal(Object.hasOwn(data, field), false, field);
  };
  const fillStart = async (host, id) => {
    await command(host, id, 'okey.bots'); clock += 3200;
    await command(host, id, 'okey.start');
  };
  async function fixture(id, uid, hand) {
    const state = await load(id), tiles = createTileSet();
    state.indicator = tiles.find(tile => tile.color === 'yellow' && tile.number === 12);
    state.okey = { color: 'yellow', number: 13 };
    const reserved = new Set([state.indicator.id, ...hand.map(tile => tile.id)]);
    const pool = tiles.filter(tile => !reserved.has(tile.id));
    state.racks = Object.fromEntries(state.players.map(id => {
      const held = id === uid ? hand : pool.splice(0, 21);
      return [id, [...held, ...Array(30 - held.length).fill(null)]];
    }));
    state.groups = Object.fromEntries(state.players.map(id => [id, {}]));
    state.drawPile = pool; state.setupPhase = false; state.setupEndsAt = null;
    state.turn = uid; state.turnDeadline = clock + 45_000; state.sideTake = null;
    state.hasDrawnThisTurn = true; state.hasOpened[uid] = false;
    for (const id of state.players) state.handVersions[id] = (state.handVersions[id] ?? 0) + 1;
    await db.runTransaction(async tx => {
      tx.set(secret(id), state); tx.set(pub(id), publicOkeyState(state));
      for (const uid of state.players.filter(uid => !state.isBotPlayer[uid])) tx.set(own(id, uid), { ...privateOkeyView(state, uid), handVersion: state.handVersions[uid] });
    });
    return state;
  }
  try {
    await t.test('closed rollout cannot create or join an Okey room', async () => {
      await rejects(run('ok-off', request('okey.create', { sessionId, nickname: 'Off', isPublic: false }), 'OKOF12', false), 'server_not_enabled');
      assert.equal((await pub('OKOF12').get()).exists, false);
      await create('ok-off', 'OKOF12');
      await rejects(run('ok-guest', request('room.join', { roomId: 'OKOF12', sessionId, nickname: 'Guest' }), 'UNUSED', false), 'server_not_enabled');
    });
    await t.test('four concurrent seats are bounded, late join becomes a spectator and countdown is server timed', async () => {
      await create('ok-host', 'OKFO12');
      await Promise.all(['ok-b', 'ok-c', 'ok-d'].map(uid => join(uid, 'OKFO12')));
      let state = await load('OKFO12'); assert.equal(state.players.length, 4); assert.equal(state.status, 'waiting');
      await rejects(join('ok-extra', 'OKFO12'), 'room_full');
      await run('ok-extra', request('room.spectate', { roomId: 'OKFO12', sessionId }));
      await rejects(command('ok-host', 'OKFO12', 'okey.start'), 'too_early');
      clock += 3200; await command('ok-b', 'OKFO12', 'okey.start');
      state = await load('OKFO12'); assert.equal(state.status, 'playing'); assert.equal(state.drawPile.length, 20);
      hidden((await pub('OKFO12').get()).data());
      assert.equal((await own('OKFO12', 'ok-b').get()).data().rack.filter(Boolean).length, state.turn === 'ok-b' ? 22 : 21);
      await rejects(command('ok-extra', 'OKFO12', 'okey.tick'), 'not_a_player');
      await rejects(run('ok-b', request('xox.move', { roomId: 'OKFO12', expectedVersion: state.version, cell: 0 })), 'unsupported_room');
    });
    await t.test('team changes require host/self permission and two seats per team', async () => {
      await create('team-a', 'OKTM12'); await join('team-b', 'OKTM12'); await join('team-c', 'OKTM12');
      const rules = { gameType: '2v2', assistedEnabled: false, foldingEnabled: true, foldToPartnerEnabled: false };
      await rejects(command('team-b', 'OKTM12', 'okey.rules', { rules }), 'host_required');
      await command('team-a', 'OKTM12', 'okey.rules', { rules });
      await command('team-a', 'OKTM12', 'okey.team', { targetUid: 'team-a', team: 'A' });
      await command('team-b', 'OKTM12', 'okey.team', { targetUid: 'team-b', team: 'A' });
      await rejects(command('team-c', 'OKTM12', 'okey.team', { targetUid: 'team-c', team: 'A' }), 'team_full');
      await rejects(command('team-b', 'OKTM12', 'okey.team', { targetUid: 'team-c', team: 'B' }), 'invalid_team');
      await command('team-a', 'OKTM12', 'okey.bots');
      const state = await load('OKTM12'); assert.equal(state.teams.A.length, 2); assert.equal(state.teams.B.length, 2);
      clock += 3200; await command('team-a', 'OKTM12', 'okey.start');
      assert.deepEqual((await load('OKTM12')).players.slice(0, 4), [state.teams.A[0], state.teams.B[0], state.teams.A[1], state.teams.B[1]]);
    });
    await t.test('a repeated draw and penalized opening are applied only once, with coherent own views', async () => {
      clock += 100_000; await create('draw-a', 'OKDR12'); await fillStart('draw-a', 'OKDR12');
      const tiles = createTileSet(); let state = await fixture('OKDR12', 'draw-a', [tiles[0], tiles[2], tiles[4], tiles[28]]);
      const input = request('okey.open', { roomId: 'OKDR12', roundId: state.roundId, turnNumber: state.turnNumber, expectedPlayVersion: state.playVersion, mode: 'series', melds: [['T0', 'T2', 'T4']] });
      const results = await Promise.all([run('draw-a', input), run('draw-a', input)]);
      assert.deepEqual(results[0], results[1]); assert.equal((await load('OKDR12')).scores['draw-a'], -101);
      for (let i = 0; i < 33; i++) { clock += 600; await heartbeat('draw-a', 'OKDR12'); }
      await rejects(run('draw-a', input), 'stale_version');
      assert.equal((await load('OKDR12')).scores['draw-a'], -101);
      state = await fixture('OKDR12', 'draw-a', [tiles[0]]); state.hasDrawnThisTurn = false;
      await secret('OKDR12').set(state);
      const draw = request('okey.draw', { roomId: 'OKDR12', roundId: state.roundId, turnNumber: state.turnNumber, expectedPlayVersion: state.playVersion, source: 'pile', targetIndex: 29 });
      await Promise.all([run('draw-a', draw), run('draw-a', draw)]);
      const saved = await load('OKDR12'), view = (await own('OKDR12', 'draw-a').get()).data();
      assert.equal(saved.racks['draw-a'].filter(Boolean).length, 2); assert.equal(saved.drawPile.length, state.drawPile.length - 1);
      assert.equal(view.handVersion, (await pub('OKDR12').get()).data().handVersions['draw-a']);
      await rejects(command('draw-a', 'OKDR12', 'okey.draw', { source: 'pile', targetIndex: null }), 'already_drawn');
      await rejects(command('draw-a', 'OKDR12', 'okey.discard', { tileId: saved.drawPile[0].id }), 'tile_not_owned');
    });
    await t.test('concurrent timer drivers execute one bot turn or timeout, and cannot advance early', async () => {
      clock += 100_000; await create('tick-a', 'OKTK12'); await fillStart('tick-a', 'OKTK12');
      let state = await load('OKTK12'); clock = state.setupEndsAt;
      await command('tick-a', 'OKTK12', 'okey.tick');
      state = await load('OKTK12'); clock = state.isBotPlayer[state.turn] ? state.botReadyAt : state.turnDeadline + 2000;
      await heartbeat('tick-a', 'OKTK12');
      const fields = { roomId: 'OKTK12', roundId: state.roundId, expectedVersion: state.version };
      const outcomes = await Promise.allSettled([run('tick-a', request('okey.tick', fields)), run('tick-a', request('okey.tick', fields))]);
      assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
      assert.equal((await load('OKTK12')).turnNumber, state.turnNumber + 1);
      await rejects(command('tick-a', 'OKTK12', 'okey.tick'), 'too_early');
    });
    await t.test('bot seat requests require the host decision and project only the adopted own hand', async () => {
      clock += 100_000; await create('seat-host', 'OKST12'); await fillStart('seat-host', 'OKST12');
      await run('seat-viewer', request('room.spectate', { roomId: 'OKST12', sessionId }));
      const state = await load('OKST12'), botUid = state.players.find(uid => state.isBotPlayer[uid]);
      await run('seat-viewer', request('okey.seat.request', { roomId: 'OKST12', botUid, nickname: 'Viewer' }));
      await rejects(command('seat-viewer', 'OKST12', 'okey.seat.resolve', { requesterUid: 'seat-viewer', accept: true }), 'host_required');
      await command('seat-host', 'OKST12', 'okey.seat.resolve', { requesterUid: 'seat-viewer', accept: true });
      const saved = await load('OKST12'); assert.ok(saved.players.includes('seat-viewer')); assert.ok(!saved.players.includes(botUid));
      assert.deepEqual(saved.racks['seat-viewer'], state.racks[botUid]);
      assert.deepEqual((await own('OKST12', 'seat-viewer').get()).data().rack, state.racks[botUid]);
      hidden((await pub('OKST12').get()).data());
    });
    await t.test('leave and wait archive private hands by UID lineup and replacement gets a new deal', async () => {
      clock += 100_000; await create('life-a', 'OKLF12'); await join('life-b', 'OKLF12'); await fillStart('life-a', 'OKLF12');
      const original = await load('OKLF12');
      await run('life-b', request('room.leave', { roomId: 'OKLF12', sessionId }));
      await command('life-a', 'OKLF12', 'room.wait');
      assert.equal((await load('OKLF12')).racks, undefined);
      await join('life-b', 'OKLF12');
      let restored = await load('OKLF12'); assert.equal(restored.roundId, original.roundId); assert.deepEqual(restored.racks, original.racks);
      await run('life-b', request('room.leave', { roomId: 'OKLF12', sessionId })); await command('life-a', 'OKLF12', 'room.wait');
      await join('life-c', 'OKLF12'); clock += 3200; await command('life-a', 'OKLF12', 'okey.start');
      restored = await load('OKLF12'); assert.notEqual(restored.roundId, original.roundId); assert.equal(restored.racks['life-b'], undefined);
      hidden((await pub('OKLF12').get()).data());
    });
    await t.test('simultaneous quick matches use four seats in one queue and stale hosts expire', async () => {
      clock += 100_000;
      const match = uid => run(uid, request('okey.match', { sessionId, nickname: uid }), 'OKMQ12');
      const results = await Promise.all(['qm-a', 'qm-b', 'qm-c', 'qm-d'].map(match));
      assert.ok(results.every(result => result.roomId === 'OKMQ12')); assert.equal((await load('OKMQ12')).players.length, 4);
      await create('stale-a', 'OKSL12', true); clock += 60_001;
      assert.equal((await run('fresh-a', request('okey.match', { sessionId, nickname: 'Fresh' }), 'OKNW12')).roomId, 'OKNW12');
    });
    await t.test('a finishing discard awards once and the next round clears old hands with a new ID', async () => {
      clock += 100_000; await create('end-a', 'OKEN12'); await fillStart('end-a', 'OKEN12');
      let state = await fixture('OKEN12', 'end-a', [createTileSet()[0]]);
      state.hasOpened['end-a'] = true; state.openedBeforeCurrentTurn = false;
      await secret('OKEN12').set(state);
      const last = request('okey.discard', { roomId: 'OKEN12', roundId: state.roundId, turnNumber: state.turnNumber, expectedPlayVersion: state.playVersion, tileId: 'T0' });
      const results = await Promise.all([run('end-a', last), run('end-a', last)]);
      assert.deepEqual(results[0], results[1]);
      let saved = await load('OKEN12'); assert.equal(saved.scores['end-a'], 101); assert.equal(saved.roundEnded, true);
      assert.equal((await own('OKEN12', 'end-a').get()).data().rack.filter(Boolean).length, 0);
      const oldRoundId = saved.roundId, oldStarter = saved.starterUid;
      await command('end-a', 'OKEN12', 'okey.newRound'); saved = await load('OKEN12');
      assert.notEqual(saved.roundId, oldRoundId); assert.equal(saved.scores['end-a'], 101);
      assert.equal(saved.roundEnded, false); assert.equal(saved.turn, saved.players[(saved.players.indexOf(oldStarter) + 1) % 4]);
      assert.equal((await own('OKEN12', 'end-a').get()).data().roundId, saved.roundId);
      await rejects(run('end-a', request('okey.layout', { roomId: 'OKEN12', roundId: oldRoundId, rack: Array(30).fill(null), groups: {} })), 'stale_round');
      hidden((await pub('OKEN12').get()).data());
    });
    await t.test('a complete server-driven round with three bots finishes with stable private/public views', async () => {
      clock += 100_000; await create('full-a', 'OKFL12');
      await command('full-a', 'OKFL12', 'okey.rules', { rules: { gameType: 'ffa', assistedEnabled: true, foldingEnabled: true, foldToPartnerEnabled: false } });
      await fillStart('full-a', 'OKFL12');
      let state = await load('OKFL12');
      for (let step = 0; step < 100 && !state.roundEnded; step++) {
        clock = state.isBotPlayer[state.turn] ? state.botReadyAt : state.turnDeadline + 2000;
        await heartbeat('full-a', 'OKFL12');
        await command('full-a', 'OKFL12', 'okey.tick');
        state = await load('OKFL12');
        const published = (await pub('OKFL12').get()).data(), view = (await own('OKFL12', 'full-a').get()).data();
        hidden(published); assert.equal(published.handVersions['full-a'], view.handVersion);
        assert.deepEqual(view.rack, state.racks['full-a']);
      }
      assert.equal(state.roundEnded, true);
    });
    await t.test('real anonymous tokens can read only their own rack and cannot list/write/read the deck', async () => {
      clock += 100_000;
      const signIn = async () => (await fetch('http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
      })).json();
      const a = await signIn(), b = await signIn(), c = await signIn();
      await create(a.localId, 'OKAU12'); await join(b.localId, 'OKAU12'); await fillStart(a.localId, 'OKAU12');
      await run(c.localId, request('room.spectate', { roomId: 'OKAU12', sessionId }));
      const api = `http://127.0.0.1:8180/v1/projects/${projectId}/databases/(default)/documents/${root}`;
      const path = 'public/data/roomsV2/OKAU12', headers = token => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
      assert.equal((await fetch(`${api}/${path}/playerData/${a.localId}`, { headers: headers(a.idToken) })).status, 200);
      for (const token of [b.idToken, c.idToken]) assert.equal((await fetch(`${api}/${path}/playerData/${a.localId}`, { headers: headers(token) })).status, 403);
      for (const blocked of [`${path}/playerData`, 'serverOkeyRooms/OKAU12']) assert.equal((await fetch(`${api}/${blocked}`, { headers: headers(a.idToken) })).status, 403);
      assert.equal((await fetch(`${api}/${path}`, { method: 'PATCH', headers: headers(a.idToken), body: '{"fields":{}}' })).status, 403);
      assert.equal((await fetch(`${api}/${path}/playerData/${a.localId}`, { method: 'PATCH', headers: headers(a.idToken), body: '{"fields":{}}' })).status, 403);
      assert.equal((await fetch(`${api}/public/data/okeyLobby/queue`, { headers: headers(c.idToken) })).status, 200);
      assert.equal((await fetch(`${api}/public/data/okeyLobby/queue`)).status, 403);
    });
  } finally { await db.terminate(); }
});
