import { ActionError, requireAction } from './errors.js';
import { validateAction } from './room-actions.js';
import { reportServerFailure } from './diagnostics.js';

const MAX_BODY_BYTES = 2048;

export function createActionHandler({ enabled, verifyToken, applyAction, allowedOrigins, allowUnsignedEmulatorTokens = false, reportFailure = reportServerFailure }) {
  return async function handler(request, response) {
    let phase = 'request';
    const report = error => { try { reportFailure(phase, error); } catch { /* preserve the response */ } };
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      requireAction(enabled(), 503, 'server_not_enabled');
      requireAction(request.method === 'POST', 405, 'method_not_allowed');
      // Bearer auth is required; cookies never authorize an action. Origin is
      // defense in depth, not the source of a player's identity.
      const origin = request.headers.origin;
      requireAction(!origin || allowedOrigins.has(origin), 403, 'origin_not_allowed');
      requireAction(request.headers['sec-fetch-site'] !== 'cross-site', 403, 'origin_not_allowed');
      requireAction(/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? ''), 415, 'json_required');
      const length = request.headers['content-length'];
      requireAction(length === undefined || (/^\d+$/.test(length) && Number(length) <= MAX_BODY_BYTES), 413, 'body_too_large');
      const authorization = request.headers.authorization;
      const tokenPattern = allowUnsignedEmulatorTokens
        ? /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/
        : /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
      requireAction(typeof authorization === 'string' && authorization.length <= 8192
        && tokenPattern.test(authorization), 401, 'authentication_required');
      let body = request.body;
      if (typeof body === 'string' || Buffer.isBuffer(body)) {
        requireAction(Buffer.byteLength(body) <= MAX_BODY_BYTES, 413, 'body_too_large');
        try { body = JSON.parse(body.toString()); }
        catch { throw new ActionError(400, 'invalid_json'); }
      } else {
        requireAction(Buffer.byteLength(JSON.stringify(body ?? null)) <= MAX_BODY_BYTES, 413, 'body_too_large');
      }
      const action = validateAction(body);
      let identity;
      phase = 'authentication';
      try { identity = await verifyToken(authorization.slice(7)); }
      catch (error) {
        // A failed account-state backend is an availability error, not an
        // expired identity. Keep the response generic and skip every write.
        if (error instanceof ActionError && error.status === 503) throw error;
        throw new ActionError(401, 'invalid_token');
      }
      requireAction(typeof identity?.uid === 'string' && identity.uid.length > 0, 401, 'invalid_token');
      phase = 'action';
      const result = await applyAction(identity.uid, action);
      // A replayed receipt must calibrate against response time, not old time.
      phase = 'response';
      return response.status(200).json({ ok: true, ...result, serverNow: Date.now() });
    } catch (error) {
      if (error instanceof ActionError) {
        if (error.status >= 500 && error.code !== 'server_not_enabled') report(error);
        if (error.status === 405) response.setHeader('Allow', 'POST');
        if (error.status === 429) response.setHeader('Retry-After', '10');
        return response.status(error.status).json({ ok: false, error: error.code });
      }
      // SDK errors may contain access tokens, URLs or database details. Never
      // return or log the raw error. The reporter emits only fixed labels.
      report(error);
      return response.status(503).json({ ok: false, error: 'service_unavailable' });
    }
  };
}
