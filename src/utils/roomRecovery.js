// Compute from the transaction's latest snapshot, never from an old overlay.
export function roomRecoveryUpdate(data, expectedPlayer, expectedReason) {
  if (!data || data.status !== 'abandoned' || data.abandonedBy !== expectedPlayer ||
      (data.abandonReason || null) !== (expectedReason || null)) return null;
  if (data.abandonReason !== 'left') {
    return { status: 'waiting', abandonedBy: null, abandonReason: null };
  }
  const players = (data.players || []).filter(id => id !== expectedPlayer);
  const keepPlaying = data.gameId === 'okey101' && players.length >= 2;
  return {
    status: players.length ? (keepPlaying ? 'playing' : 'waiting') : 'closed',
    players,
    host: players.includes(data.host) ? data.host : (players.find(id => !data.isBotPlayer?.[id]) || players[0] || null),
    abandonedBy: null,
    abandonReason: null,
  };
}
