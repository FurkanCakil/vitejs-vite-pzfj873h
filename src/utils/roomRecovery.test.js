import test from 'node:test';
import assert from 'node:assert/strict';
import { roomRecoveryUpdate } from './roomRecovery.js';

test('waiting after a departure preserves other seats and transfers the host', () => {
  const room = { status: 'abandoned', abandonedBy: 'host', abandonReason: 'left',
    host: 'host', players: ['host', 'bot', 'other', 'third'], isBotPlayer: { bot: true }, gameId: 'okey101' };
  const update = roomRecoveryUpdate(room, 'host', 'left');
  assert.deepEqual(update.players, ['bot', 'other', 'third']);
  assert.equal(update.host, 'other');
  assert.equal(update.status, 'playing');
  assert.equal(roomRecoveryUpdate({ ...room, gameId: 'chess' }, 'host', 'left').status, 'waiting');
});

test('stale disconnect actions never reopen a resumed or closed room', () => {
  const room = { status: 'abandoned', abandonedBy: 'a', abandonReason: null, players: ['a', 'b'] };
  for (const status of ['playing', 'waiting', 'closed']) {
    assert.equal(roomRecoveryUpdate({ ...room, status }, 'a', null), null);
  }
  assert.equal(roomRecoveryUpdate(room, 'b', null), null);
  assert.equal(roomRecoveryUpdate(room, 'a', 'left'), null);
  assert.deepEqual(roomRecoveryUpdate(room, 'a', null), { status: 'waiting', abandonedBy: null, abandonReason: null });
});
