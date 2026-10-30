import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { executeRoomAction } from './xox-rooms.js';
import { createPerformance } from './performance.js';

test('performance observes real SDK XOX and Okey transactions without changing their state or privacy',
  { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
    assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
    assert.equal(process.env.VERCEL_ENV, undefined);
    const projectId = 'demo-oyun-portali', root = `artifacts/${projectId}`;
    const authClient = new OAuth2Client(); authClient.setCredentials({ access_token: 'owner', expiry_date: Date.now() + 3_600_000 });
    const db = new Firestore({ projectId, authClient, preferRest: true });
    let sequence = 0, clock = 10_000_000;
    const sid = 'perf_session_0001';
    const run = async (uid, type, fields, code = 'PFXO12', measured = false) => {
      const metrics = measured ? createPerformance({ region: 'local' }) : null;
      const batches = [];
      const observedDb = {
        doc: path => db.doc(path),
        runTransaction: work => db.runTransaction(tx => work(new Proxy(tx, { get(target, key) {
          if (key === 'get' || key === 'getAll') return (...args) => {
            batches.push(args.map(ref => ref.path));
            return target[key](...args);
          };
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        } }))),
      };
      const action = { type, actionId: `perf_action_${String(++sequence).padStart(8, '0')}`, ...fields };
      const result = await executeRoomAction(metrics ? metrics.wrapDb(observedDb) : db, projectId, uid, action, clock, () => code,
        { okeyEnabled: true, metrics });
      const headers = {}; metrics?.headers({ setHeader: (key, value) => { headers[key] = value; } });
      return { result, headers, action, batches };
    };
    try {
      await run('perf-a', 'room.create', { sessionId: sid, nickname: 'Perf', isPublic: false });
      await run('perf-b', 'room.join', { sessionId: sid, nickname: 'Perf', roomId: 'PFXO12' });
      const moved = await run('perf-a', 'xox.move', { roomId: 'PFXO12', expectedVersion: 1, cell: 4 }, undefined, true);
      assert.equal(moved.headers['X-Game-Perf-Game'], 'xox');
      assert.match(moved.headers['Server-Timing'], /db_reads;dur=4\.000/);
      assert.match(moved.headers['Server-Timing'], /db_writes;dur=4\.000/);
      assert.deepEqual(moved.batches.map(batch => batch.length), [4]);
      const room = (await db.doc(`${root}/public/data/roomsV2/PFXO12`).get()).data();
      assert.equal(room.board[4], 'X'); assert.equal(room.version, 2);
      assert.equal(Object.hasOwn(room, 'metrics'), false);
      // A batched read must not move room validation ahead of saved receipts.
      await db.doc(`${root}/public/data/roomsV2/PFXO12`).delete();
      assert.deepEqual(await executeRoomAction(db, projectId, 'perf-a', moved.action, clock), moved.result);
      await assert.rejects(executeRoomAction(db, projectId, 'perf-a', { ...moved.action, cell: 5 }, clock),
        issue => issue.code === 'action_id_reused');

      await run('perf-a', 'okey.create', { sessionId: sid, nickname: 'Perf', isPublic: false }, 'PFOK12');
      for (const uid of ['perf-b', 'perf-c', 'perf-d']) await run(uid, 'room.join', { sessionId: sid, nickname: 'Perf', roomId: 'PFOK12' });
      const secretRef = db.doc(`${root}/serverOkeyRooms/PFOK12`);
      let state = (await secretRef.get()).data(); clock += 4000;
      await run('perf-a', 'okey.start', { roomId: 'PFOK12', expectedVersion: state.version });
      state = (await secretRef.get()).data();
      const uid = state.turn, rack = state.racks[uid].map(tile => tile?.id ?? null);
      [rack[0], rack[29]] = [rack[29], rack[0]];
      const layout = await run(uid, 'okey.layout', { roomId: 'PFOK12', roundId: state.roundId, rack, groups: {} }, undefined, true);
      assert.match(layout.headers['Server-Timing'], /db_reads;dur=5\.000/);
      assert.match(layout.headers['Server-Timing'], /db_writes;dur=5\.000/);
      assert.deepEqual(layout.batches.map(batch => batch.length), [5]);
      const publicRoom = (await db.doc(`${root}/public/data/roomsV2/PFOK12`).get()).data();
      const own = (await db.doc(`${root}/public/data/roomsV2/PFOK12/playerData/${uid}`).get()).data();
      assert.equal(own.rack[29].id, state.racks[uid][0].id);
      assert.equal(publicRoom.handVersions[uid], own.handVersion);
      for (const key of ['racks', 'drawPile', 'metrics', 'performance']) assert.equal(Object.hasOwn(publicRoom, key), false);
      assert.doesNotMatch(JSON.stringify(layout.headers), /perf-a|PFOK12|roundId|rack/);
      await db.doc(`${root}/public/data/roomsV2/PFOK12`).delete();
      await secretRef.delete();
      assert.deepEqual(await executeRoomAction(db, projectId, uid, layout.action, clock, undefined,
        { okeyEnabled: true }), layout.result);
    } finally {
      await db.recursiveDelete(db.doc(`${root}/public/data/roomsV2/PFXO12`));
      await db.recursiveDelete(db.doc(`${root}/public/data/roomsV2/PFOK12`));
      await db.doc(`${root}/serverOkeyRooms/PFOK12`).delete();
      await db.terminate();
    }
  });
