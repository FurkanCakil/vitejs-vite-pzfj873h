import test from 'node:test';
import assert from 'node:assert/strict';
import { countdownSeconds, okeyAutoAction } from './okeyTiming.js';
import { beginServerTiming, updateServerClock } from '../../utils/serverClock.js';
import { TURN_TIMEOUT_GRACE_MS } from './tiles.js';

test('server Okey countdown and auto start ignore a device clock that is hours ahead or behind', t => {
  t.mock.method(Date, 'now', () => 10_000_000);
  updateServerClock(1_000_000, beginServerTiming());
  assert.equal(countdownSeconds(1_045_000), 45);
  const data = { players: ['host'], status: 'waiting', countdownStartedAt: 999_000 };
  assert.equal(okeyAutoAction(data, 'host'), null);
  data.countdownStartedAt = 990_000; assert.equal(okeyAutoAction(data, 'host'), 'okey.start');
  t.mock.method(Date, 'now', () => 1);
  assert.equal(okeyAutoAction(data, 'host'), 'okey.start');
});

test('automatic start/tick preserve stagger, phase, spectator and round-end boundaries', () => {
  const data = { players: ['a', 'b'], status: 'waiting', countdownStartedAt: 1000 };
  assert.equal(okeyAutoAction(data, 'a', 4199), null); assert.equal(okeyAutoAction(data, 'a', 4200), 'okey.start');
  assert.equal(okeyAutoAction(data, 'b', 4349), null); assert.equal(okeyAutoAction(data, 'b', 4350), 'okey.start');
  Object.assign(data, { status: 'playing', hasDealt: true, setupPhase: true, setupEndsAt: 5000 });
  assert.equal(okeyAutoAction(data, 'a', 5199), null); assert.equal(okeyAutoAction(data, 'a', 5200), 'okey.tick');
  Object.assign(data, { setupPhase: false, turn: 'bot', isBotPlayer: { bot: true }, botReadyAt: 6000 });
  assert.equal(okeyAutoAction(data, 'a', 6200), 'okey.tick');
  Object.assign(data, { turn: 'a', turnDeadline: 7000 });
  assert.equal(okeyAutoAction(data, 'a', 7200 + TURN_TIMEOUT_GRACE_MS - 1), null);
  assert.equal(okeyAutoAction(data, 'a', 7200 + TURN_TIMEOUT_GRACE_MS), 'okey.tick');
  assert.equal(okeyAutoAction(data, 'viewer', 100_000), null);
  data.roundEnded = true; assert.equal(okeyAutoAction(data, 'a', 100_000), null);
  assert.equal(countdownSeconds(5000, 5001), 0);
});
