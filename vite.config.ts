import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'local-demo-game-api',
    async configureServer(server) {
      if (process.env.VITE_USE_FIREBASE_EMULATORS !== 'true') return;
      const { emulatorMiddleware } = await import('./scripts/dev-emulator-api.mjs');
      server.middlewares.use('/api/room-action', emulatorMiddleware());
    },
  }],
})
