// Explicit private-room Europe acceptance using normal client credentials only.
import { writeFile } from 'node:fs/promises';
import { runEuropeAcceptance } from '../src/qa/europeProbe.js';
import { loadEuropePreviewTarget, previewProtectionHeaders } from './europe-preview-target.mjs';
if (!process.argv.includes('--verify-europe-preview')) throw Error('Explicit --verify-europe-preview required');
const target={...loadEuropePreviewTarget(),headers:await previewProtectionHeaders()};
const report=await runEuropeAcceptance(target,console.log);
await writeFile('europe-acceptance.local',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(report.failure||report.cleanupFailures) process.exitCode=1;
