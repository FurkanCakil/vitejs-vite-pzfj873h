import test from 'node:test';
import assert from 'node:assert/strict';
import { FRESH_MS, countActiveSessions, isFreshSession, waitingPlayers } from './presence.js';

const now = 1_000_000;
const session = (uid = 'host', roomCode = 'ROOM', lastSeen = now) => ({ uid, playerId: uid, roomCode, lastSeen });
const room = { gameId: 'xox', isPublic: true, status: 'waiting', host: 'host', players: ['host'] };

test('multiple tabs and refreshed auth sessions count as one player', () => {
  assert.equal(countActiveSessions({
    a: session(), b: session(), c: { ...session('new-auth'), playerId: 'host' }, d: session('other'),
  }, now), 2);
});
test('closing one tab leaves the other tab counted', () => {
  assert.equal(countActiveSessions({ b: session() }, now), 1);
  assert.equal(countActiveSessions({}, now), 0);
});
test('legacy numeric heartbeats deduplicate by uid, including migration', () => {
  assert.equal(countActiveSessions({ host_abc: now, host_def: now, other_abc: now }, now), 2);
  assert.equal(countActiveSessions({ host_abc: now, modern: { ...session(), playerId: '123' } }, now), 1);
});
test('expired, malformed and far-future records do not inflate count', () => {
  assert.equal(countActiveSessions({
    old: session('old', null, now - FRESH_MS), bad: {}, nan: NaN,
    future: session('future', null, now + 60_000), current: session(),
  }, now), 1);
});
test('Firestore timestamps and expiry without new snapshots', () => {
  const sessions = { a: { ...session(), lastSeen: { toMillis: () => now } } };
  assert.equal(countActiveSessions(sessions, now), 1);
  assert.equal(countActiveSessions(sessions, now + FRESH_MS), 0);
  assert.equal(isFreshSession(session(), now + FRESH_MS - 1), true);
});
test('public waiting room needs a live host in that exact room', () => {
  assert.deepEqual(waitingPlayers(room, 'ROOM', {}, 'visitor', now), []);
  assert.deepEqual(waitingPlayers(room, 'ROOM', { a: session('host', null) }, 'visitor', now), []);
  assert.deepEqual(waitingPlayers(room, 'ROOM', { a: session('host', 'OTHER') }, 'visitor', now), []);
  assert.deepEqual(waitingPlayers(room, 'ROOM', { a: session() }, 'visitor', now), ['host']);
});
test('ghost waiting room expires even if its status never changes', () => {
  assert.deepEqual(waitingPlayers(room, 'ROOM', { a: session() }, 'visitor', now + FRESH_MS), []);
});
test('private, closed, playing, own and full rooms are not match candidates', () => {
  for (const patch of [{ isPublic: false }, { status: 'closed' }, { status: 'playing' }, { players: ['host', 'other'] }]) {
    assert.deepEqual(waitingPlayers({ ...room, ...patch }, 'ROOM', { a: session() }, 'visitor', now), []);
  }
  assert.deepEqual(waitingPlayers(room, 'ROOM', { a: session() }, 'host', now), []);
});
test('Okey count excludes bots and disconnected players', () => {
  const okey = { ...room, gameId: 'okey101', maxPlayers: 4, players: ['host', 'gone', 'bot'], isBotPlayer: { bot: true } };
  assert.deepEqual(waitingPlayers(okey, 'ROOM', { a: session(), b: session('bot') }, 'visitor', now), ['host']);
});
