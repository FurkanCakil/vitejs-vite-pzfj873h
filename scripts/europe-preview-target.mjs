import { readFile } from 'node:fs/promises';

export function loadEuropePreviewTarget() {
  process.loadEnvFile('.env.europe.local');
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
  const base = process.env.EUROPE_PREVIEW_URL;
  if (projectId !== 'oyun-portali-avrupa' || process.env.GCP_PROJECT_ID !== projectId
    || !/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(base ?? '')
    || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw Error('Isolated Europe Preview configuration required');
  }
  return { projectId, base, config: {
    apiKey: process.env.VITE_FIREBASE_API_KEY, authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId, appId: process.env.VITE_FIREBASE_APP_ID,
  } };
}

// A short-lived official CLI OIDC token, never an account key or a permanent
// protection exception. Only callers pinned to the Europe Preview use it.
export async function previewProtectionHeaders() {
  try {
    const token = (await readFile('.europe-preview-oidc.local', 'utf8')).trim();
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw Error('Invalid Preview OIDC token');
    return { 'x-vercel-trusted-oidc-idp-token': token };
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}
