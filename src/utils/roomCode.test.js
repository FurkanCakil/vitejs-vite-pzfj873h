import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoomCode, reserveRoomCode, generateRoomCode } from './roomCode.js';

test('room codes normalize ordinary input and reject paths or malformed values', () => {
  assert.equal(normalizeRoomCode(' ab12cd '), 'AB12CD');
  for (const value of [null, {}, '', 'ABC/DE', '../ABC', 'ABCDEF/rooms', 'ABC', 'ABCDEF7']) {
    assert.equal(normalizeRoomCode(value), null);
  }
  assert.match(generateRoomCode(), /^[A-HJ-NP-Z2-9]{6}$/);
});

test('collisions retry without replacing an existing room', async () => {
  const rooms = new Map([['AAAAAA', 'existing game']]);
  const codes = ['AAAAAA', 'BBBBBB'];
  const code = await reserveRoomCode(async (candidate) => {
    if (rooms.has(candidate)) return false;
    rooms.set(candidate, 'new game');
    return true;
  }, () => codes.shift());
  assert.equal(code, 'BBBBBB');
  assert.equal(rooms.get('AAAAAA'), 'existing game');
});

test('collision retries are bounded and network failures are propagated', async () => {
  let tries = 0;
  await assert.rejects(reserveRoomCode(async () => { tries++; return false; }), /collision/);
  assert.equal(tries, 5);
  await assert.rejects(reserveRoomCode(async () => { throw new Error('offline'); }), /offline/);
});
