export function createServerClock({ wallNow = () => Date.now(), monoNow = () => performance.now() } = {}) {
  let anchor = null, sequence = 0, acceptedOrder = 0;
  return {
    start: () => ({ at: monoNow(), order: ++sequence }),
    update: (serverAt, sample) => {
      const received = monoNow(), elapsed = received - sample?.at;
      if (!Number.isSafeInteger(serverAt) || serverAt <= 0 || !Number.isFinite(elapsed)
        || elapsed < 0 || elapsed > 30_000 || !Number.isSafeInteger(sample?.order)
        || sample.order <= acceptedOrder) return;
      acceptedOrder = sample.order;
      anchor = { at: received, serverAt: serverAt + elapsed / 2 };
    },
    // This estimate only schedules/displays. The API owns all deadlines.
    // Fresh responses reanchor after platforms that pause this clock in sleep.
    // Never persist an anchor across page lifetimes.
    now: () => anchor ? anchor.serverAt + Math.max(0, monoNow() - anchor.at) : wallNow(),
  };
}

const clock = createServerClock();
export const beginServerTiming = clock.start;
export const updateServerClock = clock.update;
export const serverNow = clock.now;
