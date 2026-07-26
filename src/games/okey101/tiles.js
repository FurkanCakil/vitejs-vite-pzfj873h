// NOT: Bu dosya sadece taş üretimi/dağıtımı ve ıstaka (rack) üzerinde taş/per
// hareketi için saf yardımcı fonksiyonlar içerir. Çekme/atma gibi tur mantığı
// bilinçli olarak burada YOKTUR (2. Faz kapsamı dışı).

export const COLORS = ['black', 'red', 'blue', 'yellow'];

// Renk körlüğü vb. erişilebilirlik için her renge eşlenen küçük sembol.
export const COLOR_SYMBOLS = { black: '♠', red: '♥', blue: '♦', yellow: '♣' };

export const COLOR_LABELS = { black: 'Siyah', red: 'Kırmızı', blue: 'Mavi', yellow: 'Sarı' };

// 2 satır x 13 sütun = 26 slot. 22 taş + rahat düzenleme payı için yeterli.
export const RACK_ROW_LENGTH = 13;
export const RACK_SLOTS = RACK_ROW_LENGTH * 2;

export const SETUP_DURATION_MS = 15000;

// 4 renk x (1-13) x 2 kopya = 104 + 2 Sahte Okey = 106 taş.
export function createTileSet() {
  const tiles = [];
  let idCounter = 0;
  for (const color of COLORS) {
    for (let number = 1; number <= 13; number++) {
      for (let copy = 0; copy < 2; copy++) {
        tiles.push({ id: `T${idCounter++}`, color, number, isJoker: false });
      }
    }
  }
  tiles.push({ id: `T${idCounter++}`, color: null, number: null, isJoker: true });
  tiles.push({ id: `T${idCounter++}`, color: null, number: null, isJoker: true });
  return tiles; // 106
}

export function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// İlk oyuncuya (players[0]) 22, diğer 3'üne 21 taş dağıtır; kalanlar çekme destesidir.
// Ayrıca kalan destenin en altından (jokerse bir üstünden) Gösterge taşını belirler.
export function dealTiles(playerUids) {
  const shuffled = shuffle(createTileSet());
  let cursor = 0;
  const racks = {};
  playerUids.forEach((uid, idx) => {
    const count = idx === 0 ? 22 : 21;
    const rack = Array(RACK_SLOTS).fill(null);
    for (let i = 0; i < count; i++) rack[i] = shuffled[cursor++];
    racks[uid] = rack;
  });
  const drawPile = shuffled.slice(cursor);

  let indicator = null;
  let idx = drawPile.length - 1;
  while (idx >= 0 && drawPile[idx].isJoker) idx--;
  if (idx >= 0) { [indicator] = drawPile.splice(idx, 1); }

  return { racks, drawPile, indicator };
}

// Göstergeden Okey'i (aynı renk, +1 sayı, 13 sonrası 1'e sarar) belirler.
export function computeOkeyInfo(indicator) {
  if (!indicator || indicator.isJoker) return null;
  const number = indicator.number === 13 ? 1 : indicator.number + 1;
  return { color: indicator.color, number };
}

export function isOkeyTile(tile, okeyInfo) {
  if (!tile) return false;
  if (tile.isJoker) return true; // Sahte Okey her zaman o elin Okey'i yerine geçer.
  if (!okeyInfo) return false;
  return tile.color === okeyInfo.color && tile.number === okeyInfo.number;
}

// Tek bir taşı (fromIdx) hedef slota (toIdx) taşır; aralarındaki taşlar/boşluklar kayar.
export function reorderRow(row, fromIdx, toIdx) {
  const newRow = [...row];
  const [moved] = newRow.splice(fromIdx, 1);
  const adjustedTo = toIdx > fromIdx ? toIdx - 1 : toIdx;
  newRow.splice(Math.max(0, Math.min(adjustedTo, newRow.length)), 0, moved);
  return newRow;
}

// Bitişik bir taş bloğunu (bir per'in tüm taşları) bozmadan hedef slota taşır.
export function moveGroupBlock(row, tileIds, targetIndex) {
  const blockSet = new Set(tileIds);
  const startIdx = row.findIndex((t) => t && blockSet.has(t.id));
  if (startIdx === -1) return row;
  const block = row.slice(startIdx, startIdx + tileIds.length);
  const withoutBlock = [...row.slice(0, startIdx), ...row.slice(startIdx + tileIds.length)];
  let insertAt = targetIndex > startIdx ? targetIndex - tileIds.length : targetIndex;
  insertAt = Math.max(0, Math.min(insertAt, withoutBlock.length));
  return [...withoutBlock.slice(0, insertAt), ...block, ...withoutBlock.slice(insertAt)];
}

// Seçili taş id'lerinin rack üzerinde gerçekten yan yana (bitişik) olup olmadığını doğrular.
export function isContiguousSelection(selectedIds, rack) {
  if (selectedIds.length === 0) return false;
  const idSet = new Set(selectedIds);
  const indices = [];
  rack.forEach((t, i) => { if (t && idSet.has(t.id)) indices.push(i); });
  if (indices.length !== selectedIds.length) return false;
  indices.sort((a, b) => a - b);
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) return false;
  }
  return true;
}
