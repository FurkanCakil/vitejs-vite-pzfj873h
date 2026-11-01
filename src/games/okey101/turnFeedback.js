// Presentation only: never changes turn ownership or authorizes an action.
export function turnInstruction({ pendingType, busy, isPlayer, isMyTurn, hasDrawn, turnPlayerName }) {
  if (pendingType === 'okey.draw') return 'Taş çekiliyor…';
  if (pendingType === 'okey.discard') return 'Taş gönderiliyor…';
  if (isPlayer && isMyTurn && busy) return 'Hamlen doğrulanıyor…';
  if (isPlayer && isMyTurn) return hasDrawn ? 'Şimdi ıstakandan bir taş at.' : 'Sıra Sende! Önce bir taş çek.';
  return `${turnPlayerName} oynuyor…`;
}
