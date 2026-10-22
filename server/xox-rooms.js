import { createHash, randomInt } from 'node:crypto';
import { requireAction } from './errors.js';
import { applyXoxMove } from './games/xox.js';
import { validateAction } from './room-schema.js';

export const CONNECTION_TTL = 60_000;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
const live = (time, now) => Number.isFinite(time) && time <= now && now - time < CONNECTION_TTL;
const pair = players => createHash('sha256').update(JSON.stringify([...players].sort())).digest('hex');
const matchFields = ['players', 'board', 'turn', 'startingPlayer', 'winner', 'winningLine', 'scores', 'rematchRequestedBy'];
const matchState = data => Object.fromEntries(matchFields.map(key => [key, data[key] ?? null]));

function pruneConnections(connections, now) {
  return Object.fromEntries(Object.entries(connections ?? {}).map(([uid, sessions]) => [uid,
    Object.fromEntries(Object.entries(sessions).filter(([, at]) => live(at, now)).slice(-8)),
  ]).filter(([, sessions]) => Object.keys(sessions).length));
}
function connected(connections, uid) { return Object.keys(connections[uid] ?? {}).length > 0; }
function freshGame(players, scores, starter = players[0]) {
  return { board: Array(9).fill(null), turn: starter, startingPlayer: starter, winner: null, winningLine: null,
    scores: Object.fromEntries(players.map(uid => [uid, scores?.[uid] ?? 0])), rematchRequestedBy: null };
}

// All public game data and server-only connection/receipt records are committed
// together. No client-supplied identity, board, result or score is accepted.
export async function executeRoomAction(db, projectId, uid, input, now = Date.now(), codeSupplier = newCode) {
  const action = validateAction(input);
  requireAction(typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid), 401, 'invalid_identity');
  const fingerprint = createHash('sha256').update(JSON.stringify(action)).digest('hex');
  const root = `artifacts/${projectId}`;
  const roomRef = id => db.doc(`${root}/public/data/roomsV2/${id}`);
  const presenceRef = id => db.doc(`${root}/serverRoomPresence/${id}`);
  const actorRef = db.doc(`${root}/serverRoomActors/${uid}`);
  const rateRef = db.doc(`${root}/serverRateLimits/${uid}`);
  const queueRef = db.doc(`${root}/public/data/xoxLobby/queue`);
  const candidateCode = ['room.create', 'room.match'].includes(action.type) ? codeSupplier() : null;
  if (candidateCode) requireAction(/^[A-Z0-9]{6}$/.test(candidateCode), 500, 'invalid_generated_code');

  return db.runTransaction(async tx => {
    const [actorSnap, rateSnap] = await tx.getAll(actorRef, rateRef);
    const actor = actorSnap.data() ?? {};
    const recent = actor.recent ?? [];
    const receipt = recent.find(item => item.actionId === action.actionId);
    if (receipt) {
      requireAction(receipt.fingerprint === fingerprint, 409, 'action_id_reused');
      return receipt.result;
    }
    const rate = rateSnap.data();
    const sameWindow = rate && now >= rate.windowStart && now - rate.windowStart < 10_000;
    const count = sameWindow ? rate.count : 0;
    requireAction(count < 30, 429, 'too_many_actions');
    const touchesQueue = action.type.startsWith('room.');
    const queue = touchesQueue ? ((await tx.get(queueRef)).data()?.entries ?? []) : [];
    let entries = queue.filter(entry => live(entry.updatedAt, now));
    let id = action.roomId;
    let data;
    let connections;
    let creating = false;
    if (action.type === 'room.match') {
      // A single bounded queue document serializes simultaneous match requests;
      // two users cannot both miss an empty query and create separate rooms.
      for (const entry of entries) {
        const [saved, presence] = await tx.getAll(roomRef(entry.roomId), presenceRef(entry.roomId));
        const room = saved.data();
        const sessions = pruneConnections(presence.data()?.connections, now);
        if (room?.status === 'waiting' && room.isPublic && room.players?.length === 1 && connected(sessions, room.host)) {
          if (room.host === uid) { id = entry.roomId; data = room; connections = sessions; break; }
          id = entry.roomId; data = room; connections = sessions; break;
        }
        entries = entries.filter(item => item.roomId !== entry.roomId);
      }
    }
    if (action.type === 'room.create' || (action.type === 'room.match' && !id)) {
      id = candidateCode;
      const [candidate, legacy] = await tx.getAll(roomRef(id), db.doc(`${root}/public/data/rooms/${id}`));
      requireAction(!candidate.exists && !legacy.exists, 409, 'room_code_collision');
      const recentCreates = (actor.createdAt ?? []).filter(at => now >= at && now - at < 60_000);
      requireAction(recentCreates.length < 3, 429, 'too_many_rooms');
      actor.createdAt = [...recentCreates, now];
      data = { schemaVersion: 2, gameType: 'xox', gameId: 'xox', version: 0,
        host: uid, players: [uid], spectators: [], playerNames: { [uid]: action.nickname },
        status: 'waiting', isPublic: action.type === 'room.match' || action.isPublic,
        ...freshGame([uid]), turn: null, startingPlayer: null,
        abandonedBy: null, abandonReason: null, createdAt: now, history: [] };
      connections = {};
      creating = true;
    } else if (!data) {
      const [saved, presence] = await tx.getAll(roomRef(id), presenceRef(id));
      requireAction(saved.exists, 404, 'room_not_found');
      data = saved.data();
      connections = pruneConnections(presence.data()?.connections, now);
    }
    requireAction(data.schemaVersion === 2 && data.gameType === 'xox', 409, 'unsupported_room');
    const originalPublic = JSON.stringify(data);
    data.spectators ??= [];
    data.history ??= [];
    const player = data.players.includes(uid);
    const spectator = data.spectators.includes(uid);
    const joining = ['room.join', 'room.match', 'room.spectate'].includes(action.type);
    requireAction(creating || joining || player || spectator, 403, 'not_a_player');
    requireAction(data.status !== 'closed' || ['room.leave', 'room.disconnect'].includes(action.type), 410, 'room_closed');
    if (Object.hasOwn(action, 'expectedVersion')) requireAction(data.version === action.expectedVersion, 409, 'stale_version');
    let changed = creating;

    if (joining && !creating) {
      if (action.type === 'room.spectate' && !player) {
        const spectators = data.spectators.filter(id => connected(connections, id));
        requireAction(spectators.includes(uid) || spectators.length < 30, 409, 'spectator_limit');
        data.spectators = [...new Set([...spectators, uid])];
      } else if (!player) {
        requireAction(data.players.length < 2 && data.status === 'waiting', 409, 'room_full');
        data.players = [...data.players, uid];
        data.spectators = data.spectators.filter(id => id !== uid);
        data.playerNames = { ...data.playerNames, [uid]: action.nickname };
        const previous = data.history.find(item => item.key === pair(data.players));
        if (previous) Object.assign(data, previous.state);
        else Object.assign(data, freshGame(data.players));
        data.status = 'playing'; data.abandonedBy = null; data.abandonReason = null;
      }
      changed = true;
    }
    if (action.sessionId && !['room.leave', 'room.disconnect'].includes(action.type)) {
      const sessions = connections[uid] ?? {};
      requireAction(Object.hasOwn(sessions, action.sessionId) || Object.keys(sessions).length < 8, 429, 'too_many_tabs');
      connections[uid] = { ...sessions, [action.sessionId]: now };
    }
    if (action.type === 'room.leave' || action.type === 'room.disconnect') {
      if (action.type === 'room.leave') requireAction(Object.hasOwn(connections[uid] ?? {}, action.sessionId), 409, 'session_expired');
      delete connections[uid]?.[action.sessionId];
      if (action.type === 'room.leave') {
        // Explicitly leaving a seat applies to this identity. Merely closing a
        // tab removes that tab's lease and leaves other tabs connected.
        delete connections[uid];
        if (player) {
          if (data.players.length === 1 || (data.status === 'abandoned' && data.abandonedBy !== uid)) {
            data.status = 'closed'; data.closedBy = uid;
          } else { data.status = 'abandoned'; data.abandonedBy = uid; data.abandonReason = 'left'; }
        } else data.spectators = data.spectators.filter(id => id !== uid);
        changed = true;
      }
    }
    if (action.type === 'room.wait') {
      requireAction(player && data.status === 'abandoned' && data.abandonedBy !== uid, 409, 'cannot_wait');
      if (data.abandonReason === 'left') {
        if (data.players.length === 2) {
          const key = pair(data.players);
          data.history = [...data.history.filter(item => item.key !== key).slice(-7), { key, state: matchState(data) }];
        }
        data.players = data.players.filter(id => id !== data.abandonedBy);
        data.host = data.players[0]; data.status = 'waiting'; data.turn = null;
        data.abandonedBy = null; data.abandonReason = null; changed = true;
      }
    }
    if (action.type === 'room.close') {
      requireAction(player && data.status === 'abandoned' && data.abandonedBy !== uid, 409, 'cannot_close');
      requireAction(data.abandonReason === 'left' || !connected(connections, data.abandonedBy), 409, 'player_reconnected');
      data.status = 'closed'; data.closedBy = uid; changed = true;
    }
    if (action.type.startsWith('xox.')) {
      requireAction(player, 403, 'not_a_player');
      // Closed tabs or deliberately departed seats cannot continue sending
      // moves using a still-valid Firebase token.
      requireAction(connected(connections, uid) && data.players.every(id => connected(connections, id)), 409, 'player_disconnected');
    }
    if (action.type === 'xox.move') {
      Object.assign(data, applyXoxMove(data, uid, action.cell)); changed = true;
    }
    if (action.type.startsWith('xox.rematch.')) {
      requireAction(player, 403, 'not_a_player');
      requireAction(data.status === 'playing' && data.winner && data.players.length === 2, 409, 'game_not_finished');
      if (action.type === 'xox.rematch.request') {
        requireAction(!data.rematchRequestedBy || data.rematchRequestedBy === uid, 409, 'rematch_pending');
        data.rematchRequestedBy = uid;
      } else {
        requireAction(data.rematchRequestedBy && data.rematchRequestedBy !== uid, 409, 'invalid_rematch');
        if (action.type === 'xox.rematch.accept') {
          const starter = data.players.find(id => id !== data.startingPlayer);
          Object.assign(data, freshGame(data.players, data.scores, starter));
        } else { data.status = 'closed'; data.closedBy = uid; }
      }
      changed = true;
    }
    if (!['room.leave', 'room.close', 'room.wait'].includes(action.type) && data.players.length === 2 && data.status !== 'closed') {
      const missing = data.players.find(id => !connected(connections, id));
      if (missing && data.abandonReason !== 'left' && (data.status !== 'abandoned' || data.abandonedBy !== missing)) {
        data.status = 'abandoned'; data.abandonedBy = missing; data.abandonReason = 'disconnected'; changed = true;
      } else if (!missing && data.status === 'abandoned' && (data.abandonReason !== 'left' || (joining && data.abandonedBy === uid))) {
        data.status = 'playing'; data.abandonedBy = null; data.abandonReason = null; changed = true;
      }
    }
    data.spectators = data.spectators.filter(id => connected(connections, id));
    const remembered = new Set([...data.players, ...data.history.flatMap(item => item.state.players)]);
    data.playerNames = Object.fromEntries(Object.entries(data.playerNames ?? {}).filter(([id]) => remembered.has(id)));
    if (changed && !creating) data.version += 1;
    const publicChanged = creating || changed || JSON.stringify(data) !== originalPublic;
    if (publicChanged) data.updatedAt = now;
    if (touchesQueue) {
      entries = entries.filter(item => item.roomId !== id);
      if (data.isPublic && data.status === 'waiting' && data.players.length === 1 && connected(connections, data.host)) {
        requireAction(entries.length < 30, 503, 'match_queue_full');
        entries.push({ roomId: id, host: data.host, updatedAt: now });
      }
    }
    const result = { roomId: id, version: data.version, winner: data.winner };
    if (publicChanged) tx.set(roomRef(id), data);
    tx.set(presenceRef(id), { connections });
    if (touchesQueue && JSON.stringify(entries) !== JSON.stringify(queue)) tx.set(queueRef, { entries });
    tx.set(actorRef, { ...actor, recent: [...recent.slice(-31), { actionId: action.actionId, fingerprint, result }] });
    tx.set(rateRef, { windowStart: sameWindow ? rate.windowStart : now, count: count + 1 });
    return result;
  });
}
