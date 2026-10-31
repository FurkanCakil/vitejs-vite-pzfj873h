import { createActionHandler } from '../server/http.js';
import { getServerServices, serverEnabled, serverOrigins } from '../server/firebase.js';
import { applyRoomAction } from '../server/room-actions.js';

export default createActionHandler({
  enabled: serverEnabled,
  allowedOrigins: serverOrigins(),
  verifyToken: async (token, metrics) => {
    const { auth, checkSession } = getServerServices();
    const identity = metrics ? await metrics.measure('auth_verify_ms', () => auth.verifyIdToken(token)) : await auth.verifyIdToken(token);
    if (checkSession) {
      if (metrics) await metrics.measure('auth_session_ms', () => checkSession(token, identity));
      else await checkSession(token, identity);
    }
    return identity;
  },
  applyAction: (uid, action, metrics) => {
    const { db, projectId } = getServerServices();
    return metrics ? applyRoomAction(metrics.wrapDb(db), projectId, uid, action, undefined, undefined, { metrics })
      : applyRoomAction(db, projectId, uid, action);
  },
});
