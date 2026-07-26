const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

export const BOT_UID = 'BOT_PLAYER';

export const DIFFICULTY_LABELS = { easy: 'Kolay', medium: 'Orta', hard: 'Zor' };

export function checkWinner(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line };
  }
  return null;
}

const getEmptyIndices = (board) => board.reduce((acc, cell, i) => { if (!cell) acc.push(i); return acc; }, []);

const getRandomMove = (board) => {
  const empty = getEmptyIndices(board);
  return empty[Math.floor(Math.random() * empty.length)];
};

const findWinningMove = (board, symbol) => {
  for (const index of getEmptyIndices(board)) {
    const copy = [...board]; copy[index] = symbol;
    if (checkWinner(copy)?.winner === symbol) return index;
  }
  return null;
};

function minimax(board, symbol, opponent, isMaximizing) {
  const result = checkWinner(board);
  if (result) return result.winner === symbol ? 10 : -10;
  if (getEmptyIndices(board).length === 0) return 0;

  const scores = getEmptyIndices(board).map((index) => {
    const copy = [...board]; copy[index] = isMaximizing ? symbol : opponent;
    return minimax(copy, symbol, opponent, !isMaximizing);
  });
  return isMaximizing ? Math.max(...scores) : Math.min(...scores);
}

function getBestMove(board, symbol, opponent) {
  let bestScore = -Infinity; let bestMove = null;
  for (const index of getEmptyIndices(board)) {
    const copy = [...board]; copy[index] = symbol;
    const score = minimax(copy, symbol, opponent, false);
    if (score > bestScore) { bestScore = score; bestMove = index; }
  }
  return bestMove;
}

function getMediumMove(board, symbol, opponent) {
  const winMove = findWinningMove(board, symbol);
  if (winMove !== null) return winMove;
  const blockMove = findWinningMove(board, opponent);
  if (blockMove !== null) return blockMove;
  if (board[4] === null && Math.random() < 0.5) return 4;
  return getRandomMove(board);
}

export function getBotMove(board, difficulty, symbol, opponent) {
  if (difficulty === 'easy') return getRandomMove(board);
  if (difficulty === 'medium') return getMediumMove(board, symbol, opponent);
  return getBestMove(board, symbol, opponent);
}
