import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerClock } from './serverClock.js';

function fixture() {
  let wall = 10_000_000, mono = 100;
  const clock = createServerClock({ wallNow: () => wall, monoNow: () => mono });
  return { clock, advance: ms => { wall += ms; mono += ms; }, jump: ms => { wall += ms; } };
}

test('clock uses the local wall time until a valid server sample arrives', () => {
  const s = fixture(); assert.equal(s.clock.now(), 10_000_000);
  const timing = s.clock.start(); s.advance(200); s.clock.update(1_000_000, timing);
  assert.equal(s.clock.now(), 1_000_100); s.advance(800); assert.equal(s.clock.now(), 1_000_900);
});

test('changing the device clock after calibration cannot change a game deadline', () => {
  const s = fixture(); s.clock.update(1_000_000, s.clock.start());
  s.advance(1000); s.jump(3_600_000); assert.equal(s.clock.now(), 1_001_000);
  s.jump(-7_200_000); s.advance(2000); assert.equal(s.clock.now(), 1_003_000);
});

test('a wall-clock correction while a response is in flight does not corrupt calibration', () => {
  const s = fixture(); const timing = s.clock.start(); s.advance(200); s.jump(-3_600_000);
  s.clock.update(1_000_000, timing); assert.equal(s.clock.now(), 1_000_100);
});

test('an older response cannot replace a newer accepted timing sample', () => {
  const s = fixture(); const old = s.clock.start(); s.advance(50); const recent = s.clock.start();
  s.advance(50); s.clock.update(1_000_000, recent); s.advance(100);
  const before = s.clock.now(); s.clock.update(900_000, old); assert.equal(s.clock.now(), before);
});

test('invalid and very slow samples do not change the calibrated clock', () => {
  const s = fixture(); s.clock.update(1_000_000, s.clock.start());
  for (const invalid of [NaN, Infinity, -1, '1000000', undefined]) s.clock.update(invalid, s.clock.start());
  assert.equal(s.clock.now(), 1_000_000);
  const old = s.clock.start(); s.advance(30_001); s.clock.update(4_000_000, old);
  assert.equal(s.clock.now(), 1_030_001);
});
