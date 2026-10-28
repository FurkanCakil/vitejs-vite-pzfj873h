import test from 'node:test';
import assert from 'node:assert/strict';
import { createRackWriteQueue } from './rackWriteQueue.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [], pending = [], errors = [];
  let idle = 0;
  const queue = createRackWriteQueue({
    write: (rack, groups) => { calls.push({ rack, groups }); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
    onIdle: () => idle++, onError: error => errors.push(error),
  });
  t.after(() => queue.stop());
  return { queue, calls, pending, errors, idle: () => idle };
}
const layout = rack => ({ rack, groups: { confirmed: rack } });

test('opening waits for the newest confirmed layout, not just the first write', async t => {
  const s = setup(t);
  s.queue.enqueue(layout('A'), { immediate: true }); await turn();
  s.queue.enqueue(layout('B'));
  let opened = false;
  const opening = s.queue.flush().then(saved => { opened = saved; });
  s.pending[0].resolve({ success: true }); await turn();
  assert.deepEqual(s.calls.map(call => call.rack), ['A', 'B']);
  assert.equal(opened, false);
  assert.equal(s.queue.isIdle(), false);
  s.pending[1].resolve({ success: true }); await opening;
  assert.equal(opened, true); assert.equal(s.queue.isIdle(), true); assert.equal(s.idle(), 1);
});

test('bursts coalesce and never run two layout writes concurrently', async t => {
  const s = setup(t);
  s.queue.enqueue(layout('A')); s.queue.enqueue(layout('B')); t.mock.timers.tick(139); await turn();
  assert.equal(s.calls.length, 0);
  t.mock.timers.tick(1); await turn();
  s.queue.enqueue(layout('C')); s.queue.enqueue(layout('D')); t.mock.timers.tick(1000); await turn();
  assert.deepEqual(s.calls.map(call => call.rack), ['B']);
  const drained = s.queue.flush(); s.pending[0].resolve(); await turn();
  assert.deepEqual(s.calls, [layout('B'), layout('D')]);
  s.pending[1].resolve(); assert.equal(await drained, true);
  t.mock.timers.tick(1000); await turn(); assert.equal(s.calls.length, 2);
});

test('unmount cancels queued and debounced work and does not notify the retired component', async t => {
  const s = setup(t);
  s.queue.enqueue(layout('A'), { immediate: true }); await turn();
  s.queue.enqueue(layout('B'));
  const drained = s.queue.flush(); s.queue.stop(); s.pending[0].resolve();
  assert.equal(await drained, false);
  s.queue.enqueue(layout('C'), { immediate: true }); t.mock.timers.tick(1000); await turn();
  assert.deepEqual(s.calls.map(call => call.rack), ['A']); assert.equal(s.idle(), 0);
  assert.equal(await s.queue.flush(), false);
});

test('stopping before debounce sends nothing; a fresh mount has an independent queue', async t => {
  const old = setup(t); old.queue.enqueue(layout('old')); old.queue.stop();
  const fresh = createRackWriteQueue({ write: async () => ({ success: true }), onIdle() {}, onError() {} });
  t.after(() => fresh.stop()); fresh.enqueue(layout('new'));
  assert.equal(await fresh.flush(), true); t.mock.timers.tick(1000); await turn();
  assert.equal(old.calls.length, 0); assert.equal(old.idle(), 0);
});

test('failed writes prevent dependent opening, but a later new batch can recover', async t => {
  const s = setup(t); s.queue.enqueue(layout('A'));
  const failed = s.queue.flush(); await turn(); s.pending[0].reject(new Error('offline'));
  assert.equal(await failed, false); assert.equal(s.errors.length, 1);
  s.queue.enqueue(layout('B')); const refused = s.queue.flush(); await turn(); s.pending[1].resolve({ success: false });
  assert.equal(await refused, false);
  s.queue.enqueue(layout('C')); const saved = s.queue.flush(); await turn(); s.pending[2].resolve({ success: true });
  assert.equal(await saved, true); assert.equal(s.queue.isIdle(), true);
});

test('a layout arriving as the last request settles is still part of the opening barrier', async t => {
  const s = setup(t); s.queue.enqueue(layout('A'));
  let opened = false;
  const opening = s.queue.flush().then(saved => { opened = saved; }); await turn();
  s.pending[0].resolve();
  queueMicrotask(() => s.queue.enqueue(layout('B')));
  await turn();
  assert.deepEqual(s.calls.map(call => call.rack), ['A', 'B']); assert.equal(opened, false);
  s.pending[1].resolve(); await opening; assert.equal(opened, true);
});
