import test from 'node:test';
import assert from 'node:assert/strict';
import { startRoomConnection } from './roomConnection.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(t, delayed = false) {
  const win = new EventTarget(), doc = new EventTarget();
  doc.visibilityState = 'visible';
  globalThis.window = win; globalThis.document = doc;
  t.mock.timers.enable({ apis: ['setInterval'] });
  const calls = [], pending = [], errors = [];
  let id = 1;
  const api = fields => {
    calls.push(fields);
    return delayed && fields.type === 'room.heartbeat'
      ? new Promise((resolve, reject) => pending.push({ resolve, reject })) : Promise.resolve({});
  };
  const stop = startRoomConnection({ api, roomId: 'TEST12', getSessionId: () => `session_${id}`,
    renewSessionId: () => `session_${++id}`, onError: error => errors.push(error) });
  t.after(() => { stop(); delete globalThis.window; delete globalThis.document; });
  return { win, doc, calls, pending, errors, stop,
    beats: () => calls.filter(call => call.type === 'room.heartbeat') };
}

test('pagehide pauses the lease; pageshow immediately renews it without waiting for a timer', async t => {
  const s = setup(t); await flush();
  s.win.dispatchEvent(new Event('pagehide'));
  t.mock.timers.tick(30_000); await flush();
  assert.equal(s.beats().length, 1, 'a parked document must not re-open its connection');
  s.win.dispatchEvent(new Event('pageshow')); await flush();
  assert.equal(s.beats().length, 2);
  assert.notEqual(s.beats()[0].sessionId, s.beats()[1].sessionId);
});

test('a delayed old heartbeat is retired without disconnecting the restored page', async t => {
  const s = setup(t, true);
  s.win.dispatchEvent(new Event('pagehide'));
  s.win.dispatchEvent(new Event('pageshow'));
  assert.equal(s.beats().length, 2, 'an old pending request must not block the new page');
  s.pending[0].resolve({}); await flush();
  const disconnects = s.calls.filter(call => call.type === 'room.disconnect');
  assert.equal(disconnects.length, 2);
  assert.ok(disconnects.every(call => call.sessionId === s.beats()[0].sessionId));
  assert.notEqual(s.beats()[1].sessionId, disconnects[0].sessionId);
  s.pending[1].resolve({}); await flush();
});

test('offline pauses requests and online resumes despite a pending old request', async t => {
  const s = setup(t, true);
  s.win.dispatchEvent(new Event('offline'));
  t.mock.timers.tick(60_000); await flush();
  assert.equal(s.beats().length, 1);
  s.win.dispatchEvent(new Event('online'));
  assert.equal(s.beats().length, 2);
  assert.equal(s.beats()[0].sessionId, s.beats()[1].sessionId, 'network recovery must not consume another tab lease');
  s.pending[0].reject({ code: 'connection_failed' }); await flush();
  assert.equal(s.errors.length, 0, 'an obsolete connection error must not cover the recovered game');
  s.pending[1].resolve({}); await flush();
});

test('ordinary tab visibility keeps its lease and cleanup removes lifecycle callbacks', async t => {
  const s = setup(t); await flush();
  s.doc.visibilityState = 'hidden'; s.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(s.calls.length, 1);
  s.doc.visibilityState = 'visible'; s.doc.dispatchEvent(new Event('visibilitychange')); await flush();
  assert.equal(s.beats().length, 2);
  assert.equal(s.beats()[0].sessionId, s.beats()[1].sessionId);
  s.stop(); const count = s.calls.length;
  for (const event of ['pagehide', 'pageshow', 'offline', 'online']) s.win.dispatchEvent(new Event(event));
  s.doc.dispatchEvent(new Event('visibilitychange')); t.mock.timers.tick(60_000); await flush();
  assert.equal(s.calls.length, count);
});

test('network flaps reuse one lease and visibility cannot resume an offline connection', async t => {
  const s = setup(t); await flush();
  for (let i = 0; i < 12; i++) {
    s.win.dispatchEvent(new Event('offline'));
    const count = s.calls.length;
    s.doc.dispatchEvent(new Event('visibilitychange')); t.mock.timers.tick(15_000); await flush();
    assert.equal(s.calls.length, count);
    s.win.dispatchEvent(new Event('online')); await flush();
  }
  assert.equal(s.beats().length, 13);
  assert.equal(new Set(s.beats().map(call => call.sessionId)).size, 1);
  assert.equal(s.calls.filter(call => call.type === 'room.disconnect').length, 0);
  s.win.dispatchEvent(new Event('offline')); s.win.dispatchEvent(new Event('pagehide'));
  s.win.dispatchEvent(new Event('pageshow'));
  assert.equal(s.beats().length, 13);
  s.win.dispatchEvent(new Event('online')); await flush();
  assert.notEqual(s.beats()[0].sessionId, s.beats().at(-1).sessionId);
});
