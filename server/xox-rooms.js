import { createHash, randomInt, randomBytes } from 'node:crypto';
import { requireAction } from './errors.js';
import { freshServerTime, monotonicServerTime } from './time.js';
import { applyXoxMove } from './games/xox.js';
import { applyConnect4Move, freshConnect4 } from './games/connect4.js';
import { applyCheckersMove, freshCheckers } from './games/checkers.js';
import { applyChessMove, freshChess, applyChessOffer, resignChess } from './games/chess.js';
import { freshTavla, rollTavla, resetTavlaOpening, moveTavla, undoTavla, cubeTavla } from './games/tavla.js';
import { freshBattle, validateFleet, applyBattleShot } from './games/battleship.js';
import { validateAction } from './room-schema.js';
import { executeOkeyTransaction } from './okey-rooms.js';

export const CONNECTION_TTL = 60_000;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
const live = (time, now) => freshServerTime(time, now, CONNECTION_TTL);
const pair = players => createHash('sha256').update(JSON.stringify([...players].sort())).digest('hex');
const matchFields = ['players', 'board', 'turn', 'startingPlayer', 'winner', 'winningLine', 'scores', 'rematchRequestedBy'];
const battleFields = ['players', 'setupPhase', 'roundId', 'readyPlayers', 'shots', 'revealedShips', 'turn', 'startingPlayer', 'winner', 'scores', 'rematchRequestedBy'];
const chessFields = [...matchFields, 'playerColors', 'captured', 'halfmoveClock', 'positionHistory', 'enPassantTarget',
  'lastMove', 'previousState', 'chessMoves', 'notationStartFen', 'drawReason', 'winReason', 'drawOffer', 'takebackOffer'];
const tavlaFields = [...matchFields, 'playerColors', 'bar', 'borneOff', 'dice', 'usedDice', 'phase', 'openingRolls',
  'cubeValue', 'cubeOwner', 'cubeOfferBy', 'initialTurnState'];
const matchState = data => Object.fromEntries((data.gameType === 'amiralbatti' ? battleFields
  : data.gameType === 'tavla' ? tavlaFields
  : data.gameType === 'satranc' ? chessFields
  : data.gameType === 'connect4' ? [...matchFields, 'lastMove']
    : data.gameType === 'dama' ? [...matchFields, 'playerColors', 'multiJumpIdx'] : matchFields).map(key => [key, data[key] ?? null]));

function pruneConnections(connections, now) {
  return Object.fromEntries(Object.entries(connections ?? {}).map(([uid, sessions]) => [uid,
    Object.fromEntries(Object.entries(sessions).filter(([, at]) => live(at, now)).slice(-8)),
  ]).filter(([, sessions]) => Object.keys(sessions).length));
}
function connected(connections, uid) { return Object.keys(connections[uid] ?? {}).length > 0; }
function freshGame(players, scores, starter = players[0], game = 'xox', roundId, playerColors) {
  if (game === 'tavla') {
    const white = playerColors ? players.find(uid => ['w', 'white'].includes(playerColors[uid]))
      ?? players.find(uid => uid !== players[0]) : starter;
    return freshTavla(players, scores, white);
  }
  if (game === 'amiralbatti') return freshBattle(players, scores, starter, roundId);
  if (game === 'connect4') return freshConnect4(players, scores, starter);
  if (game === 'dama' || game === 'satranc') {
    const white = playerColors ? players.find(uid => playerColors[uid] === 'w')
      ?? players.find(uid => uid !== players[0]) : starter;
    return game === 'dama' ? freshCheckers(players, scores, white) : freshChess(players, scores, white);
  }
  return { board: Array(9).fill(null), turn: starter, startingPlayer: starter, winner: null, winningLine: null,
    scores: Object.fromEntries(players.map(uid => [uid, scores?.[uid] ?? 0])), rematchRequestedBy: null };
}

// All public game data and server-only connection/receipt records are committed
// together. No client-supplied identity, board, result or score is accepted.
export async function executeRoomAction(db, projectId, uid, input, now = Date.now(), codeSupplier = newCode,
  { battleshipEnabled = process.env.BATTLESHIP_API_ENABLED === 'true', okeyEnabled = process.env.OKEY_API_ENABLED === 'true',
    connect4Enabled = process.env.CONNECT4_API_ENABLED === 'true', checkersEnabled = process.env.CHECKERS_API_ENABLED === 'true',
    chessEnabled = process.env.CHESS_API_ENABLED === 'true', tavlaEnabled = process.env.TAVLA_API_ENABLED === 'true', metrics } = {}) {
  const action = validateAction(input);
  requireAction(typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid), 401, 'invalid_identity');
  const fingerprint = createHash('sha256').update(JSON.stringify(action)).digest('hex');
  const root = `artifacts/${projectId}`;
  const roomRef = id => db.doc(`${root}/public/data/roomsV2/${id}`);
  const presenceRef = id => db.doc(`${root}/serverRoomPresence/${id}`);
  const actorRef = db.doc(`${root}/serverRoomActors/${uid}`);
  const rateRef = db.doc(`${root}/serverRateLimits/${uid}`);
  const createAction = ['room.create', 'battleship.create', 'okey.create', 'connect4.create', 'checkers.create', 'chess.create', 'tavla.create'].includes(action.type);
  const matchAction = ['room.match', 'battleship.match', 'okey.match', 'connect4.match', 'checkers.match', 'chess.match', 'tavla.match'].includes(action.type);
  const candidateCode = createAction || matchAction ? codeSupplier() : null;
  const nextRoundId = randomBytes(12).toString('hex');
  const checkersHostColor = randomInt(2) === 0 ? 'w' : 'b';
  // Sample once per request, outside the transaction callback. Transaction
  // retries and saved action receipts cannot become free dice rerolls.
  const tavlaRolls = action.type === 'tavla.roll' ? [randomInt(1, 7), randomInt(1, 7)] : null;
  if (candidateCode) requireAction(/^[A-Z0-9]{6}$/.test(candidateCode), 500, 'invalid_generated_code');

  return db.runTransaction(async tx => {
    // These paths are already known from the validated command. One read batch
    // keeps the receipt, rate, room and lease in the same transaction snapshot.
    // Check receipts before interpreting room data, including for retired rooms.
    const existingRoom = !createAction && !matchAction;
    const directOkey = existingRoom && action.type.startsWith('okey.');
    const [actorSnap, rateSnap, saved, presence, okeySnapshot] = await tx.getAll(
      actorRef, rateRef,
      ...(existingRoom ? [roomRef(action.roomId), presenceRef(action.roomId)] : []),
      ...(directOkey ? [db.doc(`${root}/serverOkeyRooms/${action.roomId}`)] : []),
    );
    const actor = actorSnap.data() ?? {};
    const recent = actor.recent ?? [];
    const receipt = recent.find(item => item.actionId === action.actionId);
    if (receipt) {
      requireAction(receipt.fingerprint === fingerprint, 409, 'action_id_reused');
      return receipt.result;
    }
    const rate = rateSnap.data();
    const sameWindow = rate && freshServerTime(rate.windowStart, now, 10_000);
    const count = sameWindow ? rate.count : 0;
    requireAction(count < 30, 429, 'too_many_actions');
    let id = action.roomId;
    let data;
    let connections;
    let creating = false;
    let game = action.type.startsWith('okey.') ? 'okey101' : action.type.startsWith('battleship.') ? 'amiralbatti'
      : action.type.startsWith('connect4.') ? 'connect4' : action.type.startsWith('checkers.') ? 'dama' : action.type.startsWith('chess.') ? 'satranc' : action.type.startsWith('tavla.') ? 'tavla' : 'xox';
    if (!createAction && !matchAction) {
      requireAction(saved.exists, 404, 'room_not_found');
      data = saved.data(); game = data.gameType;
      connections = pruneConnections(presence.data()?.connections, now);
    }
    metrics?.selectGame(game);
    if (game === 'okey101') {
      requireAction(okeyEnabled, 503, 'server_not_enabled');
      const result = await executeOkeyTransaction({ tx, db, root, uid, action, now, candidateCode, data, connections, actor, okeySnapshot });
      tx.set(actorRef, { ...actor, recent: [...recent.slice(-31), { actionId: action.actionId, fingerprint, result }] });
      tx.set(rateRef, { windowStart: sameWindow ? rate.windowStart : now, count: count + 1 });
      return result;
    }
    requireAction(['xox', 'amiralbatti', 'connect4', 'dama', 'satranc', 'tavla'].includes(game) && !action.type.startsWith('okey.'), 409, 'unsupported_room');
    requireAction(game !== 'amiralbatti' || battleshipEnabled, 503, 'server_not_enabled');
    requireAction(game !== 'connect4' || connect4Enabled, 503, 'server_not_enabled');
    requireAction(game !== 'dama' || checkersEnabled, 503, 'server_not_enabled');
    requireAction(game !== 'satranc' || chessEnabled, 503, 'server_not_enabled');
    requireAction(game !== 'tavla' || tavlaEnabled, 503, 'server_not_enabled');
    if (action.type.startsWith('xox.')) requireAction(game === 'xox', 409, 'unsupported_room');
    if (action.type.startsWith('battleship.')) requireAction(game === 'amiralbatti', 409, 'unsupported_room');
    if (action.type.startsWith('connect4.')) requireAction(game === 'connect4', 409, 'unsupported_room');
    if (action.type.startsWith('checkers.')) requireAction(game === 'dama', 409, 'unsupported_room');
    if (action.type.startsWith('chess.')) requireAction(game === 'satranc', 409, 'unsupported_room');
    if (action.type.startsWith('tavla.')) requireAction(game === 'tavla', 409, 'unsupported_room');
    const queueRef = db.doc(`${root}/public/data/${{ xox: 'xoxLobby', amiralbatti: 'battleshipLobby', connect4: 'connect4Lobby', dama: 'checkersLobby', satranc: 'chessLobby', tavla: 'tavlaLobby' }[game]}/queue`);
    const touchesQueue = action.type.startsWith('room.') || createAction || matchAction;
    const queue = touchesQueue ? ((await tx.get(queueRef)).data()?.entries ?? []) : [];
    let entries = queue.filter(entry => live(entry.updatedAt, now));
    if (matchAction) {
      // A single bounded queue document serializes simultaneous match requests;
      // two users cannot both miss an empty query and create separate rooms.
      for (const entry of entries) {
        const [saved, presence] = await tx.getAll(roomRef(entry.roomId), presenceRef(entry.roomId));
        const room = saved.data();
        const sessions = pruneConnections(presence.data()?.connections, now);
        if (room?.gameType === game && room.status === 'waiting' && room.isPublic && room.players?.length === 1 && connected(sessions, room.host)) {
          if (room.host === uid) { id = entry.roomId; data = room; connections = sessions; break; }
          id = entry.roomId; data = room; connections = sessions; break;
        }
        entries = entries.filter(item => item.roomId !== entry.roomId);
      }
    }
    if (createAction || (matchAction && !id)) {
      id = candidateCode;
      const [candidate, legacy] = await tx.getAll(roomRef(id), db.doc(`${root}/public/data/rooms/${id}`));
      requireAction(!candidate.exists && !legacy.exists, 409, 'room_code_collision');
      const recentCreates = (actor.createdAt ?? []).filter(at => live(at, now));
      requireAction(recentCreates.length < 3, 429, 'too_many_rooms');
      actor.createdAt = [...recentCreates, now];
      data = { schemaVersion: 2, gameType: game, gameId: game, version: 0,
        host: uid, players: [uid], spectators: [], playerNames: { [uid]: action.nickname },
        status: 'waiting', isPublic: matchAction || action.isPublic,
        ...freshGame([uid], undefined, undefined, game, nextRoundId, { [uid]: checkersHostColor }), turn: null, startingPlayer: null,
        abandonedBy: null, abandonReason: null, createdAt: now, history: [] };
      connections = {};
      creating = true;
    } else if (!data) {
      const [saved, presence] = await tx.getAll(roomRef(id), presenceRef(id));
      requireAction(saved.exists, 404, 'room_not_found');
      data = saved.data();
      connections = pruneConnections(presence.data()?.connections, now);
    }
    requireAction(data.schemaVersion === 2 && data.gameType === game, 409, 'unsupported_room');
    const originalPublic = JSON.stringify(data);
    data.spectators ??= [];
    data.history ??= [];
    const player = data.players.includes(uid);
    const spectator = data.spectators.includes(uid);
    const joining = ['room.join', 'room.spectate'].includes(action.type) || matchAction;
    requireAction(creating || joining || player || spectator, 403, 'not_a_player');
    requireAction(data.status !== 'closed' || ['room.leave', 'room.disconnect'].includes(action.type), 410, 'room_closed');
    if (Object.hasOwn(action, 'expectedVersion')) requireAction(data.version === action.expectedVersion, 409, 'stale_version');
    if (Object.hasOwn(action, 'roundId')) requireAction(data.roundId === action.roundId, 409, 'stale_round');
    const battle = game === 'amiralbatti';
    const fleetRef = db.doc(`${root}/serverBattleFleets/${id}`);
    const needsFleet = battle && (creating || joining || action.type === 'room.wait' || action.type.startsWith('battleship.'));
    const secret = needsFleet && !creating ? ((await tx.get(fleetRef)).data() ?? { fleets: {}, history: [] }) : { fleets: {}, history: [] };
    let fleetChanged = battle && creating;
    let shotHit;
    let changed = creating;
    const chessHistoryRef = key => db.doc(`${root}/serverChessHistory/${id}/matches/${key}`);
    let chessArchive = null;
    let chessEvicted = [];

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
        if (previous && game === 'satranc') {
          const saved = await tx.get(chessHistoryRef(previous.key));
          requireAction(saved.exists, 503, 'service_unavailable');
          Object.assign(data, saved.data());
        } else if (previous) Object.assign(data, previous.state);
        else Object.assign(data, freshGame(data.players, undefined, undefined, game, nextRoundId, data.playerColors));
        if (battle) {
          const savedFleet = secret.history.find(item => item.key === pair(data.players));
          requireAction(!previous || savedFleet?.roundId === data.roundId, 503, 'service_unavailable');
          secret.fleets = previous ? savedFleet.fleets : {}; fleetChanged = true;
        }
        data.status = 'playing'; data.abandonedBy = null; data.abandonReason = null;
      }
      changed = true;
    }
    if (action.sessionId && !['room.leave', 'room.disconnect'].includes(action.type)) {
      const sessions = connections[uid] ?? {};
      requireAction(Object.hasOwn(sessions, action.sessionId) || Object.keys(sessions).length < 8, 429, 'too_many_tabs');
      connections[uid] = { ...sessions, [action.sessionId]: monotonicServerTime(sessions[action.sessionId], now) };
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
          const others = data.history.filter(item => item.key !== key);
          if (game === 'satranc') {
            chessArchive = { key, state: matchState(data) };
            chessEvicted = others.slice(0, Math.max(0, others.length - 7)).map(item => item.key);
          }
          data.history = [...others.slice(-7), { key, state: game === 'satranc' ? { players: [...data.players] } : matchState(data) }];
          if (battle) {
            secret.history = [...secret.history.filter(item => item.key !== key).slice(-7), { key, roundId: data.roundId, fleets: secret.fleets }];
            fleetChanged = true;
          }
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
    if (action.type.startsWith('xox.') || ((action.type.startsWith('battleship.') || action.type.startsWith('connect4.') || action.type.startsWith('checkers.') || action.type.startsWith('chess.') || action.type.startsWith('tavla.')) && !createAction && !matchAction)) {
      requireAction(player, 403, 'not_a_player');
      // Closed tabs or deliberately departed seats cannot continue sending
      // moves using a still-valid Firebase token.
      requireAction(connected(connections, uid) && data.players.every(id => connected(connections, id)), 409, 'player_disconnected');
    }
    if (action.type === 'xox.move') {
      Object.assign(data, applyXoxMove(data, uid, action.cell)); changed = true;
    }
    if (action.type === 'connect4.move') {
      Object.assign(data, applyConnect4Move(data, uid, action.column)); changed = true;
    }
    if (action.type === 'checkers.move') {
      Object.assign(data, applyCheckersMove(data, uid, action.from, action.to)); changed = true;
    }
    if (action.type === 'chess.move') {
      Object.assign(data, applyChessMove(data, uid, action.from, action.to, action.promotion)); changed = true;
    }
    if (action.type === 'chess.resign') { Object.assign(data, resignChess(data, uid)); changed = true; }
    if (action.type === 'tavla.roll') { Object.assign(data, rollTavla(data, uid, tavlaRolls)); changed = true; }
    if (action.type === 'tavla.opening.reset') { Object.assign(data, resetTavlaOpening(data, uid)); changed = true; }
    if (action.type === 'tavla.move') { Object.assign(data, moveTavla(data, uid, action.from, action.to, action.die)); changed = true; }
    if (action.type === 'tavla.undo') { Object.assign(data, undoTavla(data, uid)); changed = true; }
    if (action.type.startsWith('tavla.cube.')) { Object.assign(data, cubeTavla(data, uid, action.type.split('.')[2])); changed = true; }
    if (action.type.startsWith('chess.draw.') || action.type.startsWith('chess.takeback.')) {
      const [, kind, decision] = action.type.split('.');
      Object.assign(data, applyChessOffer(data, uid, kind, decision)); changed = true;
    }
    if (action.type === 'battleship.ready') {
      requireAction(data.status === 'playing' && data.setupPhase && !data.readyPlayers[uid], 409, 'setup_locked');
      secret.fleets = { ...secret.fleets, [uid]: validateFleet(action.fleet) }; fleetChanged = true;
      data.readyPlayers = { ...data.readyPlayers, [uid]: true };
      if (data.players.every(id => data.readyPlayers[id])) {
        data.setupPhase = false; data.turn = data.startingPlayer ?? data.host; data.startingPlayer = data.turn;
      }
      changed = true;
    }
    if (action.type === 'battleship.cancel') {
      requireAction(data.status === 'playing' && data.setupPhase && data.readyPlayers[uid]
        && !data.players.some(id => id !== uid && data.readyPlayers[id]), 409, 'setup_locked');
      data.readyPlayers = { ...data.readyPlayers, [uid]: false }; changed = true;
    }
    if (action.type === 'battleship.shot') {
      const shot = applyBattleShot(data, secret.fleets, uid, action.row, action.col);
      Object.assign(data, shot.state); shotHit = shot.hit; changed = true;
    }
    if (action.type.includes('.rematch.')) {
      requireAction(player, 403, 'not_a_player');
      requireAction(data.status === 'playing' && data.winner && data.players.length === 2, 409, 'game_not_finished');
      if (action.type.endsWith('.request')) {
        requireAction(!data.rematchRequestedBy || data.rematchRequestedBy === uid, 409, 'rematch_pending');
        data.rematchRequestedBy = uid;
      } else {
        requireAction(data.rematchRequestedBy && data.rematchRequestedBy !== uid, 409, 'invalid_rematch');
        if (action.type.endsWith('.accept')) {
          const starter = data.players.find(id => id !== data.startingPlayer);
          const colors = game === 'tavla' ? Object.fromEntries(data.players.map(id => [id, data.playerColors[id] === 'white' ? 'black' : 'white'])) : undefined;
          Object.assign(data, freshGame(data.players, data.scores, starter, game, nextRoundId, colors));
          if (battle) { secret.fleets = {}; fleetChanged = true; }
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
    if (publicChanged) data.updatedAt = monotonicServerTime(data.updatedAt, now);
    if (touchesQueue) {
      entries = entries.filter(item => item.roomId !== id);
      if (data.isPublic && data.status === 'waiting' && data.players.length === 1 && connected(connections, data.host)) {
        requireAction(entries.length < 30, 503, 'match_queue_full');
        entries.push({ roomId: id, host: data.host, updatedAt: Math.max(now, ...Object.values(connections[data.host])) });
      }
    }
    const result = { roomId: id, version: data.version, winner: data.winner };
    if (shotHit !== undefined) result.hit = shotHit;
    if (publicChanged) tx.set(roomRef(id), data);
    if (chessArchive) tx.set(chessHistoryRef(chessArchive.key), chessArchive.state);
    for (const key of chessEvicted) tx.delete(chessHistoryRef(key));
    if (fleetChanged) {
      tx.set(fleetRef, secret);
      for (const playerId of data.players) tx.set(roomRef(id).collection('playerData').doc(playerId), {
        roundId: data.roundId, ships: secret.fleets[playerId] ?? [],
      });
    }
    tx.set(presenceRef(id), { connections });
    if (touchesQueue && JSON.stringify(entries) !== JSON.stringify(queue)) tx.set(queueRef, { entries });
    tx.set(actorRef, { ...actor, recent: [...recent.slice(-31), { actionId: action.actionId, fingerprint, result }] });
    tx.set(rateRef, { windowStart: sameWindow ? rate.windowStart : now, count: count + 1 });
    return result;
  });
}
