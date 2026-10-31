import test from 'node:test';
import assert from 'node:assert/strict';
import { scanMatchQueue } from './match-queue.js';

const entries = n => Array.from({ length: n }, (_, i) => ({ roomId: `room-${i}` }));
function reader() {
  const reads = [];
  return { reads, async getAll(...refs) { reads.push(refs); return refs; } };
}
const refs = entry => [entry.roomId, `${entry.roomId}/lease`];

test('a live first candidate keeps the two-document fast path and stable queue order', async () => {
  const tx = reader(), queue = entries(30);
  const result = await scanMatchQueue(tx, queue, refs, entry => entry);
  assert.equal(tx.reads.length, 1); assert.equal(tx.reads[0].length, 2);
  assert.equal(result.match.entry.roomId, 'room-0'); assert.deepEqual(result.entries, queue);
});

test('invalid prefixes are batched, but the earliest valid candidate still wins', async () => {
  const tx = reader();
  const result = await scanMatchQueue(tx, entries(30), refs, (entry, snapshots) => {
    assert.deepEqual(snapshots, refs(entry));
    return ['room-8', 'room-9'].includes(entry.roomId) ? entry : null;
  });
  assert.equal(result.match.entry.roomId, 'room-8');
  assert.deepEqual(tx.reads.map(r => r.length), [2, 10, 10]);
  assert.equal(result.entries[0].roomId, 'room-8');
});

test('thirty rejected candidates use at most seven stages and a read error never yields a partial match', async () => {
  const tx = reader(), queue = entries(30);
  assert.deepEqual(await scanMatchQueue(tx, queue, refs, () => null), { match: null, entries: [] });
  assert.equal(tx.reads.length, 7); assert.equal(tx.reads.flat().length, 60);
  await assert.rejects(scanMatchQueue({ getAll: async () => { throw Error('unavailable'); } }, queue, refs, () => true), /unavailable/);
  assert.equal(queue.length, 30);
});
