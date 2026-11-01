import test from 'node:test';
import assert from 'node:assert/strict';
import { runEuropeAcceptance, runEuropeMeasurement } from './europeProbe.js';

for (const [name, run] of [['acceptance', runEuropeAcceptance], ['measurement', runEuropeMeasurement]]) {
  test(`${name} refuses old projects and non-Preview destinations before opening client accounts`, async () => {
    const target = { projectId: 'oyun-portali-avrupa', config: { projectId: 'oyun-portali-avrupa' }, base: 'https://europe-preview.vercel.app' };
    for (const patch of [
      { projectId: 'oyun-odasi-8ecee', config: { projectId: 'oyun-odasi-8ecee' } },
      { config: { projectId: 'oyun-odasi-8ecee' } },
      { base: 'https://www.xn--oyunportal-6ub.com.tr' },
      { base: 'https://other.example' },
      { base: 'http://europe-preview.vercel.app' },
      { base: 'https://europe-preview.vercel.app/path' },
      { mode: 'europe-production', base: 'https://other.example' },
      { mode: 'europe-production', base: 'https://europe-preview.vercel.app' },
      { mode: 'europe-production', projectId: 'oyun-odasi-8ecee', base: 'https://www.xn--oyunportal-6ub.com.tr' },
    ]) await assert.rejects(run({ ...target, ...patch }), /Isolated Europe Preview required/);
  });
}
