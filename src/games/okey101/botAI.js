// NOT: Bu dosya SADECE saf karar-verme mantığını içerir (Firestore/transaction
// YOK). Tüm doğrulamalar './gameLogic.js'teki (insan oyuncuların da kullandığı)
// aynı fonksiyonlarla yapılır — bot hiçbir zaman insanın oynayamayacağı bir
// per/çift üretemez. Gerçek işlemler (transaction) Okey101Game.jsx'te bu
// fonksiyonların döndürdüğü kararları uygular.

import { COLORS, isOkeyTile } from './tiles.js';
import { validateGroup, canTackTile } from './gameLogic.js';

export const BOT_TURN_DELAY_MIN_MS = 1500;
export const BOT_TURN_DELAY_MAX_MS = 2500;

export function randomTurnDelay() {
  const ms = BOT_TURN_DELAY_MIN_MS + Math.random() * (BOT_TURN_DELAY_MAX_MS - BOT_TURN_DELAY_MIN_MS);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const removeTiles = (pool, tiles) => {
  const ids = new Set(tiles.map((t) => t.id));
  return pool.filter((t) => !ids.has(t.id));
};

// ---- SET arama: bir sayı için farklı renklerden (gerekirse Okey/joker ile tamamlanmış) 3-4'lü grup ----
function findBestSetForNumber(remaining, number, okeyInfo) {
  const jokers = remaining.filter((t) => isOkeyTile(t, okeyInfo));
  const sameNumber = remaining.filter((t) => !isOkeyTile(t, okeyInfo) && t.number === number);
  const byColor = {};
  sameNumber.forEach((t) => { if (!byColor[t.color]) byColor[t.color] = t; }); // set'te aynı renkten sadece 1 taş
  const distinct = Object.values(byColor);

  for (const size of [4, 3]) {
    const needed = size - distinct.length;
    if (needed < 0 || needed > jokers.length) continue;
    const candidate = [...distinct, ...jokers.slice(0, needed)];
    if (candidate.length !== size) continue;
    const result = validateGroup(candidate, okeyInfo);
    if (result.valid && result.type === 'set') return { tiles: candidate, type: 'set', value: result.value };
  }
  return null;
}

// ---- SERİ arama: bir renk için en uzun (sonra en değerli) geçerli ardışık blok ----
// Tüm sanal başlangıç/uzunluk kombinasyonlarını dener (13->1 sarma dahil, validateGroup zaten
// bunu doğru şekilde kontrol ediyor); ~13x13 = küçük bir arama, performans sorunu yaratmaz.
function findBestSeriesForColor(remaining, color, okeyInfo) {
  const jokers = remaining.filter((t) => isOkeyTile(t, okeyInfo));
  const colorTiles = remaining.filter((t) => !isOkeyTile(t, okeyInfo) && t.color === color);
  if (colorTiles.length === 0) return null;

  let best = null;
  for (let start = 1; start <= 13; start++) {
    const maxLen = Math.min(13, colorTiles.length + jokers.length);
    for (let len = maxLen; len >= 3; len--) {
      const used = []; let missing = 0;
      for (let i = 0; i < len; i++) {
        const virtual = start + i;
        const real = ((virtual - 1) % 13) + 1;
        const tile = colorTiles.find((t) => t.number === real && !used.includes(t));
        if (tile) used.push(tile); else missing++;
      }
      if (missing > jokers.length || used.length === 0) continue;
      const candidate = [...used, ...jokers.slice(0, missing)];
      const result = validateGroup(candidate, okeyInfo);
      if (result.valid && result.type === 'seri') {
        if (!best || candidate.length > best.tiles.length || (candidate.length === best.tiles.length && result.value > best.value)) {
          best = { tiles: candidate, type: 'seri', value: result.value };
        }
      }
    }
  }
  return best;
}

// Greedy: elindeki taşlardan, üst üste binmeyen mümkün olduğunca değerli/çok
// per bulur. Önce yüksek sayılı setleri, sonra her renk için en uzun seriyi
// dener; bulduğunu eldeki havuzdan çıkarıp tekrar dener (aynı renkte/sayıda
// ikinci bir per kalmışsa onu da yakalamak için).
export function pickBotMelds(handTiles, okeyInfo) {
  let remaining = [...handTiles];
  const melds = [];

  for (let num = 13; num >= 1; num--) {
    let found = findBestSetForNumber(remaining, num, okeyInfo);
    while (found) {
      melds.push(found);
      remaining = removeTiles(remaining, found.tiles);
      found = findBestSetForNumber(remaining, num, okeyInfo);
    }
  }

  for (const color of COLORS) {
    let found = findBestSeriesForColor(remaining, color, okeyInfo);
    while (found) {
      melds.push(found);
      remaining = removeTiles(remaining, found.tiles);
      found = findBestSeriesForColor(remaining, color, okeyInfo);
    }
  }

  return melds;
}

// 5 çift arar (aynı renk+sayı ikilisi; Okey/Sahte Okey herhangi bir taşın eşi olabilir).
export function pickBotPairs(handTiles, okeyInfo) {
  const jokers = handTiles.filter((t) => isOkeyTile(t, okeyInfo));
  const normals = handTiles.filter((t) => !isOkeyTile(t, okeyInfo));
  const byKey = {};
  normals.forEach((t) => { const k = `${t.color}-${t.number}`; (byKey[k] ??= []).push(t); });

  const pairs = [];
  const usedJokers = [];
  for (const arr of Object.values(byKey)) {
    if (arr.length >= 2) pairs.push([arr[0], arr[1]]);
  }
  for (const arr of Object.values(byKey)) {
    if (pairs.length >= 5) break;
    if (arr.length === 1) {
      const j = jokers.find((jk) => !usedJokers.includes(jk.id));
      if (j) { pairs.push([arr[0], j]); usedJokers.push(j.id); }
    }
  }
  return pairs.slice(0, 5).map((tiles) => ({ tiles, type: 'cift' }));
}

// Yerden (bir önceki oyuncunun attığı) taşı almanın işe yarayıp yaramadığını
// kontrol eder: elindeki bir per'i tamamlıyorsa VEYA çok değerli (Okey ya da
// yüksek sayı) ise alınır; aksi halde desteden çekilir.
export function shouldTakeDiscard(handTiles, discardTile, okeyInfo) {
  if (!discardTile) return false;
  if (isOkeyTile(discardTile, okeyInfo)) return true;

  const meldsWithout = pickBotMelds(handTiles, okeyInfo);
  const valueWithout = meldsWithout.reduce((s, m) => s + m.value, 0);
  const meldsWith = pickBotMelds([...handTiles, discardTile], okeyInfo);
  const usedInMeld = meldsWith.some((m) => m.tiles.some((t) => t.id === discardTile.id));
  const valueWith = meldsWith.reduce((s, m) => s + m.value, 0);
  if (usedInMeld && valueWith > valueWithout) return true;

  return discardTile.number >= 12; // yüksek değerli tekil taş — ileride işe yarayabilir
}

// Masadaki (kendi veya rakip) açık perlere işlenebilecek (tacking) tüm fırsatları tarar.
export function findTackOpportunities(handTiles, openedHandsAllPlayers, okeyInfo) {
  const opportunities = [];
  for (const [uid, groups] of Object.entries(openedHandsAllPlayers || {})) {
    (groups || []).forEach((g, groupIndex) => {
      if (!g || g.type === 'cift') return;
      for (const tile of handTiles) {
        for (const side of ['left', 'right']) {
          const result = canTackTile(g.tiles, g.type, tile, side, okeyInfo);
          if (result.valid) { opportunities.push({ tile, targetUid: uid, groupIndex, side }); return; }
        }
      }
    });
  }
  return opportunities;
}

function tileConnectionScore(tile, handTiles, okeyInfo) {
  let score = 0;
  for (const other of handTiles) {
    if (other.id === tile.id) continue;
    if (isOkeyTile(other, okeyInfo)) { score += 1; continue; }
    if (other.color === tile.color && Math.abs(other.number - tile.number) <= 2) score += 2;
    if (other.number === tile.number && other.color !== tile.color) score += 1;
  }
  return score;
}

// Atılacak taşı seçer: KESİNLİKLE Okey taşını atmaz (elde başka taş kalmadığı
// durum hariç). Diğer taşlar arasında elindeki diğer taşlarla en az "bağlantısı"
// olan (aynı renkte yakın komşusu / aynı sayıda eşi olmayan) en gereksiz taşı,
// eşitlik durumunda en yüksek sayılı olanı tercih eder (bot stratejisi: yüksek
// sayılı taşları elde tutmak daha risklidir).
export function pickDiscardTile(handTiles, okeyInfo) {
  if (handTiles.length === 0) return null;
  const nonOkey = handTiles.filter((t) => !isOkeyTile(t, okeyInfo));
  const candidates = nonOkey.length > 0 ? nonOkey : handTiles;

  const sorted = [...candidates].sort((a, b) => {
    const diff = tileConnectionScore(a, handTiles, okeyInfo) - tileConnectionScore(b, handTiles, okeyInfo);
    if (diff !== 0) return diff;
    return b.number - a.number;
  });
  return sorted[0];
}

// Süre aşımı (hamle yapmayan oyuncu) için otomatik atış: KESİNLİKLE Okey
// atmaz, ve hiçbir pere bağlantısı olmayan (connectionScore === 0) taşlar
// arasından en KÜÇÜK sayılı olanı seçer. pickDiscardTile'ın aksine (o, bot
// stratejisi gereği eşitlikte en büyüğü tercih eder), burada amaç oyuncuya
// en az zararı veren/en masum atışı otomatik yapmaktır.
export function pickSmallestSafeDiscard(handTiles, okeyInfo) {
  if (handTiles.length === 0) return null;
  const nonOkey = handTiles.filter((t) => !isOkeyTile(t, okeyInfo));
  const candidates = nonOkey.length > 0 ? nonOkey : handTiles;
  const unconnected = candidates.filter((t) => tileConnectionScore(t, handTiles, okeyInfo) === 0);
  const pool = unconnected.length > 0 ? unconnected : candidates;
  const sorted = [...pool].sort((a, b) => (a.number ?? 99) - (b.number ?? 99));
  return sorted[0];
}
