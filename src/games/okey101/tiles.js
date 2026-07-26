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

export const SETUP_DURATION_MS = 30000;

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

// Sabit slotlu ıstaka fiziği: tek bir taşı (fromIdx) hedef slota (toIdx) taşır.
// Diğer taşların konumu ASLA kaymaz — hedef slot boşsa taş oraya gider (eski
// slotu boşalır), doluysa iki taş yer değiştirir (swap).
export function moveTileToSlot(row, fromIdx, toIdx) {
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || toIdx >= row.length) return row;
  const newRow = [...row];
  const moved = newRow[fromIdx];
  newRow[fromIdx] = newRow[toIdx];
  newRow[toIdx] = moved;
  return newRow;
}

// Bitişik bir taş bloğunu (bir per'in tüm taşları) sabit hedef slota taşır.
// Hedef aralık TAMAMEN boş ya da bloğun kendi eski slotlarıyla örtüşüyorsa
// yerleştirilir; aksi halde (dolu başka bir taşa denk gelirse) hiçbir şey
// değişmez — diğer taşlar asla kaymaz.
export function moveGroupBlockToSlot(row, tileIds, targetIndex) {
  const blockSet = new Set(tileIds);
  const oldIndices = [];
  row.forEach((t, i) => { if (t && blockSet.has(t.id)) oldIndices.push(i); });
  if (oldIndices.length !== tileIds.length) return row;

  const orderedBlock = oldIndices.map((i) => row[i]);
  const oldSet = new Set(oldIndices);
  const end = targetIndex + tileIds.length;
  if (targetIndex < 0 || end > row.length) return row;
  for (let i = targetIndex; i < end; i++) {
    if (row[i] && !oldSet.has(i)) return row; // dolu ve bloğa ait değil -> reddet, kaydırma yok
  }

  const newRow = [...row];
  oldIndices.forEach((i) => { newRow[i] = null; });
  orderedBlock.forEach((tile, i) => { newRow[targetIndex + i] = tile; });
  return newRow;
}

// Seçili taş id'lerinin rack üzerinde "yan yana" olup olmadığını doğrular.
// Boş (null) slotlar taşlar arasında serbestçe atlanabilir (kaydırma fiziği
// nedeniyle atma/açma sonrası aralarda boşluk kalması normaldir) — tek şart,
// seçili taşların arasında SEÇİLİ OLMAYAN başka bir taşın bulunmamasıdır.
export function isContiguousSelection(selectedIds, rack) {
  if (selectedIds.length === 0) return false;
  const idSet = new Set(selectedIds);
  const indices = [];
  rack.forEach((t, i) => { if (t && idSet.has(t.id)) indices.push(i); });
  if (indices.length !== selectedIds.length) return false;
  indices.sort((a, b) => a - b);
  const min = indices[0]; const max = indices[indices.length - 1];
  for (let i = min; i <= max; i++) {
    const tile = rack[i];
    if (tile && !idSet.has(tile.id)) return false; // aralarda yabancı bir taş var
  }
  return true;
}
