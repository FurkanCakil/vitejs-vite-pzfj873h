import test from 'node:test';
import assert from 'node:assert/strict';
import { personalHand, previewDiscard } from './personalLayout.js';

const tile = id => ({ id, color: 'red', number: 1 });
const hand = () => ({ roundId: 'round-a', rack: [tile('T0'), tile('T1'), tile('T2'), ...Array(27).fill(null)], groups: {} });

test('personal layouts preserve authoritative membership, new draws and reconnect order without inventing tiles', () => {
  const own = hand(), layout = { roundId: own.roundId, rack: ['T1', null, 'T0', 'T99', ...Array(26).fill(null)], groups: { pair: ['T1', 'T0'], stale: ['T99', 'T2'] } };
  const shown = personalHand(own, layout);
  assert.equal(shown.rack[0].id, 'T1'); assert.equal(shown.rack[2].id, 'T0');
  assert.deepEqual(shown.rack.filter(Boolean).map(t => t.id).sort(), ['T0', 'T1', 'T2']);
  assert.deepEqual(shown.groups, { pair: ['T1', 'T0'] });
  assert.equal(own.rack[0].id, 'T0');
  const removed = { ...own, rack: own.rack.map(t => t?.id === 'T0' ? null : t) };
  assert.equal(personalHand(removed, layout).rack.some(t => t?.id === 'T0'), false);
  assert.equal(personalHand({ ...own, roundId: 'new-round' }, layout).roundId, 'new-round');
  assert.equal(personalHand(own, null), own);
});

test('discard previews change only the displayed known tile and are discarded after rejection, version or round change', () => {
  const own = hand(), room = { roundId: own.roundId, playVersion: 3, racks: { me: own.rack }, groups: { me: {} }, discardPiles: { me: [] }, turn: 'me', scores: { me: 0 } };
  const pending = { roundId: room.roundId, playVersion: 3, tileId: 'T0' };
  const shown = previewDiscard(room, 'me', pending);
  assert.equal(shown.racks.me[0], null); assert.equal(shown.discardPiles.me[0].id, 'T0');
  assert.equal(room.racks.me[0].id, 'T0'); assert.equal(room.discardPiles.me.length, 0);
  assert.equal(shown.turn, 'me'); assert.deepEqual(shown.scores, { me: 0 });
  for (const invalid of [null, { ...pending, tileId: 'T99' }, { ...pending, roundId: 'other' }, { ...pending, playVersion: 2 }]) {
    assert.equal(previewDiscard(room, 'me', invalid), room);
  }
});
