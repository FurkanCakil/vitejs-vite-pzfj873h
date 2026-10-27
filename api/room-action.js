import { createActionHandler } from '../server/http.js';
import { getServerServices, serverEnabled } from '../server/firebase.js';
import { applyRoomAction } from '../server/room-actions.js';

export default createActionHandler({
  enabled: serverEnabled,
  allowedOrigins: new Set(['https://www.xn--oyunportal-6ub.com.tr', 'https://xn--oyunportal-6ub.com.tr']),
  verifyToken: async token => {
    const { auth, checkSession } = getServerServices();
    const identity = await auth.verifyIdToken(token);
    if (checkSession) await checkSession(token, identity);
    return identity;
  },
  applyAction: (uid, action) => {
    const { db, projectId } = getServerServices();
    return applyRoomAction(db, projectId, uid, action);
  },
});
