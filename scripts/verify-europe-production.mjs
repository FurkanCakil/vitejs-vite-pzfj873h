// Explicit cutover acceptance. Normal anonymous SDK clients, new private rooms;
// hard pinned to the new project and the canonical Production origin.
import { writeFile } from 'node:fs/promises';
import { runEuropeAcceptance, runEuropeMeasurement } from '../src/qa/europeProbe.js';

const acceptance = process.argv.includes('--verify-europe-production');
const measurement = process.argv.includes('--measure-europe-production');
if (acceptance === measurement) throw Error('Choose exactly one explicit Europe Production probe');
process.loadEnvFile('.env.europe.local');
if (process.env.VITE_FIREBASE_PROJECT_ID !== 'oyun-portali-avrupa'
  || process.env.GCP_PROJECT_ID !== 'oyun-portali-avrupa'
  || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw Error('New Europe project required');
}
const target = {
  mode: 'europe-production', base: 'https://www.xn--oyunportal-6ub.com.tr',
  projectId: 'oyun-portali-avrupa', config: {
    apiKey: process.env.VITE_FIREBASE_API_KEY, authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: 'oyun-portali-avrupa', appId: process.env.VITE_FIREBASE_APP_ID,
  },
};
const report = await (acceptance ? runEuropeAcceptance : runEuropeMeasurement)(target, console.log);
// The shared browser probe also runs in Node; identify this transport accurately.
if (measurement) Object.assign(report, { scenario: 'europe-production-node-rest-client', client: 'node-fetch' });
await writeFile(acceptance ? 'europe-production-acceptance.local' : 'performance-europe-production.local', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (report.failure || report.cleanupFailures) process.exitCode = 1;
