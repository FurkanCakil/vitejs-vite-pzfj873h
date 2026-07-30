// Amiral Battı — saf (state'siz) yardımcı fonksiyonlar: tahta boyutu, gemi
// envanteri, koordinat/etiket dönüşümleri ve yerleştirme doğrulaması. Ateş
// etme / tur mantığı FAZ 2'de buraya eklenecek — bu dosya sadece Faz 1
// (10x10 tahta + gemi yerleştirme) için gereklidir.

export const BOARD_SIZE = 10;
export const ROW_LABELS = Array.from({ length: BOARD_SIZE }, (_, i) => String.fromCharCode(65 + i)); // A..J

// Klasik Amiral Battı filosu: 5 gemi, toplam 17 hücre.
export const SHIP_DEFS = [
  { id: 'carrier', name: 'Uçak Gemisi', length: 5 },
  { id: 'cruiser', name: 'Kurvaziyer', length: 4 },
  { id: 'submarine', name: 'Denizaltı', length: 3 },
  { id: 'destroyer', name: 'Muhrip', length: 3 },
  { id: 'patrol', name: 'Hücumbot', length: 2 },
];

export const cellKey = (row, col) => `${row}-${col}`;

// Bir geminin başlangıç hücresi (origin), yönü ve uzunluğuna göre kapladığı
// tüm hücreleri döndürür. Yatayda sağa, dikeyde aşağı doğru büyür.
export function getShipCells(origin, orientation, length) {
  const cells = [];
  for (let i = 0; i < length; i++) {
    cells.push(orientation === 'H'
      ? { row: origin.row, col: origin.col + i }
      : { row: origin.row + i, col: origin.col });
  }
  return cells;
}

export function isWithinBounds(cells) {
  return cells.every((c) => c.row >= 0 && c.row < BOARD_SIZE && c.col >= 0 && c.col < BOARD_SIZE);
}

function cellsOverlap(cellsA, cellsB) {
  const setB = new Set(cellsB.map((c) => cellKey(c.row, c.col)));
  return cellsA.some((c) => setB.has(cellKey(c.row, c.col)));
}

// Aday hücrelerin tahtaya sığıp sığmadığını VE mevcut (zaten yerleştirilmiş)
// gemilerle çakışıp çakışmadığını kontrol eder. `excludeShipId`, döndürme
// (rotate) sırasında geminin KENDİSİYLE çakışma sayılmaması için kullanılır.
export function canPlaceShip(existingShips, candidateCells, excludeShipId = null) {
  if (!isWithinBounds(candidateCells)) return { valid: false, reason: 'out-of-bounds' };
  for (const ship of existingShips) {
    if (ship.id === excludeShipId) continue;
    if (cellsOverlap(candidateCells, ship.cells)) return { valid: false, reason: 'overlap' };
  }
  return { valid: true };
}

export function allShipsPlaced(placedShips) {
  return SHIP_DEFS.every((def) => placedShips.some((s) => s.id === def.id));
}

// Bir geminin hücre dizisindeki "merkez" indeksi. TEK sayılı uzunluklarda
// (5, 3, 3) tam ortadaki hücredir. ÇİFT sayılı uzunluklarda (4, 2) tam
// ortaya denk gelen TEK bir hücre olmadığından, KULLANICI İSTEĞİYLE ortadaki
// iki hücreden SOLDAKİ/ÜSTTEKİ seçilir (2 uzunlukta bu zaten geminin sol
// ucuyla aynı hücredir). Hem yeni gemi yerleştirme çıpası (anchorOrigin) HEM
// DE döndürme pivotu (bkz. BattleshipGame.jsx#rotateInPlace) bu TEK indeksi
// kullanır — ikisi de "aynı hücre sabit kalır" mantığının farklı yönleri.
export function centerCellIndex(length) {
  return Math.floor((length - 1) / 2);
}

// Gemiyi tıklanan/bırakılan hücreye göre nereye "çıpalayacağımızı" (origin)
// hesaplar: tıklanan hücre her zaman `centerCellIndex(length)` ile bulunan
// merkez hücreye denk gelir.
export function anchorOrigin(anchorCell, orientation, length) {
  const idx = centerCellIndex(length);
  return orientation === 'H'
    ? { row: anchorCell.row, col: anchorCell.col - idx }
    : { row: anchorCell.row - idx, col: anchorCell.col };
}
