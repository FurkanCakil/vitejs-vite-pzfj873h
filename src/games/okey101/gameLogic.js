import { isOkeyTile } from './tiles.js';

// NOT: Bu dosya tur sırası, per (seri/set) katı doğrulaması, çift açma
// doğrulaması, işleme (tacking) ve gizli-toplam puan hesabı için saf
// yardımcı fonksiyonlar içerir. Hepsi transaction içinde (sunucu tarafı
// gibi) çağrılmak üzere tasarlandı — istemci hesaplanan sonucu göremez.

export const OPEN_THRESHOLD = 101;
export const PENALTY_POINTS = 101;

export function getNextTurnUid(players, currentUid) {
  const idx = players.indexOf(currentUid);
  if (idx === -1) return players[0] || null;
  return players[(idx + 1) % players.length];
}

export function getPrevTurnUid(players, currentUid) {
  const idx = players.indexOf(currentUid);
  if (idx === -1) return null;
  return players[(idx - 1 + players.length) % players.length];
}

const realNumber = (n) => ((n - 1) % 13) + 1; // 14->1, 15->2... (13 sonrası sarma) için gerçek yüz değeri

function trySetAnalysis(normals, jokerCount) {
  if (normals.length === 0) return null; // tamamı joker olan "set" pratikte anlamsız, basitleştirme
  const number = normals[0].number;
  if (!normals.every((t) => t.number === number)) return null;
  const colors = new Set(normals.map((t) => t.color));
  if (colors.size !== normals.length) return null; // set'te aynı renkten iki taş olamaz
  const total = normals.length + jokerCount;
  if (total < 3 || total > 4) return null;
  if (jokerCount > 4 - colors.size) return null;
  return { number, total };
}

function trySeriAnalysis(normals, jokerCount) {
  if (normals.length === 0) return null;
  const color = normals[0].color;
  if (!normals.every((t) => t.color === color)) return null;
  const rawNumbers = normals.map((t) => t.number);
  if (new Set(rawNumbers).size !== rawNumbers.length) return null; // aynı seride tekrar eden sayı olamaz
  const total = normals.length + jokerCount;
  if (total < 3 || total > 13) return null;

  const tryWindow = (numbers) => {
    const sorted = [...numbers].sort((a, b) => a - b);
    const min = sorted[0]; const max = sorted[sorted.length - 1];
    if (max - min + 1 > total) return null;
    for (let start = max - total + 1; start <= min; start++) {
      const end = start + total - 1;
      if (sorted.every((n) => n >= start && n <= end)) return { start, end };
    }
    return null;
  };

  let win = tryWindow(rawNumbers);
  if (win) return { color, start: win.start, end: win.end };

  // 13'ten sonra 1 gelebilir: küçük sayıları (1-3) +13 kaydırıp 13 ile aynı pencereye sığıyor mu dene.
  if (rawNumbers.includes(13) || rawNumbers.some((n) => n <= 3)) {
    const wrappedNumbers = rawNumbers.map((n) => (n <= 3 ? n + 13 : n));
    if (new Set(wrappedNumbers).size === wrappedNumbers.length) {
      win = tryWindow(wrappedNumbers);
      if (win) return { color, start: win.start, end: win.end };
    }
  }
  return null;
}

// Bir per'in (taş dizisinin) geçerli bir SET (farklı renk, aynı sayı) ya da
// SERİ (aynı renk, ardışık sayı, 13->1 sarma dahil) olup olmadığını katı
// şekilde doğrular ve geçerliyse Okey ikamesi dahil gerçek puan değerini
// hesaplar. Sadece sayı toplamı YETERLİ DEĞİLDİR — dizilim de doğru olmalı.
export function validateGroup(tiles, okeyInfo) {
  if (!tiles || tiles.length < 3) return { valid: false };
  const jokerCount = tiles.filter((t) => isOkeyTile(t, okeyInfo)).length;
  const normals = tiles.filter((t) => !isOkeyTile(t, okeyInfo));

  const setInfo = trySetAnalysis(normals, jokerCount);
  if (setInfo) return { valid: true, type: 'set', value: setInfo.total * setInfo.number };

  const seriInfo = trySeriAnalysis(normals, jokerCount);
  if (seriInfo) {
    let value = 0;
    for (let n = seriInfo.start; n <= seriInfo.end; n++) value += realNumber(n);
    return { valid: true, type: 'seri', value };
  }

  return { valid: false };
}

// Birden fazla seçili per'in HEPSİNİN geçerli olup olmadığını kontrol eder.
// Tek bir geçersiz per varsa "Geçersiz Per Dizilimi!" ile tüm işlem reddedilmeli.
export function validateGroups(groupsMap, tilesById, selectedGroupIds, okeyInfo) {
  const results = selectedGroupIds.map((gid) => {
    const tileIds = groupsMap[gid] || [];
    const tiles = tileIds.map((id) => tilesById[id]).filter(Boolean);
    const res = validateGroup(tiles, okeyInfo);
    return { gid, tiles, ...res };
  });
  return { allValid: results.every((r) => r.valid), results };
}

export function computeSelectedGroupsValue(results) {
  return results.reduce((sum, r) => sum + (r.valid ? r.value : 0), 0);
}

// Çift açma: seçili her per TAM 2 taş olmalı ve (Okey/Sahte Okey herhangi bir
// taşın eşi sayılabilir) aynı renk+sayı çifti oluşturmalı; TAM 5 çift gerekir.
export function validatePairs(groupsMap, tilesById, selectedGroupIds, okeyInfo) {
  if (selectedGroupIds.length !== 5) return { valid: false };
  for (const gid of selectedGroupIds) {
    const tileIds = groupsMap[gid] || [];
    if (tileIds.length !== 2) return { valid: false };
    const tiles = tileIds.map((id) => tilesById[id]).filter(Boolean);
    if (tiles.length !== 2) return { valid: false };
    const [a, b] = tiles;
    const aIsOkey = isOkeyTile(a, okeyInfo); const bIsOkey = isOkeyTile(b, okeyInfo);
    if (aIsOkey || bIsOkey) continue; // joker herhangi bir taşın eşi olabilir
    if (!(a.color === b.color && a.number === b.number)) return { valid: false };
  }
  return { valid: true };
}

// Masadaki açık bir per/seriye (cift HARİÇ) tek bir taş eklemenin (işleme/tacking)
// diziyi bozup bozmadığını kontrol eder. Geçerliyse yeni taş dizisini döndürür.
export function canTackTile(groupTiles, groupType, newTile, side, okeyInfo) {
  if (groupType === 'cift' || !groupTiles || groupTiles.length === 0) return { valid: false };
  const candidateOrdered = side === 'left' ? [newTile, ...groupTiles] : [...groupTiles, newTile];
  let result = validateGroup(candidateOrdered, okeyInfo);
  if (result.valid) return { valid: true, newTiles: candidateOrdered };

  // Set'te sıra anlamsızdır; tek yönlü denemede geçersiz çıktıysa diğer ucu da dene.
  if (groupType === 'set') {
    const alt = side === 'left' ? [...groupTiles, newTile] : [newTile, ...groupTiles];
    result = validateGroup(alt, okeyInfo);
    if (result.valid) return { valid: true, newTiles: alt };
  }
  return { valid: false };
}
