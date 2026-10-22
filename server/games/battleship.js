import { requireAction } from '../errors.js';
import { SHIP_DEFS, getShipCells, canPlaceShip, cellKey } from '../../src/games/battleship/logic.js';

// Only anchors and directions cross the API. Lengths, occupied cells, hits and
// scores are derived here; a player's claim about any of those is never used.
export function validateFleet(input) {
  requireAction(Array.isArray(input) && input.length === SHIP_DEFS.length, 400, 'invalid_fleet');
  const ships = [];
  for (const def of SHIP_DEFS) {
    const matches = input.filter(ship => ship?.id === def.id);
    requireAction(matches.length === 1, 400, 'invalid_fleet');
    const ship = matches[0];
    requireAction(Object.keys(ship).length === 4 && Object.keys(ship).every(key => ['id', 'row', 'col', 'orientation'].includes(key)), 400, 'invalid_fleet');
    requireAction(Number.isInteger(ship.row) && Number.isInteger(ship.col)
      && ['H', 'V'].includes(ship.orientation), 400, 'invalid_fleet');
    const origin = { row: ship.row, col: ship.col };
    const cells = getShipCells(origin, ship.orientation, def.length);
    requireAction(canPlaceShip(ships, cells).valid, 400, 'invalid_fleet');
    ships.push({ ...def, orientation: ship.orientation, origin, cells });
  }
  return ships;
}

export function freshBattle(players, scores, starter, roundId) {
  return { setupPhase: true, roundId, readyPlayers: {}, shots: {}, revealedShips: {},
    turn: null, startingPlayer: starter ?? null, winner: null, rematchRequestedBy: null,
    scores: Object.fromEntries(players.map(uid => [uid, scores?.[uid] ?? 0])) };
}

export function applyBattleShot(data, fleets, uid, row, col) {
  requireAction(data.players.includes(uid), 403, 'not_a_player');
  requireAction(data.status === 'playing' && !data.setupPhase && !data.winner, 409, 'game_not_playing');
  requireAction(data.turn === uid, 409, 'not_your_turn');
  requireAction(Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < 10 && col >= 0 && col < 10, 400, 'invalid_cell');
  const opponent = data.players.find(id => id !== uid);
  const fleet = fleets[opponent];
  requireAction(fleet?.length === SHIP_DEFS.length, 409, 'fleet_not_ready');
  const shots = data.shots[uid] ?? [];
  requireAction(!shots.some(shot => shot.row === row && shot.col === col), 409, 'already_shot');
  const hit = fleet.some(ship => ship.cells.some(cell => cell.row === row && cell.col === col));
  const nextShots = [...shots, { row, col, hit }];
  const hits = new Set(nextShots.filter(shot => shot.hit).map(shot => cellKey(shot.row, shot.col)));
  const won = fleet.every(ship => ship.cells.every(cell => hits.has(cellKey(cell.row, cell.col))));
  return { hit, state: { shots: { ...data.shots, [uid]: nextShots },
    turn: won ? null : hit ? uid : opponent, winner: won ? uid : null,
    scores: won ? { ...data.scores, [uid]: (data.scores[uid] ?? 0) + 1 } : data.scores,
    // Full fleets become public only after the round is irrevocably finished.
    revealedShips: won ? structuredClone(fleets) : {},
  } };
}
