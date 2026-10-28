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
test('offline/online opens a new session and a late old response never retires the new session', async t => {
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
    assert.notEqual(beats[0].sessionId, beats[1].sessionId);
    pending[0]({ serverNow: Date.now() }); await new Promise(resolve => setImmediate(resolve));
    assert.ok(calls.filter(call => call.type === 'presence.leave').every(call => call.sessionId === beats[0].sessionId));
    pending[1]({ serverNow: Date.now() }); await new Promise(resolve => setImmediate(resolve));
  } finally { stop(); }
});
