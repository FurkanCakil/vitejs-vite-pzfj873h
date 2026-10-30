// Explicit, bounded production baseline in new private rooms only. No Admin
// credentials, public matching, existing room IDs, deletion or load generation.
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { summarizePerformance } from '../src/utils/gamePerformance.js';

if (!process.argv.includes('--production-private-baseline')) throw Error('Explicit --production-private-baseline is required');
process.loadEnvFile('.env');
const project = process.env.VITE_FIREBASE_PROJECT_ID, key = process.env.VITE_FIREBASE_API_KEY;
if (project !== 'oyun-odasi-8ecee' || !key) throw Error('Expected project client configuration is required');
const base = 'https://www.xn--oyunportal-6ub.com.tr', rows = [], actors = [], held = [];
let sequence = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
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
    Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json', 'X-Game-Perf': '1',
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
let failure = null;
try {
  for (let i = 0; i < 4; i++) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(key)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error(`signup_${response.status}`);
    const account = await response.json(); actors.push({ uid: account.localId, token: account.idToken, sessionId: randomBytes(16).toString('hex') });
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
  console.log('XOX private baseline: 60 moves completed.');
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
    await send(actor, 'okey101', 'okey.layout', { roomId: okey.roomId, roundId: state.roundId, rack, groups: {} });
    state = await read(actor, okey.roomId);
    await send(actor, 'okey101', 'okey.discard', { roomId: okey.roomId, roundId: state.roundId,
      expectedPlayVersion: state.playVersion, turnNumber: state.turnNumber, tileId: own.rack.find(Boolean).id }); discards++;
  }
  console.log(`Okey private baseline: ${draws} draws / ${discards} discards completed.`);
} catch (error) {
  failure = /^\w{1,100}$/.test(error?.message ?? '') ? error.message : 'baseline_failed'; process.exitCode = 1;
} finally {
  for (const room of held.filter(item => !item.closed)) for (const actor of room.actors) {
    try { await send(actor, room.game, 'room.leave', { roomId: room.id, sessionId: actor.sessionId }, false); } catch { /* report cleanup below */ }
  }
  const report = { capturedAt: new Date().toISOString(), scenario: 'production-private-rest-client',
    node: process.version, okeyMode: 'four real anonymous identities, assisted, no bot search', failure,
    samples: rows, summary: summarizePerformance(rows) };
  await writeFile('performance-api-baseline.local', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ failure, n: rows.length, summary: report.summary.filter(item => ['xox.move', 'okey.draw', 'okey.discard', 'okey.layout'].includes(item.action)) }));
}
