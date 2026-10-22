import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { applyXoxMove } from './games/xox.js';
import { validateAction } from './room-actions.js';
import { createActionHandler } from './http.js';
import { federationConfig, serverEnabled } from './firebase.js';

const room = (patch = {}) => ({
  schemaVersion: 2, version: 0, gameType: 'xox', status: 'playing',
  players: ['alice', 'bob'], turn: 'alice', board: Array(9).fill(null),
  winner: null, scores: { alice: 0, bob: 0 }, ...patch,
});
const action = { roomId: 'ABC123', actionId: 'request_00000001', expectedVersion: 0, type: 'xox.move', cell: 0 };
const fails = (code, callback) => assert.throws(callback, error => error.code === code);

test('API imports in serverless loaders without CommonJS require(ESM) support', () => {
  const entry = new URL('../api/room-action.js', import.meta.url).href;
  const result = spawnSync(process.execPath, [
    '--no-experimental-require-module', '--input-type=module',
    '-e', `await import(${JSON.stringify(entry)});`,
  ], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test('XOX derives symbol and next turn without mutating saved state', () => {
  const before = room();
  const after = applyXoxMove(before, 'alice', 4);
  assert.equal(after.board[4], 'X');
  assert.equal(after.turn, 'bob');
  assert.equal(before.board[4], null);
  assert.deepEqual(after.scores, { alice: 0, bob: 0 });
});

test('XOX rejects spectators, out-of-turn moves, closed games and occupied cells', () => {
  fails('not_a_player', () => applyXoxMove(room(), 'mallory', 0));
  fails('not_your_turn', () => applyXoxMove(room(), 'bob', 0));
  for (const status of ['waiting', 'abandoned', 'closed']) {
    fails('game_not_playing', () => applyXoxMove(room({ status }), 'alice', 0));
  }
  fails('occupied_cell', () => applyXoxMove(room({ board: ['O', ...Array(8).fill(null)] }), 'alice', 0));
});

test('XOX awards one point for a win and ends the turn on a draw', () => {
  const win = applyXoxMove(room({ board: ['X', 'X', null, 'O', 'O', null, null, null, null] }), 'alice', 2);
  assert.equal(win.winner, 'X');
  assert.equal(win.turn, null);
  assert.deepEqual(win.scores, { alice: 1, bob: 0 });
  fails('game_not_playing', () => applyXoxMove(room(win), 'alice', 8));
  const draw = applyXoxMove(room({ board: ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', null] }), 'alice', 8);
  assert.equal(draw.winner, 'Draw');
  assert.equal(draw.turn, null);
  assert.deepEqual(draw.scores, { alice: 0, bob: 0 });
});

test('request schema rejects forged scores, identities, boards and path traversal', () => {
  for (const key of ['uid', 'scores', 'board', '__proto__']) {
    fails('invalid_fields', () => validateAction({ ...action, [key]: 'forged' }));
  }
  for (const roomId of ['../abc', 'abc123', 'A/B123', '', null]) {
    fails('invalid_room_id', () => validateAction({ ...action, roomId }));
  }
  for (const cell of [-1, 9, 0.5, '0', null]) {
    fails('invalid_cell', () => validateAction({ ...action, cell }));
  }
  for (const expectedVersion of [-1, 0.5, '0', Number.MAX_SAFE_INTEGER]) {
    fails('invalid_version', () => validateAction({ ...action, expectedVersion }));
  }
});

test('room and rematch requests cannot choose identities, seats, scores or visibility implicitly', () => {
  const base = { actionId: 'request_00000099', roomId: 'ABC123', sessionId: 'session_00000001' };
  const examples = [
    { type: 'room.create', actionId: base.actionId, sessionId: base.sessionId, nickname: 'Player', isPublic: false },
    { type: 'room.match', actionId: base.actionId, sessionId: base.sessionId, nickname: 'Player' },
    { type: 'room.join', ...base, nickname: 'Player' },
    ...['room.spectate', 'room.heartbeat', 'room.disconnect', 'room.leave'].map(type => ({ type, ...base })),
    ...['room.wait', 'room.close', 'xox.rematch.request', 'xox.rematch.accept', 'xox.rematch.reject'].map(type => ({
      type, actionId: base.actionId, roomId: base.roomId, expectedVersion: 0,
    })),
  ];
  for (const input of examples) {
    assert.equal(validateAction(input).type, input.type);
    for (const forged of ['uid', 'players', 'scores', 'board', 'host', 'createdAt']) {
      fails('invalid_fields', () => validateAction({ ...input, [forged]: 'forged' }));
    }
  }
  for (const nickname of ['', '   ', 'x'.repeat(16), 'a\nb']) {
    fails('invalid_nickname', () => validateAction({ ...examples[0], nickname }));
  }
  fails('invalid_visibility', () => validateAction({ ...examples[0], isPublic: 'false' }));
  fails('invalid_session_id', () => validateAction({ ...examples[2], sessionId: '../wrong' }));
});

function response() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request(patch = {}) {
  return {
    method: 'POST', body: action,
    headers: { authorization: 'Bearer header.payload.signature', 'content-type': 'application/json', origin: 'https://game.example' },
    ...patch,
  };
}

test('HTTP uses only verified Firebase identity and disables caching', async () => {
  let received;
  const handler = createActionHandler({
    enabled: () => true, allowedOrigins: new Set(['https://game.example']),
    verifyToken: async token => { assert.equal(token, 'header.payload.signature'); return { uid: 'alice' }; },
    applyAction: async (uid, data) => { received = { uid, data }; return { version: 1 }; },
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(received.uid, 'alice');
  assert.deepEqual(received.data, action);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('HTTP rejects unauthenticated, cross-site, oversized and malformed requests before any write', async () => {
  let writes = 0;
  const handler = createActionHandler({
    enabled: () => true, allowedOrigins: new Set(['https://game.example']),
    verifyToken: async () => ({ uid: 'alice' }), applyAction: async () => { writes++; },
  });
  const cases = [
    [request({ method: 'GET' }), 405],
    [request({ headers: { 'content-type': 'application/json', cookie: 'uid=alice' } }), 401],
    [request({ headers: { ...request().headers, authorization: 'Bearer header.payload.' } }), 401],
    [request({ headers: { ...request().headers, origin: 'https://evil.example' } }), 403],
    [request({ headers: { ...request().headers, 'sec-fetch-site': 'cross-site' } }), 403],
    [request({ headers: { ...request().headers, 'content-type': 'text/plain' } }), 415],
    [request({ body: 'x'.repeat(2049) }), 413],
    [request({ body: '{invalid' }), 400],
    [request({ body: { ...action, scores: { alice: 999 } } }), 400],
  ];
  for (const [req, expected] of cases) {
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, expected);
  }
  assert.equal(writes, 0);
});

test('HTTP denies expired/forged tokens and hides underlying SDK errors', async () => {
  let writes = 0;
  for (const authFails of [true, false]) {
    const handler = createActionHandler({
      enabled: () => true, allowedOrigins: new Set(['https://game.example']),
      verifyToken: async () => { if (authFails) throw Error('secret-token'); return { uid: 'alice' }; },
      applyAction: async () => { writes++; throw Error('secret-database-detail'); },
    });
    const res = response();
    await handler(request(), res);
    assert.equal(res.statusCode, authFails ? 401 : 503);
    assert.equal(JSON.stringify(res.body).includes('secret'), false);
  }
  assert.equal(writes, 1);
});

test('disabled rollout never verifies tokens or touches Firestore', async () => {
  const handler = createActionHandler({
    enabled: () => false, allowedOrigins: new Set(),
    verifyToken: () => assert.fail('must not authenticate'),
    applyAction: () => assert.fail('must not write'),
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(serverEnabled({ GAME_API_ENABLED: 'true', VERCEL_ENV: 'preview' }), false);
  assert.equal(serverEnabled({ GAME_API_ENABLED: 'true', VERCEL_ENV: 'production', FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' }), false);
  assert.equal(serverEnabled({ GAME_API_ENABLED: 'true', VERCEL_ENV: 'production' }), true);
});

test('federation pins Google endpoints and rejects unexpected service accounts', () => {
  const env = {
    GCP_PROJECT_ID: 'demo-game-project', GCP_PROJECT_NUMBER: '123456789012',
    GCP_WORKLOAD_IDENTITY_POOL_ID: 'game-prod', GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel',
    GCP_SERVICE_ACCOUNT_EMAIL: 'game-server@demo-game-project.iam.gserviceaccount.com',
  };
  const config = federationConfig(env);
  assert.equal(config.options.token_url, 'https://sts.googleapis.com/v1/token');
  assert.equal(config.audience, `https:${config.options.audience}`);
  assert.deepEqual(config.options.scopes, ['https://www.googleapis.com/auth/datastore']);
  assert.throws(() => federationConfig({ ...env, GCP_SERVICE_ACCOUNT_EMAIL: 'game-server@another-project.iam.gserviceaccount.com' }));
  assert.throws(() => federationConfig({ ...env, GCP_WORKLOAD_IDENTITY_POOL_ID: '../evil' }));
});
