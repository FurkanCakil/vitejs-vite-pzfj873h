import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { europeClientOverrides } from './server/firebase-client-config.js'

const europeOverrides = europeClientOverrides(process.env);

// https://vite.dev/config/
export default defineConfig({
  define: {
    ...Object.fromEntries(Object.entries(europeOverrides).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
    'import.meta.env.EUROPE_PREVIEW_QA': JSON.stringify(process.env.VERCEL_ENV === 'preview'
      && process.env.VERCEL_GIT_COMMIT_REF === 'codex/europe-preview'
      && process.env.GCP_PROJECT_ID === 'oyun-portali-avrupa'),
  },
  plugins: [react(), {
    name: 'local-demo-game-api',
    async configureServer(server) {
      if (process.env.VITE_USE_FIREBASE_EMULATORS !== 'true') return;
      const { emulatorMiddleware } = await import('./scripts/dev-emulator-api.mjs');
      server.middlewares.use('/api/room-action', emulatorMiddleware());
    },
  }],
})
