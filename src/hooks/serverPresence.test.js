import test from 'node:test';
import assert from 'node:assert/strict';
import { startServerPresence } from './serverPresence.js';
test('closing during a heartbeat retires only that session again after the delayed response', async t => {
  const win = new EventTarget(), doc = new EventTarget(); doc.visibilityState = 'visible';
  globalThis.window = win; globalThis.document = doc;
  t.after(() => { delete globalThis.window; delete globalThis.document; });
  let finish;
  const calls = [];
  const api = fields => { calls.push(fields); return fields.type === 'presence.heartbeat'
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ serverNow: Date.now() }); };
  const stop = startServerPresence({ roomCode: null, getToken() {}, api, onError: error => { throw error; } });
  try {
    assert.equal(calls.length, 1); stop();
    assert.equal(calls[1].type, 'presence.leave'); assert.equal(calls[1].sessionId, calls[0].sessionId);
    finish({ serverNow: Date.now() }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.filter(call => call.type === 'presence.leave').length, 2);
  } finally { stop(); }
});
test('offline/online reuses its session and a late old response never retires the recovered session', async t => {
  const win = new EventTarget(), doc = new EventTarget(); doc.visibilityState = 'visible';
  globalThis.window = win; globalThis.document = doc;
  t.after(() => { delete globalThis.window; delete globalThis.document; });
  const calls = [], pending = [];
  const api = fields => { calls.push(fields); return fields.type === 'presence.heartbeat'
    ? new Promise(resolve => pending.push(resolve)) : Promise.resolve({ serverNow: Date.now() }); };
  const stop = startServerPresence({ roomCode: 'ROOM12', getToken() {}, api, onError: error => { throw error; } });
  try {
    win.dispatchEvent(new Event('offline')); win.dispatchEvent(new Event('online'));
    const beats = calls.filter(call => call.type === 'presence.heartbeat'); assert.equal(beats.length, 2);
    assert.equal(beats[0].sessionId, beats[1].sessionId);
    pending[0]({ serverNow: Date.now() }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.filter(call => call.type === 'presence.leave').length, 0);
    pending[1]({ serverNow: Date.now() }); await new Promise(resolve => setImmediate(resolve));
  } finally { stop(); }
});

const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(t, { online = true, delayed = false } = {}) {
  const win = new EventTarget(), doc = new EventTarget(); doc.visibilityState = 'visible';
  win.navigator = { onLine: online };
  globalThis.window = win; globalThis.document = doc;
  t.mock.timers.enable({ apis: ['setInterval'] });
  const calls = [], pending = [], errors = [];
  const api = fields => {
    calls.push(fields);
    return delayed && fields.type === 'presence.heartbeat'
      ? new Promise((resolve, reject) => pending.push({ resolve, reject })) : Promise.resolve({ serverNow: Date.now() });
  };
  const stop = startServerPresence({ roomCode: null, getToken() {}, api, onError: error => errors.push(error) });
  t.after(() => { stop(); delete globalThis.window; delete globalThis.document; });
  return { win, doc, calls, pending, errors, stop, beats: () => calls.filter(call => call.type === 'presence.heartbeat') };
}

test('initially offline presence waits for online, including through visibility and pageshow', async t => {
  const s = setup(t, { online: false });
  s.doc.dispatchEvent(new Event('visibilitychange')); s.win.dispatchEvent(new Event('pageshow'));
  t.mock.timers.tick(60_000); await flush(); assert.equal(s.calls.length, 0);
  s.win.dispatchEvent(new Event('online')); await flush(); assert.equal(s.beats().length, 1);
});

test('offline stays paused through visibility and page events; recovery sends one immediate beat', async t => {
  const s = setup(t); await flush(); s.win.dispatchEvent(new Event('offline'));
  s.doc.dispatchEvent(new Event('visibilitychange')); s.win.dispatchEvent(new Event('pageshow'));
  t.mock.timers.tick(60_000); await flush(); assert.equal(s.beats().length, 1);
  assert.equal(s.calls.filter(call => call.type === 'presence.leave').length, 0);
  s.win.dispatchEvent(new Event('online')); await flush(); assert.equal(s.beats().length, 2);
  assert.equal(s.beats()[0].sessionId, s.beats()[1].sessionId);
});

test('twenty network flaps use one session instead of consuming the bounded tab history', async t => {
  const s = setup(t); await flush();
  for (let n = 0; n < 20; n++) {
    s.win.dispatchEvent(new Event('offline')); s.doc.dispatchEvent(new Event('visibilitychange'));
    s.win.dispatchEvent(new Event('online')); await flush();
  }
  assert.equal(s.beats().length, 21);
  assert.equal(new Set(s.beats().map(call => call.sessionId)).size, 1);
  assert.equal(s.calls.filter(call => call.type === 'presence.leave').length, 0);
});

test('pagehide remains parked on visibility, while pageshow starts a new session', async t => {
  const s = setup(t); await flush(); s.win.dispatchEvent(new Event('pagehide'));
  s.doc.dispatchEvent(new Event('visibilitychange')); t.mock.timers.tick(60_000); await flush();
  assert.equal(s.beats().length, 1);
  s.win.dispatchEvent(new Event('pageshow')); await flush(); assert.equal(s.beats().length, 2);
  assert.notEqual(s.beats()[0].sessionId, s.beats()[1].sessionId);
});

test('a delayed failed beat cannot report an obsolete error after network recovery', async t => {
  const s = setup(t, { delayed: true });
  s.win.dispatchEvent(new Event('offline')); s.win.dispatchEvent(new Event('online'));
  assert.equal(s.beats().length, 2);
  s.pending[0].reject({ code: 'connection_failed' }); await flush(); assert.equal(s.errors.length, 0);
  s.pending[1].resolve({ serverNow: Date.now() }); await flush();
});

test('cleanup removes presence listeners and stops interval work', async t => {
  const s = setup(t); await flush(); s.stop(); const count = s.calls.length;
  for (const event of ['pagehide', 'pageshow', 'offline', 'online']) s.win.dispatchEvent(new Event(event));
  s.doc.dispatchEvent(new Event('visibilitychange')); t.mock.timers.tick(60_000); await flush();
  assert.equal(s.calls.length, count);
});

test('late pagehide response retires only the departed session after pageshow', async t => {
  const s = setup(t, { delayed: true });
  s.win.dispatchEvent(new Event('pagehide')); s.win.dispatchEvent(new Event('pageshow'));
  assert.equal(s.beats().length, 2); assert.notEqual(s.beats()[0].sessionId, s.beats()[1].sessionId);
  s.pending[0].resolve({ serverNow: Date.now() }); await flush();
  const leaves = s.calls.filter(call => call.type === 'presence.leave'); assert.equal(leaves.length, 2);
  assert.ok(leaves.every(call => call.sessionId === s.beats()[0].sessionId));
  s.pending[1].resolve({ serverNow: Date.now() }); await flush();
});

test('a server-retired session is replaced, while ordinary hidden tabs retain their session', async t => {
  const s = setup(t, { delayed: true });
  s.pending[0].resolve({ retired: true, serverNow: Date.now() }); await flush();
  assert.equal(s.beats().length, 2); assert.notEqual(s.beats()[0].sessionId, s.beats()[1].sessionId);
  s.pending[1].resolve({ serverNow: Date.now() }); await flush();
  s.doc.visibilityState = 'hidden'; s.doc.dispatchEvent(new Event('visibilitychange')); await flush();
  assert.equal(s.beats().length, 2);
  t.mock.timers.tick(20_000); assert.equal(s.beats().length, 3);
  assert.equal(s.beats()[2].sessionId, s.beats()[1].sessionId);
  s.pending[2].resolve({ serverNow: Date.now() }); await flush();
});
