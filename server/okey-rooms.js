import { createHash, randomBytes } from 'node:crypto';
import { requireAction } from './errors.js';
import { freshServerTime, monotonicServerTime } from './time.js';
import { applyOkeyAction, dealOkeyRound, publicOkeyState, privateOkeyView, secureShuffle } from './games/okey.js';
import { okeyCommand } from './okey-schema.js';
import { createBotPlayers } from '../src/games/okey101/botPlayers.js';
import { buildSeatSwapUpdate } from '../src/games/okey101/gameLogic.js';
import { TURN_DURATION_MS } from '../src/games/okey101/tiles.js';

const live = (at, now) => freshServerTime(at, now, 60_000);
const prune = (connections, now) => Object.fromEntries(Object.entries(connections ?? {}).map(([uid, sessions]) =>
  [uid, Object.fromEntries(Object.entries(sessions).filter(([, at]) => live(at, now)).slice(-8))]).filter(([, sessions]) => Object.keys(sessions).length));
const connected = (connections, uid) => Object.keys(connections[uid] ?? {}).length > 0;
const bot = (data, uid) => data.isBotPlayer?.[uid] === true;
const lineup = players => createHash('sha256').update(JSON.stringify([...players].sort())).digest('hex');
const defaults = { gameType: 'ffa', assistedEnabled: false, foldingEnabled: false, foldToPartnerEnabled: false };
const lobbyActions = new Set(['okey.rules', 'okey.team', 'okey.distribute', 'okey.bots', 'okey.start']);
const humanPlayers = data => data.players.filter(uid => !bot(data, uid));
function replaceWithBot(data, uid, connections, now) {
  const replacement = createBotPlayers(1, data.players.indexOf(uid))[0];
  const wasHost = data.host === uid;
  const deadline = data.turnDeadline;
  Object.assign(data, buildSeatSwapUpdate(data, uid, replacement.uid, replacement.name));
  data.turnDeadline = deadline;
  data.isBotPlayer[replacement.uid] = true;
  delete data.handVersions[uid];
  delete connections[uid];
  // A bot inherits the seat, never ownership of the room.
  if (wasHost) data.host = humanPlayers(data).find(id => connected(connections, id)) ?? humanPlayers(data)[0];
  data.status = 'playing'; data.abandonedBy = null; data.abandonReason = null;
  data.playVersion = (data.playVersion ?? 0) + 1;
  if (data.turn === replacement.uid && !data.roundEnded && !data.setupPhase) data.botReadyAt = now + 2000;
}
const readyTeams = data => data.rules.gameType !== '2v2' || (data.teams.A.length === 2 && data.teams.B.length === 2);
function distribute(data) {
  const assigned = new Set([...data.teams.A, ...data.teams.B]);
  for (const uid of secureShuffle(data.players.filter(id => !assigned.has(id)))) {
    (data.teams.A.length <= data.teams.B.length ? data.teams.A : data.teams.B).push(uid);
  }
}
function waitingState(data, players) {
  return { schemaVersion: 2, gameType: 'okey101', gameId: 'okey101', version: data.version,
    host: players.includes(data.host) ? data.host : players.find(id => !bot(data, id)), players,
    spectators: data.spectators, playerNames: Object.fromEntries(players.map(id => [id, data.playerNames[id]])),
    isBotPlayer: Object.fromEntries(players.filter(id => bot(data, id)).map(id => [id, true])),
    scores: Object.fromEntries(players.map(id => [id, 0])), status: 'waiting', isPublic: data.isPublic,
    rules: data.rules, teams: { A: data.teams.A.filter(id => players.includes(id)), B: data.teams.B.filter(id => players.includes(id)) },
    countdownStartedAt: null, roundId: randomBytes(12).toString('hex'), createdAt: data.createdAt,
    abandonedBy: null, abandonReason: null, seatRequests: {}, handVersions: {}, _history: data._history ?? [] };
}

// Called inside the shared action transaction after identity, receipt and rate
// checks. All reads precede all writes, including four-player quick matching.
export async function executeOkeyTransaction({ tx, db, root, uid, action, now, candidateCode, data: publicData, connections, actor, okeySnapshot }) {
  requireAction(action.type.startsWith('okey.') || action.type.startsWith('room.'), 409, 'unsupported_room');
  requireAction(!['room.create', 'room.match'].includes(action.type), 409, 'unsupported_room');
  const roomRef = id => db.doc(`${root}/public/data/roomsV2/${id}`);
  const secretRef = id => db.doc(`${root}/serverOkeyRooms/${id}`);
  const presenceRef = id => db.doc(`${root}/serverRoomPresence/${id}`);
  const queueRef = db.doc(`${root}/public/data/okeyLobby/queue`);
  const touchesQueue = action.type !== 'room.heartbeat' && (!action.type.startsWith('okey.') || ['okey.create', 'okey.match'].includes(action.type) || lobbyActions.has(action.type));
  if (publicData && action.type === 'room.heartbeat') {
    requireAction(publicData.schemaVersion === 2, 409, 'unsupported_room');
    const player = publicData.players.includes(uid) && !bot(publicData, uid);
    requireAction(player || publicData.spectators.includes(uid), 403, 'not_a_player');
    requireAction(publicData.status !== 'closed', 410, 'room_closed');
    const sessions = connections[uid] ?? {};
    requireAction(Object.hasOwn(sessions, action.sessionId) || Object.keys(sessions).length < 8, 429, 'too_many_tabs');
    const renewed = { ...connections, [uid]: { ...sessions, [action.sessionId]: monotonicServerTime(sessions[action.sessionId], now) } };
    const needsRepair = (publicData.hasDealt && publicData.players.some(id => !bot(publicData, id) && !connected(renewed, id)))
      || publicData.spectators.some(id => !connected(renewed, id)) || publicData.status === 'abandoned';
    // Ordinary lease renewal never reads the closed deck or writes game state.
    // Actual seat retirement/recovery still uses the atomic repair path below.
    if (!needsRepair) {
      tx.set(presenceRef(action.roomId), { connections: renewed });
      return { roomId: action.roomId, version: publicData.version, serverNow: now };
    }
  }
  // Generic room commands learn the game from the public room first. Once known,
  // the queue and private state are independent and can share the next batch.
  const needsSecret = publicData && !okeySnapshot;
  const refs = [...(touchesQueue ? [queueRef] : []), ...(needsSecret ? [secretRef(action.roomId)] : [])];
  const snapshots = refs.length ? await tx.getAll(...refs) : [];
  const queue = touchesQueue ? (snapshots.shift().data()?.entries ?? []) : [];
  // Queue membership is structural; room leases, not queue rewrites, prove life.
  const queuedPresence = touchesQueue && queue.length ? await tx.getAll(...queue.map(entry => presenceRef(entry.roomId))) : [];
  let entries = queue.filter((entry, index) => connected(prune(queuedPresence[index]?.data()?.connections, now), entry.host));
  const creatingAction = action.type === 'okey.create', matchAction = action.type === 'okey.match';
  let id = action.roomId, data;
  if (publicData) {
    requireAction(publicData.gameType === 'okey101' && publicData.schemaVersion === 2, 409, 'unsupported_room');
    data = (okeySnapshot ?? snapshots.shift()).data();
    requireAction(data, 503, 'service_unavailable');
  }
  if (matchAction) for (const entry of entries) {
    const [saved, presence] = await tx.getAll(secretRef(entry.roomId), presenceRef(entry.roomId));
    const candidate = saved.data(), sessions = prune(presence.data()?.connections, now);
    if (candidate?.status === 'waiting' && candidate.isPublic && candidate.players.length < 4 && connected(sessions, candidate.host)) {
      id = entry.roomId; data = candidate; connections = sessions; break;
    }
    entries = entries.filter(item => item.roomId !== entry.roomId);
  }
  let creating = false;
  if (creatingAction || (matchAction && !id)) {
    id = candidateCode;
    const [candidate, legacy] = await tx.getAll(roomRef(id), db.doc(`${root}/public/data/rooms/${id}`));
    requireAction(!candidate.exists && !legacy.exists, 409, 'room_code_collision');
    const recentCreates = (actor.createdAt ?? []).filter(at => now >= at && now - at < 60_000);
    requireAction(recentCreates.length < 3, 429, 'too_many_rooms'); actor.createdAt = [...recentCreates, now];
    data = waitingState({ version: 0, host: uid, spectators: [], playerNames: { [uid]: action.nickname },
      isPublic: matchAction || action.isPublic, rules: { ...defaults }, teams: { A: [], B: [] }, createdAt: now }, [uid]);
    creating = true; connections = {};
  }
  requireAction(data?.gameType === 'okey101', 409, 'unsupported_room');
  const before = structuredClone(data);
  const player = data.players.includes(uid) && !bot(data, uid), spectator = data.spectators.includes(uid);
  const joining = ['room.join', 'room.spectate'].includes(action.type) || matchAction;
  requireAction(creating || joining || player || spectator, 403, 'not_a_player');
  requireAction(data.status !== 'closed' || ['room.leave', 'room.disconnect'].includes(action.type), 410, 'room_closed');
  if (Object.hasOwn(action, 'expectedVersion')) requireAction(action.expectedVersion === data.version, 409, 'stale_version');
  if (Object.hasOwn(action, 'expectedPlayVersion')) requireAction(action.expectedPlayVersion === data.playVersion, 409, 'stale_version');
  if (joining && !creating) {
    if (action.type === 'room.spectate' && !player) {
      const viewers = data.spectators.filter(id => connected(connections, id));
      requireAction(viewers.includes(uid) || viewers.length < 30, 409, 'spectator_limit');
      data.spectators = [...new Set([...viewers, uid])];
    } else if (!player) {
      requireAction(data.status === 'waiting' && data.players.length < 4, 409, 'room_full');
      data.players.push(uid); data.spectators = data.spectators.filter(id => id !== uid);
      data.playerNames[uid] = action.nickname; data.scores[uid] = 0;
      if (data.players.length === 4) {
        const previous = data._history.find(item => item.key === lineup(data.players));
        if (previous) {
          const history = data._history, host = data.host, viewers = data.spectators, names = data.playerNames, version = data.version;
          data = { ...structuredClone(previous.state), _history: history, host, spectators: viewers, playerNames: names, version,
            status: 'playing', abandonedBy: null, abandonReason: null };
          if (!data.roundEnded) {
            data.turnDeadline = now + TURN_DURATION_MS; data.botReadyAt = now + 2000;
            if (data.setupPhase) data.setupEndsAt = now + 25_000;
          }
        }
      }
    } else if (data.status === 'abandoned' && data.abandonedBy === uid) {
      data.status = data.racks ? 'playing' : 'waiting'; data.abandonedBy = null; data.abandonReason = null;
    }
  }
  if (action.sessionId && !['room.leave', 'room.disconnect'].includes(action.type)) {
    const sessions = connections[uid] ?? {};
    requireAction(Object.hasOwn(sessions, action.sessionId) || Object.keys(sessions).length < 8, 429, 'too_many_tabs');
    connections[uid] = { ...sessions, [action.sessionId]: monotonicServerTime(sessions[action.sessionId], now) };
  }
  if (action.type === 'room.leave' || action.type === 'room.disconnect') {
    if (action.type === 'room.leave') requireAction(connected(connections, uid) && Object.hasOwn(connections[uid], action.sessionId), 409, 'session_expired');
    // Page hide also fires on refresh. Keep the last lease until its normal
    // 60s expiry so a short reconnect cannot turn a human into a bot.
    if (action.type === 'room.leave' || !data.racks) delete connections[uid]?.[action.sessionId];
    if (action.type === 'room.leave') {
      delete connections[uid];
      if (!player) { data.spectators = data.spectators.filter(id => id !== uid); delete data.seatRequests[uid]; }
      else if (data.status !== 'closed') {
        if (humanPlayers(data).length === 1) { data.status = 'closed'; data.closedBy = uid; }
        else if (!data.racks) data = waitingState(data, data.players.filter(id => id !== uid));
        else replaceWithBot(data, uid, connections, now);
      }
    }
  }
  if (action.type === 'room.heartbeat' && player && data.racks && data.status !== 'closed') {
    // Only a surviving player's heartbeat retires expired seats. Refreshing
    // players renew their own lease above before this decision is made.
    for (const missing of humanPlayers(data).filter(id => !connected(connections, id)
      || (data.status === 'abandoned' && data.abandonedBy === id && data.abandonReason === 'left'))) {
      if (missing !== uid) replaceWithBot(data, missing, connections, now);
    }
  }
  if (['room.wait', 'room.close'].includes(action.type)) {
    requireAction(player && data.status === 'abandoned' && data.abandonedBy !== uid, 409, 'cannot_wait');
    if (action.type === 'room.close') { data.status = 'closed'; data.closedBy = uid; }
    else {
      const historyState = structuredClone(data); delete historyState._history;
      const key = lineup(data.players);
      data._history = [...data._history.filter(item => item.key !== key).slice(-7), { key, state: historyState }];
      data = waitingState(data, data.players.filter(id => id !== data.abandonedBy));
    }
  }
  let outcome = {};
  if (action.type.startsWith('okey.') && !creatingAction && !matchAction) {
    const seatAction = action.type.startsWith('okey.seat.');
    requireAction((seatAction && spectator) || player, 403, 'not_a_player');
    requireAction(connected(connections, uid), 409, 'player_disconnected');
    if (lobbyActions.has(action.type)) {
      requireAction(data.status === 'waiting' && !data.racks, 409, 'lobby_locked');
      if (!['okey.team', 'okey.start'].includes(action.type)) requireAction(data.host === uid, 403, 'host_required');
      if (action.type === 'okey.rules') data.rules = action.rules;
      if (action.type === 'okey.team') {
        requireAction(data.rules.gameType === '2v2' && data.players.includes(action.targetUid)
          && (data.host === uid || action.targetUid === uid), 403, 'invalid_team');
        const next = { A: data.teams.A.filter(id => id !== action.targetUid), B: data.teams.B.filter(id => id !== action.targetUid) };
        if (action.team) { requireAction(next[action.team].length < 2, 409, 'team_full'); next[action.team].push(action.targetUid); }
        data.teams = next;
      }
      if (action.type === 'okey.distribute') distribute(data);
      if (action.type === 'okey.bots') {
        requireAction(data.players.length < 4, 409, 'room_full');
        for (const b of createBotPlayers(4 - data.players.length, data.players.length)) {
          data.players.push(b.uid); data.playerNames[b.uid] = b.name; data.isBotPlayer[b.uid] = true; data.scores[b.uid] = 0;
        }
        if (data.rules.gameType === '2v2') distribute(data);
      }
      if (action.type === 'okey.start') {
        requireAction(data.players.length === 4 && readyTeams(data), 409, 'teams_incomplete');
        requireAction(data.countdownStartedAt && now >= data.countdownStartedAt + 3000, 409, 'too_early');
        data = dealOkeyRound(data, now);
      }
    } else if (seatAction) {
      if (action.type === 'okey.seat.request') {
        requireAction(spectator && !player && data.status === 'playing' && bot(data, action.botUid)
          && data.players.includes(action.botUid), 409, 'seat_unavailable');
        data.seatRequests[uid] = { botUid: action.botUid, name: action.nickname, at: now };
      }
      if (action.type === 'okey.seat.cancel') delete data.seatRequests[uid];
      if (action.type === 'okey.seat.resolve') {
        requireAction(data.host === uid && player, 403, 'host_required');
        const request = data.seatRequests[action.requesterUid];
        requireAction(request && data.spectators.includes(action.requesterUid) && connected(connections, action.requesterUid)
          && data.players.includes(request.botUid) && bot(data, request.botUid), 409, 'seat_unavailable');
        if (action.accept) {
          const wasTurn = data.turn === request.botUid;
          Object.assign(data, buildSeatSwapUpdate(data, request.botUid, action.requesterUid, request.name));
          data.playVersion = (data.playVersion ?? 0) + 1;
          if (wasTurn && !data.roundEnded && !data.setupPhase) data.turnDeadline = now + TURN_DURATION_MS;
        } else delete data.seatRequests[action.requesterUid];
      }
    } else {
      const applied = applyOkeyAction(data, uid, okeyCommand(action), now);
      data = applied.state; outcome = applied.result;
      if (action.type !== 'okey.layout') data.playVersion = (data.playVersion ?? 0) + 1;
    }
  }
  const countdown = data.status === 'waiting' && data.players.length === 4 && readyTeams(data);
  if (countdown && !data.countdownStartedAt) data.countdownStartedAt = now;
  else if (!countdown) data.countdownStartedAt = null;
  data.spectators = data.spectators.filter(id => connected(connections, id));
  data.seatRequests = Object.fromEntries(Object.entries(data.seatRequests).filter(([id, request]) =>
    data.spectators.includes(id) && data.players.includes(request.botUid) && bot(data, request.botUid)));
  let changed = JSON.stringify(data) !== JSON.stringify(before);
  if (changed && !creating) data.version = before.version + 1;
  if (changed || creating) data.updatedAt = monotonicServerTime(data.updatedAt, now);
  const handWrites = [];
  data.handVersions ??= {};
  if (data.racks) for (const id of humanPlayers(data)) {
    const view = privateOkeyView(data, id);
    const oldView = before.racks?.[id] ? privateOkeyView(before, id) : null;
    if (JSON.stringify(view) !== JSON.stringify(oldView)) {
      data.handVersions[id] = (data.handVersions[id] ?? 0) + 1;
      handWrites.push([id, { ...view, handVersion: data.handVersions[id] }]);
      changed = true;
    }
  }
  entries = entries.filter(entry => entry.roomId !== id);
  if (touchesQueue && data.isPublic && data.status === 'waiting' && data.players.length < 4 && connected(connections, data.host)) {
    requireAction(entries.length < 30, 503, 'match_queue_full');
    entries.push({ roomId: id, host: data.host, players: data.players.length, leaseManaged: true, updatedAt: Math.max(now, ...Object.values(connections[data.host])) });
  }
  if (changed || creating) {
    tx.set(secretRef(id), data); tx.set(roomRef(id), publicOkeyState(data));
    for (const [uid, view] of handWrites) tx.set(roomRef(id).collection('playerData').doc(uid), view);
    for (const retired of humanPlayers(before).filter(uid => !data.players.includes(uid))) {
      tx.delete(roomRef(id).collection('playerData').doc(retired));
    }
  }
  if (creating || joining || action.type.startsWith('room.')) tx.set(presenceRef(id), { connections });
  if (touchesQueue && JSON.stringify(entries) !== JSON.stringify(queue)) tx.set(queueRef, { entries });
  return { roomId: id, version: data.version, serverNow: now, ...outcome };
}
