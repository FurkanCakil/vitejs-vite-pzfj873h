import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { executeRoomAction, CONNECTION_TTL } from './xox-rooms.js';

const projectId = 'demo-oyun-portali';
// Each concurrently running suite needs its own artifact namespace. Their
// synthetic clocks must never prune another suite's matchmaking queue.
const appId = 'test-xox-lifecycle';
let sequence = 1000;
const sessionId = 'session_00000001';
const session2 = 'session_00000002';
const action = (type, fields = {}) => ({ type, actionId: `lifecycle_${String(++sequence).padStart(8, '0')}`, ...fields });

test('XOX lifecycle on Firestore emulator', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: 'owner', expiry_date: Date.now() + 3_600_000 });
  const db = new Firestore({ projectId, authClient, preferRest: true });
  const ref = id => db.doc(`artifacts/${appId}/public/data/roomsV2/${id}`);
  const queue = db.doc(`artifacts/${appId}/public/data/xoxLobby/queue`);
  const now = 1_000_000;
  const run = (uid, input, time = now, code = 'LIFE12') => executeRoomAction(db, appId, uid, input, time, () => code);
  const create = (uid, code, isPublic = false, time = now) => run(uid, action('room.create', { nickname: uid, isPublic, sessionId }), time, code);
  const join = (uid, roomId, time = now, tab = sessionId) => run(uid, action('room.join', { roomId, nickname: uid, sessionId: tab }), time);
  const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
  try {
    await t.test('create retry is idempotent and collisions never overwrite rooms', async () => {
      const request = action('room.create', { nickname: 'Create', isPublic: false, sessionId });
      const first = await run('creator', request, now, 'CRTE12');
      assert.deepEqual(await run('creator', request, now, 'OTHER1'), first);
      await rejects(create('intruder', 'CRTE12'), 'room_code_collision');
      assert.deepEqual((await ref('CRTE12').get()).data().players, ['creator']);
      const legacy = db.doc(`artifacts/${appId}/public/data/rooms/OLD123`);
      await legacy.set({ gameId: 'tavla' });
      await rejects(create('intruder', 'OLD123'), 'room_code_collision');
      assert.equal((await legacy.get()).data().gameId, 'tavla');
    });
    await t.test('concurrent joins leave exactly two seats and spectators cannot move', async () => {
      await create('host', 'JOIN12');
      const results = await Promise.allSettled([join('guest1', 'JOIN12'), join('guest2', 'JOIN12')]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(results.find(result => result.status === 'rejected').reason.code, 'room_full');
      const saved = (await ref('JOIN12').get()).data();
      assert.equal(saved.players.length, 2); assert.equal(saved.status, 'playing');
      await run('watcher', action('room.spectate', { roomId: 'JOIN12', sessionId }));
      await rejects(run('watcher', action('xox.move', { roomId: 'JOIN12', expectedVersion: 2, cell: 0 })), 'not_a_player');
      await rejects(run('watcher', action('room.close', { roomId: 'JOIN12', expectedVersion: 2 })), 'cannot_close');
    });
    await t.test('simultaneous quick matches share one room; expired hosts never match', async () => {
      await queue.set({ entries: [] });
      const results = await Promise.all([
        run('matcher1', action('room.match', { nickname: 'One', sessionId }), now, 'MATH12'),
        run('matcher2', action('room.match', { nickname: 'Two', sessionId }), now, 'MATH13'),
      ]);
      assert.equal(results[0].roomId, results[1].roomId);
      assert.equal((await ref(results[0].roomId).get()).data().players.length, 2);
      await create('ghost', 'GHOST1', true);
      const fresh = await run('matcher3', action('room.match', { nickname: 'Three', sessionId }), now + CONNECTION_TTL + 1, 'FRESH1');
      assert.equal(fresh.roomId, 'FRESH1');
      assert.deepEqual((await ref('GHOST1').get()).data().players, ['ghost']);
    });
    await t.test('a closed tab cannot disconnect another tab; refresh preserves the board and UID', async () => {
      await create('tabhost', 'TABS12'); await join('tabguest', 'TABS12');
      await join('tabhost', 'TABS12', now, session2);
      await run('tabhost', action('xox.move', { roomId: 'TABS12', expectedVersion: 2, cell: 0 }));
      await run('tabhost', action('room.disconnect', { roomId: 'TABS12', sessionId }));
      assert.equal((await ref('TABS12').get()).data().status, 'playing');
      await run('tabhost', action('room.disconnect', { roomId: 'TABS12', sessionId: session2 }));
      assert.equal((await ref('TABS12').get()).data().status, 'abandoned');
      await run('tabhost', action('room.heartbeat', { roomId: 'TABS12', sessionId: 'session_refreshed1' }));
      const saved = (await ref('TABS12').get()).data();
      assert.equal(saved.status, 'playing'); assert.equal(saved.board[0], 'X'); assert.equal(saved.turn, 'tabguest');
      await rejects(run('tabguest', action('room.close', { roomId: 'TABS12', expectedVersion: saved.version - 1 })), 'stale_version');
      await rejects(run('tabhost', action('room.leave', { roomId: 'TABS12', sessionId })), 'session_expired');
      await rejects(join('fake_display_id', 'TABS12'), 'room_full');
    });
    await t.test('late pre-restore heartbeats and disconnects cannot remove the new page lease', async () => {
      await create('restore-host', 'BACK12'); await join('restore-guest', 'BACK12');
      await run('restore-host', action('xox.move', { roomId: 'BACK12', expectedVersion: 1, cell: 4 }));
      const beat = tab => run('restore-host', action('room.heartbeat', { roomId: 'BACK12', sessionId: tab }));
      const disconnect = tab => run('restore-host', action('room.disconnect', { roomId: 'BACK12', sessionId: tab }));
      await disconnect(sessionId);
      await beat(session2); // pageshow establishes the new page before old work settles
      await beat(sessionId); // old heartbeat finishes late
      await disconnect(sessionId); // its cleanup must affect only the old lease
      const saved = (await ref('BACK12').get()).data();
      assert.equal(saved.status, 'playing'); assert.equal(saved.board[4], 'X');
      assert.equal(saved.turn, 'restore-guest'); assert.deepEqual(saved.scores, { 'restore-host': 0, 'restore-guest': 0 });
      // The UI's explicit leave must use the renewed page ID too.
      await run('restore-host', action('room.leave', { roomId: 'BACK12', sessionId: session2 }));
      assert.equal((await ref('BACK12').get()).data().abandonReason, 'left');
    });
    await t.test('rematch needs an opponent decision, alternates starter and preserves scores', async () => {
      await create('winner', 'PLAY12'); await join('loser', 'PLAY12');
      let version = 1;
      for (const [uid, cell] of [['winner', 0], ['loser', 3], ['winner', 1], ['loser', 4], ['winner', 2]]) {
        const result = await run(uid, action('xox.move', { roomId: 'PLAY12', expectedVersion: version, cell })); version = result.version;
      }
      assert.equal((await ref('PLAY12').get()).data().scores.winner, 1);
      await rejects(run('loser', action('xox.rematch.accept', { roomId: 'PLAY12', expectedVersion: version })), 'invalid_rematch');
      version = (await run('winner', action('xox.rematch.request', { roomId: 'PLAY12', expectedVersion: version }))).version;
      await rejects(run('winner', action('xox.rematch.accept', { roomId: 'PLAY12', expectedVersion: version })), 'invalid_rematch');
      version = (await run('loser', action('xox.rematch.accept', { roomId: 'PLAY12', expectedVersion: version }))).version;
      const saved = (await ref('PLAY12').get()).data();
      assert.equal(saved.turn, 'loser'); assert.equal(saved.scores.winner, 1); assert(saved.board.every(cell => cell === null));
      await rejects(run('winner', action('xox.rematch.request', { roomId: 'PLAY12', expectedVersion: version })), 'game_not_finished');
    });
    await t.test('leaving frees a seat only after the remaining player chooses to wait; same UID restores its match', async () => {
      await create('keeper', 'KEEP12'); await join('returner', 'KEEP12');
      await run('keeper', action('xox.move', { roomId: 'KEEP12', expectedVersion: 1, cell: 4 }));
      let version = (await run('returner', action('room.leave', { roomId: 'KEEP12', sessionId }))).version;
      await rejects(join('new_guest', 'KEEP12'), 'room_full');
      version = (await run('keeper', action('room.wait', { roomId: 'KEEP12', expectedVersion: version }))).version;
      assert.equal((await ref('KEEP12').get()).data().status, 'waiting');
      await join('returner', 'KEEP12');
      const saved = (await ref('KEEP12').get()).data();
      assert.equal(saved.board[4], 'X'); assert.equal(saved.turn, 'returner');
      assert.equal(saved.version, version + 1);
    });
  } finally { await db.terminate(); }
});
