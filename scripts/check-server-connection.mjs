import { createProductionFirestore } from '../server/firebase.js';

// During rollout, verify the production identity without enabling any game
// endpoint or changing game data. Preview/local builds have no database access.
if (process.env.VERCEL_ENV === 'production' && process.env.GCP_PROJECT_ID) {
  let db;
  try {
    const connection = createProductionFirestore();
    db = connection.db;
    // Read a fixed, server-only sentinel; do not print its contents or identity
    // tokens. Reading a missing document also verifies database authorization.
    await db.doc(`artifacts/${connection.projectId}/serverHealth/connection`).get();
    console.log('Production server identity: Firestore read verified. Game API remains controlled by its rollout flag.');
  } catch (error) {
    const safeCode = ['permission-denied', 'unauthenticated', 'unavailable', 7, 16, 14].includes(error?.code)
      ? String(error.code) : 'connection_failed';
    console.error(`Production server identity check failed (${safeCode}). Deployment stopped; no game data was changed.`);
    process.exitCode = 1;
  } finally {
    if (db) await db.terminate();
  }
} else {
  console.log('Production server identity check skipped: local/preview or server not configured.');
}
