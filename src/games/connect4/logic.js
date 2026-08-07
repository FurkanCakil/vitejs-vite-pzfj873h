// NOT: Bu dosya SADECE saf oyun mantığı içerir (Firestore/React YOK) — diğer
// oyunlardaki (checkers/logic.js, xox/bot.js) desene uygun olarak. Tahta,
// 42 elemanlı DÜZ (flat) bir dizi olarak tutulur: index = row * 7 + col.
// row 0 = EN ÜST satır, row 5 = EN ALT satır (yerçekimi bu yüzden taşı
// mümkün olan EN BÜYÜK row'a düşürür).

export const CONNECT4_COLS = 7;
export const CONNECT4_ROWS = 6;
export const CONNECT4_CELLS = CONNECT4_COLS * CONNECT4_ROWS;

export function createInitialConnect4Board() {
  return Array(CONNECT4_CELLS).fill(null);
}

// Bir sütuna taş bırakıldığında YERÇEKİMİYLE düşeceği (en alttaki BOŞ)
// satırı bulur. Sütun tamamen doluysa (en üst satır -row 0- de doluysa)
// null döner — bu durumda hamle yapılamaz.
export function findDropRow(board, col) {
  for (let row = CONNECT4_ROWS - 1; row >= 0; row--) {
    if (!board[row * CONNECT4_COLS + col]) return row;
  }
  return null;
}

export function isColumnFull(board, col) {
  return findDropRow(board, col) === null;
}

export function isConnect4BoardFull(board) {
  return board.every((cell) => cell !== null);
}

// 4 eksen: her biri BİRBİRİNE ZIT iki yön içerir (yatay, dikey, iki çapraz).
// Son bırakılan taştan başlayıp her eksende HER İKİ yöne doğru sayarak
// (yerçekimi sayesinde pratikte hep en az bir yönde -aşağı- taş biriktiği
// için dikey kontrolü de dahil, genel/simetrik tutuldu) 4-üst-üste arar.
const DIRECTIONS = [
  [[0, 1], [0, -1]],   // yatay ( — )
  [[1, 0], [-1, 0]],   // dikey ( | )
  [[1, 1], [-1, -1]],  // sağ-çapraz ( \ )
  [[1, -1], [-1, 1]],  // sol-çapraz ( / )
];

// Son bırakılan taştan (lastRow, lastCol) başlayarak 4 eksende o oyuncunun
// ard arda 4 (ya da daha fazla) taş dizip dizmediğini kontrol eder.
// Bulursa kazanan rengi ve (highlight için) TÜM birleşik taşların
// index'lerini döndürür (5+ üst üste gelirse hepsi vurgulanır).
export function checkConnect4Winner(board, lastRow, lastCol) {
  if (lastRow == null || lastCol == null) return null;
  const color = board[lastRow * CONNECT4_COLS + lastCol];
  if (!color) return null;

  for (const [dirA, dirB] of DIRECTIONS) {
    const cells = [[lastRow, lastCol]];
    for (const [dr, dc] of [dirA, dirB]) {
      let r = lastRow + dr; let c = lastCol + dc;
      while (r >= 0 && r < CONNECT4_ROWS && c >= 0 && c < CONNECT4_COLS && board[r * CONNECT4_COLS + c] === color) {
        cells.push([r, c]);
        r += dr; c += dc;
      }
    }
    if (cells.length >= 4) {
      return { winner: color, line: cells.map(([r, c]) => r * CONNECT4_COLS + c) };
    }
  }
  return null;
}
