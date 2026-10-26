import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { executeRoomAction, CONNECTION_TTL } from './xox-rooms.js';
import { freshChess } from './games/chess.js';

const projectId = 'demo-oyun-portali', sessionId = 'chess_session_test1';
let sequence = 0;
const action = (type, fields = {}) => ({ type, actionId: `chess_int_${String(++sequence).padStart(8, '0')}`, ...fields });
const sq = name => (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]);
test('Chess server play, agreements, notation, lifecycle and access rules', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9199');
  const authClient = new OAuth2Client(); authClient.setCredentials({ access_token: 'owner', expiry_date: Date.now() + 3_600_000 });
  const db = new Firestore({ projectId, authClient, preferRest: true }), now = 9_000_000;
  const root = `artifacts/${projectId}`, ref = id => db.doc(`${root}/public/data/roomsV2/${id}`);
  const load = async id => (await ref(id).get()).data();
  const run = (uid, input, time = now, code = 'CUNUSD', enabled = true) => executeRoomAction(db, projectId, uid, input, time, () => code,
    { chessEnabled: enabled, checkersEnabled: true, connect4Enabled: true });
  const create = (uid, code, isPublic = false) => run(uid, action('chess.create', { sessionId, nickname: uid.slice(0, 15), isPublic }), now, code);
  const join = (uid, roomId) => run(uid, action('room.join', { roomId, sessionId, nickname: uid.slice(0, 15) }));
  const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
  const command = async (uid, roomId, type) => run(uid, action(type, { roomId, expectedVersion: (await load(roomId)).version }));
  const play = async (id, from, to, promotion = null) => {
    const room = await load(id);
    return run(room.turn, action('chess.move', { roomId: id, expectedVersion: room.version, from: sq(from), to: sq(to), promotion }));
  };
  const pair = async (id, a, b) => { await create(a, id); await join(b, id); return load(id); };
  try {
    await t.test('closed flag rejects creation and joins, with no cross-game action allowed', async () => {
      await rejects(run('c-off', action('chess.create', { sessionId, nickname: 'Off', isPublic: false }), now, 'COFF12', false), 'server_not_enabled');
      assert.equal((await ref('COFF12').get()).exists, false);
      await create('c-off', 'COFF12');
      await rejects(run('c-off-b', action('room.join', { roomId: 'COFF12', sessionId, nickname: 'Guest' }), now, 'CUNUSD', false), 'server_not_enabled');
      await run('c-xox', action('room.create', { sessionId, nickname: 'XOX', isPublic: false }), now, 'CXOX12', false);
      await rejects(command('c-xox', 'CXOX12', 'chess.resign'), 'unsupported_room');
      await rejects(run('c-off', action('checkers.move', { roomId: 'COFF12', expectedVersion: 0, from: 40, to: 33 })), 'unsupported_room');
    });
    await t.test('host color is retained on join and white starts; forged fields and spectators are denied', async () => {
      await create('c-open-a', 'COPEN1'); const first = await load('COPEN1'); await join('c-open-b', 'COPEN1');
      const room = await load('COPEN1');
      assert.equal(room.playerColors['c-open-a'], first.playerColors['c-open-a']); assert.equal(room.playerColors[room.turn], 'w');
      assert.equal(room.board.filter(Boolean).length, 32);
      await run('c-viewer', action('room.spectate', { roomId: 'COPEN1', sessionId }));
      await rejects(command('c-viewer', 'COPEN1', 'chess.resign'), 'not_a_player');
      const before = await load('COPEN1'), request = action('chess.move', { roomId: 'COPEN1', expectedVersion: before.version, from: 52, to: 36, promotion: null });
      await rejects(run(before.players.find(uid => uid !== before.turn), request), 'not_your_turn');
      await rejects(run(before.turn, { ...request, scores: { [before.turn]: 999 } }), 'invalid_fields');
      await rejects(run(before.turn, { ...request, previousState: before }), 'invalid_fields');
    });
    await t.test('competing moves commit one version and retrying one action never repeats it', async () => {
      const room = await load('COPEN1');
      const inputs = [36, 44].map(to => action('chess.move', { roomId: 'COPEN1', expectedVersion: room.version, from: 52, to, promotion: null }));
      const results = await Promise.allSettled(inputs.map(input => run(room.turn, input)));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(results.find(result => result.status === 'rejected').reason.code, 'stale_version');
      const winner = results.findIndex(result => result.status === 'fulfilled');
      assert.deepEqual(await run(room.turn, inputs[winner]), results[winner].value);
      assert.equal((await load('COPEN1')).chessMoves.length, 1);
    });
    await t.test('a complete mate scores once and rematch needs opponent consent and swaps colors', async () => {
      await pair('CMATE1', 'c-mate-a', 'c-mate-b');
      for (const [from, to] of [['f2','f3'],['e7','e5'],['g2','g4']]) await play('CMATE1', from, to);
      let room = await load('CMATE1'); const winner = room.turn, other = room.players.find(uid => uid !== winner);
      const final = action('chess.move', { roomId: 'CMATE1', expectedVersion: room.version, from: sq('d8'), to: sq('h4'), promotion: null });
      assert.deepEqual(...await Promise.all([run(winner, final), run(winner, final)]));
      room = await load('CMATE1'); assert.equal(room.winner, winner); assert.equal(room.scores[winner], 1);
      assert.deepEqual(room.chessMoves, ['f3','e5','g4','Qh4#']);
      await rejects(command(winner, 'CMATE1', 'chess.resign'), 'game_not_playing');
      await command(winner, 'CMATE1', 'chess.rematch.request');
      await rejects(command(winner, 'CMATE1', 'chess.rematch.accept'), 'invalid_rematch');
      const oldColors = room.playerColors; await command(other, 'CMATE1', 'chess.rematch.accept'); room = await load('CMATE1');
      for (const uid of room.players) assert.notEqual(room.playerColors[uid], oldColors[uid]);
      assert.equal(room.playerColors[room.turn], 'w'); assert.equal(room.scores[winner], 1); assert.equal(room.board.filter(Boolean).length, 32);
      assert.deepEqual(room.chessMoves, []); assert.equal(room.previousState, null); assert.equal(room.drawOffer, null);
    });
    await t.test('draw agreement and resignation derive results once and cannot be self-accepted', async () => {
      await pair('CDRAW1', 'c-draw-a', 'c-draw-b');
      await command('c-draw-a', 'CDRAW1', 'chess.draw.request');
      await rejects(command('c-draw-a', 'CDRAW1', 'chess.draw.accept'), 'invalid_offer');
      await command('c-draw-b', 'CDRAW1', 'chess.draw.reject');
      await command('c-draw-a', 'CDRAW1', 'chess.draw.request');
      await command('c-draw-b', 'CDRAW1', 'chess.draw.accept');
      let room = await load('CDRAW1'); assert.equal(room.winner, 'Draw'); assert.equal(Object.values(room.scores).reduce((a,b)=>a+b), 0);
      await pair('CRESG1', 'c-resign-a', 'c-resign-b'); room = await load('CRESG1');
      const request = action('chess.resign', { roomId: 'CRESG1', expectedVersion: room.version });
      assert.deepEqual(...await Promise.all([run('c-resign-a', request), run('c-resign-a', request)]));
      room = await load('CRESG1'); assert.equal(room.winner, 'c-resign-b'); assert.equal(room.scores['c-resign-b'], 1);
      await rejects(command('c-resign-a', 'CRESG1', 'chess.resign'), 'game_not_playing');
    });
    await t.test('takeback restores only the server previous move including en passant, captured pieces and PGN', async () => {
      await pair('CBACK1', 'c-back-a', 'c-back-b');
      for (const [from,to] of [['e2','e4'],['a7','a6'],['e4','e5'],['d7','d5']]) await play('CBACK1', from, to);
      const before = await load('CBACK1'), mover = before.turn, other = before.players.find(uid => uid !== mover);
      await play('CBACK1', 'e5','d6'); await command(mover, 'CBACK1', 'chess.takeback.request');
      await rejects(command(mover, 'CBACK1', 'chess.takeback.accept'), 'invalid_offer');
      await command(other, 'CBACK1', 'chess.takeback.accept'); let room = await load('CBACK1');
      for (const key of ['board','turn','captured','enPassantTarget','positionHistory','chessMoves','halfmoveClock','scores']) assert.deepEqual(room[key], before[key]);
      assert.equal(room.previousState, null); await rejects(command(other, 'CBACK1', 'chess.takeback.accept'), 'invalid_offer');
      await play('CBACK1','e5','d6'); await command(mover,'CBACK1','chess.takeback.request'); room = await load('CBACK1');
      const old = action('chess.takeback.accept', { roomId:'CBACK1', expectedVersion:room.version });
      await play('CBACK1','a6','a5'); await rejects(run(other, old),'stale_version');
    });
    await t.test('a takeback acceptance competing with the reply commits only one outcome', async () => {
      await pair('CRACE1','c-race-a','c-race-b'); await play('CRACE1','e2','e4');
      let room=await load('CRACE1'); const reply=room.turn, mover=room.players.find(uid=>uid!==reply);
      await command(mover,'CRACE1','chess.takeback.request'); room=await load('CRACE1');
      const inputs=[action('chess.takeback.accept',{roomId:'CRACE1',expectedVersion:room.version}),
        action('chess.move',{roomId:'CRACE1',expectedVersion:room.version,from:12,to:28,promotion:null})];
      const results=await Promise.allSettled(inputs.map(input=>run(reply,input)));
      assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
      assert.equal(results.find(result=>result.status==='rejected').reason.code,'stale_version');
      const after=await load('CRACE1'); assert.equal(after.version,room.version+1); assert.equal(after.takebackOffer,null);
      assert.deepEqual(after.chessMoves,results[0].status==='fulfilled'?[]:['e4','e5']);
      assert.equal(Object.values(after.scores).reduce((a,b)=>a+b),0);
    });
    await t.test('leave/wait archives full notation separately and restores only the same Firebase UID pair', async () => {
      await pair('CHIST1','c-hist-a','c-hist-b'); await play('CHIST1','e2','e4');
      const before = await load('CHIST1'), leaver = before.turn, host = before.players.find(uid => uid !== leaver);
      await run(leaver,action('room.heartbeat',{roomId:'CHIST1',sessionId:'chess_second_tab'}));
      await run(leaver,action('room.disconnect',{roomId:'CHIST1',sessionId:'chess_second_tab'})); assert.equal((await load('CHIST1')).status,'playing');
      await run(leaver,action('room.leave',{roomId:'CHIST1',sessionId})); await command(host,'CHIST1','room.wait');
      const waiting = await load('CHIST1'); assert.equal(waiting.history.length,1); assert.deepEqual(Object.keys(waiting.history[0].state),['players']);
      assert.equal((await db.doc(`${root}/serverChessHistory/CHIST1/matches/${waiting.history[0].key}`).get()).data().chessMoves[0],'e4');
      await join('c-new','CHIST1'); let room = await load('CHIST1'); assert.equal(room.chessMoves.length,0); assert.equal(room.board.filter(Boolean).length,32);
      await run('c-new',action('room.leave',{roomId:'CHIST1',sessionId})); await command(host,'CHIST1','room.wait'); await join(leaver,'CHIST1'); room=await load('CHIST1');
      for(const key of ['board','turn','captured','enPassantTarget','positionHistory','chessMoves','previousState','halfmoveClock','scores','playerColors']) assert.deepEqual(room[key],before[key],key);
    });
    await t.test('long notation fits a real Firestore write and archive; only eight pair records are retained', async () => {
      let room=await pair('CLONG1','c-long-a','c-long-b');
      // Deliberately extreme synthetic upper bound, not a naturally played game.
      await ref('CLONG1').update({chessMoves:Array(19_999).fill('Qabcdefghijklmno')});
      await play('CLONG1','e2','e4'); room=await load('CLONG1'); assert.equal(room.chessMoves.length,20_000);
      const leaver=room.turn, host=room.players.find(uid=>uid!==leaver);
      await run(leaver,action('room.leave',{roomId:'CLONG1',sessionId})); await command(host,'CLONG1','room.wait');
      const waiting=await load('CLONG1'); const archive=db.collection(`${root}/serverChessHistory/CLONG1/matches`);
      assert.equal((await archive.get()).docs[0].data().chessMoves.length,20_000);
      for(let i=0;i<8;i++) {
        const guest=`c-long-guest-${i}`; await join(guest,'CLONG1');
        await run(guest,action('room.leave',{roomId:'CLONG1',sessionId})); await command(host,'CLONG1','room.wait');
      }
      assert.equal((await archive.get()).size,8); assert.equal((await load('CLONG1')).history.length,8);
      assert.equal((await archive.doc(waiting.history[0].key).get()).exists,false);
    });
    await t.test('atomic matchmaking is game-specific and stale hosts cannot appear as opponents', async () => {
      const matches=await Promise.all(['c-match-a','c-match-b'].map((uid,i)=>run(uid,action('chess.match',{sessionId,nickname:uid}),now,`CMAT${i}1`)));
      assert.equal(matches[0].roomId,matches[1].roomId); assert.equal((await load(matches[0].roomId)).players.length,2);
      await create('c-stale','CSTALE',true);
      assert.equal((await run('c-fresh',action('chess.match',{sessionId,nickname:'Fresh'}),now+CONNECTION_TTL+1,'CFRESH')).roomId,'CFRESH');
    });
    await t.test('real Auth permits members and read-only lobby, denying direct writes, listings and private history', async () => {
      const signup=async()=> (await (await fetch('http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})})).json());
      const [a,b]=await Promise.all([signup(),signup()]); await create(a.localId,'CAUTH1');
      const base=`http://127.0.0.1:8180/v1/projects/${projectId}/databases/(default)/documents/${root}`;
      const headers={Authorization:`Bearer ${a.idToken}`,'Content-Type':'application/json'}, room=`${base}/public/data/roomsV2/CAUTH1`;
      assert.equal((await fetch(room,{headers})).status,200);
      assert.equal((await fetch(room)).status,403); assert.equal((await fetch(room,{headers:{Authorization:`Bearer ${b.idToken}`}})).status,403);
      assert.equal((await fetch(room,{method:'PATCH',headers,body:JSON.stringify({fields:{}})})).status,403);
      assert.equal((await fetch(`${base}/public/data/chessLobby/queue`,{headers})).status,200);
      assert.equal((await fetch(`${base}/public/data/chessLobby/queue`)).status,403);
      assert.equal((await fetch(`${base}/public/data/chessLobby/queue`,{method:'PATCH',headers,body:JSON.stringify({fields:{}})})).status,403);
      for(const path of ['public/data/roomsV2','serverRoomActors','serverRoomPresence','serverChessHistory/CHIST1/matches']) assert.equal((await fetch(`${base}/${path}`,{headers})).status,403);
      const key=(await load('CHIST1')).history[0].key;
      assert.equal((await fetch(`${base}/serverChessHistory/CHIST1/matches/${key}`,{headers})).status,403);
    });
  } finally { await db.terminate(); }
});
