import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, setPersistence, inMemoryPersistence, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, collection, getDocFromServer, getDocs, onSnapshot, disableNetwork, enableNetwork, terminate, setLogLevel } from 'firebase/firestore';
import { getValidCheckersMoves } from '../games/checkers/logic.js';
import { getStrictValidMoves } from '../games/backgammon/logic.js';
import { summarizePerformance } from '../utils/gamePerformance.js';

const requestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
const check = (value, code = 'assertion_failed') => { if (!value) throw Error(code); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const assert = Object.assign(check, {
  equal: (a,b) => check(Object.is(a,b), 'equality_check_failed'),
  deepEqual: (a,b) => check(JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)), 'state_check_failed'),
  rejects: async (work,predicate) => { let caught; try { await work; } catch(error) { caught=error; } check(caught && predicate(caught), 'expected_rejection_missing'); },
});
function guard({base, projectId, config}) {
  const url = new URL(base);
  if (projectId !== 'oyun-portali-avrupa' || config.projectId !== projectId
    || url.protocol !== 'https:' || !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname)
    || base !== url.origin) throw Error('Isolated Europe Preview required');
}
export async function runEuropeAcceptance(target, progress = () => {}) {
  guard(target);
  const {base,projectId,config,headers:protection={}}=target;
const root = `artifacts/${projectId}`, actors = [], rooms = [], results = [];
const id = requestId;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
setLogLevel('silent');
let phase = 'login', expectedRejections = 0, failure = null, report;
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
  const before = await read(actor, fields.roomId);
  const first = await send(actor, type, fields, requestId);
  const once = await read(actor, fields.roomId);
  if (type !== 'okey.arrange') assert(once.version > before.version);
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
      const discardedId = hand.rack.find(Boolean).id;
      await replay(actor, 'okey.discard', { roomId: room, roundId: state.roundId, expectedPlayVersion: state.playVersion,
        turnNumber: state.turnNumber, tileId: discardedId });
      assert(!(await getDocFromServer(own(actor))).data().rack.some(tile => tile?.id === discardedId));
      state = await read(a, room); actor = turnActor(state);
      const countBeforeDraw = (await getDocFromServer(own(actor))).data().rack.filter(Boolean).length;
      await replay(actor, 'okey.draw', { roomId: room, roundId: state.roundId, expectedPlayVersion: state.playVersion,
        turnNumber: state.turnNumber, source: 'pile', targetIndex: null });
      assert.equal((await getDocFromServer(own(actor))).data().rack.filter(Boolean).length, countBeforeDraw + 1);
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
    progress(`${game}: acceptance passed`);
  }
} catch (error) {
  failure = { phase, code: /^[a-z0-9_/-]{1,100}$/i.test(error.code ?? error.message) ? error.code ?? error.message : 'acceptance_failed' };
} finally {
  let cleanupFailures = 0;
  for (const held of rooms.filter(room => !room.closed)) for (const actor of held.members) {
    try { await send(actor, 'room.leave', { roomId: held.room, sessionId: actor.sessionId }); } catch { cleanupFailures++; }
  }
  for (const actor of actors) { await terminate(actor.db); await deleteApp(actor.app); }
  report = { capturedAt: new Date().toISOString(), project: projectId, failure, expectedRejections, cleanupFailures, results };
}
return report;
}

export async function runEuropeMeasurement(target, progress = () => {}) {
  guard(target);
  const {base,projectId:project,config,headers:protection={}}=target;
  const rows=[],actors=[],held=[]; let sequence=0, failure=null, cleanupFailures=0;
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const randomBytes=()=>({toString:()=>requestId()});
const decode = value => {
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decode);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([k, v]) => [k, decode(v)]));
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  return value.stringValue ?? value.timestampValue;
};
const read = async (actor, room, own = false) => {
  const path = `artifacts/${project}/public/data/roomsV2/${room}${own ? `/playerData/${actor.uid}` : ''}`;
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${actor.token}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`read_${response.status}`);
  const result = await response.json();
  return decode({ mapValue: { fields: result.fields } });
};
const send = async (actor, game, type, fields, measure = true) => {
  // Keep request rates below normal per-user limits; this is a latency sample.
  if (actor.lastAt) await wait(Math.max(0, 600 - (performance.now() - actor.lastAt)));
  actor.lastAt = performance.now();
  const at = performance.now();
  const response = await fetch(`${base}/api/room-action`, { method: 'POST', headers: {
    ...protection, Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json', 'X-Game-Perf': '1',
  }, body: JSON.stringify({ type, actionId: randomBytes(16).toString('hex'), ...fields }), signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  const metrics = { http_ms: performance.now() - at, attempts: 1 };
  for (const entry of (response.headers.get('server-timing') ?? '').split(',')) {
    const match = /^\s*([a-z_]+);dur=([\d.]+)\s*$/.exec(entry);
    if (match) metrics[match[1]] = Number(match[2]);
  }
  if (measure) rows.push({ sample: ++sequence, game, action: type, outcome: response.ok && result.ok ? 'ok' : 'error',
    region: response.headers.get('x-game-region') ?? 'unavailable', metrics });
  if (!response.ok || !result.ok) throw Error(`action_${response.status}_${result.error ?? 'unknown'}`);
  if (measure && !response.headers.has('server-timing')) throw Error('server_measurement_disabled');
  return result;
};

try {
  for(let i=0;i<4;i++) {
    const app=initializeApp(config, 'europe-perf-'+requestId()),auth=getAuth(app);
    await setPersistence(auth,inMemoryPersistence); const {user}=await signInAnonymously(auth);
    actors.push({app,user,uid:user.uid,token:await user.getIdToken(),sessionId:requestId()});
  }
  const [a, b] = actors;
  const xox = await send(a, 'xox', 'room.create', { nickname: 'Perf A', isPublic: false, sessionId: a.sessionId });
  held.push({ id: xox.roomId, game: 'xox', actors: [a, b] });
  await send(b, 'xox', 'room.join', { roomId: xox.roomId, nickname: 'Perf B', sessionId: b.sessionId });
  for (let round = 0; round < 12; round++) {
    let state = await read(a, xox.roomId);
    // A five-move win with a changing starter; 60 genuine validated moves.
    const cells = [0, 3, 1, 4, 2];
    for (const cell of cells) {
      const actor = actors.find(item => item.uid === state.turn);
      await send(actor, 'xox', 'xox.move', { roomId: xox.roomId, expectedVersion: state.version, cell });
      state = await read(a, xox.roomId);
    }
    if (round < 11) {
      await send(a, 'xox', 'xox.rematch.request', { roomId: xox.roomId, expectedVersion: state.version });
      state = await read(a, xox.roomId);
      await send(b, 'xox', 'xox.rematch.accept', { roomId: xox.roomId, expectedVersion: state.version });
    }
    if (round % 3 === 2) for (const actor of [a, b]) await send(actor, 'xox', 'room.heartbeat', { roomId: xox.roomId, sessionId: actor.sessionId }, false);
  }
  progress('XOX private baseline: 60 moves completed.');
  for (const actor of [a, b]) await send(actor, 'xox', 'room.leave', { roomId: xox.roomId, sessionId: actor.sessionId }, false);
  held[0].closed = true;
  const okey = await send(a, 'okey101', 'okey.create', { nickname: 'Perf A', isPublic: false, sessionId: a.sessionId });
  held.push({ id: okey.roomId, game: 'okey101', actors: [...actors] });
  for (const [index, actor] of actors.slice(1).entries()) await send(actor, 'okey101', 'room.join', {
    roomId: okey.roomId, nickname: `Perf ${index + 2}`, sessionId: actor.sessionId });
  let state = await read(a, okey.roomId);
  // An existing supported room option skips the intentional 25s preparation;
  // it does not change draw/discard validation. Report the mode explicitly.
  await send(a, 'okey101', 'okey.rules', { roomId: okey.roomId, expectedVersion: state.version,
    rules: { gameType: 'ffa', assistedEnabled: true, foldingEnabled: false, foldToPartnerEnabled: false } });
  await wait(3500); state = await read(a, okey.roomId);
  await send(a, 'okey101', 'okey.start', { roomId: okey.roomId, expectedVersion: state.version });
  let draws = 0, discards = 0;
  for (let step = 0; step < 90 && draws < 36; step++) {
    if (step % 8 === 0) for (const actor of actors) await send(actor, 'okey101', 'room.heartbeat', { roomId: okey.roomId, sessionId: actor.sessionId }, false);
    state = await read(a, okey.roomId);
    if (state.roundEnded) { await send(a, 'okey101', 'okey.newRound', { roomId: okey.roomId, roundId: state.roundId }); continue; }
    const actor = actors.find(item => item.uid === state.turn);
    if (!state.hasDrawnThisTurn) {
      await send(actor, 'okey101', 'okey.draw', { roomId: okey.roomId, roundId: state.roundId,
        expectedPlayVersion: state.playVersion, turnNumber: state.turnNumber, source: 'pile', targetIndex: null }); draws++;
      state = await read(actor, okey.roomId); if (state.roundEnded) continue;
    }
    const own = await read(actor, okey.roomId, true);
    // Toggle two occupied slots to measure real changed layouts too.
    const rack = own.rack.map(tile => tile?.id ?? null), slots = rack.flatMap((tile, i) => tile ? [i] : []);
    [rack[slots[0]], rack[slots[1]]] = [rack[slots[1]], rack[slots[0]]];
    await send(actor, 'okey101', 'okey.arrange', { roomId: okey.roomId, roundId: state.roundId, rack, groups: {} });
    state = await read(actor, okey.roomId);
    await send(actor, 'okey101', 'okey.discard', { roomId: okey.roomId, roundId: state.roundId,
      expectedPlayVersion: state.playVersion, turnNumber: state.turnNumber, tileId: own.rack.find(Boolean).id }); discards++;
  }
  progress(`Okey private baseline: ${draws} draws / ${discards} discards completed.`);
} catch(error) {
  failure=/^\w{1,100}$/.test(error?.message??'') ? error.message : 'baseline_failed';
} finally {
  for(const room of held.filter(item=>!item.closed)) for(const actor of room.actors) {
    try { await send(actor,room.game,'room.leave',{roomId:room.id,sessionId:actor.sessionId},false); } catch { cleanupFailures++; }
  }
  for(const actor of actors) await deleteApp(actor.app);
}
return {capturedAt:new Date().toISOString(),scenario:'europe-preview-browser-rest-client',client:'browser-fetch',
  okeyMode:'four real anonymous identities, assisted, no bot search',layoutAction:'okey.arrange',failure,cleanupFailures,
  samples:rows,summary:summarizePerformance(rows)};
}
