// Run only inside firebase emulators:exec --project demo-oyun-portali.
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180'
  || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9199'
  || process.env.VERCEL_ENV) throw new Error('Local demo emulators are required');
process.env.VITE_USE_FIREBASE_EMULATORS = 'true';
process.env.VITE_SERVER_XOX_ENABLED = 'true';
process.env.VITE_SERVER_BATTLESHIP_ENABLED = 'true';
process.env.BATTLESHIP_API_ENABLED = 'true';
const { createServer } = await import('vite');
const server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
await server.listen();
server.printUrls();
