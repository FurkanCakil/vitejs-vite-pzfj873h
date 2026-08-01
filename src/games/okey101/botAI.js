// NOT: Bu dosya SADECE saf karar-verme mantığını içerir (Firestore/transaction
// YOK). Tüm doğrulamalar './gameLogic.js'teki (insan oyuncuların da kullandığı)
// aynı fonksiyonlarla yapılır — bot hiçbir zaman insanın oynayamayacağı bir
// per/çift üretemez. Gerçek işlemler (transaction) Okey101Game.jsx'te bu
// fonksiyonların döndürdüğü kararları uygular.

import { COLORS, isOkeyTile, effectiveTile } from './tiles.js';
import { validateGroup, canTackTile, isTileTackable, OPEN_THRESHOLD, PAIRS_OPEN_MIN } from './gameLogic.js';

// Taşın kurallara göre geçerli yüz değeri. Sahte Okey artık joker DEĞİL; o elin
// Okey'inin renk/sayısına sahip normal bir taş gibi davranır (bkz. tiles.js).
// Arama fonksiyonları renk/sayı okurken HER ZAMAN bunu kullanmalı, yoksa Sahte
// Okey'in color/number alanları null olduğu için hiçbir pere giremez.
const eff = (tile, okeyInfo) => effectiveTile(tile, okeyInfo);

export const BOT_TURN_DELAY_MIN_MS = 450;
export const BOT_TURN_DELAY_MAX_MS = 900;

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
  const sameNumber = remaining.filter((t) => !isOkeyTile(t, okeyInfo) && eff(t, okeyInfo).number === number);
  const byColor = {};
  sameNumber.forEach((t) => { const c = eff(t, okeyInfo).color; if (!byColor[c]) byColor[c] = t; }); // set'te aynı renkten sadece 1 taş
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
  const colorTiles = remaining.filter((t) => !isOkeyTile(t, okeyInfo) && eff(t, okeyInfo).color === color);
  if (colorTiles.length === 0) return null;

  let best = null;
  for (let start = 1; start <= 13; start++) {
    const maxLen = Math.min(13, colorTiles.length + jokers.length);
    for (let len = maxLen; len >= 3; len--) {
      // Her pozisyon için ya gerçek taşı ya da (bulunamazsa) null yerleştir —
      // jokerler daha sonra TAM OLARAK bu boş (null) pozisyonlara sırayla
      // yerleştirilir, sona eklenmez. Böylece bot'un açtığı seri HER ZAMAN
      // görsel olarak da doğru artan sırada olur (ör. 9-10-11, "11-9-10" değil).
      const usedColorTiles = []; const slots = [];
      for (let i = 0; i < len; i++) {
        const virtual = start + i;
        const real = ((virtual - 1) % 13) + 1;
        const tile = colorTiles.find((t) => eff(t, okeyInfo).number === real && !usedColorTiles.includes(t));
        if (tile) { usedColorTiles.push(tile); slots.push(tile); } else { slots.push(null); }
      }
      const missing = slots.filter((s) => s === null).length;
      if (missing > jokers.length || usedColorTiles.length === 0) continue;
      let jokerIdx = 0;
      const candidate = slots.map((s) => s ?? jokers[jokerIdx++]);
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

// Verilen taş havuzundan, verilen SIRAYA göre (kategori kategori) açgözlü
// per toplar: her kategori TAMAMEN tüketilir, sonra bir sonrakine geçilir.
function greedyByOrder(handTiles, okeyInfo, order) {
  let remaining = [...handTiles];
  const melds = [];
  const takeSets = () => {
    for (let num = 13; num >= 1; num--) {
      let found = findBestSetForNumber(remaining, num, okeyInfo);
      while (found) { melds.push(found); remaining = removeTiles(remaining, found.tiles); found = findBestSetForNumber(remaining, num, okeyInfo); }
    }
  };
  const takeSeries = () => {
    for (const color of COLORS) {
      let found = findBestSeriesForColor(remaining, color, okeyInfo);
      while (found) { melds.push(found); remaining = removeTiles(remaining, found.tiles); found = findBestSeriesForColor(remaining, color, okeyInfo); }
    }
  };
  if (order === 'sets-first') { takeSets(); takeSeries(); } else { takeSeries(); takeSets(); }
  return melds;
}

// Her adımda o an mevcut TÜM olası perler arasından (set YA DA seri fark
// etmeksizin) en DEĞERLİ olanı seçer, onu havuzdan çıkarıp tekrar dener.
// Kategori-sıralı açgözlünün aksine, "sırf önce denendiği için" düşük
// değerli bir per, çok daha değerli rakip bir peri BLOKE edemez.
function greedyByValue(handTiles, okeyInfo) {
  let remaining = [...handTiles];
  const melds = [];
  for (;;) {
    let best = null;
    for (let num = 1; num <= 13; num++) {
      const found = findBestSetForNumber(remaining, num, okeyInfo);
      if (found && (!best || found.value > best.value)) best = found;
    }
    for (const color of COLORS) {
      const found = findBestSeriesForColor(remaining, color, okeyInfo);
      if (found && (!best || found.value > best.value)) best = found;
    }
    if (!best) break;
    melds.push(best);
    remaining = removeTiles(remaining, best.tiles);
  }
  return melds;
}

const meldsTotalValue = (melds) => melds.reduce((s, m) => s + m.value, 0);

function combinations(arr, k) {
  const result = [];
  const n = arr.length;
  const combo = [];
  function backtrack(start) {
    if (combo.length === k) { result.push(combo.slice()); return; }
    for (let i = start; i < n; i++) { combo.push(arr[i]); backtrack(i + 1); combo.pop(); }
  }
  backtrack(0);
  return result;
}

// ============================================================
// 1. madde (kullanıcı isteği): TAM (EGZAKT) per araması
// ============================================================
// KULLANICI RAPORU: "Seri Diz" (ve bot açılışları) elde çok daha yüksek
// puanlı bir dizilim mümkünken düşük bir tanesini üretebiliyordu — çünkü
// eski sürüm SADECE açgözlü (greedy) stratejiler deniyordu: her adımda o an
// en iyi görüneni seçip bir daha geri dönmüyorlardı. Bu, genel halde
// (ağırlıklı küme paketleme NP-zor olduğu için) KANITLANABİLİR şekilde
// optimal olmayan sonuçlar üretebilir — düşük değerli bir per, çok daha
// değerli BAŞKA bir kombinasyonu (aynı taşı istediği için) bilmeden bloke
// edebilir. Somut örnekler: (A) bir set'i, onun kullandığı taşa muhtaç çok
// daha değerli bir seriyi bloke ederek seçmek; (B) elde birden fazla seri
// mümkünken Okey'i toplam puanı MAKSİMİZE etmeyen bir boşluğa yerleştirmek;
// (C) bir taşı, onu KOMŞU taşlarıyla birleştirip YENİ bir per kurmak yerine
// mevcut (ama toplamda daha düşük değerli) bir pere eklemek.
//
// Çözüm: elin TÜM taş-per kombinasyonlarını (jokerler dahil) tarayıp EN
// YÜKSEK TOPLAM PUANI veren dizilimi bulan TAM bir arama:
//   1) Gerçek (joker olmayan) taşlar ETKİN (renk,sayı) "slot"lara gruplanır
//      (Sahte Okey de effectiveTile ile bu slotlara girer — o bir joker
//      DEĞİLDİR, bkz. tiles.js). Her slotta 0/1/2 fiziksel taş olabilir.
//   2) Olası TÜM setler (bir sayı, 3-4 farklı renk, gerekirse joker) ve TÜM
//      seri pencereleri (bir renk, 3-13 uzunluk, gerekirse joker — SADECE
//      gerçekten eksik pozisyonlar için) "aday per" olarak üretilir.
//   3) Adaylar arasından, kullanılabilir taş/joker STOĞUNU aşmayan ve
//      TOPLAM DEĞERİ en yüksek olan alt-kümeyi bulmak için, "hâlâ elde taş
//      kalan İLK slot"u çapa alıp o slotu (a) hiç kullanmama ya da (b) onu
//      içeren adaylardan birine dahil etme seçeneklerini deneyen, hafızalı
//      (memoized) tam bir geri izleme (backtracking) yapılır — bu, standart
//      "ilk elemana göre dallan" tam arama yapısıdır (aynı anda hem "bu
//      taşı hiç kullanma" hem "şu peri dene" dallarını kapsadığı için sonuç
//      KANITLANABİLİR şekilde optimaldir). Elin en fazla ~22 taş olması
//      (ve gerçekçi ellerde çok daha az "çakışma" bulunması) sayesinde bu
//      arama pratikte milisaniyeler içinde biter.
//
// GÜVENLİK AĞI: arama beklenmedik şekilde (patolojik bir el yüzünden) çok
// büyürse bir üst çağrı-sayısı sınırında sessizce İPTAL edilip eski (hâlâ
// geçerli perler üreten, sadece garanti-optimal olmayan) açgözlü ensemble'a
// düşülür — kullanıcı hiçbir zaman oynanamaz bir sonuç görmez.
const EXACT_MELD_SEARCH_CALL_LIMIT = 200000;

function buildMeldCandidates(normalTiles, okeyInfo, maxJokers) {
  const slotKey = (color, number) => `${color}::${number}`;
  const slotMap = new Map(); // key -> tile[]
  normalTiles.forEach((t) => {
    const e = effectiveTile(t, okeyInfo);
    const key = slotKey(e.color, e.number);
    if (!slotMap.has(key)) slotMap.set(key, []);
    slotMap.get(key).push(t);
  });
  const slots = [...slotMap.entries()].map(([, tiles]) => {
    const e = effectiveTile(tiles[0], okeyInfo);
    return { color: e.color, number: e.number, tiles };
  });
  const slotIndex = new Map(slots.map((s, i) => [slotKey(s.color, s.number), i]));

  const candidates = [];

  // SETLER: bir sayı için 3-4 farklı renk (+ gerekirse joker).
  const numbers = [...new Set(slots.map((s) => s.number))];
  for (const number of numbers) {
    const colorsAtNumber = slots.filter((s) => s.number === number);
    const m = colorsAtNumber.length;
    for (let size = 3; size <= 4; size++) {
      for (let j = 0; j <= Math.min(maxJokers, size); j++) {
        const c = size - j;
        if (c < 1 || c > m) continue;
        for (const combo of combinations(colorsAtNumber, c)) {
          const slotUsage = combo.map((s) => slotIndex.get(slotKey(s.color, s.number)));
          candidates.push({ type: 'set', slotUsage, jokers: j, value: size * number });
        }
      }
    }
  }

  // SERİLER: bir renk için 3-13 uzunluk pencere (+ gerekirse joker, SADECE
  // gerçekten eksik pozisyonlar için — mevcut bir taş varsa jokeri boşuna
  // harcamaz, bu daha değerli olan alternatifi ASLA domine edilmez kılar).
  const colors = [...new Set(slots.map((s) => s.color))];
  for (const color of colors) {
    const bySlotNumber = new Map(
      slots.filter((s) => s.color === color).map((s) => [s.number, slotIndex.get(slotKey(s.color, s.number))]),
    );
    for (let start = 1; start <= 13; start++) {
      for (let len = 3; len <= 13; len++) {
        const end = start + len - 1;
        if (end > 13) break;
        let jNeeded = 0;
        const slotUsage = [];
        for (let n = start; n <= end; n++) {
          if (bySlotNumber.has(n)) slotUsage.push(bySlotNumber.get(n));
          else jNeeded++;
        }
        if (jNeeded > maxJokers || slotUsage.length === 0) continue;
        let value = 0;
        for (let n = start; n <= end; n++) value += n;
        candidates.push({ type: 'seri', slotUsage, jokers: jNeeded, value, color, start, end });
      }
    }
  }

  return { slots, candidates };
}

// `handTiles`in en yüksek toplam değerli per dizilimini bulur; `bailedOut`
// (patolojik el) durumunda `null` döner — çağıran taraf açgözlü ensemble'a
// düşer (bkz. pickBotMelds).
function solveExactMelds(handTiles, okeyInfo) {
  const jokerTiles = handTiles.filter((t) => isOkeyTile(t, okeyInfo));
  const normalTiles = handTiles.filter((t) => !isOkeyTile(t, okeyInfo));
  if (normalTiles.length === 0) return [];
  const maxJokers = jokerTiles.length;

  const { slots, candidates } = buildMeldCandidates(normalTiles, okeyInfo, maxJokers);
  if (candidates.length === 0) return [];

  const perSlot = slots.map(() => []);
  candidates.forEach((c, ci) => { c.slotUsage.forEach((si) => perSlot[si].push(ci)); });

  const memo = new Map();
  let callCount = 0;
  let bailedOut = false;

  function solve(counts, jokerBudget) {
    if (bailedOut) return { value: 0, melds: [] };
    let anchor = -1;
    for (let i = 0; i < counts.length; i++) { if (counts[i] > 0) { anchor = i; break; } }
    if (anchor === -1) return { value: 0, melds: [] };

    const key = `${counts.join(',')}|${jokerBudget}`;
    const cached = memo.get(key);
    if (cached) return cached;

    callCount += 1;
    if (callCount > EXACT_MELD_SEARCH_CALL_LIMIT) { bailedOut = true; return { value: 0, melds: [] }; }

    // Seçenek A: bu slottaki BİR taşı hiçbir pere hiç dahil etme.
    const countsSkip = counts.slice();
    countsSkip[anchor] -= 1;
    let best = solve(countsSkip, jokerBudget);

    // Seçenek B: bu slotu içeren adaylardan birine dahil et (tümü denenir).
    for (const ci of perSlot[anchor]) {
      const c = candidates[ci];
      if (c.jokers > jokerBudget) continue;
      let feasible = true;
      for (const si of c.slotUsage) { if (counts[si] < 1) { feasible = false; break; } }
      if (!feasible) continue;
      const nextCounts = counts.slice();
      for (const si of c.slotUsage) nextCounts[si] -= 1;
      const sub = solve(nextCounts, jokerBudget - c.jokers);
      const val = c.value + sub.value;
      if (val > best.value) best = { value: val, melds: [c, ...sub.melds] };
    }

    memo.set(key, best);
    return best;
  }

  const initialCounts = slots.map((s) => s.tiles.length);
  const result = solve(initialCounts, maxJokers);
  if (bailedOut) return null;

  // Soyut (slot bazlı) aday perleri GERÇEK taş nesnelerine dönüştürür.
  const slotCursor = slots.map(() => 0);
  let jokerCursor = 0;
  const slotIndexOf = (color, number) => slots.findIndex((s) => s.color === color && s.number === number);
  return result.melds.map((c) => {
    const tiles = [];
    if (c.type === 'set') {
      c.slotUsage.forEach((si) => { tiles.push(slots[si].tiles[slotCursor[si]++]); });
      for (let k = 0; k < c.jokers; k++) tiles.push(jokerTiles[jokerCursor++]);
    } else {
      for (let n = c.start; n <= c.end; n++) {
        const si = slotIndexOf(c.color, n);
        if (si !== -1 && c.slotUsage.includes(si)) tiles.push(slots[si].tiles[slotCursor[si]++]);
        else tiles.push(jokerTiles[jokerCursor++]);
      }
    }
    return { tiles, type: c.type, value: c.value };
  });
}

// Bu fonksiyon HEM botların açılış kararında HEM DE Yardımlı Mod'un "Seri
// Diz" butonunda (bkz. assist.js#buildSeriesArrangement) kullanılır —
// zorluk seviyesi fark etmeksizin TÜM botlar (Okey101'de zorluk sadece bot
// ismini etkiler, karar mantığını değil) bu aramadan otomatik yararlanır.
export function pickBotMelds(handTiles, okeyInfo) {
  const exact = solveExactMelds(handTiles, okeyInfo);
  if (exact) return exact;
  // Emniyet ağı: tam arama sınırı aşıldıysa (patolojik el) eski açgözlü
  // ensemble'a düşülür — hâlâ geçerli perler üretir, sadece garanti-optimal
  // olmayabilir.
  const strategies = [
    greedyByValue(handTiles, okeyInfo),
    greedyByOrder(handTiles, okeyInfo, 'sets-first'),
    greedyByOrder(handTiles, okeyInfo, 'series-first'),
  ];
  return strategies.reduce((best, cur) => (meldsTotalValue(cur) > meldsTotalValue(best) ? cur : best));
}

// Elindeki TÜM geçerli çiftleri bulur (aynı renk+sayı ikilisi; sadece gerçek
// Okey herhangi bir taşın eşi olabilir — Sahte Okey normal bir taş gibi kendi
// yüz değeriyle eşleşir).
//
// `target`: açılış için gereken en az çift sayısı. Gerçek çiftler HER ZAMAN
// tümüyle döndürülür (bot da insan gibi 6-7 çiftle açıp katlamalı modda barajı
// yükseltebilsin diye); Okey harcayarak çift TAMAMLAMA ise sadece bu hedefe
// ulaşmak için yapılır (aksi halde bot elindeki Okey'i gereksiz yere çifte
// bağlardı).
export function pickBotPairs(handTiles, okeyInfo, target = PAIRS_OPEN_MIN) {
  const jokers = handTiles.filter((t) => isOkeyTile(t, okeyInfo));
  const normals = handTiles.filter((t) => !isOkeyTile(t, okeyInfo));
  const byKey = {};
  normals.forEach((t) => { const e = eff(t, okeyInfo); const k = `${e.color}-${e.number}`; (byKey[k] ??= []).push(t); });

  const pairs = [];
  const usedJokers = [];
  for (const arr of Object.values(byKey)) {
    if (arr.length >= 2) pairs.push([arr[0], arr[1]]);
  }
  for (const arr of Object.values(byKey)) {
    if (pairs.length >= target) break;
    if (arr.length === 1) {
      const j = jokers.find((jk) => !usedJokers.includes(jk.id));
      if (j) { pairs.push([arr[0], j]); usedJokers.push(j.id); }
    }
  }
  return pairs.map((tiles) => ({ tiles, type: 'cift' }));
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

  return (eff(discardTile, okeyInfo).number || 0) >= 12; // yüksek değerli tekil taş — ileride işe yarayabilir
}

// Henüz elini AÇMAMIŞ bir bot için: yerden taş almak SADECE bu taşı alınca
// GERÇEKTEN açabilecekse (5 tam çift kurulabiliyorsa YA DA per toplamı
// `requiredTotal`ı geçiyorsa VE alınan taş o per'de/çiftte KULLANILIYORSA)
// mantıklıdır. Açılmadan önce yerden taş almanın (bu oyunda) tek bedeli,
// o taşı KULLANAMAZSA elini AÇANA kadar geri koyup desteden çekmeye
// ZORLANMASIdır — yani "iyi görünen ama açmaya yetmeyen" bir taş için bunu
// göze almak gereksiz bir gecikme/görsel tuhaflıktan başka bir şey
// kazandırmaz. Bu yüzden `shouldTakeDiscard`'ın (açılmış bot/genel arzu
// heuristiği) aksine burada SADECE "bu taşla gerçekten açabilir miyim?"
// sorusu sorulur. `requiredTotal`, katlamalı mod barajı aktifse (ve bot
// ondan muaf değilse) normal 101'den YÜKSEK olabilir (bkz. Okey101Game).
export function shouldTakeDiscardToOpen(handTiles, discardTile, okeyInfo, requiredTotal = OPEN_THRESHOLD, requiredPairs = PAIRS_OPEN_MIN) {
  if (!discardTile) return false;
  const withTile = [...handTiles, discardTile];

  // Çift açmanın kendi barajı vardır (`requiredPairs`, bkz.
  // gameLogic#requiredPairsToOpen) — seri barajından (requiredTotal) bağımsız
  // olarak değerlendirilir.
  {
    const pairs = pickBotPairs(withTile, okeyInfo, requiredPairs);
    if (pairs.length >= requiredPairs && pairs.some((p) => p.tiles.some((t) => t.id === discardTile.id))) return true;
  }

  const melds = pickBotMelds(withTile, okeyInfo);
  const total = melds.reduce((s, m) => s + m.value, 0);
  const usedInMeld = melds.some((m) => m.tiles.some((t) => t.id === discardTile.id));
  return usedInMeld && total >= requiredTotal;
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
  const self = eff(tile, okeyInfo);
  let score = 0;
  for (const other of handTiles) {
    if (other.id === tile.id) continue;
    if (isOkeyTile(other, okeyInfo)) { score += 1; continue; }
    const o = eff(other, okeyInfo);
    if (o.color === self.color && Math.abs(o.number - self.number) <= 2) score += 2;
    if (o.number === self.number && o.color !== self.color) score += 1;
  }
  return score;
}

// Elindeki taşlar arasından, masada AÇIK duran perlere "işlek" (uyan) olanları
// eler — atılırsa +101 ceza yer (bkz. gameLogic.js#isTileTackable). Güvenli
// (işlek olmayan) hiç taş yoksa orijinal listeyi olduğu gibi döndürür (ceza
// yemek kaçınılmazsa en azından atma kararı yine de verilebilsin diye).
function excludeTackable(candidates, openedHandsAllPlayers, okeyInfo) {
  if (!openedHandsAllPlayers) return candidates;
  const safe = candidates.filter((t) => !isTileTackable(t, openedHandsAllPlayers, okeyInfo));
  return safe.length > 0 ? safe : candidates;
}

// Atılacak taşı seçer. Öncelik sırası:
//   1. KESİNLİKLE Okey taşı atmaz (elde başka taş kalmadığı durum hariç).
//   2. Mümkünse "işlek" (masadaki bir pere uyan, atılırsa +101 yenen) taş atmaz.
//   3. Kalanlar arasında elindeki diğer taşlarla en az "bağlantısı" olan
//      (bir per'e dönüşme ihtimali en düşük) taşı seçer.
//   4. Eşitlikte EN DÜŞÜK sayılı olanı atar: hem yandan alınıp açılırsa yenecek
//      ceza (çekilen taşın 10/20 katı) küçük kalsın, hem de yüksek değerli
//      taşlar per yapma potansiyeli için elde tutulsun.
export function pickDiscardTile(handTiles, okeyInfo, openedHandsAllPlayers = null) {
  if (handTiles.length === 0) return null;
  const nonOkey = handTiles.filter((t) => !isOkeyTile(t, okeyInfo));
  let candidates = nonOkey.length > 0 ? nonOkey : handTiles;
  candidates = excludeTackable(candidates, openedHandsAllPlayers, okeyInfo);

  const sorted = [...candidates].sort((a, b) => {
    const diff = tileConnectionScore(a, handTiles, okeyInfo) - tileConnectionScore(b, handTiles, okeyInfo);
    if (diff !== 0) return diff;
    return (eff(a, okeyInfo).number ?? 99) - (eff(b, okeyInfo).number ?? 99);
  });
  return sorted[0];
}

// Süre aşımı (hamle yapmayan oyuncu) için otomatik atış: KESİNLİKLE Okey
// atmaz, mümkünse "işlek" bir taş da atmaz, ve kalan taşlar arasından hiçbir
// pere bağlantısı olmayan (connectionScore === 0) taşlar arasından en KÜÇÜK
// sayılı olanı seçer. pickDiscardTile'ın aksine (o, bot stratejisi gereği
// eşitlikte en büyüğü tercih eder), burada amaç oyuncuya en az zararı veren/en
// masum atışı otomatik yapmaktır.
export function pickSmallestSafeDiscard(handTiles, okeyInfo, openedHandsAllPlayers = null, ownGroups = null) {
  if (handTiles.length === 0) return null;

  // 1. madde: Oyuncunun "Per Onayla" ile ONAYLADIĞI perlerdeki taşlar süre
  // aşımında ASLA atılmamalı — oyuncu o taşları bilerek bir per için ayırmış
  // durumda ve süresi dolduğu için o peri bozmak en can sıkıcı sonuçtu.
  // Sadece onaylı perlere ait OLMAYAN taşlar aday olur; hiç serbest taş
  // kalmamışsa (tüm el perlere ayrılmışsa) mecburen tüm taşlara düşülür.
  let candidates = handTiles;
  if (ownGroups) {
    const reserved = new Set(Object.values(ownGroups).flat());
    const free = handTiles.filter((t) => !reserved.has(t.id));
    if (free.length > 0) candidates = free;
  }

  const nonOkey = candidates.filter((t) => !isOkeyTile(t, okeyInfo));
  if (nonOkey.length > 0) candidates = nonOkey;
  candidates = excludeTackable(candidates, openedHandsAllPlayers, okeyInfo);
  const unconnected = candidates.filter((t) => tileConnectionScore(t, handTiles, okeyInfo) === 0);
  const pool = unconnected.length > 0 ? unconnected : candidates;
  const sorted = [...pool].sort((a, b) => (eff(a, okeyInfo).number ?? 99) - (eff(b, okeyInfo).number ?? 99));
  return sorted[0];
}
