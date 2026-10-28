import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { executePresenceAction, presenceShardId } from './presence.js';
import { presenceShardSessions, FRESH_MS } from '../src/utils/presenceProtocol.js';
import { countActiveSessions, waitingPlayers } from '../src/utils/presence.js';
import { startServerPresence } from '../src/hooks/serverPresence.js';

let sequence = 0;
test('verified presence, concurrent tabs and read-only public summaries', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
  const project = 'demo-oyun-portali', root = `artifacts/${project}`;
  const authClient = new OAuth2Client(); authClient.setCredentials({ access_token: 'owner', expiry_date: Date.now() + 3_600_000 });
  const db = new Firestore({ projectId: project, authClient, preferRest: true });
  let clock = 100_000_000;
  const action = (type, fields = {}) => ({ type, actionId: `presence_action_${String(++sequence).padStart(12, '0')}`, sessionId: 'presence_session_0001', ...fields });
  const run = (uid, input, enabled = true) => executePresenceAction(db, project, uid, input, clock, { enabled });
  const beat = (uid, roomCode = null, sessionId = 'presence_session_0001') => run(uid, action('presence.heartbeat', { sessionId, roomCode }));
  const leave = (uid, sessionId = 'presence_session_0001') => run(uid, action('presence.leave', { sessionId }));
  const pub = uid => db.doc(`${root}/public/data/presenceV2/${presenceShardId(uid)}`);
  const secret = uid => db.doc(`${root}/serverPresence/${presenceShardId(uid)}`);
  const member = async uid => (await pub(uid).get()).data()?.members?.[uid];
  const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
  const collision = (uid, prefix) => {
    for (let n = 0; ; n++) { const candidate = prefix + n; if (presenceShardId(candidate) === presenceShardId(uid)) return candidate; }
  };
  try {
    await t.test('off flag rejects with no presence documents; request identity/time/count cannot be supplied', async () => {
      await rejects(run('presence-off', action('presence.heartbeat', { roomCode: null }), false), 'server_not_enabled');
      assert.equal((await member('presence-off')), undefined);
      for (const field of ['uid', 'playerId', 'lastSeen', 'count', 'shard']) await rejects(run('presence-forge', action('presence.heartbeat', { roomCode: null, [field]: 123 })), 'invalid_fields');
    });
    await t.test('simultaneous duplicate beats and two tabs count one UID; closing one does not remove another', async () => {
      clock += 200_000; const uid = 'presence-tabs';
      const input = action('presence.heartbeat', { roomCode: null });
      const responses = await Promise.all([run(uid, input), run(uid, input)]); assert.deepEqual(responses[0], responses[1]);
      await beat(uid, null, 'presence_session_0002');
      let summary = (await pub(uid).get()).data();
      assert.equal(countActiveSessions(presenceShardSessions([summary]), clock), 1);
      assert.deepEqual(await member(uid), { lastSeen: clock, rooms: {} });
      assert.equal(JSON.stringify(summary).includes('presence_session'), false);
      assert.equal(JSON.stringify(summary).includes('recent'), false);
      await leave(uid); assert.ok(await member(uid));
      await leave(uid, 'presence_session_0002'); assert.equal(await member(uid), undefined);
      await beat('presence-other', null, 'presence_session_0001'); assert.ok(await member('presence-other'));
      assert.equal(await member(uid), undefined); // Session IDs cannot retire another UID.
    });
    await t.test('only actual public waiting-room members advertise a room; private/playing/malformed rooms are hidden', async () => {
      clock += 200_000; const host = 'presence-room-host', visitor = 'presence-room-other';
      const ref = db.doc(`${root}/public/data/roomsV2/PRWAIT`);
      const room = { schemaVersion: 2, gameId: 'tavla', isPublic: true, status: 'waiting', host, players: [host] };
      await ref.set(room); await beat(host, 'PRWAIT'); await beat(visitor, 'PRWAIT');
      assert.deepEqual((await member(host)).rooms, { PRWAIT: clock }); assert.deepEqual((await member(visitor)).rooms, {});
      const sessions = presenceShardSessions([(await pub(host).get()).data()]);
      assert.deepEqual(waitingPlayers(room, 'PRWAIT', sessions, visitor, clock), [host]);
      for (const patch of [{ isPublic: false }, { status: 'playing' }, { players: host }]) {
        await ref.set({ ...room, ...patch }); await beat(host, 'PRWAIT'); assert.deepEqual((await member(host)).rooms, {});
      }
      await db.doc(`${root}/public/data/roomsV2/PRV2AA`).set({ ...room, gameId: 'xox' });
      await beat(host, 'PRV2AA'); assert.deepEqual((await member(host)).rooms, { PRV2AA: clock });
    });
    await t.test('old room membership no longer advertises a retired room through the counter', async () => {
      clock += 200_000; const uid = 'presence-retired-room';
      await db.doc(`${root}/public/data/rooms/PROLD1`).set({ gameId: 'okey101', isPublic: true, status: 'waiting', host: uid, players: [uid], racks: { [uid]: ['old-private-tile'] } });
      await beat(uid, 'PROLD1');
      assert.deepEqual((await member(uid)).rooms, {});
      assert.equal(countActiveSessions(presenceShardSessions([(await pub(uid).get()).data()]), clock), 1);
    });
    await t.test('a live lobby tab does not keep a closed room tab or its ghost opponent alive', async () => {
      clock += 200_000; const uid = 'presence-room-expiry';
      await db.doc(`${root}/public/data/roomsV2/PRLIVE`).set({ schemaVersion: 2, gameId: 'tavla', isPublic: true, status: 'waiting', host: uid, players: [uid] });
      await beat(uid, 'PRLIVE', 'presence_session_room');
      clock += 40_000; await beat(uid, null, 'presence_session_lobby');
      clock += 40_000; await beat(uid, null, 'presence_session_lobby');
      assert.ok(await member(uid)); assert.deepEqual((await member(uid)).rooms, {});
      const sessions = presenceShardSessions([(await pub(uid).get()).data()]);
      assert.equal(countActiveSessions(sessions, clock), 1);
      assert.equal(countActiveSessions(sessions, clock + FRESH_MS), 0);
      const other = collision(uid, 'presence-pruner-'); clock += FRESH_MS; await beat(other);
      assert.equal(await member(uid), undefined);
    });
    await t.test('leave arriving before an in-flight beat creates a tombstone; old actions cannot resurrect it', async () => {
      clock += 200_000; const uid = 'presence-race';
      const oldBeat = action('presence.heartbeat', { roomCode: null });
      await leave(uid); const result = await run(uid, oldBeat); assert.equal(result.retired, true); assert.equal(await member(uid), undefined);
      for (let n = 0; n < 9; n++) { clock += 1000; await beat(uid, null, 'presence_session_live'); }
      await run(uid, oldBeat);
      const saved = (await secret(uid).get()).data().members[uid];
      assert.equal(saved.sessions.presence_session_0001.closed, true);
      assert.equal(Object.values(saved.sessions).filter(s => !s.closed).length, 1);
      await rejects(run(uid, { ...oldBeat, roomCode: 'OTHER1' }), 'action_id_reused');
    });
    await t.test('per-UID tab and action limits do not disturb another identity', async () => {
      clock += 200_000; const uid = 'presence-limits';
      for (let n = 0; n < 8; n++) await beat(uid, null, 'presence_session_' + String(n).padStart(4, '0'));
      await rejects(beat(uid, null, 'presence_session_extra'), 'too_many_tabs');
      for (let n = 8; n < 30; n++) await beat(uid);
      await rejects(beat(uid), 'too_many_actions');
      await beat('presence-unrelated'); assert.ok(await member('presence-unrelated'));
      clock += 10_000; await beat(uid); assert.ok(await member(uid));
    });
    await t.test('twenty client network recoveries preserve one server session and final leave removes its projection', async () => {
      clock += 200_000; const uid = 'presence-client-recovery';
      const win = new EventTarget(), doc = new EventTarget(); doc.visibilityState = 'visible'; win.navigator = { onLine: true };
      globalThis.window = win; globalThis.document = doc;
      const pending = [], calls = [], errors = [];
      const api = fields => { calls.push(fields); const request = run(uid, action(fields.type, fields)); pending.push(request); return request; };
      const settle = async () => { await Promise.all(pending); await new Promise(resolve => setImmediate(resolve)); };
      const stop = startServerPresence({ api, getToken() {}, roomCode: null, onError: error => errors.push(error) });
      try {
        await settle();
        for (let n = 0; n < 20; n++) {
          clock += 1000; win.dispatchEvent(new Event('offline'));
          const before = calls.length; doc.dispatchEvent(new Event('visibilitychange')); await settle();
          assert.equal(calls.length, before);
          win.dispatchEvent(new Event('online')); await settle();
        }
        assert.deepEqual(errors, []);
        assert.equal(new Set(calls.filter(call => call.type === 'presence.heartbeat').map(call => call.sessionId)).size, 1);
        const saved = (await secret(uid).get()).data().members[uid]; assert.equal(Object.keys(saved.sessions).length, 1);
        assert.ok(await member(uid));
        stop(); await settle(); assert.equal(await member(uid), undefined);
      } finally { stop(); await settle(); delete globalThis.window; delete globalThis.document; }
    });
    await t.test('bounded shards reject saturation and reclaim expired identities without a scheduled job', async () => {
      clock += 200_000; const uid = 'presence-capacity', members = {};
      for (let n = 0; Object.keys(members).length < 128; n++) {
        const id = 'capacity_' + n;
        if (presenceShardId(id) === presenceShardId(uid)) members[id] = { seenAt: clock, sessions: { presence_session_0001: { at: clock, roomCode: null } }, recent: [] };
      }
      await secret(uid).set({ members });
      await rejects(beat(uid), 'presence_capacity');
      clock += 120_001; await beat(uid); assert.ok(await member(uid));
      assert.equal(Object.keys((await secret(uid).get()).data().members).length, 1);
    });
    await t.test('real Auth rules allow only summary reads and deny every direct/legacy/private write or read', async () => {
      clock += 200_000;
      const signIn = async () => (await fetch('http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
      })).json();
      const a = await signIn(), b = await signIn(); await beat(a.localId);
      const base = `http://127.0.0.1:8180/v1/projects/${project}/databases/(default)/documents/${root}`;
      const headers = { Authorization: `Bearer ${b.idToken}`, 'Content-Type': 'application/json' };
      for (const path of ['public/data/presenceV2', `public/data/presenceV2/${presenceShardId(a.localId)}`]) {
        assert.equal((await fetch(`${base}/${path}`, { headers })).status, 200);
        assert.equal((await fetch(`${base}/${path}`)).status, 403);
      }
      assert.equal((await fetch(`${base}/serverPresence/${presenceShardId(a.localId)}`, { headers })).status, 403);
      for (const path of [`public/data/presenceV2/${presenceShardId(a.localId)}`, 'public/data/serverStatus/info']) {
        assert.equal((await fetch(`${base}/${path}`, { headers, method: 'PATCH', body: '{"fields":{}}' })).status, 403);
      }
    });
  } finally { await db.terminate(); }
});
