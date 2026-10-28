import { TURN_TIMEOUT_GRACE_MS } from './tiles.js';
import { serverNow } from '../../utils/serverClock.js';

export const countdownSeconds = (deadline, now = serverNow()) => Math.max(0, Math.ceil((deadline - now) / 1000));

// Only schedules an attempt; the existing server validates the real deadline.
export function okeyAutoAction(data, uid, now = serverNow()) {
  if (!data.players.includes(uid)) return null;
  const stagger = Math.max(0, data.players.indexOf(uid)) * 150;
  if (data.status === 'waiting' && data.countdownStartedAt && now >= data.countdownStartedAt + 3200 + stagger) return 'okey.start';
  if (data.status === 'playing' && data.hasDealt && !data.roundEnded) {
    const due = data.setupPhase ? data.setupEndsAt : data.isBotPlayer?.[data.turn] ? data.botReadyAt : data.turnDeadline + TURN_TIMEOUT_GRACE_MS;
    if (now >= due + 200 + stagger) return 'okey.tick';
  }
  return null;
}
