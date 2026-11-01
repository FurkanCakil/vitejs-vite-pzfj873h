import test from 'node:test';
import assert from 'node:assert/strict';
import { startOkeyAutoAdvance } from './okeyAutoAdvance.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(t, send) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 0;
  const data = { players: ['me'], status: 'playing', hasDealt: true, turn: 'bot', isBotPlayer: { bot: true }, botReadyAt: 1000 };
  const calls = [], documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const scheduler = startOkeyAutoAdvance({ read: () => data, uid: 'me', now: () => clock, documentTarget,
    send: type => { calls.push(type); return send?.(data); } });
  t.after(() => scheduler.stop());
  return { data, calls, scheduler,
    async tick(ms) { clock += ms; t.mock.timers.tick(ms); await flush(); },
    visibility(value) { documentTarget.visibilityState = value; documentTarget.dispatchEvent(new Event('visibilitychange')); },
  };
}
test('deadline timer fires once at due time without a one-second polling gap', async t => {
  const s = setup(t, data => { data.botReadyAt = 2000; });
  await s.tick(1079); assert.equal(s.calls.length, 0);
  await s.tick(1); assert.deepEqual(s.calls, ['okey.tick']);
  await s.tick(999); assert.equal(s.calls.length, 1);
  await s.tick(1); assert.equal(s.calls.length, 2);
});
test('a newer snapshot reschedules the old deadline; spectators and round end schedule nothing', async t => {
  const s = setup(t);
  s.data.botReadyAt = 3000; s.scheduler.notify();
  await s.tick(1080); assert.equal(s.calls.length, 0);
  s.data.roundEnded = true; s.scheduler.notify();
  await s.tick(5000); assert.equal(s.calls.length, 0);
  s.data.roundEnded = false; s.data.players = []; s.scheduler.notify();
  await s.tick(5000); assert.equal(s.calls.length, 0);
});
test('hidden tabs pause and return to an overdue turn immediately on visibility recovery', async t => {
  const s = setup(t);
  s.visibility('hidden'); await s.tick(2000); assert.equal(s.calls.length, 0);
  s.visibility('visible'); await s.tick(0); assert.equal(s.calls.length, 1);
});
test('one in-flight attempt survives snapshot notifications without sending duplicates', async t => {
  let finish;
  const s = setup(t, () => new Promise(resolve => { finish = resolve; }));
  await s.tick(1080); s.scheduler.notify(); await s.tick(5000);
  assert.equal(s.calls.length, 1);
  s.data.turn = 'me'; s.data.turnDeadline = 20_000; finish(); await flush();
  await s.tick(1000); assert.equal(s.calls.length, 1);
});
test('failed or unchanged attempts back off instead of looping at the same overdue deadline', async t => {
  const s = setup(t, () => Promise.reject(Error('offline')));
  await s.tick(1080); assert.equal(s.calls.length, 1);
  await s.tick(999); assert.equal(s.calls.length, 1);
  await s.tick(1); assert.equal(s.calls.length, 2);
  s.scheduler.stop(); await s.tick(10_000); assert.equal(s.calls.length, 2);
});
