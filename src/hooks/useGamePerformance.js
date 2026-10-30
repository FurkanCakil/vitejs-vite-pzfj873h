import { useLayoutEffect } from 'react';
import { gamePerformance } from '../utils/gamePerformance.js';

// Wall time from this component's render entry to layout commit, not CPU time.
// Two rAFs identify a subsequent visible frame opportunity, not a paint proof.
export function useGamePerformance(roomId, game, version, coherent = true) {
  const started = (game === 'xox' || game === 'okey101') && gamePerformance.isEnabled() ? performance.now() : null;
  useLayoutEffect(() => {
    if (started === null || !coherent) return undefined;
    gamePerformance.commit(roomId, game, version, performance.now() - started);
    let second;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => gamePerformance.frame(roomId, game, version));
    });
    return () => { cancelAnimationFrame(first); if (second !== undefined) cancelAnimationFrame(second); };
  });
}
