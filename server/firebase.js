import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from '@google-cloud/firestore';
import { IdentityPoolClient } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';
import { createSelfAccountLookup, createSessionCheck } from './session-check.js';

export function federationConfig(env) {
  const projectId = env.GCP_PROJECT_ID;
  const projectNumber = env.GCP_PROJECT_NUMBER;
  const pool = env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const provider = env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  const account = env.GCP_SERVICE_ACCOUNT_EMAIL;
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId ?? '')
    || !/^\d{6,20}$/.test(projectNumber ?? '')
    || !/^[a-z0-9-]{4,32}$/.test(pool ?? '')
    || !/^[a-z0-9-]{4,32}$/.test(provider ?? '')
    || typeof account !== 'string'
    || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]@/.test(account)
    || !account.endsWith(`@${projectId}.iam.gserviceaccount.com`)) {
    throw new Error('Invalid server identity configuration');
  }
  const resource = `iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${pool}/providers/${provider}`;
  return {
    projectId,
    audience: `https://${resource}`,
    options: {
      type: 'external_account',
      audience: `//${resource}`,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      token_url: 'https://sts.googleapis.com/v1/token',
      service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateAccessToken`,
      scopes: ['https://www.googleapis.com/auth/datastore'],
    },
  };
}

export function isEuropePreview(env = process.env) {
  // A branch-scoped opt-in never gives Preview access to the old project.
  return env.VERCEL_ENV === 'preview' && env.GAME_PREVIEW_ENABLED === 'true'
    && env.VERCEL_GIT_COMMIT_REF === 'codex/europe-preview'
    && env.GAME_PREVIEW_PROJECT_ID === 'oyun-portali-avrupa'
    && env.GCP_PROJECT_ID === env.GAME_PREVIEW_PROJECT_ID
    && env.VITE_FIREBASE_PROJECT_ID === env.GAME_PREVIEW_PROJECT_ID
    && !env.FIRESTORE_EMULATOR_HOST && !env.FIREBASE_AUTH_EMULATOR_HOST;
}

function isAuthorizedServer(env) {
  return !env.FIRESTORE_EMULATOR_HOST && !env.FIREBASE_AUTH_EMULATOR_HOST
    && (env.VERCEL_ENV === 'production' || isEuropePreview(env));
}

export function serverOrigins(env = process.env) {
  if (env.VERCEL_ENV === 'production') return new Set(['https://www.xn--oyunportal-6ub.com.tr', 'https://xn--oyunportal-6ub.com.tr']);
  if (!isEuropePreview(env)) return new Set();
  return new Set([env.VERCEL_URL, env.VERCEL_BRANCH_URL]
    .filter(host => typeof host === 'string' && /^[a-z0-9-]+\.vercel\.app$/.test(host))
    .map(host => `https://${host}`));
}

export function serverEnabled(env = process.env) {
  return env.GAME_API_ENABLED === 'true' && isAuthorizedServer(env);
}

export function createProductionFirestore(env = process.env) {
  if (!isAuthorizedServer(env)) throw new Error('Authorized Vercel identity required');
  const config = federationConfig(env);
  const authClient = new IdentityPoolClient({
    ...config.options,
    subject_token_supplier: {
      // Read the current invocation's token when Google refreshes credentials.
      // Do not capture a Vercel token at module load or put one in a file.
      getSubjectToken: () => getVercelOidcToken({ audience: config.audience }),
    },
  });
  return {
    projectId: config.projectId,
    // Firebase Admin's Firestore wrapper does not accept custom credentials;
    // the official Google client accepts the external-account auth client.
    db: new Firestore({ projectId: config.projectId, authClient, preferRest: true }),
  };
}

let services;
export function getServerServices() {
  if (!serverEnabled()) throw new Error('Server is not enabled');
  if (services) return services;
  const { db, projectId } = createProductionFirestore();
  const appName = 'game-server';
  const app = getApps().find(candidate => candidate.name === appName)
    ?? initializeApp({ projectId }, appName);
  services = {
    projectId,
    auth: getAuth(app),
    db,
    // Opt-in until the real Production lookup and outage behavior are checked.
    checkSession: process.env.AUTH_SESSION_CHECK_ENABLED === 'true'
      ? createSessionCheck({ lookup: createSelfAccountLookup({ apiKey: process.env.VITE_FIREBASE_API_KEY }) }) : null,
  };
  return services;
}
