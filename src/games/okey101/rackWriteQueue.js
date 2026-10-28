// One write at a time; retain only the newest layout while a write is pending.
// flush() is a barrier for the whole drain, including coalesced follow-up writes.
export function createRackWriteQueue({ write, onIdle, onError, delay = 140 }) {
  let pending = null, running = null, timer = null, stopped = false;
  const cancelTimer = () => { clearTimeout(timer); timer = null; };
  const flush = () => {
    cancelTimer();
    if (stopped) return Promise.resolve(false);
    if (running) return running;
    if (!pending) return Promise.resolve(true);
    let succeeded = true;
    running = Promise.resolve().then(async () => {
      while (!stopped && pending) {
        const next = pending; pending = null;
        try {
          const result = await write(next.rack, next.groups);
          if (result?.success === false) succeeded = false;
        } catch (error) { succeeded = false; onError(error); }
      }
    }).then(async () => {
      running = null;
      // A new layout can arrive between the last write and this microtask.
      if (!stopped && pending) succeeded = await flush() && succeeded;
      else if (!stopped) { cancelTimer(); onIdle(); }
      return !stopped && succeeded;
    });
    return running;
  };
  return {
    enqueue(layout, { immediate = false } = {}) {
      if (stopped) return;
      pending = layout;
      cancelTimer();
      if (immediate) void flush();
      else timer = setTimeout(flush, delay);
    },
    flush,
    isIdle: () => !timer && !pending && !running,
    stop() { stopped = true; cancelTimer(); pending = null; },
  };
}
