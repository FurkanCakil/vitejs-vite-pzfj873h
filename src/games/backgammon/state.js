import { getStrictValidMoves } from './logic.js';

export function remainingTavlaDice(dice, usedDice) {
  const remaining = [...dice];
  for (const die of usedDice) {
    const index = remaining.indexOf(die);
    if (index !== -1) remaining.splice(index, 1);
  }
  return remaining;
}

// Single, gammon and backgammon use the winner's home board.
export function tavlaWinPoints(board, bar, borneOff, color, cubeValue = 1) {
  const opponent = color === 'white' ? 'black' : 'white';
  if (borneOff[opponent] > 0) return cubeValue;
  const homeStart = color === 'white' ? 18 : 0;
  const backgammon = bar[opponent] > 0 || board.slice(homeStart, homeStart + 6)
    .some(point => point.color === opponent && point.count > 0);
  return (backgammon ? 3 : 2) * cubeValue;
}

export function tavlaTurnSnapshot(room) {
  return structuredClone({ board: room.board, bar: room.bar, borneOff: room.borneOff });
}

// Called after a server roll or move. A blocked roll must never strand a turn.
export function tavlaNextPhase(room, color, dice, usedDice, uid) {
  const remaining = remainingTavlaDice(dice, usedDice);
  if (remaining.length && getStrictValidMoves(room.board, color, remaining, room.bar, room.borneOff).length) {
    return { phase: 'moving', turn: uid, usedDice };
  }
  return { phase: 'rolling', turn: room.players.find(player => player !== uid), usedDice: [...usedDice, ...remaining], initialTurnState: null };
}
