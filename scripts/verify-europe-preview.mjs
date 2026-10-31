// Explicit acceptance against NEW private rooms in the isolated Europe project.
// Normal client SDK credentials only; no Admin SDK, seeding or existing rooms.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, setPersistence, inMemoryPersistence, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, collection, getDocFromServer, getDocs, onSnapshot, disableNetwork, enableNetwork, terminate, setLogLevel } from 'firebase/firestore';
import { getValidCheckersMoves } from '../src/games/checkers/logic.js';
import { getStrictValidMoves } from '../src/games/backgammon/logic.js';
import { loadEuropePreviewTarget, previewProtectionHeaders } from './europe-preview-target.mjs';

if (!process.argv.includes('--verify-europe-preview')) throw Error('Explicit --verify-europe-preview required');
const { base, projectId, config } = loadEuropePreviewTarget();
const protection = await previewProtectionHeaders();
const root = `artifacts/${projectId}`, actors = [], rooms = [], results = [];
const id = () => randomBytes(16).toString('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
setLogLevel('silent');
let phase = 'login', expectedRejections = 0, failure = null;
const send = async (actor, type, fields, requestId = id()) => {
  await wait(Math.max(0, 650 - (Date.now() - (actor.lastAt ?? 0))));
  actor.lastAt = Date.now();
  const response = await fetch(`${base}/api/room-action`, { method: 'POST', headers: {
    ...protection, Authorization: `Bearer ${await actor.user.getIdToken()}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify({ type, actionId: requestId, ...fields }), signal: AbortSignal.timeout(20000), redirect: 'manual' });
  if (!response.headers.get('content-type')?.includes('application/json')) throw Error('preview_protection_required');
  const result = await response.json();
  if (!response.ok || !result.ok) { const error = Error(result.error ?? 'api_failure'); error.code = result.error; throw error; }
  const { serverNow: _now, ...receipt } = result;
  return receipt;
};
const roomRef = (actor, room) => doc(actor.db, `${root}/public/data/roomsV2/${room}`);
const read = async (actor, room) => (await getDocFromServer(roomRef(actor, room))).data();
const denied = async work => {
  await assert.rejects(work, error => error.code === 'permission-denied'); expectedRejections++;
};
const replay = async (actor, type, fields) => {
  const requestId = id();
  const first = await send(actor, type, fields, requestId);
  const once = await read(actor, fields.roomId);
  assert.deepEqual(await send(actor, type, fields, requestId), first);
  assert.deepEqual(await read(actor, fields.roomId), once);
};
async function reconnect(actor, room) {
  const before = await read(actor, room);
  await send(actor, 'room.disconnect', { roomId: room, sessionId: actor.sessionId });
  await disableNetwork(actor.db);
  actor.sessionId = id();
  await send(actor, 'room.heartbeat', { roomId: room, sessionId: actor.sessionId });
  await enableNetwork(actor.db);
  await new Promise((resolve, reject) => {
    let stop;
    const timer = setTimeout(() => { stop?.(); reject(Error('snapshot_reconnect_timeout')); }, 15000);
    stop = onSnapshot(roomRef(actor, room), snapshot => {
      if (!snapshot.exists() || snapshot.metadata.fromCache || snapshot.data().version < before.version) return;
      clearTimeout(timer); stop(); resolve();
    }, error => { clearTimeout(timer); stop?.(); reject(error); });
  });
  const after = await read(actor, room);
  assert.deepEqual(after.board ?? null, before.board ?? null);
  assert.deepEqual(after.scores, before.scores);
  assert(after.players.includes(actor.user.uid));
}

try {
  for (let i = 0; i < 4; i++) {
    const app = initializeApp(config, `europe-${id()}`), auth = getAuth(app);
    await setPersistence(auth, inMemoryPersistence);
    const { user } = await signInAnonymously(auth);
    actors.push({ app, auth, user, db: getFirestore(app), sessionId: id() });
  }
  const games = ['xox', 'connect4', 'chess', 'checkers', 'tavla', 'battleship', 'okey'];
  for (const [index, game] of games.entries()) {
    phase = game;
    const a = actors[index % 4], b = actors[(index + 1) % 4];
    const members = game === 'okey' ? [a, ...actors.filter(actor => actor !== a)] : [a, b];
    const created = await send(a, game === 'xox' ? 'room.create' : `${game}.create`, {
      nickname: 'Europe QA', isPublic: false, sessionId: a.sessionId });
    const room = created.roomId, held = { room, members, closed: false }; rooms.push(held);
    for (const actor of members.slice(1)) await send(actor, 'room.join', { roomId: room, nickname: 'Europe QA', sessionId: actor.sessionId });
    let state = await read(a, room);
    const turnActor = value => members.find(actor => actor.user.uid === value.turn);
    if (game === 'battleship') {
      const fleet = ['carrier', 'cruiser', 'submarine', 'destroyer', 'patrol'].map((ship, i) => ({ id: ship, row: i * 2, col: 0, orientation: 'H' }));
      for (const actor of members) await send(actor, 'battleship.ready', { roomId: room, roundId: state.roundId, fleet });
      state = await read(a, room);
      assert.equal(state.ships, undefined); assert.deepEqual(state.revealedShips, {});
      assert((await getDocFromServer(doc(a.db, `${root}/public/data/roomsV2/${room}/playerData/${a.user.uid}`))).exists());
      await denied(getDocFromServer(doc(a.db, `${root}/public/data/roomsV2/${room}/playerData/${b.user.uid}`)));
      await replay(turnActor(state), 'battleship.shot', { roomId: room, expectedVersion: state.version, row: 0, col: 0 });
    } else if (game === 'okey') {
      await send(a, 'okey.rules', { roomId: room, expectedVersion: state.version, rules: {
        gameType: 'ffa', assistedEnabled: true, foldingEnabled: false, foldToPartnerEnabled: false } });
      await wait(3500); state = await read(a, room);
      await send(a, 'okey.start', { roomId: room, expectedVersion: state.version });
      state = await read(a, room);
      for (const field of ['racks', 'groups', 'drawPile', '_history']) assert.equal(Object.hasOwn(state, field), false);
      const own = (actor, uid = actor.user.uid) => doc(actor.db, `${root}/public/data/roomsV2/${room}/playerData/${uid}`);
      await denied(getDocFromServer(own(a, b.user.uid)));
      await denied(getDocs(collection(a.db, `${root}/public/data/roomsV2/${room}/playerData`)));
      await denied(getDocFromServer(doc(a.db, `${root}/serverOkeyRooms/${room}`)));
      let actor = turnActor(state), hand = (await getDocFromServer(own(actor))).data();
      const rack = hand.rack.map(tile => tile?.id ?? null), slots = rack.flatMap((tile, i) => tile ? [i] : []);
      [rack[slots[0]], rack[slots[1]]] = [rack[slots[1]], rack[slots[0]]];
      await replay(actor, 'okey.arrange', { roomId: room, roundId: state.roundId, rack, groups: {} });
      assert((await getDocFromServer(doc(actor.db, `${root}/public/data/roomsV2/${room}/playerLayouts/${actor.user.uid}`))).exists());
      await denied(getDocFromServer(doc(b.db, `${root}/public/data/roomsV2/${room}/playerLayouts/${actor.user.uid === b.user.uid ? a.user.uid : actor.user.uid}`)));
      state = await read(actor, room);
      await replay(actor, 'okey.discard', { roomId: room, roundId: state.roundId, expectedPlayVersion: state.playVersion,
        turnNumber: state.turnNumber, tileId: hand.rack.find(Boolean).id });
      state = await read(a, room); actor = turnActor(state);
      await replay(actor, 'okey.draw', { roomId: room, roundId: state.roundId, expectedPlayVersion: state.playVersion,
        turnNumber: state.turnNumber, source: 'pile', targetIndex: null });
    } else if (game === 'tavla') {
      for (let tries = 0; state.phase === 'opening' && tries < 12; tries++) {
        if (state.openingRolls.p1 && state.openingRolls.p1 === state.openingRolls.p2) {
          await send(a, 'tavla.opening.reset', { roomId: room, expectedVersion: state.version });
        } else {
          const actor = members.find(item => !state.openingRolls[state.playerColors[item.user.uid] === 'white' ? 'p1' : 'p2']);
          await send(actor, 'tavla.roll', { roomId: room, expectedVersion: state.version });
        }
        state = await read(a, room);
      }
      assert.equal(state.phase, 'moving');
      const move = getStrictValidMoves(state.board, state.playerColors[state.turn], state.dice, state.bar, state.borneOff)[0];
      assert(move); await replay(turnActor(state), 'tavla.move', { roomId: room, expectedVersion: state.version, ...move });
    } else {
      let fields;
      if (game === 'xox') fields = { cell: 0 };
      if (game === 'connect4') fields = { column: 0 };
      if (game === 'chess') fields = { from: 52, to: 36, promotion: null };
      if (game === 'checkers') {
        const color = state.playerColors[state.turn];
        const move = state.board.flatMap((piece, from) => piece?.color === color
          ? getValidCheckersMoves(state.board, from, state.multiJumpIdx).map(item => ({ from, to: item.to })) : [])[0];
        assert(move); fields = move;
      }
      await replay(turnActor(state), `${game}.move`, { roomId: room, expectedVersion: state.version, ...fields });
    }
    const ownPrivate = doc(a.db, `${root}/public/data/roomsV2/${room}/playerData/${a.user.uid}`);
    const privateBefore = ['okey', 'battleship'].includes(game) ? (await getDocFromServer(ownPrivate)).data() : null;
    await reconnect(a, room);
    if (privateBefore) assert.deepEqual((await getDocFromServer(ownPrivate)).data(), privateBefore);
    results.push({ game, loginAndJoin: true, move: true, replay: true, reconnectSnapshot: true,
      privateView: ['okey', 'battleship'].includes(game) ? true : 'not_applicable' });
    for (const actor of members) await send(actor, 'room.leave', { roomId: room, sessionId: actor.sessionId });
    held.closed = true;
    console.log(`${game}: acceptance passed`);
  }
} catch (error) {
  failure = { phase, code: /^[a-z0-9_/-]{1,100}$/i.test(error.code ?? error.message) ? error.code ?? error.message : 'acceptance_failed' };
  process.exitCode = 1;
} finally {
  let cleanupFailures = 0;
  for (const held of rooms.filter(room => !room.closed)) for (const actor of held.members) {
    try { await send(actor, 'room.leave', { roomId: held.room, sessionId: actor.sessionId }); } catch { cleanupFailures++; }
  }
  for (const actor of actors) { await terminate(actor.db); await deleteApp(actor.app); }
  const report = { capturedAt: new Date().toISOString(), project: projectId, failure, expectedRejections, cleanupFailures, results };
  await writeFile('europe-acceptance.local', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
