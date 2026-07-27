// NOT: Bu dosya SADECE bot yapay zekası mantığı içerir (Firestore/React YOK) —
// diğer oyunlardaki (checkers/bot.js, xox/bot.js) desene uygun. FAZ 2: Minimax +
// Alpha-Beta budaması ile gerçek bir düşünen bot. Zor mod rakibin tehditlerini
// aktif olarak arar (heuristic pencere değerlendirmesi negatif ağırlıklı olduğu
// için insan 3'lüleri otomatik olarak yüksek öncelikle bloklanır).
import {
  CONNECT4_COLS, CONNECT4_ROWS, findDropRow, checkConnect4Winner,
} from './logic.js';

export const BOT_UID = 'BOT_PLAYER';

export const DIFFICULTY_LABELS = { easy: 'Kolay', medium: 'Orta', hard: 'Zor' };

const CENTER_COL = 3;
// Sütunları MERKEZDEN dışa doğru sıralar: alpha-beta budaması, en güçlü
// hamleler ilk denendiğinde çok daha fazla dal keser (merkez sütunlar
// istatistiksel olarak connect-4'te en güçlü hamlelerdir).
const COLUMN_ORDER = [3, 2, 4, 1, 5, 0, 6];

const getValidColumns = (board) => COLUMN_ORDER.filter((col) => findDropRow(board, col) !== null);

function applyDrop(board, col, color) {
  const row = findDropRow(board, col);
  if (row === null) return null;
  const newBoard = board.slice();
  newBoard[row * CONNECT4_COLS + col] = color;
  return { board: newBoard, row, col };
}

// Tahtadaki her 4'lü "pencereyi" (yatay/dikey/çift çapraz) bir kez üretir —
// heuristic değerlendirmede tekrar tekrar hesaplamamak için modül yüklenirken
// bir kere kurulur.
function buildWindows() {
  const windows = [];
  for (let row = 0; row < CONNECT4_ROWS; row++) {
    for (let col = 0; col <= CONNECT4_COLS - 4; col++) {
      windows.push([0, 1, 2, 3].map((k) => row * CONNECT4_COLS + col + k));
    }
  }
  for (let col = 0; col < CONNECT4_COLS; col++) {
    for (let row = 0; row <= CONNECT4_ROWS - 4; row++) {
      windows.push([0, 1, 2, 3].map((k) => (row + k) * CONNECT4_COLS + col));
    }
  }
  for (let row = 0; row <= CONNECT4_ROWS - 4; row++) {
    for (let col = 0; col <= CONNECT4_COLS - 4; col++) {
      windows.push([0, 1, 2, 3].map((k) => (row + k) * CONNECT4_COLS + col + k));
      windows.push([0, 1, 2, 3].map((k) => (row + 3 - k) * CONNECT4_COLS + col + k));
    }
  }
  return windows;
}
const WINDOWS = buildWindows();

function scoreWindow(board, window, botColor, humanColor) {
  let bot = 0; let human = 0;
  for (const idx of window) {
    const cell = board[idx];
    if (cell === botColor) bot++; else if (cell === humanColor) human++;
  }
  if (bot > 0 && human > 0) return 0; // karışık pencere hiçbir zaman 4'lü olamaz
  if (bot === 4) return 100000;
  if (human === 4) return -100000;
  if (bot === 3) return 100;
  if (bot === 2) return 10;
  if (bot === 1) return 1;
  // Rakip tehditleri kasıtlı olarak simetriğinden biraz DAHA AĞIR cezalandırılır
  // — bot sadece kendi fırsatını değil, rakibin 3'lüsünü de anında öncelikli görsün.
  if (human === 3) return -120;
  if (human === 2) return -12;
  return 0;
}

function evaluateBoard(board, botColor, humanColor) {
  let score = 0;
  for (let row = 0; row < CONNECT4_ROWS; row++) {
    const cell = board[row * CONNECT4_COLS + CENTER_COL];
    if (cell === botColor) score += 3; else if (cell === humanColor) score -= 3;
  }
  for (const w of WINDOWS) score += scoreWindow(board, w, botColor, humanColor);
  return score;
}

// depth: KALAN arama derinliği. lastMove: bir önceki hamlenin {row,col}'u —
// kazanma kontrolü SADECE son bırakılan taştan yapılır (logic.js ile aynı yaklaşım).
function minimax(board, depth, isMaximizing, botColor, humanColor, alpha, beta, lastMove) {
  if (lastMove) {
    const win = checkConnect4Winner(board, lastMove.row, lastMove.col);
    if (win) return (win.winner === botColor ? 1 : -1) * (1000000 + depth);
  }
  const validCols = getValidColumns(board);
  if (validCols.length === 0) return 0; // berabere
  if (depth === 0) return evaluateBoard(board, botColor, humanColor);

  const color = isMaximizing ? botColor : humanColor;
  let best = isMaximizing ? -Infinity : Infinity;
  for (const col of validCols) {
    const applied = applyDrop(board, col, color);
    const score = minimax(applied.board, depth - 1, !isMaximizing, botColor, humanColor, alpha, beta, applied);
    if (isMaximizing) {
      best = Math.max(best, score); alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score); beta = Math.min(beta, best);
    }
    if (beta <= alpha) break; // alpha-beta budaması
  }
  return best;
}

// Tarayıcıyı dondurmamak için: tahta ne kadar BOŞSA (yani arama ağacı ne kadar
// genişse) derinliği o kadar kısıtla; oyun sonuna yaklaşıldıkça (az sütun/hücre
// kaldıkça dallanma zaten daralır) derinliği artırıp neredeyse tam çözüme geç.
function getDynamicHardDepth(board) {
  const empty = board.reduce((n, c) => n + (c ? 0 : 1), 0);
  if (empty <= 10) return Math.min(10, empty); // oyun sonu: pratikte tam çözüm
  if (empty <= 24) return 6;
  return 5; // açılış: hâlâ çok derin ama performans için 5
}

function getBestColumn(board, botColor, humanColor, depth) {
  const validCols = getValidColumns(board);
  if (validCols.length === 0) return null;
  let bestScore = -Infinity; let bestCols = [];
  let alpha = -Infinity; const beta = Infinity;
  for (const col of validCols) {
    const applied = applyDrop(board, col, botColor);
    const score = minimax(applied.board, depth - 1, false, botColor, humanColor, alpha, beta, applied);
    if (score > bestScore) { bestScore = score; bestCols = [col]; }
    else if (score === bestScore) bestCols.push(col);
    alpha = Math.max(alpha, bestScore);
  }
  // Eşit skorlu hamleler arasından rastgele seçer — bot her partide birebir
  // aynı açılışı tekrarlamasın, ama asla en iyiden daha kötü oynamasın.
  return bestCols[Math.floor(Math.random() * bestCols.length)];
}

// ORTA bot da minimax kullanır ama kullanıcı isteği gereği sadece 2 hamle
// (1 bot + 1 insan yanıtı) ileriye bakar — bariz 3'lü tehditleri görür/bloklar
// ama derin çapraz tuzakları veya çok adımlı kombinasyonları göremez.
function getMediumColumn(board, botColor, humanColor) {
  return getBestColumn(board, botColor, humanColor, 2);
}

function getHardColumn(board, botColor, humanColor) {
  return getBestColumn(board, botColor, humanColor, getDynamicHardDepth(board));
}

// KOLAY bot heuristic HESAPLAMAZ: rastgele geçerli bir sütuna oynar. Sadece
// %50 ihtimalle rakibin bir sonraki hamlede kazanacağı BARİZ tehdidi fark edip
// önünü keser — diğer %50'sinde bu tehdidi de gözden kaçırır (kasıtlı olarak zayıf).
function getEasyColumn(board, botColor, humanColor) {
  const validCols = getValidColumns(board);
  if (validCols.length === 0) return null;
  if (Math.random() < 0.5) {
    for (const col of validCols) {
      const applied = applyDrop(board, col, humanColor);
      if (applied && checkConnect4Winner(applied.board, applied.row, applied.col)) return col;
    }
  }
  return validCols[Math.floor(Math.random() * validCols.length)];
}

export function getBotColumn(board, difficulty, botColor, humanColor) {
  if (difficulty === 'easy') return getEasyColumn(board, botColor, humanColor);
  if (difficulty === 'medium') return getMediumColumn(board, botColor, humanColor);
  return getHardColumn(board, botColor, humanColor);
}
