import { createHash } from 'node:crypto';
import { ActionError } from './errors.js';

const unavailable = () => new ActionError(503, 'authentication_unavailable');
const invalid = () => new ActionError(401, 'invalid_token');
const rejected = new Set(['USER_DISABLED', 'USER_NOT_FOUND', 'EMAIL_NOT_FOUND', 'INVALID_ID_TOKEN', 'TOKEN_EXPIRED']);

// This is an end-user lookup, not a privileged user-directory request. The
// token goes only to its issuer; no account ID/filter or service credential is
// sent. Only the matching account is accepted and no profile is retained.
export function createSelfAccountLookup({ apiKey, fetcher = fetch }) {
  return async (token, uid) => {
    if (typeof apiKey !== 'string' || !apiKey) throw unavailable();
    let response, data;
    try {
      response = await fetcher(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(5000),
      });
      data = await response.json();
    } catch { throw unavailable(); }
    if (!response.ok) {
      if ([400, 401].includes(response.status) && rejected.has(data?.error?.message)) throw invalid();
      // Permission/configuration, upstream throttling and outages are not a
      // bad player token. Never trigger token-refresh loops or leak details.
      throw unavailable();
    }
    const account = data?.users?.[0];
    if (data?.users?.length !== 1 || account?.localId !== uid) throw unavailable();
    if (account.disabled === true) throw invalid();
    if (account.disabled !== undefined && typeof account.disabled !== 'boolean') throw unavailable();
    if (account.validSince !== undefined
      && (typeof account.validSince !== 'string' || !/^\d+$/.test(account.validSince)
        || !Number.isSafeInteger(Number(account.validSince)))) throw unavailable();
    return { validSince: Number(account.validSince ?? 0) };
  };
}

// Recheck the account backend at most every minute for a given signed token.
// Keys are hashes, not tokens. Cache and in-flight work are bounded; rotating
// tokens cannot create an unbounded process-wide Map or lookup fan-out.
// The caller MUST verify signature, issuer, project and expiry on every call.
export function createSessionCheck({ lookup, now = Date.now, ttlMs = 60_000, maxEntries = 512, maxPending = 32 }) {
  const cache = new Map(), pending = new Map();
  return async (token, identity) => {
    if (typeof token !== 'string' || !token || typeof identity?.uid !== 'string' || !identity.uid
      || !Number.isSafeInteger(identity.auth_time) || identity.auth_time < 0
      || !Number.isSafeInteger(identity.exp)) throw invalid();
    const at = now();
    if (identity.exp * 1000 <= at) throw invalid();
    const key = createHash('sha256').update(identity.uid).update('\0').update(token).digest('hex');
    const cached = cache.get(key);
    if (cached && cached.until > at) {
      cache.delete(key); cache.set(key, cached);
      if (!cached.allowed) throw invalid();
      return;
    }
    cache.delete(key);
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= maxPending) throw unavailable();
    const remember = (allowed, duration) => {
      // Expired records are removed without a timer or a scheduled job.
      const checkedAt = now();
      for (const [id, value] of cache) if (value.until <= checkedAt) cache.delete(id);
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
      cache.set(key, { allowed, until: Math.min(at + duration, identity.exp * 1000) });
    };
    const work = Promise.resolve().then(async () => {
      try {
        const account = await lookup(token, identity.uid);
        // Some new anonymous accounts have no validSince field. The backend
        // still rejects disabled/deleted/expired tokens; compare the original
        // authentication time too whenever it returns a revocation boundary.
        if (identity.auth_time < account.validSince) throw invalid();
        if (identity.exp * 1000 <= now()) throw invalid();
        remember(true, ttlMs);
      } catch (error) {
        if (error instanceof ActionError && error.status === 401) {
          remember(false, Math.min(ttlMs, 10_000)); throw error;
        }
        throw unavailable();
      } finally { pending.delete(key); }
    });
    pending.set(key, work);
    return work;
  };
}
