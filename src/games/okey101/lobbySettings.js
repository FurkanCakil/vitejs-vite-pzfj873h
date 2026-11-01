// Preview only public lobby settings; the server still validates every write.
export function createLobbySettings({ read, send, onChange }) {
  let draft = null, queued = null, running = null, starting = false, stopped = false;
  const notify = () => { if (!stopped) onChange(); };
  const locked = () => starting || !!read().countdownStartedAt || read().status !== 'waiting';
  const flush = () => {
    if (running) return running;
    if (stopped || !queued) return Promise.resolve(!stopped);
    running = Promise.resolve().then(async () => {
      while (!stopped && queued) {
        const rules = queued; queued = null;
        try {
          const result = await send('okey.rules', { rules });
          if (result?.success === false) { queued = null; return false; }
        } catch { queued = null; return false; }
      }
      return !stopped;
    }).then(async succeeded => {
      running = null;
      if (!stopped && queued) return await flush() && succeeded;
      draft = null; notify();
      return succeeded;
    });
    return running;
  };
  return {
    view: () => ({ rules: draft ?? read().rules, saving: !!draft, locked: locked(), starting }),
    locked,
    change(key, value) {
      if (stopped || locked()) return;
      const current = draft ?? read().rules;
      if (current[key] === value) return;
      const rules = { ...current, [key]: value };
      if (rules.gameType !== '2v2' || !rules.foldingEnabled) rules.foldToPartnerEnabled = false;
      draft = rules; queued = rules; notify();
      void flush();
    },
    async start() {
      if (stopped || locked()) return false;
      starting = true; notify();
      try {
        // Freeze now; save the latest selection before filling the seats.
        if (!await flush() || stopped || read().countdownStartedAt || read().status !== 'waiting') return false;
        const result = await send('okey.bots');
        return result?.success !== false;
      } catch { return false; }
      finally { starting = false; notify(); }
    },
    resume() { stopped = false; },
    stop() { stopped = true; queued = null; },
  };
}
