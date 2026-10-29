const phases = new Set(['request', 'authentication', 'action', 'response']);
const categories = new Map([
  [4, 'deadline_exceeded'], ['deadline-exceeded', 'deadline_exceeded'], ['DEADLINE_EXCEEDED', 'deadline_exceeded'],
  [7, 'permission_denied'], ['permission-denied', 'permission_denied'], ['PERMISSION_DENIED', 'permission_denied'],
  [8, 'resource_exhausted'], ['resource-exhausted', 'resource_exhausted'], ['RESOURCE_EXHAUSTED', 'resource_exhausted'],
  [10, 'transaction_aborted'], ['aborted', 'transaction_aborted'], ['ABORTED', 'transaction_aborted'],
  [14, 'upstream_unavailable'], ['unavailable', 'upstream_unavailable'], ['UNAVAILABLE', 'upstream_unavailable'],
  [16, 'upstream_unauthenticated'], ['unauthenticated', 'upstream_unauthenticated'],
  ['authentication_unavailable', 'authentication_unavailable'],
  ['presence_capacity', 'capacity'], ['match_queue_full', 'capacity'],
  ['ECONNRESET', 'connection_reset'], ['ETIMEDOUT', 'transport_timeout'],
]);

// Only fixed labels leave the process. Never inspect/serialize message, stack,
// cause, token, UID, room, request body, URL or provider response.
export function createFailureReporter({ emit = record => console.error(JSON.stringify(record)), now = Date.now } = {}) {
  let windowStart = null;
  const seen = new Set();
  return (phase, error) => {
    try {
      const at = now();
      if (windowStart === null || at < windowStart || at - windowStart >= 60_000) {
        windowStart = at; seen.clear();
      }
      const safePhase = phases.has(phase) ? phase : 'request';
      const category = categories.get(error?.code) ?? 'unknown';
      const key = `${safePhase}:${category}`;
      // One event per category/phase and at most eight per process/minute.
      // Fixed labels keep the Set bounded regardless of untrusted error codes.
      if (seen.has(key) || seen.size >= 8) return;
      seen.add(key);
      emit({ event: 'game_api_failure', phase: safePhase, category });
    } catch { /* reporting must never change the API response */ }
  };
}

export const reportServerFailure = createFailureReporter();
