export function rollDie() { return Math.floor(Math.random() * 6) + 1; }

export function createInitialBoard() {
  const board = Array(24).fill(null).map(() => ({ count: 0, color: null }));
  board[0] = { count: 2, color: 'white' }; board[11] = { count: 5, color: 'white' };
  board[16] = { count: 3, color: 'white' }; board[18] = { count: 5, color: 'white' };
  board[23] = { count: 2, color: 'black' }; board[12] = { count: 5, color: 'black' };
  board[7] = { count: 3, color: 'black' }; board[5] = { count: 5, color: 'black' };
  return board;
}

export function applyMove(board, bar, borneOff, color, from, to) {
  const newBoard = board.map(pt => pt ? { count: pt.count || 0, color: pt.color || null } : { count: 0, color: null });
  const newBar = { white: bar?.white || 0, black: bar?.black || 0 };
  const newBorneOff = { white: borneOff?.white || 0, black: borneOff?.black || 0 };
  const opp = color === 'white' ? 'black' : 'white';

  if (from === -1) newBar[color] = Math.max(0, (newBar[color] || 0) - 1);
  else { newBoard[from].count = Math.max(0, (newBoard[from].count || 0) - 1); if (newBoard[from].count === 0) newBoard[from].color = null; }

  if ((color === 'white' && to === 24) || (color === 'black' && to === -1)) { newBorneOff[color] = (newBorneOff[color] || 0) + 1; return { board: newBoard, bar: newBar, borneOff: newBorneOff }; }
  if (newBoard[to] && newBoard[to].color === opp && newBoard[to].count === 1) { newBoard[to] = { count: 0, color: null }; newBar[opp] = (newBar[opp] || 0) + 1; }
  if (!newBoard[to] || newBoard[to].count === 0) { newBoard[to] = { count: 1, color }; } else { newBoard[to].count = (newBoard[to].count || 0) + 1; newBoard[to].color = color; }
  return { board: newBoard, bar: newBar, borneOff: newBorneOff };
}

export function getBaseValidMoves(board, color, dice, bar, borneOff) {
  if (!board || !color || !dice || dice.length === 0) return [];
  const uniqueDice = [...new Set(dice)]; const moves = []; const direction = color === 'white' ? 1 : -1;
  const homeStart = color === 'white' ? 18 : 0; const homeEnd = color === 'white' ? 23 : 5;   

  const piecesOnBoard = board.reduce((acc, pt) => pt && pt.color === color ? acc + (pt.count || 0) : acc, 0);
  const piecesOnBar = bar || 0;
  const canBearOff = (piecesOnBoard + piecesOnBar + (borneOff || 0) === 15) && allInHome(board, color, homeStart, homeEnd, piecesOnBar);

  for (const die of uniqueDice) {
    if (piecesOnBar > 0) {
      const entryIdx = color === 'white' ? die - 1 : 24 - die;
      if (!board[entryIdx] || board[entryIdx].color === null || board[entryIdx].color === color || board[entryIdx].count === 1) moves.push({ from: -1, to: entryIdx, die });
      continue;
    }
    for (let i = 0; i < 24; i++) {
      if (!board[i] || board[i].color !== color || !board[i].count) continue;
      const toIdx = i + direction * die;
      if (color === 'white' && toIdx >= 24 && canBearOff) {
        if (toIdx === 24 || (toIdx > 24 && i === highestPiece(board, color, homeStart, homeEnd))) moves.push({ from: i, to: 24, die });
        continue;
      }
      if (color === 'black' && toIdx < 0 && canBearOff) {
        if (toIdx === -1 || (toIdx < -1 && i === highestPiece(board, color, homeStart, homeEnd))) moves.push({ from: i, to: -1, die });
        continue;
      }
      if (toIdx < 0 || toIdx > 23) continue;
      if (!board[toIdx] || board[toIdx].color === null || board[toIdx].color === color || board[toIdx].count <= 1) moves.push({ from: i, to: toIdx, die });
    }
  }
  return moves;
}

export function getMaxDiceUsage(board, color, dice, barObj, borneOffObj) {
  if (dice.length === 0) return 0;
  const myBar = barObj[color] || 0; const myBorne = borneOffObj[color] || 0;
  const moves = getBaseValidMoves(board, color, dice, myBar, myBorne);
  if (moves.length === 0) return 0;

  let maxUsed = 0;
  for (const move of moves) {
    const { board: nb, bar: nbar, borneOff: nboff } = applyMove(board, barObj, borneOffObj, color, move.from, move.to);
    const remDice = [...dice]; remDice.splice(remDice.indexOf(move.die), 1);
    const usedHere = 1 + getMaxDiceUsage(nb, color, remDice, nbar, nboff);
    if (usedHere > maxUsed) maxUsed = usedHere;
  }
  return maxUsed;
}

export function getStrictValidMoves(board, color, dice, barObj, borneOffObj) {
  const myBar = barObj[color] || 0; const myBorne = borneOffObj[color] || 0;
  const baseMoves = getBaseValidMoves(board, color, dice, myBar, myBorne);
  if (baseMoves.length === 0) return [];

  let globalMaxUsage = 0;
  const movesWithUsage = baseMoves.map(move => {
    const { board: nb, bar: nbar, borneOff: nboff } = applyMove(board, barObj, borneOffObj, color, move.from, move.to);
    const remDice = [...dice]; remDice.splice(remDice.indexOf(move.die), 1);
    const totalUsage = 1 + getMaxDiceUsage(nb, color, remDice, nbar, nboff);
    if (totalUsage > globalMaxUsage) globalMaxUsage = totalUsage;
    return { move, totalUsage };
  });

  let validMoves = movesWithUsage.filter(m => m.totalUsage === globalMaxUsage).map(m => m.move);
  if (globalMaxUsage === 1 && new Set(dice).size > 1) {
    const maxDiePlayable = Math.max(...validMoves.map(m => m.die));
    validMoves = validMoves.filter(m => m.die === maxDiePlayable);
  }
  return validMoves;
}

export function allInHome(board, color, homeStart, homeEnd, piecesOnBar) {
  if (piecesOnBar > 0) return false;
  for (let i = 0; i < 24; i++) { if (i < homeStart || i > homeEnd) { if (board[i]?.color === color && board[i].count > 0) return false; } }
  return true;
}

export function highestPiece(board, color, homeStart, homeEnd) {
  if (color === 'white') { for (let i = homeStart; i <= homeEnd; i++) { if (board[i]?.color === color && board[i].count > 0) return i; } } 
  else { for (let i = homeEnd; i >= homeStart; i--) { if (board[i]?.color === color && board[i].count > 0) return i; } }
  return -1;
}