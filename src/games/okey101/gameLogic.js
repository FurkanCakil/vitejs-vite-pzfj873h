import { isOkeyTile, effectiveTile } from './tiles.js';

// Bir per'i "joker (gerçek Okey) sayısı" + "normal taşlar" olarak ayırır.
// Sahte Okey normal taşlar arasında, temsil ettiği yüz değeriyle (göstergenin
// 1 fazlası) yer alır — joker DEĞİLDİR.
const splitTiles = (tiles, okeyInfo) => ({
  jokerCount: tiles.filter((t) => isOkeyTile(t, okeyInfo)).length,
  normals: tiles.filter((t) => !isOkeyTile(t, okeyInfo)).map((t) => effectiveTile(t, okeyInfo)),
});

// NOT: Bu dosya tur sırası, per (seri/set) katı doğrulaması, çift açma
// doğrulaması, işleme (tacking) ve gizli-toplam puan hesabı için saf
// yardımcı fonksiyonlar içerir. Hepsi transaction içinde (sunucu tarafı
// gibi) çağrılmak üzere tasarlandı — istemci hesaplanan sonucu göremez.

export const OPEN_THRESHOLD = 101;
export const PENALTY_POINTS = 101;

// Yandan taş alma cezası: taşı atan oyuncuya, yandan çekilen taşın değerinin
// (Seri/Set ile açarsa) 10 katı, (Çift ile açarsa) 20 katı ceza yazılır —
// sadece ve sadece yandan alan oyuncu o taşla elini BAŞARIYLA AÇARSA.
export const SIDE_TAKE_SERIES_MULTIPLIER = 10;
export const SIDE_TAKE_PAIRS_MULTIPLIER = 20;

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
  const { jokerCount, normals } = splitTiles(tiles, okeyInfo);

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

// Bir per'in (SADECE seri için anlamlı — set'te sıra önemsizdir) taş
// DİZİLİMİNİN de (küme/toplam değil, GÖRSEL SIRANIN da) doğru artan sırada
// olup olmadığını kontrol eder. `tiles` zaten `validateGroup` ile geçerli
// bulunmuş bir seri OLMALIDIR (aksi halde false döner). Jokerler herhangi
// bir pozisyonda kabul edilir (o pozisyondaki eksik sayıyı temsil ettikleri
// varsayılır); sadece GERÇEK taşların kendi pozisyonlarına denk gelen sayıyı
// taşıyıp taşımadığı kontrol edilir.
export function isProperlyOrderedGroup(tiles, type, okeyInfo) {
  if (type !== 'seri' || !tiles || tiles.length < 3) return true;
  const { jokerCount, normals } = splitTiles(tiles, okeyInfo);
  const info = trySeriAnalysis(normals, jokerCount);
  if (!info) return false;
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    if (isOkeyTile(tile, okeyInfo)) continue; // joker her pozisyonda kabul
    if (effectiveTile(tile, okeyInfo).number !== realNumber(info.start + i)) return false;
  }
  return true;
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

// Çift açma / çift işleme: seçili her per TAM 2 taş olmalı ve (gerçek Okey
// herhangi bir taşın eşi sayılabilir) aynı renk+sayı çifti oluşturmalı.
//
// `requireFive` true ise (İLK açılış) TAM 5 çift gerekir. false ise (zaten
// açmış bir oyuncunun elindeki çiftleri masaya sürmesi — bkz. PAIR_* kuralları)
// en az 1 çift yeterlidir.
export function validatePairs(groupsMap, tilesById, selectedGroupIds, okeyInfo, requireFive = true) {
  if (requireFive ? selectedGroupIds.length !== 5 : selectedGroupIds.length < 1) return { valid: false };
  for (const gid of selectedGroupIds) {
    const tileIds = groupsMap[gid] || [];
    if (tileIds.length !== 2) return { valid: false };
    const tiles = tileIds.map((id) => tilesById[id]).filter(Boolean);
    if (tiles.length !== 2) return { valid: false };
    const [a, b] = tiles;
    if (isOkeyTile(a, okeyInfo) || isOkeyTile(b, okeyInfo)) continue; // joker (gerçek Okey) her taşın eşi olabilir
    const ea = effectiveTile(a, okeyInfo); const eb = effectiveTile(b, okeyInfo);
    if (!(ea.color === eb.color && ea.number === eb.number)) return { valid: false };
  }
  return { valid: true };
}

// Masadaki açık bir per/seriye (cift HARİÇ) tek bir taş eklemenin (işleme/tacking)
// diziyi bozup bozmadığını kontrol eder. Geçerliyse yeni taş dizisini döndürür.
// İŞLEME sırasında bir seri 13 -> 1 sınırını AŞAMAZ: 13'te biten bir serinin
// sağına, 1'de başlayan bir serinin soluna taş eklenemez. (Zaten 12-13-1 gibi
// sarmalı olarak AÇILMIŞ bir per geçerliliğini korur — burada kısıtlanan sadece
// masadaki bir seriyi bu sınırın ötesine UZATMAKTIR.)
function seriTackBoundaryOk(groupTiles, side, okeyInfo) {
  const { jokerCount, normals } = splitTiles(groupTiles, okeyInfo);
  const info = trySeriAnalysis(normals, jokerCount);
  if (!info) return true; // analiz edilemiyorsa burada engelleme, validateGroup karar versin
  const wanted = side === 'left' ? info.start - 1 : info.end + 1;
  return wanted >= 1 && wanted <= 13;
}

export function canTackTile(groupTiles, groupType, newTile, side, okeyInfo) {
  if (groupType === 'cift' || !groupTiles || groupTiles.length === 0) return { valid: false };
  if (groupType === 'seri' && !seriTackBoundaryOk(groupTiles, side, okeyInfo)) return { valid: false };
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

// Masadaki açık bir per'in HANGİ uçlarına hâlâ taş eklenebileceğini söyler.
// Per'in yanında gösterilen "bir taşlık kesik çizgili boş yer" (işleme alanı)
// tam olarak buna göre çizilir:
//   - Çift (cift): hiçbir uç açık değildir (çifte tek taş işlenmez).
//   - Set: sıra anlamsız olduğu için tek bir boşluk yeter (4. renk eksikse).
//   - Seri: 1..13 arası HER olası taş, gerçek `canTackTile` doğrulayıcısıyla
//     her iki uçta denenir. Böylece ekranda görünen boşluk, gerçekten bir taş
//     kabul edecek uçlarla BİREBİR aynı olur (ör. seri 1'de başlıyorsa solda,
//     13'te bitiyorsa sağda boşluk gösterilmez).
export function getGroupOpenEnds(tiles, type, okeyInfo) {
  const closed = { left: false, right: false };
  if (!tiles || tiles.length === 0 || type === 'cift') return closed;
  if (type === 'set') return { left: false, right: tiles.length < 4 };

  // Serinin rengi: gerçek Okey (joker) taşları serinin renginden farklı bir
  // renge sahip olabileceği için onlar atlanır; Sahte Okey zaten temsil ettiği
  // (yani serinin) rengiyle değerlendirilir.
  const anchor = tiles.find((t) => t && !isOkeyTile(t, okeyInfo));
  const color = anchor ? effectiveTile(anchor, okeyInfo).color : null;
  if (!color) return closed;

  const ends = { left: false, right: false };
  for (let number = 1; number <= 13; number++) {
    if (ends.left && ends.right) break;
    const probe = { id: '__probe__', color, number, isJoker: false };
    if (!ends.left && canTackTile(tiles, type, probe, 'left', okeyInfo).valid) ends.left = true;
    if (!ends.right && canTackTile(tiles, type, probe, 'right', okeyInfo).valid) ends.right = true;
  }
  return ends;
}

// ============================================================
// Çift açma kuralları (bkz. 5. madde)
// ============================================================
// - Henüz elini açmamış oyuncu: TAM 5 çift ile açabilir (101 aranmaz).
// - ÇİFT ile açmış oyuncu: artık seri/set (per) açamaz; sadece elinde kalan
//   çiftleri masaya sürebilir ve tek tek taş işleyebilir (tacking).
// - SERİ/SET ile açmış oyuncu: elindeki çiftleri ancak masada ÇİFT ile açmış
//   (kendisi dışında ya da dahil, fark etmez) en az bir oyuncu varsa sürebilir.
export function anyPairsOnTable(openedWithPairs) {
  return Object.values(openedWithPairs || {}).some(Boolean);
}

// Bu oyuncu ŞU AN masaya çift sürebilir mi? (İlk açılış dahil.)
export function canPlayerLayPairs(uid, hasOpened, openedWithPairs) {
  if (!hasOpened?.[uid]) return true;              // ilk açılış: 5 çift ile açabilir
  if (openedWithPairs?.[uid]) return true;         // çift açan: kalan çiftlerini sürebilir
  return anyPairsOnTable(openedWithPairs);         // seri açan: ancak biri çift açtıysa
}

// Bu oyuncu masaya yeni bir SERİ/SET (per) sürebilir mi?
// Çift ile açmış oyuncu ASLA per açamaz/işleyemez.
export function canPlayerLayMelds(uid, openedWithPairs) {
  return !openedWithPairs?.[uid];
}

// Bir taşın "işlek" olup olmadığını kontrol eder: masadaki (herhangi bir
// oyuncunun) açık en az bir seri/set'inin sağına ya da soluna tam oturuyorsa
// (bkz. canTackTile) o taş işlektir. Okey/Sahte Okey taşı da HER ZAMAN işlek
// sayılır (kendisi zaten her yere işlenebilir bir taştır). Bu, "işlek ya da
// Okey bir taş atan oyuncuya -101 ceza yazılır" kuralını uygulamak için
// kullanılır (bkz. handleDiscardTile).
export function isTileTackable(tile, openedHandsAllPlayers, okeyInfo) {
  if (!tile) return false;
  if (isOkeyTile(tile, okeyInfo)) return true;
  for (const groups of Object.values(openedHandsAllPlayers || {})) {
    for (const g of (groups || [])) {
      if (!g || g.type === 'cift') continue;
      if (canTackTile(g.tiles, g.type, tile, 'left', okeyInfo).valid) return true;
      if (canTackTile(g.tiles, g.type, tile, 'right', okeyInfo).valid) return true;
    }
  }
  return false;
}

// ============================================================
// 5. FAZ: Tur sonu puanlama
// ============================================================
export const NON_OPENER_PENALTY = PENALTY_POINTS * 2; // 202 — elini açamayan oyuncu

// ÇİFT ile açan oyuncunun tur sonunda elinde kalan taşlara uygulanan ceza katı.
export const PAIRS_OPENER_PENALTY_MULTIPLIER = 2;

// Bir oyuncunun ıstakasında kalan taşların ceza değerini toplar. Sadece gerçek
// Okey (joker) 101 sayı kabul edilir; Sahte Okey dahil diğer tüm taşlar kendi
// (Sahte Okey için: temsil ettiği) yüz değeriyle sayılır.
export function computeRemainingTilesPenalty(rack, okeyInfo) {
  let sum = 0;
  (rack || []).forEach((tile) => {
    if (!tile) return;
    sum += isOkeyTile(tile, okeyInfo) ? 101 : (effectiveTile(tile, okeyInfo).number || 0);
  });
  return sum;
}

// Bir el (round) bittiğinde her oyuncunun bu turdaki net puan değişimini ve
// (Eşli modda) takım havuzlamasını hesaplar. `roomData.scores` zaten anlık
// (yandan-alma/açamama gibi) cezaları içerdiği için, o anlık cezaları
// roundStartScores'a göre ayrıştırıp tablo için ayrıca raporluyoruz.
export function computeRoundEnd({ players, scores, roundStartScores, hasOpened, openedWithPairs, racks, rules, teams, okeyInfo, foldMultiplier }, winnerUid, wonByOkeyDiscard) {
  const baseDelta = {};
  players.forEach((uid) => {
    if (uid === winnerUid) {
      baseDelta[uid] = wonByOkeyDiscard ? -(PENALTY_POINTS * 2) : -PENALTY_POINTS;
      return;
    }
    if (!hasOpened?.[uid]) {
      baseDelta[uid] = NON_OPENER_PENALTY;
    } else {
      // ÇİFT ile açan oyuncu, elinde kalan taşların İKİ KATI ceza yazar;
      // Seri/Set ile açan taşların kendi değeri kadar ceza yazar (5. madde).
      const remaining = computeRemainingTilesPenalty(racks?.[uid], okeyInfo);
      baseDelta[uid] = openedWithPairs?.[uid] ? remaining * PAIRS_OPENER_PENALTY_MULTIPLIER : remaining;
    }
  });

  // Eşli (2v2): takımın iki üyesinin bu turki delta'sı ortak havuzda toplanıp
  // ikisine de aynı şekilde uygulanır.
  const pooledDelta = { ...baseDelta };
  if (rules?.gameType === '2v2' && teams) {
    for (const teamUids of [teams.A || [], teams.B || []]) {
      if (teamUids.length < 2) continue;
      const pooled = teamUids.reduce((s, uid) => s + (baseDelta[uid] || 0), 0);
      teamUids.forEach((uid) => { pooledDelta[uid] = pooled; });
    }
  }

  const multiplier = foldMultiplier || 1;
  const newScores = { ...scores };
  const perPlayer = {};
  players.forEach((uid) => {
    const interimPenalty = (scores?.[uid] || 0) - (roundStartScores?.[uid] || 0);
    const roundDelta = pooledDelta[uid] * multiplier;
    newScores[uid] = (scores?.[uid] || 0) + roundDelta;
    perPlayer[uid] = { interimPenalty, roundDelta, total: interimPenalty + roundDelta };
  });

  return {
    newScores,
    roundResult: { winnerUid, wonByOkeyDiscard, foldMultiplier: multiplier, perPlayer },
  };
}
