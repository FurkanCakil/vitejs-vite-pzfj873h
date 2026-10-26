import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { executeRoomAction, CONNECTION_TTL } from './xox-rooms.js';
import { remainingTavlaDice } from '../src/games/backgammon/state.js';
import { getStrictValidMoves } from '../src/games/backgammon/logic.js';

const projectId = 'demo-oyun-portali', sessionId = 'tavla_session_test1';
let sequence = 0;
const action = (type, fields = {}) => ({ type, actionId: `tavla_int_${String(++sequence).padStart(8, '0')}`, ...fields });
test('Tavla server dice, legal play, cube, lifecycle and access rules', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
  const authClient = new OAuth2Client(); authClient.setCredentials({ access_token: 'owner', expiry_date: Date.now() + 3_600_000 });
  const db = new Firestore({ projectId, authClient, preferRest: true }), now = 10_000_000;
  const root = `artifacts/${projectId}`, ref = id => db.doc(`${root}/public/data/roomsV2/${id}`);
  const load = async id => (await ref(id).get()).data();
  const run = (uid, input, time = now, code = 'TUNUSD', enabled = true) => executeRoomAction(db, projectId, uid, input, time, () => code,
    { tavlaEnabled: enabled, chessEnabled: true });
  const create = (uid, code, isPublic = false) => run(uid, action('tavla.create', { sessionId, nickname: uid.slice(0, 15), isPublic }), now, code);
  const join = (uid, roomId) => run(uid, action('room.join', { roomId, sessionId, nickname: uid.slice(0, 15) }));
  const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
  const command = async (uid, roomId, type, fields = {}, time = now) => run(uid, action(type, { roomId, expectedVersion: (await load(roomId)).version, ...fields }), time);
  const pair = async (id, a, b) => { await create(a, id); await join(b, id); return load(id); };
  const open = async id => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const room = await load(id); if (room.phase !== 'opening') return room;
      if (room.openingRolls.p1 && room.openingRolls.p1 === room.openingRolls.p2) await command(room.players[0], id, 'tavla.opening.reset');
      else {
        const uid = room.players.find(p => !room.openingRolls[room.playerColors[p] === 'white' ? 'p1' : 'p2']);
        await command(uid, id, 'tavla.roll');
      }
    }
    assert.fail('Opening must finish');
  };
  try {
    await t.test('disabled flags and cross-game actions cannot touch a room', async () => {
      await rejects(run('t-off', action('tavla.create', { sessionId, nickname: 'Off', isPublic: false }), now, 'TOFF12', false), 'server_not_enabled');
      assert.equal((await ref('TOFF12').get()).exists, false);
      await create('t-off', 'TOFF12'); await rejects(run('t-off-b', action('room.join', { roomId: 'TOFF12', sessionId, nickname: 'Guest' }), now, 'TUNUSD', false), 'server_not_enabled');
      await run('t-xox', action('room.create', { sessionId, nickname: 'XOX', isPublic: false }), now, 'TXOX12');
      await rejects(command('t-xox', 'TXOX12', 'tavla.roll'), 'unsupported_room'); await rejects(command('t-off', 'TOFF12', 'chess.resign'), 'unsupported_room');
    });
    await t.test('colors survive joining; opening rolls are server-only and action replay cannot reroll', async () => {
      await create('t-open-a', 'TOPEN1'); const first = await load('TOPEN1'); await join('t-open-b', 'TOPEN1');
      let room = await load('TOPEN1'); assert.equal(room.playerColors['t-open-a'], first.playerColors['t-open-a']);
      const request = action('tavla.roll', { roomId: 'TOPEN1', expectedVersion: room.version });
      const results = await Promise.all([run('t-open-a', request), run('t-open-a', request)]); assert.deepEqual(results[0], results[1]);
      room = await load('TOPEN1'); const key = room.playerColors['t-open-a'] === 'white' ? 'p1' : 'p2';
      assert.ok(room.openingRolls[key] >= 1 && room.openingRolls[key] <= 6); assert.equal(room.version, first.version + 2);
      await rejects(command('t-open-a', 'TOPEN1', 'tavla.roll'), 'already_rolled');
      await rejects(run('t-open-a', { ...request, dice: [6, 6] }), 'invalid_fields');
      await run('t-viewer', action('room.spectate', { roomId: 'TOPEN1', sessionId }));
      await rejects(command('t-viewer', 'TOPEN1', 'tavla.opening.reset'), 'not_a_player');
      room = await open('TOPEN1'); assert.equal(room.phase, 'moving');
      const winningColor = room.openingRolls.p1 > room.openingRolls.p2 ? 'white' : 'black'; assert.equal(room.playerColors[room.turn], winningColor);
      assert.deepEqual(room.dice, [room.openingRolls.p1, room.openingRolls.p2].sort((a,b) => b-a));
    });
    await t.test('competing moves change one version and legal undo consumes only a server snapshot', async () => {
      const room = await load('TOPEN1'), color = room.playerColors[room.turn];
      const moves = getStrictValidMoves(room.board, color, room.dice, room.bar, room.borneOff);
      const inputs = moves.slice(0,2).map(move => action('tavla.move', { roomId:'TOPEN1', expectedVersion:room.version, ...move }));
      assert.equal(inputs.length,2); const results = await Promise.allSettled(inputs.map(input => run(room.turn,input)));
      assert.equal(results.filter(r => r.status === 'fulfilled').length,1); assert.equal(results.find(r => r.status === 'rejected').reason.code,'stale_version');
      const index = results.findIndex(r => r.status === 'fulfilled'); assert.deepEqual(await run(room.turn, inputs[index]),results[index].value);
      const after = await load('TOPEN1'); assert.equal(after.usedDice.length,1); assert.equal(after.turn,room.turn);
      const undo = action('tavla.undo',{roomId:'TOPEN1',expectedVersion:after.version});
      await Promise.all([run(room.turn,undo),run(room.turn,undo)]); const restored = await load('TOPEN1');
      for (const key of ['board','bar','borneOff','scores','dice','usedDice']) assert.deepEqual(restored[key],room[key]);
      await rejects(command(room.turn,'TOPEN1','tavla.undo'),'invalid_undo');
    });
    await t.test('equal opening resets and fully blocked bar turns are committed atomically', async () => {
      let room = await pair('TTIES1','t-tie-a','t-tie-b');
      // Emulator-only synthetic tie to exercise both clients racing reset.
      await ref('TTIES1').update({openingRolls:{p1:3,p2:3}});
      const inputs=room.players.map(()=>action('tavla.opening.reset',{roomId:'TTIES1',expectedVersion:room.version}));
      const results=await Promise.allSettled(inputs.map((input,i)=>run(room.players[i],input)));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1); assert.deepEqual((await load('TTIES1')).openingRolls,{p1:null,p2:null});
      // Both white bar entries for every possible die are blocked; no chosen roll is injected.
      const board=Array.from({length:24},(_,i)=>i<6?{color:'black',count:i===0?5:2}:i===23?{color:'white',count:14}:{color:null,count:0});
      const white=room.players.find(uid=>room.playerColors[uid]==='white'), black=room.players.find(uid=>uid!==white);
      await ref('TTIES1').update({board,bar:{white:1,black:0},phase:'rolling',turn:white}); await command(white,'TTIES1','tavla.roll'); room=await load('TTIES1');
      assert.equal(room.turn,black); assert.equal(room.phase,'rolling'); assert.deepEqual(room.usedDice,room.dice); assert.equal(room.initialTurnState,null);
    });
    await t.test('cube acceptance blocks rolling, transfers ownership, and rejection scores the old cube once', async () => {
      const room=await pair('TCUBE1','t-cube-a','t-cube-b'); const [a,b]=room.players;
      await ref('TCUBE1').update({phase:'rolling',turn:a}); await command(a,'TCUBE1','tavla.cube.request');
      await rejects(command(a,'TCUBE1','tavla.roll'),'offer_pending'); await rejects(command(a,'TCUBE1','tavla.cube.accept'),'invalid_offer');
      await command(b,'TCUBE1','tavla.cube.accept'); let after=await load('TCUBE1'); assert.equal(after.cubeValue,2); assert.equal(after.cubeOwner,b);
      await rejects(command(a,'TCUBE1','tavla.cube.request'),'cube_not_owned');
      await ref('TCUBE1').update({turn:b}); await command(b,'TCUBE1','tavla.cube.request'); after=await load('TCUBE1');
      const request=action('tavla.cube.reject',{roomId:'TCUBE1',expectedVersion:after.version}); await Promise.all([run(a,request),run(a,request)]);
      after=await load('TCUBE1'); assert.equal(after.winner,b); assert.equal(after.scores[b],2); assert.equal(after.scores[a],0);
      await command(a,'TCUBE1','tavla.rematch.request'); await rejects(command(a,'TCUBE1','tavla.rematch.accept'),'invalid_rematch');
      await command(b,'TCUBE1','tavla.rematch.accept'); after=await load('TCUBE1');
      assert.equal(after.phase,'opening'); assert.equal(after.turn,null); assert.equal(after.cubeValue,1); assert.equal(after.cubeOwner,null); assert.deepEqual(after.scores,{[a]:0,[b]:2});
      for(const uid of room.players) assert.notEqual(after.playerColors[uid],room.playerColors[uid]);
    });
    await t.test('last bearing off scores once and denies forged dice, board, results and spectator actions', async () => {
      const room=await pair('TFINI1','t-fini-a','t-fini-b'), white=room.players.find(uid=>room.playerColors[uid]==='white'), black=room.players.find(uid=>uid!==white);
      const board=Array.from({length:24},(_,i)=>i===23?{color:'white',count:1}:i===0?{color:'black',count:15}:{color:null,count:0});
      await ref('TFINI1').update({board,borneOff:{white:14,black:0},phase:'moving',turn:white,dice:[1,6],usedDice:[],cubeValue:2});
      let before=await load('TFINI1'); const request=action('tavla.move',{roomId:'TFINI1',expectedVersion:before.version,from:23,to:24,die:6});
      for(const key of ['board','dice','scores','winner','uid','initialTurnState']) await rejects(run(white,{...request,[key]:999}),'invalid_fields');
      await rejects(run(black,request),'not_your_turn'); await run('t-fini-view',action('room.spectate',{roomId:'TFINI1',sessionId}));
      before=await load('TFINI1'); request.expectedVersion=before.version; await rejects(run('t-fini-view',request),'not_a_player');
      await Promise.all([run(white,request),run(white,request)]); const after=await load('TFINI1');
      assert.equal(after.winner,white); assert.equal(after.scores[white],4); assert.equal(after.scores[black],0); assert.equal(after.borneOff.white,15);
      await rejects(command(white,'TFINI1','tavla.move',{from:23,to:24,die:6}),'game_not_playing');
    });
    await t.test('same UID pair restores full turn state; replacement players start fresh and disconnect leases are respected', async () => {
      let room=await pair('THIST1','t-hist-a','t-hist-b'); room=await open('THIST1');
      const mover=room.turn, leaver=room.players.find(uid=>uid!==mover), legal=getStrictValidMoves(room.board,room.playerColors[mover],room.dice,room.bar,room.borneOff)[0];
      await command(mover,'THIST1','tavla.move',legal); const before=await load('THIST1');
      await run(leaver,action('room.heartbeat',{roomId:'THIST1',sessionId:'tavla_second_tab'}));
      await run(leaver,action('room.disconnect',{roomId:'THIST1',sessionId:'tavla_second_tab'})); assert.equal((await load('THIST1')).status,'playing');
      await run(leaver,action('room.leave',{roomId:'THIST1',sessionId}));
      await rejects(command(mover,'THIST1','tavla.undo'),'player_disconnected'); await command(mover,'THIST1','room.wait');
      await join('t-new','THIST1'); assert.equal((await load('THIST1')).phase,'opening');
      await run('t-new',action('room.leave',{roomId:'THIST1',sessionId})); await command(mover,'THIST1','room.wait'); await join(leaver,'THIST1');
      room=await load('THIST1'); for(const key of ['board','dice','usedDice','turn','playerColors','initialTurnState','scores','cubeValue','cubeOwner','cubeOfferBy','openingRolls']) assert.deepEqual(room[key],before[key],key);
      await command(mover,'THIST1','tavla.undo'); assert.deepEqual((await load('THIST1')).board,before.initialTurnState.board);
    });
    await t.test('matchmaking serializes real hosts and expired entries disappear', async () => {
      const results=await Promise.all(['t-match-a','t-match-b'].map((uid,i)=>run(uid,action('tavla.match',{sessionId,nickname:uid}),now,`TMAT${i}1`)));
      assert.equal(results[0].roomId,results[1].roomId); assert.equal((await load(results[0].roomId)).players.length,2);
      await create('t-stale','TSTALE',true);
      assert.equal((await run('t-fresh',action('tavla.match',{sessionId,nickname:'Fresh'}),now+CONNECTION_TTL+1,'TFRESH')).roomId,'TFRESH');
    });
    await t.test('real Auth permits member get/read-only queue; direct writes, lists and private records are denied', async () => {
      const signup=async()=> (await (await fetch('http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})})).json());
      const [a,b]=await Promise.all([signup(),signup()]); await create(a.localId,'TAUTH1');
      const base=`http://127.0.0.1:8180/v1/projects/${projectId}/databases/(default)/documents/${root}`, url=`${base}/public/data/roomsV2/TAUTH1`;
      const headers={Authorization:`Bearer ${a.idToken}`,'Content-Type':'application/json'};
      assert.equal((await fetch(url,{headers})).status,200); assert.equal((await fetch(url)).status,403);
      assert.equal((await fetch(url,{headers:{Authorization:`Bearer ${b.idToken}`}})).status,403);
      assert.equal((await fetch(url,{method:'PATCH',headers,body:JSON.stringify({fields:{}})})).status,403);
      assert.equal((await fetch(`${base}/public/data/tavlaLobby/queue`,{headers})).status,200); assert.equal((await fetch(`${base}/public/data/tavlaLobby/queue`)).status,403);
      assert.equal((await fetch(`${base}/public/data/tavlaLobby/queue`,{method:'PATCH',headers,body:JSON.stringify({fields:{}})})).status,403);
      for(const path of ['public/data/roomsV2','serverRoomActors','serverRoomPresence','serverRoomActors/'+a.localId]) assert.equal((await fetch(`${base}/${path}`,{headers})).status,403);
    });
  } finally { await db.terminate(); }
});
