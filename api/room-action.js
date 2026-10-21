import { createActionHandler } from '../server/http.js';
import { getServerServices, serverEnabled } from '../server/firebase.js';
import { applyRoomAction } from '../server/room-actions.js';

export default createActionHandler({
  enabled: serverEnabled,
  allowedOrigins: new Set(['https://www.xn--oyunportal-6ub.com.tr', 'https://xn--oyunportal-6ub.com.tr']),
  verifyToken: token => getServerServices().auth.verifyIdToken(token),
  applyAction: (uid, action) => {
    const { db, projectId } = getServerServices();
    return applyRoomAction(db, projectId, uid, action);
  },
});
