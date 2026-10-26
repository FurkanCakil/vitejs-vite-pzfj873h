import test from 'node:test';
import assert from 'node:assert/strict';
import { freshServerTime, monotonicServerTime, MAX_SERVER_REORDER_MS } from './time.js';

test('server timestamp freshness tolerates bounded request reordering without extending expired past leases',()=>{
 const now=1_000_000;
 assert.equal(freshServerTime(now+1,now,60_000),true);
 assert.equal(freshServerTime(now-59_999,now,60_000),true);
 assert.equal(freshServerTime(now-60_000,now,60_000),false);
 for(const at of [now+MAX_SERVER_REORDER_MS+1,Infinity,NaN,undefined,'1000000'])assert.equal(freshServerTime(at,now,60_000),false);
});
test('a delayed server write cannot reduce a newer valid lease timestamp',()=>{
 const now=1_000_000;
 assert.equal(monotonicServerTime(now+1,now),now+1);assert.equal(monotonicServerTime(now-1,now),now);
 assert.equal(monotonicServerTime(now+MAX_SERVER_REORDER_MS+1,now),now);
 assert.equal(monotonicServerTime(undefined,now),now);
});
