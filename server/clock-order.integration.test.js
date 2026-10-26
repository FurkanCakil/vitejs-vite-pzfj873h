import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { executeRoomAction } from './xox-rooms.js';
import { executePresenceAction } from './presence.js';

const projectId='demo-oyun-portali',sessionId='clock_order_session1';let sequence=0;
const action=(type,fields={})=>({type,actionId:`clock_order_${String(++sequence).padStart(8,'0')}`,...fields});
test('Server requests that finish out of timestamp order preserve live seats and retired sessions',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async t=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8180');assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9199');
 const authClient=new OAuth2Client();authClient.setCredentials({access_token:'owner',expiry_date:Date.now()+3_600_000});
 const db=new Firestore({projectId,authClient,preferRest:true}),now=12_000_000;
 const run=(uid,type,fields,time=now,code='CLKUNO')=>executeRoomAction(db,projectId,uid,action(type,fields),time,()=>code,{okeyEnabled:true});
 const load=async code=>(await db.doc(`artifacts/${projectId}/public/data/roomsV2/${code}`).get()).data();
 try{
  await t.test('an older heartbeat cannot disconnect a freshly renewed opponent',async()=>{
   await run('clock-a','room.create',{sessionId,nickname:'Clock A',isPublic:false},now,'CLKAB1');
   await run('clock-b','room.join',{roomId:'CLKAB1',sessionId,nickname:'Clock B'});
   await run('clock-b','room.heartbeat',{roomId:'CLKAB1',sessionId},now+1);
   await run('clock-a','room.heartbeat',{roomId:'CLKAB1',sessionId},now);
   assert.equal((await load('CLKAB1')).status,'playing');
   await run('clock-a','xox.move',{roomId:'CLKAB1',expectedVersion:(await load('CLKAB1')).version,cell:0},now);
  });
  await t.test('an earlier match request still sees a newer live waiting host',async()=>{
   await run('clock-match-a','room.create',{sessionId,nickname:'Clock Host',isPublic:true},now+1,'CLKMAT');
   const joined=await run('clock-match-b','room.match',{sessionId,nickname:'Clock Guest'},now,'CLKNEW');assert.equal(joined.roomId,'CLKMAT');
  });
  await t.test('an older Okey heartbeat cannot replace a connected human with a bot',async()=>{
   const players=['clock-ok-a','clock-ok-b','clock-ok-c','clock-ok-d'];
   await run(players[0],'okey.create',{sessionId,nickname:'Clock Okey',isPublic:false},now,'CLKOK1');
   for(const uid of players.slice(1))await run(uid,'room.join',{roomId:'CLKOK1',sessionId,nickname:uid},now);
   await run(players[0],'okey.start',{roomId:'CLKOK1',expectedVersion:(await load('CLKOK1')).version},now+3200);
   await run(players[1],'room.heartbeat',{roomId:'CLKOK1',sessionId},now+3201);
   await run(players[0],'room.heartbeat',{roomId:'CLKOK1',sessionId},now+3200);
   const after=await load('CLKOK1');assert.deepEqual(after.players,players);assert.equal(after.isBotPlayer[players[1]],undefined);
  });
  await t.test('an older presence heartbeat cannot forget a newer leave tombstone',async()=>{
   const uid='clock-presence',fields={sessionId,roomCode:null};
   const beat=time=>executePresenceAction(db,projectId,uid,action('presence.heartbeat',fields),time,{enabled:true});
   await beat(now);await executePresenceAction(db,projectId,uid,action('presence.leave',{sessionId}),now+1,{enabled:true});
   assert.equal((await beat(now)).retired,true);
  });
  await t.test('a request from before a newer rate window cannot reset its action count',async()=>{
   await run('clock-rate','room.create',{sessionId,nickname:'Clock Rate',isPublic:false},now+10_001,'CLKRAT');
   for(let i=0;i<29;i++)await run('clock-rate','room.heartbeat',{roomId:'CLKRAT',sessionId},now+10_001);
   await assert.rejects(run('clock-rate','room.heartbeat',{roomId:'CLKRAT',sessionId},now+10_000),error=>error.code==='too_many_actions');
  });
  await t.test('a delayed create cannot discard newer room-creation limit records',async()=>{
   for(const code of ['CLKC01','CLKC02','CLKC03'])await run('clock-create','room.create',{sessionId,nickname:'Clock Create',isPublic:false},now+1,code);
   await assert.rejects(run('clock-create','room.create',{sessionId,nickname:'Clock Create',isPublic:false},now,'CLKC04'),error=>error.code==='too_many_rooms');
  });
 }finally{await db.terminate();}
});
