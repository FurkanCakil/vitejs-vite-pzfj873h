import { TURN_TIMEOUT_GRACE_MS } from './tiles.js';
import { serverNow } from '../../utils/serverClock.js';

export const countdownSeconds = (deadline, now = serverNow()) => Math.max(0, Math.ceil((deadline - now) / 1000));

// A due time only schedules an attempt; the server validates every deadline.
export function okeyAutoActionAt(data, uid) {
  if (!data.players.includes(uid)) return null;
  const seat = Math.max(0, data.players.indexOf(uid));
  if (data.status === 'waiting' && data.countdownStartedAt) return data.countdownStartedAt + 3200 + seat * 150;
  if (data.status === 'playing' && data.hasDealt && !data.roundEnded) {
    const botTurn = !data.setupPhase && data.isBotPlayer?.[data.turn];
    const due = data.setupPhase ? data.setupEndsAt : botTurn ? data.botReadyAt : data.turnDeadline + TURN_TIMEOUT_GRACE_MS;
    if (Number.isFinite(due)) return due + (botTurn ? 80 + seat * 120 : 200 + seat * 150);
  }
  return null;
}

export function okeyAutoAction(data, uid, now = serverNow()) {
  const due = okeyAutoActionAt(data, uid);
  return due !== null && now >= due ? (data.status === 'waiting' ? 'okey.start' : 'okey.tick') : null;
}
