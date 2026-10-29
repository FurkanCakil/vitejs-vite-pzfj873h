// Opt-in sustained transaction test. Never runs against a real Firebase project.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { applyRoomAction } from '../server/room-actions.js';
import { presenceShardId } from '../server/presence.js';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
assert.ok(!process.env.VERCEL_ENV && !process.env.GOOGLE_APPLICATION_CREDENTIALS);
assert.ok(!process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT === 'demo-oyun-portali');
assert.equal(typeof global.gc, 'function', 'run with node --expose-gc');
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(seconds|rooms|output)=(.+)$/.exec(arg);
  assert.ok(match, 'expected --seconds=600 --rooms=4 --output=path');
  return [match[1], match[2]];
}));
const seconds = Number(options.seconds ?? 600), roomCount = Number(options.rooms ?? 4);
assert.ok(Number.isInteger(seconds) && seconds >= 30 && seconds <= 1800);
assert.ok(Number.isInteger(roomCount) && roomCount >= 1 && roomCount <= 8);

const projectId = 'demo-oyun-portali';
const appId = `soak-${randomBytes(6).toString('hex')}`;
const authClient = new OAuth2Client();
authClient.setCredentials({ access_token: 'owner', expiry_date: Date.now() + 3_600_000 });
const db = new Firestore({ projectId, authClient, preferRest: true });
const root = `artifacts/${appId}`;
const rooms = [], samples = [], latencies = [];
const expectedRejections = {};
let sequence = 0, calls = 0, rounds = 0, peakInFlight = 0, inFlight = 0;
const action = (type, fields = {}) => ({ type, actionId: `soak_${String(++sequence).padStart(12, '0')}`, ...fields });
const roomRef = room => db.doc(`${root}/public/data/roomsV2/${room.id}`);
const sample = () => {
  global.gc();
  const { heapUsed, rss, external } = process.memoryUsage();
  samples.push({ elapsedSeconds: Math.round((performance.now() - started) / 1000), rounds, heapUsed, rss, external });
};
async function send(uid, input) {
  const before = performance.now(); calls++; inFlight++; peakInFlight = Math.max(peakInFlight, inFlight);
  try {
    const options = input.type.startsWith('presence.') ? [{ enabled: true }] : [];
    return await applyRoomAction(db, appId, uid, input, Date.now(), ...options);
  }
  finally { inFlight--; latencies.push(performance.now() - before); }
}
async function together(promises) {
  const results = await Promise.allSettled(promises);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  return results.map(result => result.value);
}
async function reject(promise, code) {
  await assert.rejects(promise, error => error.code === code);
  expectedRejections[code] = (expectedRejections[code] ?? 0) + 1;
}
async function heartbeat(room) {
  await together(room.players.map(async uid => {
    await send(uid, action('room.heartbeat', { roomId: room.id, sessionId: room.session }));
    await send(uid, action('presence.heartbeat', { sessionId: room.session, roomCode: null }));
  }));
}
async function play(room) {
  await heartbeat(room);
  let saved = (await roomRef(room).get()).data();
  if (saved.winner) {
    await send(room.players[0], action('xox.rematch.request', { roomId: room.id, expectedVersion: saved.version }));
    saved = (await roomRef(room).get()).data();
    await send(room.players[1], action('xox.rematch.accept', { roomId: room.id, expectedVersion: saved.version }));
    saved = (await roomRef(room).get()).data();
  }
  let version = saved.version;
  const starter = saved.turn, opponent = room.players.find(uid => uid !== starter);
  // Different requests racing on one version must not both commit.
  const racing = await Promise.allSettled([0, 1].map(() => send(starter,
    action('xox.move', { roomId: room.id, expectedVersion: version, cell: 0 }))));
  assert.equal(racing.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(racing.find(result => result.status === 'rejected').reason.code, 'stale_version');
  expectedRejections.stale_version = (expectedRejections.stale_version ?? 0) + 1;
  version = racing.find(result => result.status === 'fulfilled').value.version;
  for (const [uid, cell] of [[opponent, 3], [starter, 1], [opponent, 4]]) {
    version = (await send(uid, action('xox.move', { roomId: room.id, expectedVersion: version, cell }))).version;
  }
  // A lost-response replay racing with the original winning move scores once.
  const winning = action('xox.move', { roomId: room.id, expectedVersion: version, cell: 2 });
  const results = await together([send(starter, winning), send(starter, winning), send(starter, winning)]);
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]);
  room.scores[starter]++;
  saved = (await roomRef(room).get()).data();
  assert.deepEqual(saved.scores, room.scores);
  assert.equal(saved.board.filter(Boolean).length, 5);
  assert.equal(saved.version, version + 1);
  await reject(send(`outsider_${room.id}`, action('xox.move', {
    roomId: room.id, expectedVersion: saved.version, cell: 8,
  })), 'not_a_player');
  assert.deepEqual((await roomRef(room).get()).data(), saved);
  for (const uid of room.players) {
    const actor = (await db.doc(`${root}/serverRoomActors/${uid}`).get()).data();
    assert.ok(actor.recent.length <= 32);
    const presence = (await db.doc(`${root}/serverPresence/${presenceShardId(uid)}`).get()).data();
    assert.ok(presence.members[uid].recent.length <= 8);
    assert.equal(Object.keys(presence.members[uid].sessions).length, 1);
  }
}
const started = performance.now();
let passed = false;
try {
  for (let index = 0; index < roomCount; index++) {
    const players = [`host_${index}`, `guest_${index}`], session = `soak_session_${String(index).padStart(8, '0')}`;
    const created = await send(players[0], action('room.create', { nickname: 'Soak Host', isPublic: false, sessionId: session }));
    const room = { id: created.roomId, players, session, scores: Object.fromEntries(players.map(uid => [uid, 0])) };
    rooms.push(room);
    await send(players[1], action('room.join', { roomId: room.id, nickname: 'Soak Guest', sessionId: session }));
  }
  sample();
  // Wall time, not a fast-forwarded clock. Rate limits and leases stay enabled.
  while (performance.now() - started < seconds * 1000) {
    const wave = performance.now();
    const results = await Promise.allSettled(rooms.map(play));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    rounds++;
    sample();
    console.log(JSON.stringify({ rounds, matches: rounds * roomCount, calls, heapMiB: +(samples.at(-1).heapUsed / 1048576).toFixed(2) }));
    const remaining = seconds * 1000 - (performance.now() - started);
    if (remaining > 0) await delay(Math.min(remaining, Math.max(0, 15_000 - (performance.now() - wave))));
  }
  // Normal departure, never administrative deletion. Emulator state is disposable.
  for (const room of rooms) {
    for (const uid of room.players) {
      await send(uid, action('room.leave', { roomId: room.id, sessionId: room.session }));
      await send(uid, action('presence.leave', { sessionId: room.session }));
    }
    assert.equal((await roomRef(room).get()).data().status, 'closed');
    await reject(send(room.players[0], action('room.join', {
      roomId: room.id, nickname: 'Soak Host', sessionId: room.session,
    })), 'room_closed');
  }
  const summary = await db.collection(`${root}/public/data/presenceV2`).get();
  for (const doc of summary.docs) assert.equal(Object.keys(doc.data().members).length, 0);
  passed = true;
} finally {
  await db.terminate();
  sample();
  const sorted = [...latencies].sort((a, b) => a - b);
  const percentile = fraction => +(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0).toFixed(2);
  const report = {
    passed, projectId, transport: 'local Firestore REST; direct server actions; no HTTP/auth/WAF/browser',
    durationSeconds: +((performance.now() - started) / 1000).toFixed(2), roomCount, rounds, matches: rounds * roomCount,
    calls, peakInFlight, expectedRejections, latencyMs: { p50: percentile(.5), p95: percentile(.95), max: percentile(1) },
    memory: { scope: 'Node harness + Firestore SDK; explicit GC between waves; excludes emulator JVM and browser', samples },
    limits: 'No production capacity, real-device, multi-hour soak or leak-free guarantee. Latencies include expected rejections and SDK retries.',
  };
  console.log(JSON.stringify({ passed, calls, matches: report.matches, seconds: report.durationSeconds, latencyMs: report.latencyMs }));
  if (options.output) await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
}
