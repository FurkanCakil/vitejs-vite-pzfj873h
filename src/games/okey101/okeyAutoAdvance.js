import { okeyAutoAction, okeyAutoActionAt } from './okeyTiming.js';
import { serverNow } from '../../utils/serverClock.js';

// One timer per actual deadline, no game-state polling. Snapshot changes and
// visibility recovery re-arm it. Existing seat staggering avoids a tick burst.
export function startOkeyAutoAdvance({ read, uid, send, now = serverNow, documentTarget = document }) {
  let timer, stopped = false, pending = false;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const schedule = (minimumDelay = 0) => {
    clear();
    if (stopped || pending || documentTarget.visibilityState === 'hidden') return;
    const due = okeyAutoActionAt(read(), uid);
    if (due !== null) timer = setTimeout(run, Math.min(2_147_483_647, Math.max(minimumDelay, due - now())));
  };
  const run = () => {
    clear();
    if (stopped || pending || documentTarget.visibilityState === 'hidden') return;
    const data = read(), type = okeyAutoAction(data, uid, now());
    if (!type) { schedule(); return; }
    const attemptedAt = okeyAutoActionAt(data, uid);
    pending = true;
    Promise.resolve().then(() => stopped ? undefined : send(type)).catch(() => {}).finally(() => {
      pending = false;
      // An early/failed/stale attempt must not spin at a past deadline.
      schedule(okeyAutoActionAt(read(), uid) === attemptedAt ? 1000 : 0);
    });
  };
  const visible = () => schedule();
  documentTarget.addEventListener('visibilitychange', visible);
  schedule();
  return { notify: () => schedule(), stop() { stopped = true; clear(); documentTarget.removeEventListener('visibilitychange', visible); } };
}
