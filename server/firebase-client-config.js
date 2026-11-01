// Public web configuration only. Preserve legacy Vercel Secret entries for
// rollback; the explicit selector switches build and session lookup together.
export function europeClientOverrides(env = process.env) {
  if (!env.FIREBASE_CLIENT_TARGET) return {};
  if (env.FIREBASE_CLIENT_TARGET !== 'oyun-portali-avrupa'
    || env.GCP_PROJECT_ID !== 'oyun-portali-avrupa'
    || env.EUROPE_FIREBASE_PROJECT_ID !== 'oyun-portali-avrupa') {
    throw Error('Europe client/server project mismatch');
  }
  const fields = ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID'];
  if (fields.some(field => !env[`EUROPE_FIREBASE_${field}`])) throw Error('Incomplete Europe web configuration');
  return Object.fromEntries(fields.map(field => [`VITE_FIREBASE_${field}`, env[`EUROPE_FIREBASE_${field}`]]));
}

export function sessionApiKey(env = process.env) {
  return europeClientOverrides(env).VITE_FIREBASE_API_KEY ?? env.VITE_FIREBASE_API_KEY;
}
