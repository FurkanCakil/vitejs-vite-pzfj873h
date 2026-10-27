import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { executeRoomAction } from './xox-rooms.js';

const projectId='demo-oyun-portali',sessionId='legacy_retirement_01';let sequence=0;
const action=(type,fields={})=>({type,actionId:`retired_${String(++sequence).padStart(12,'0')}`,...fields});
test('Retired room rules deny all client access while the v2 boundary and collision checks remain intact',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async t=>{
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8180');assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9199');
  const authClient=new OAuth2Client();authClient.setCredentials({access_token:'owner',expiry_date:Date.now()+3_600_000});
  const db=new Firestore({projectId,authClient,preferRest:true}),root=`artifacts/${projectId}`;
  const signup=async()=> (await(await fetch('http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})})).json());
  const [member,outsider]=await Promise.all([signup(),signup()]);
  const headers=user=>({Authorization:`Bearer ${user.idToken}`,'Content-Type':'application/json'});
  const base=`http://127.0.0.1:8180/v1/projects/${projectId}/databases/(default)/documents/${root}/public/data`;
  const types=['room.create','battleship.create','okey.create','connect4.create','checkers.create','chess.create','tavla.create'];
  const games=['xox','amiralbatti','okey101','connect4','dama','satranc','tavla'];
  const code=i=>`LEG${i}01`,ref=i=>db.doc(`${root}/public/data/rooms/${code(i)}`);
  const run=(uid,input,roomCode)=>executeRoomAction(db,projectId,uid,input,15_000_000,()=>roomCode,{
    battleshipEnabled:true,okeyEnabled:true,connect4Enabled:true,checkersEnabled:true,chessEnabled:true,tavlaEnabled:true});
  try{
    for(let i=0;i<games.length;i++)await ref(i).set({gameId:games[i],players:[member.localId],host:member.localId,status:'waiting',isPublic:true,
      board:['retired-board'],ships:{opponent:['retired-fleet']},racks:{opponent:['retired-hand']},drawPile:['retired-deck']});
    await t.test('anonymous, former member and outsider cannot read or list any retired game',async()=>{
      for(let i=0;i<games.length;i++)for(const user of [null,member,outsider])assert.equal((await fetch(`${base}/rooms/${code(i)}`,user?{headers:headers(user)}:{})).status,403);
      for(const user of [null,member,outsider])for(const path of ['rooms','serverStatus','serverStatus/info'])assert.equal((await fetch(`${base}/${path}`,user?{headers:headers(user)}:{})).status,403);
      await ref(0).collection('playerData').doc(member.localId).set({private:'retired'});
      assert.equal((await fetch(`${base}/rooms/${code(0)}/playerData/${member.localId}`,{headers:headers(member)})).status,403);
    });
    await t.test('clients cannot create, edit or delete old rooms, and stored old data is preserved',async()=>{
      for(const user of [null,member,outsider]){
        const opts=user?{headers:headers(user)}:{headers:{'Content-Type':'application/json'}};
        assert.equal((await fetch(`${base}/rooms?documentId=LEGNEW`,{...opts,method:'POST',body:'{"fields":{}}'})).status,403);
        assert.equal((await fetch(`${base}/rooms/${code(0)}?updateMask.fieldPaths=nonexistentAuditField`,{...opts,method:'PATCH',body:'{"fields":{}}'})).status,403);
        assert.equal((await fetch(`${base}/rooms/${code(0)}`,{...opts,method:'DELETE'})).status,403);
        assert.equal((await fetch(`${base}/serverStatus/info?updateMask.fieldPaths=nonexistentAuditField`,{...opts,method:'PATCH',body:'{"fields":{}}'})).status,403);
      }
      assert.deepEqual((await ref(0).get()).data().board,['retired-board']);assert.equal((await db.doc(`${root}/public/data/rooms/LEGNEW`).get()).exists,false);
    });
    await t.test('new server rooms never reuse retired codes for any game',async()=>{
      for(let i=0;i<types.length;i++)await assert.rejects(run(`legacy-collision-${i}`,action(types[i],{sessionId,nickname:'New Room',isPublic:false}),code(i)),error=>error.code==='room_code_collision');
    });
    await t.test('a retired code cannot silently rejoin or spectate through the v2 API',async()=>{
      for(const type of ['room.join','room.spectate']){
        const fields={roomId:code(0),sessionId,...(type==='room.join'?{nickname:'Former Member'}:{})};
        await assert.rejects(run(member.localId,action(type,fields)),error=>error.code==='room_not_found');
      }
      assert.equal((await db.doc(`${root}/public/data/roomsV2/${code(0)}`).get()).exists,false);
      assert.deepEqual((await ref(0).get()).data().players,[member.localId]);
    });
  }finally{await db.terminate();}
});
