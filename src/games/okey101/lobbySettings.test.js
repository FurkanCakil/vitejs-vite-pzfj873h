import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createLobbySettings } from './lobbySettings.js';

function harness() {
  const state = { status: 'waiting', countdownStartedAt: null, rules: {
    gameType: 'ffa', assistedEnabled: false, foldingEnabled: false, foldToPartnerEnabled: false,
  } };
  const calls = [], notifications = [];
  const settings = createLobbySettings({ read: () => state,
    onChange: () => notifications.push(settings.view()),
    send: (type, fields) => {
      const gate = Promise.withResolvers();
      calls.push({ type, ...fields, finish(success = true) {
        if (success && type === 'okey.rules') state.rules = fields.rules;
        if (success && type === 'okey.bots') state.countdownStartedAt = 123;
        gate.resolve({ success });
      }, reject: gate.reject });
      return gate.promise;
    } });
  return { state, calls, notifications, settings };
}

test('lobby selection previews synchronously, combines rapid changes and preserves dependent rules', async () => {
  const { settings, calls, state } = harness();
  settings.change('gameType', '2v2');
  settings.change('foldingEnabled', true);
  settings.change('foldToPartnerEnabled', true);
  assert.equal(settings.view().rules.foldToPartnerEnabled, true);
  assert.equal(state.rules.gameType, 'ffa');
  assert.equal(calls.length, 0);
  await setImmediate();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].rules.foldToPartnerEnabled, true);
  calls[0].finish(); await setImmediate();
  settings.change('gameType', 'ffa');
  assert.equal(settings.view().rules.foldToPartnerEnabled, false);
  await setImmediate(); calls[1].finish(); await setImmediate();
  assert.equal(settings.view().saving, false);
  settings.change('gameType', 'ffa'); await setImmediate();
  assert.equal(calls.length, 2);
});

test('start freezes immediately, waits for the newest selection and sends only one start request', async () => {
  const { settings, calls, state } = harness();
  settings.change('gameType', '2v2'); await setImmediate();
  settings.change('foldingEnabled', true);
  settings.change('assistedEnabled', true);
  const started = settings.start();
  assert.equal(settings.view().locked, true);
  assert.equal(await settings.start(), false);
  settings.change('gameType', 'ffa');
  assert.equal(settings.view().rules.gameType, '2v2');
  calls[0].finish(); await setImmediate();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].type, 'okey.rules');
  assert.equal(calls[1].rules.foldingEnabled, true);
  assert.equal(calls[1].rules.assistedEnabled, true);
  calls[1].finish(); await setImmediate();
  assert.equal(calls[2].type, 'okey.bots');
  assert.equal(state.rules.gameType, '2v2');
  calls[2].finish(); assert.equal(await started, true);
  assert.equal(settings.view().starting, false);
  assert.equal(settings.view().locked, true);
  state.countdownStartedAt = null; // A human leaves before the countdown ends.
  assert.equal(settings.view().locked, false);
});

test('failed rule save restores confirmed settings and prevents the waiting start', async () => {
  const { settings, calls, state } = harness();
  settings.change('foldingEnabled', true); await setImmediate();
  const started = settings.start();
  calls[0].finish(false);
  assert.equal(await started, false);
  assert.deepEqual(settings.view().rules, state.rules);
  assert.equal(settings.view().locked, false);
  assert.equal(calls.length, 1);
});

test('start failure unlocks controls and permits a deliberate retry', async () => {
  const { settings, calls } = harness();
  const started = settings.start(); await setImmediate();
  calls[0].reject(new Error('network unavailable'));
  assert.equal(await started, false);
  assert.equal(settings.view().locked, false);
  const retry = settings.start(); await setImmediate();
  calls[1].finish(); assert.equal(await retry, true);
});

test('a countdown restored on reconnect and a playing room reject edits and start', async () => {
  const { settings, calls, state } = harness();
  state.countdownStartedAt = 123;
  settings.change('gameType', '2v2');
  assert.equal(await settings.start(), false);
  assert.equal(settings.view().rules.gameType, 'ffa');
  state.countdownStartedAt = null; state.status = 'playing';
  settings.change('foldingEnabled', true);
  assert.equal(await settings.start(), false);
  assert.equal(calls.length, 0);
});

test('leaving the lobby cancels unsent settings and suppresses updates after unmount', async () => {
  const { settings, calls, notifications } = harness();
  settings.change('gameType', '2v2'); await setImmediate();
  settings.change('foldingEnabled', true);
  settings.stop(); const count = notifications.length;
  calls[0].finish(); await setImmediate();
  assert.equal(calls.length, 1);
  assert.equal(notifications.length, count);
});
