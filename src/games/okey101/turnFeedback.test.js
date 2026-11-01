import test from 'node:test';
import assert from 'node:assert/strict';
import { turnInstruction } from './turnFeedback.js';

test('a pending draw never tells the player to discard before the private hand arrives', () => {
  const state = { isPlayer: true, isMyTurn: true, busy: true, hasDrawn: false, turnPlayerName: 'Me' };
  assert.equal(turnInstruction({ ...state, pendingType: 'okey.draw' }), 'Taş çekiliyor…');
  assert.equal(turnInstruction({ ...state, hasDrawn: true, pendingType: 'okey.draw' }), 'Taş çekiliyor…');
  assert.equal(turnInstruction({ ...state, pendingType: 'okey.discard' }), 'Taş gönderiliyor…');
  assert.equal(turnInstruction(state), 'Hamlen doğrulanıyor…');
});
test('settled and rejected requests return to confirmed instructions; spectators never get a command', () => {
  const state = { isPlayer: true, isMyTurn: true, busy: false, hasDrawn: false, turnPlayerName: 'Elif' };
  assert.equal(turnInstruction(state), 'Sıra Sende! Önce bir taş çek.');
  assert.equal(turnInstruction({ ...state, hasDrawn: true }), 'Şimdi ıstakandan bir taş at.');
  assert.equal(turnInstruction({ ...state, isPlayer: false }), 'Elif oynuyor…');
  assert.equal(turnInstruction({ ...state, isMyTurn: false }), 'Elif oynuyor…');
});
