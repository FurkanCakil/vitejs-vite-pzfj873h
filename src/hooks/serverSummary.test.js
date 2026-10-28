import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribeServerSummary, queueEntries, waitingCount } from './serverSummary.js';

function setup() {
  const values = [], errors = []; let callback, failure, options, stopped = false;
  const listen = (ref, settings, next, error) => {
    assert.equal(ref, 'summary-ref');
    if (typeof settings === 'function') { options = {}; callback = settings; failure = next; }
    else { options = settings; callback = next; failure = error; }
    return () => { stopped = true; };
  };
  const unsubscribe = subscribeServerSummary('summary-ref', queueEntries, value => values.push(value), error => errors.push(error), listen);
  const emit = (entries, { cached = false, pending = false, exists = true } = {}) => callback({
    metadata: { fromCache: cached, hasPendingWrites: pending }, exists: () => exists, data: () => ({ entries }),
  });
  return { values, errors, options, emit, fail: error => failure(error), unsubscribe, stopped: () => stopped };
}

test('a cached opponent is unknown until the server confirms the summary, even if data did not change', () => {
  const s = setup(), entries = [{ host: 'other', updatedAt: 1000 }];
  s.emit(entries, { cached: true }); assert.deepEqual(s.values, [null]);
  s.emit(entries); assert.deepEqual(s.values[1], entries);
  assert.equal(s.options.includeMetadataChanges, true);
});

test('cached absence is not a verified empty queue; only confirmed absence becomes zero', () => {
  const s = setup(); s.emit(undefined, { cached: true, exists: false }); assert.equal(s.values[0], null);
  s.emit(undefined, { exists: false }); assert.deepEqual(s.values[1], []);
  assert.equal(waitingCount(s.values[1], 'self', 1000), 0);
});

test('loss of server verification or a pending local write clears a formerly confirmed count', () => {
  const s = setup(), entries = [{ host: 'other', updatedAt: 1000 }];
  s.emit(entries); s.emit(entries, { cached: true }); s.emit(entries, { pending: true });
  assert.deepEqual(s.values, [entries, null, null]);
});

test('errors and malformed server summaries stay distinct from a real empty summary; cleanup is returned', () => {
  const s = setup(); s.emit({ wrong: true }); assert.equal(s.values[0], undefined);
  s.fail({ code: 'permission-denied' }); assert.equal(s.errors[0].code, 'permission-denied');
  assert.equal(waitingCount(null, 'self', 1000), null);
  assert.equal(waitingCount(undefined, 'self', 1000), undefined);
  s.unsubscribe(); assert.equal(s.stopped(), true);
});

test('freshness, self exclusion and Okey player counts retain their boundaries without accepting malformed entries', () => {
  const entries = [null, { updatedAt: 1000 }, { host: 'self', updatedAt: 1000 },
    { host: 'other', updatedAt: 1000, players: 3 }, { host: 'expired', updatedAt: -59_000 },
    { host: 'future', updatedAt: 1001 }, { host: 'broken', updatedAt: '1000' }];
  assert.equal(waitingCount(entries, 'self', 1000), 1);
  assert.equal(waitingCount(entries, 'self', 1000, true), 3);
  assert.equal(waitingCount([{ host: 'other', updatedAt: 1000 }], 'self', 1000, true), 1);
  assert.equal(waitingCount([{ host: 'other', updatedAt: 1000, players: '3' }], 'self', 1000, true), 0);
});
