import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createActionHandler } from '../server/http.js';
import { applyRoomAction } from '../server/room-actions.js';

export function emulatorMiddleware() {
  if (process.env.VERCEL_ENV || process.env.VITE_USE_FIREBASE_EMULATORS !== 'true'
    || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180'
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9199') {
    throw new Error('Local demo emulators are required');
  }
  const projectId = 'demo-oyun-portali';
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: 'owner', expiry_date: Date.now() + 86_400_000 });
  const db = new Firestore({ projectId, authClient, preferRest: true });
  const app = getApps().find(item => item.name === 'xox-emulator-api') ?? initializeApp({ projectId }, 'xox-emulator-api');
  const handler = createActionHandler({ enabled: () => true, allowUnsignedEmulatorTokens: true,
    allowedOrigins: new Set(['http://localhost:5173', 'http://127.0.0.1:5173']),
    verifyToken: token => getAuth(app).verifyIdToken(token),
    applyAction: (uid, action, metrics) => metrics
      ? applyRoomAction(metrics.wrapDb(db), projectId, uid, action, undefined, undefined, { metrics })
      : applyRoomAction(db, projectId, uid, action),
  });
  return async (request, response) => {
    let bytes = 0;
    const chunks = [];
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 2048) { response.statusCode = 413; response.end('{"ok":false,"error":"body_too_large"}'); return; }
      chunks.push(chunk);
    }
    request.body = Buffer.concat(chunks);
    response.status = code => { response.statusCode = code; return response; };
    response.json = body => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body)); return response; };
    await handler(request, response);
  };
}
