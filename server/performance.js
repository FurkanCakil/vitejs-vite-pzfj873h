import { performance } from 'node:perf_hooks';

const games = new Set(['xox', 'okey101']);
export const measuredAction = type => /^(?:okey\.|xox\.)/.test(type)
  || ['room.create', 'room.match', 'room.join', 'room.spectate'].includes(type);

// Request-local numbers only. No payloads, identities, room codes or log sink.
// SDK set() only enqueues a write: finalize includes commit + SDK overhead,
// and must never be described as a separately measured pure DB write latency.
export function createPerformance({ now = () => performance.now(), region = process.env.VERCEL_REGION } = {}) {
  const started = now(), values = {}, attempts = [];
  let game = null;
  const add = (key, value) => { values[key] = (values[key] ?? 0) + Math.max(0, value); };
  const measure = async (key, work) => {
    const at = now();
    try { return await work(); } finally { add(key, now() - at); }
  };
  const wrapDb = db => ({
    doc: path => db.doc(path),
    runTransaction: async (work, ...options) => {
      const transactionAt = now();
      let lastEnd = transactionAt;
      try {
        return await db.runTransaction(async tx => {
          const at = now();
          add(attempts.length ? 'tx_retry_wait_ms' : 'tx_begin_ms', at - lastEnd);
          const attempt = { reads: 0, writes: 0 };
          attempts.push(attempt);
          const tracked = new Proxy(tx, { get(target, key) {
            if (key === 'get' || key === 'getAll') return (...args) => {
              attempt.reads += key === 'get' ? 1 : args.filter(arg => typeof arg?.path === 'string').length;
              return measure('db_read_ms', () => target[key](...args));
            };
            if (['set', 'update', 'create', 'delete'].includes(key)) return (...args) => {
              const writeAt = now();
              try { target[key](...args); attempt.writes++; return tracked; }
              finally { add('db_write_enqueue_ms', now() - writeAt); }
            };
            const value = target[key];
            return typeof value === 'function' ? value.bind(target) : value;
          } });
          const readBefore = values.db_read_ms ?? 0, writeBefore = values.db_write_enqueue_ms ?? 0;
          try { return await work(tracked); }
          finally {
            lastEnd = now();
            add('tx_compute_ms', lastEnd - at - ((values.db_read_ms ?? 0) - readBefore)
              - ((values.db_write_enqueue_ms ?? 0) - writeBefore));
          }
        }, ...options);
      } finally {
        add('tx_ms', now() - transactionAt);
        add('tx_finalize_ms', now() - lastEnd);
        values.tx_attempts = attempts.length;
        values.db_reads = attempts.reduce((total, item) => total + item.reads, 0);
        values.db_writes = attempts.reduce((total, item) => total + item.writes, 0);
      }
    },
  });
  return {
    measure, wrapDb,
    selectGame(value) { game = games.has(value) ? value : null; },
    headers(response) {
      if (!game) return;
      const metrics = { ...values, server_ms: now() - started };
      response.setHeader('Server-Timing', Object.entries(metrics)
        .filter(([, value]) => Number.isFinite(value) && value >= 0)
        .map(([key, value]) => `${key};dur=${Math.min(value, 300_000).toFixed(3)}`).join(', '));
      response.setHeader('X-Game-Perf-Game', game);
      if (/^[a-z]{3}\d$/.test(region ?? '')) response.setHeader('X-Game-Region', region);
    },
  };
}
