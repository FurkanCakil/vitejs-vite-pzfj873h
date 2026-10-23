import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAction } from './room-schema.js';
import { executePresenceAction, presenceShardId, projectPresence } from './presence.js';
import { FRESH_MS, PRESENCE_SHARDS, presenceShardSessions } from '../src/utils/presenceProtocol.js';
import { countActiveSessions, livePlayersByRoom } from '../src/utils/presence.js';

const now = 1_000_000, sessionId = 'presence_test_session';
test('presence schema accepts no chosen identity, display ID, count, time, shard or room path', () => {
  const beat = { type: 'presence.heartbeat', actionId: 'presence_test_0001', sessionId, roomCode: null };
  assert.deepEqual(validateAction(beat), beat);
  for (const field of ['uid', 'playerId', 'count', 'lastSeen', 'shard']) assert.throws(() => validateAction({ ...beat, [field]: 123 }), { code: 'invalid_fields' });
  for (const roomCode of ['../ABC', '', 'abc123', 123]) assert.throws(() => validateAction({ ...beat, roomCode }), { code: 'invalid_room_id' });
  assert.throws(() => validateAction({ ...beat, sessionId: '__proto__' }), { code: 'invalid_session_id' });
});
test('disabled presence touches no database and identities choose no shard', async () => {
  await assert.rejects(executePresenceAction({ runTransaction() { throw Error('DB touched'); } }, 'demo', 'a', {}, now, { enabled: false }), { code: 'server_not_enabled' });
  for (let i = 0; i < 200; i++) assert.ok(Number(presenceShardId('uid_' + i)) < PRESENCE_SHARDS);
  assert.equal(presenceShardId('same'), presenceShardId('same'));
});
test('only active authenticated identities and independently fresh room leases are public', () => {
  const privateMembers = {
    a: { sessions: { first: { at: now, roomCode: 'ROOM12' }, second: { at: now - FRESH_MS, roomCode: 'OLD123' }, closed: { at: now, closed: true } }, recent: ['secret'] },
    b: { sessions: { first: { at: now, roomCode: null } } },
    gone: { sessions: { first: { at: now - FRESH_MS, roomCode: null } } },
  };
  const pub = projectPresence(privateMembers, {}, now);
  assert.deepEqual(pub, { members: { a: { lastSeen: now, rooms: { ROOM12: now } }, b: { lastSeen: now, rooms: {} } } });
  assert.equal(JSON.stringify(pub).includes('secret'), false);
  const sessions = presenceShardSessions([pub]);
  assert.equal(countActiveSessions(sessions, now), 2);
  assert.deepEqual([...livePlayersByRoom(sessions, now).get('ROOM12')], ['a']);
  assert.equal(countActiveSessions(sessions, now + FRESH_MS), 0);
});
test('multiple tabs coalesce frequent summaries without delaying new/removed rooms or final leave', () => {
  const first = projectPresence({ a: { sessions: { one: { at: now, roomCode: null } } } }, {}, now);
  const again = projectPresence({ a: { sessions: { one: { at: now + 1000, roomCode: null } } } }, first.members, now + 1000);
  assert.deepEqual(again, first);
  const room = projectPresence({ a: { sessions: { one: { at: now + 2000, roomCode: 'ROOM12' } } } }, first.members, now + 2000);
  assert.deepEqual(room.members.a.rooms, { ROOM12: now + 2000 });
  assert.deepEqual(projectPresence({ a: { sessions: { one: { at: now + 3000, closed: true } } } }, room.members, now + 3000), { members: {} });
});
