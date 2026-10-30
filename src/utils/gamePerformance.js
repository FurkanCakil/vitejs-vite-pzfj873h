const supportedGames = new Set(['xox', 'okey101']);
const supportedAction = type => /^(?:xox\.|okey\.)/.test(type)
  || ['room.create', 'room.match', 'room.join', 'room.spectate'].includes(type);
const serverKeys = new Set(['auth_ms', 'auth_verify_ms', 'auth_session_ms', 'action_ms', 'server_ms', 'db_read_ms',
  'db_write_enqueue_ms', 'tx_ms', 'tx_compute_ms', 'tx_begin_ms', 'tx_retry_wait_ms', 'tx_finalize_ms', 'tx_attempts', 'db_reads', 'db_writes']);
const errorCodes = new Set(['stale_version', 'stale_round', 'stale_turn', 'not_your_turn', 'occupied_cell', 'too_many_actions',
  'connection_failed', 'authentication_unavailable', 'invalid_token', 'service_unavailable', 'round_finished', 'player_disconnected']);
const percentile = (values, fraction) => values.length ? values[Math.max(0, Math.ceil(values.length * fraction) - 1)] : null;

export function summarizePerformance(rows) {
  const groups = {};
  for (const row of rows) {
    const key = `${row.game}:${row.action}:${row.outcome}`;
    const group = groups[key] ??= { game: row.game, action: row.action, outcome: row.outcome, n: 0, metrics: {} };
    group.n++;
    for (const [name, value] of Object.entries(row.metrics)) {
      if (Number.isFinite(value)) (group.metrics[name] ??= []).push(value);
    }
  }
  return Object.values(groups).map(group => ({ ...group, metrics: Object.fromEntries(Object.entries(group.metrics).map(([name, values]) => {
    values.sort((a, b) => a - b);
    return [name, { n: values.length, p50: percentile(values, .5), p95: percentile(values, .95), max: values.at(-1) }];
  })) }));
}

// Opt-in, memory-only and bounded. Internal room/version keys correlate the
// existing streams; exports contain only allowlisted labels and numbers.
export function createGamePerformance({ now = () => performance.now(), enabled = false, maxRows = 256, maxPending = 32 } = {}) {
  let active = enabled, expiresAt = now() + 600_000, sequence = 0;
  const rows = [], pending = new Set(), rooms = new Map();
  const isEnabled = () => active && now() < expiresAt;
  const record = trace => {
    pending.delete(trace); rows.push(trace.row);
    if (rows.length > maxRows) rows.shift();
  };
  const prune = () => {
    for (const trace of pending) if (!isEnabled() || now() - trace.started > 30_000) {
      trace.row.outcome = trace.responseAt ? 'snapshot_unobserved' : 'unfinished'; record(trace);
    }
  };
  const roomEvents = roomId => {
    if (!rooms.has(roomId)) {
      if (rooms.size >= 8) rooms.delete(rooms.keys().next().value);
      rooms.set(roomId, { public: [], private: [], commit: [], frame: [] });
    }
    return rooms.get(roomId);
  };
  const append = (list, item) => { list.push(item); if (list.length > 64) list.shift(); };
  const reconcile = trace => {
    if (trace.responseAt === undefined || !trace.roomId || !Number.isSafeInteger(trace.version)) return;
    const events = rooms.get(trace.roomId);
    if (!events) return;
    const pub = events.public.find(item => item.version >= trace.version && item.at >= trace.started);
    if (pub) {
      trace.row.metrics.public_snapshot_ms = pub.at - trace.started;
      if (pub.handVersion !== undefined) {
        const own = events.private.find(item => item.round === pub.round && item.handVersion === pub.handVersion && item.at >= trace.started);
        if (own) trace.row.metrics.private_snapshot_ms = own.at - trace.started;
      }
    }
    const commit = events.commit.find(item => item.version >= trace.version && item.at >= trace.started);
    if (commit) {
      trace.row.metrics.view_commit_ms = commit.at - trace.started;
      trace.row.metrics.render_commit_ms = commit.duration;
      trace.row.metrics.snapshot_wait_after_http_ms = Math.max(0, commit.at - trace.responseAt);
    }
    const frame = events.frame.find(item => item.version >= trace.version && item.at >= trace.started);
    if (frame && commit) {
      trace.row.metrics.next_frame_ms = frame.at - trace.started;
      trace.row.outcome = 'ok'; record(trace);
    }
  };
  const reconcileAll = () => { prune(); for (const trace of pending) reconcile(trace); };
  return {
    isEnabled,
    setEnabled(value) { active = value === true; expiresAt = now() + 600_000; if (!active) { pending.clear(); rooms.clear(); } },
    clear() { pending.clear(); rows.length = 0; rooms.clear(); },
    start(action, roomId) {
      prune();
      if (!isEnabled() || !supportedAction(action) || pending.size >= maxPending) return null;
      const game = action.startsWith('okey.') ? 'okey101'
        : action.startsWith('xox.') || ['room.create', 'room.match'].includes(action) ? 'xox' : 'unknown';
      const trace = { started: now(), roomId, row: { sample: ++sequence, game,
        action, outcome: 'pending', metrics: { attempts: 0 } } };
      pending.add(trace); return trace;
    },
    execute(trace) { if (trace && pending.has(trace)) trace.row.metrics.queue_wait_ms ??= now() - trace.started; },
    cancel(trace, outcome = 'cancelled') {
      if (trace && pending.has(trace)) { trace.row.outcome = outcome === 'coalesced' ? 'coalesced' : 'cancelled'; record(trace); }
    },
    add(trace, key, value) {
      if (trace && isEnabled() && (pending.has(trace) || rows.includes(trace.row)) && Number.isFinite(value) && value >= 0) {
        trace.row.metrics[key] = (trace.row.metrics[key] ?? 0) + value;
      }
    },
    server(trace, headers) {
      if (!trace || !pending.has(trace)) return;
      const game = headers?.get?.('x-game-perf-game');
      if (supportedGames.has(game)) trace.row.game = game;
      const region = headers?.get?.('x-game-region');
      if (/^[a-z]{3}\d$/.test(region ?? '')) trace.row.region = region;
      for (const entry of (headers?.get?.('server-timing') ?? '').split(',')) {
        const match = /^\s*([a-z_]+);dur=([\d.]+)\s*$/.exec(entry);
        if (match && serverKeys.has(match[1])) this.add(trace, match[1], Number(match[2]));
      }
    },
    response(trace, result) {
      if (!trace || !pending.has(trace)) return;
      trace.responseAt = now(); trace.roomId = result.roomId ?? trace.roomId; trace.version = result.version;
      trace.row.metrics.api_total_ms = now() - trace.started;
      reconcile(trace);
    },
    fail(trace, code) {
      if (trace && pending.has(trace)) {
        trace.row.outcome = 'error'; trace.row.error = errorCodes.has(code) ? code : 'other';
        trace.row.metrics.api_total_ms = now() - trace.started; record(trace);
      }
    },
    snapshot(roomId, data, uid, fromCache) {
      for (const trace of pending) if (trace.roomId === roomId && data?.gameId) {
        if (!supportedGames.has(data.gameId)) pending.delete(trace);
        else trace.row.game = data.gameId;
      }
      if (!isEnabled() || fromCache || !supportedGames.has(data?.gameId)) return;
      const events = roomEvents(roomId);
      append(events.public, { version: data.version, at: now(), round: data.roundId, handVersion: data.handVersions?.[uid] });
      reconcileAll();
    },
    privateSnapshot(roomId, view, fromCache) {
      if (!isEnabled() || fromCache || !view) return;
      append(roomEvents(roomId).private, { round: view.roundId, handVersion: view.handVersion, at: now() }); reconcileAll();
    },
    commit(roomId, game, version, duration) {
      if (!isEnabled() || !supportedGames.has(game)) return;
      append(roomEvents(roomId).commit, { version, at: now(), duration }); reconcileAll();
    },
    frame(roomId, game, version) {
      if (!isEnabled() || !supportedGames.has(game)) return;
      append(roomEvents(roomId).frame, { version, at: now() }); reconcileAll();
    },
    report() {
      prune();
      const samples = rows.map(row => ({ ...row, metrics: Object.fromEntries(Object.entries(row.metrics).map(([key, value]) => [key, Math.round(value * 1000) / 1000])) }));
      return { schema: 1, enabled: isEnabled(), pending: pending.size, limit: maxRows, samples, summary: summarizePerformance(samples) };
    },
  };
}

let optedIn = false;
try { optedIn = typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('gamePerf') === '1'; } catch { /* optional tooling */ }
export const gamePerformance = createGamePerformance({ enabled: optedIn });
export const gamePerformancePanelRequested = optedIn;
