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

// Bir seri için OLASI TÜM sayı pencerelerini (start..end) döndürür. Jokerler
// (gerçek Okey) pencerede eksik kalan sayıları temsil eder.
//
// ÖNEMLİ: Eskiden bulunan İLK pencere döndürülüyordu; bu, jokerin ıstakadaki
// GÖRSEL yerinden bağımsız olarak hep "mümkün olan en küçük başlangıcı"
// seçtiği için ör. [10, 11, Okey] perinin 10-11-12 değil 9-10-11 sayılmasına
// (ve dolayısıyla hem yanlış puanlanmasına hem de "düzgün dizilmemiş"
// görünmesine) yol açıyordu. Artık tüm pencereler üretilir; hangisinin
// kullanılacağına `pickSeriWindow` taşların GERÇEK SIRASINA bakarak karar verir.
function seriWindows(normals, jokerCount) {
  const out = [];
  if (normals.length === 0) return out;
  const color = normals[0].color;
  if (!normals.every((t) => t.color === color)) return out;
  const rawNumbers = normals.map((t) => t.number);
  if (new Set(rawNumbers).size !== rawNumbers.length) return out; // aynı seride tekrar eden sayı olamaz
  const total = normals.length + jokerCount;
  if (total < 3 || total > 13) return out;

  const collect = (numbers) => {
    if (new Set(numbers).size !== numbers.length) return;
    const sorted = [...numbers].sort((a, b) => a - b);
    const min = sorted[0]; const max = sorted[sorted.length - 1];
    if (max - min + 1 > total) return;
    // start >= 1: "0-1-2" gibi var olmayan bir seriye izin verilmez (eskiden
    // Okey+1+2 böyle okunup 6 yerine 3 puan sayılıyordu).
    // start <= 13: 14+ ile başlayan pencere zaten 1+ ile başlayanın aynısıdır.
    for (let start = Math.max(1, max - total + 1); start <= Math.min(13, min); start++) {
      const end = start + total - 1;
      if (sorted.every((n) => n >= start && n <= end)) out.push({ color, start, end });
    }
  };

  collect(rawNumbers);
  // 13'ten sonra 1 gelebilir: küçük sayıları (1-3) +13 kaydırıp 13 ile aynı pencereye sığıyor mu dene.
  if (rawNumbers.includes(13) || rawNumbers.some((n) => n <= 3)) {
    collect(rawNumbers.map((n) => (n <= 3 ? n + 13 : n)));
  }

  const seen = new Set();
  return out.filter((w) => {
    const key = `${w.start}-${w.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function seriWindowValue(win) {
  let value = 0;
  for (let n = win.start; n <= win.end; n++) value += realNumber(n);
  return value;
}

// Taşların GÖRSEL sırası bu pencereyle birebir uyuşuyor mu? (Jokerler her
// pozisyonda kabul edilir; sadece gerçek taşların kendi pozisyonlarına denk
// gelen sayıyı taşıyıp taşımadığına bakılır.)
function windowMatchesOrder(tiles, win, okeyInfo) {
  if (tiles.length !== win.end - win.start + 1) return false;
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    if (isOkeyTile(tile, okeyInfo)) continue;
    if (effectiveTile(tile, okeyInfo).number !== realNumber(win.start + i)) return false;
  }
  return true;
}

// Bir seri için KULLANILACAK pencereyi seçer: önce taşların görsel sırasıyla
// uyumlu olanlar, onların içinden (ya da hiçbiri uymuyorsa tümünün içinden)
// en değerli olan.
function pickSeriWindow(tiles, okeyInfo) {
  const { jokerCount, normals } = splitTiles(tiles, okeyInfo);
  const windows = seriWindows(normals, jokerCount);
  if (windows.length === 0) return null;
  const inOrder = windows.filter((w) => windowMatchesOrder(tiles, w, okeyInfo));
  const pool = inOrder.length > 0 ? inOrder : windows;
  return pool.reduce((best, w) => (seriWindowValue(w) > seriWindowValue(best) ? w : best));
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

  const win = pickSeriWindow(tiles, okeyInfo);
  if (win) return { valid: true, type: 'seri', value: seriWindowValue(win) };

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
  return seriWindows(normals, jokerCount).some((w) => windowMatchesOrder(tiles, w, okeyInfo));
}

// Bir per'in taşlarını masaya konmadan önce DOĞRU sıraya dizer (sadece seri
// için anlamlıdır; set'te sıra önemsizdir). Jokerler temsil ettikleri sayının
// pozisyonuna yerleştirilir. Diziliş çözümlenemezse taşlar olduğu gibi döner.
//
// Masaya yazılan HER per bundan geçirilir: hem oyuncunun hem botun açtığı
// perler ekranda her zaman "9-10-11-12" gibi doğru sırada görünür.
export function orderGroupTiles(tiles, type, okeyInfo) {
  if (type !== 'seri' || !tiles || tiles.length < 3) return tiles;
  const win = pickSeriWindow(tiles, okeyInfo);
  if (!win) return tiles;
  if (windowMatchesOrder(tiles, win, okeyInfo)) return tiles;

  const pool = [...tiles];
  const slots = [];
  for (let n = win.start; n <= win.end; n++) {
    const want = realNumber(n);
    const idx = pool.findIndex((t) => !isOkeyTile(t, okeyInfo) && effectiveTile(t, okeyInfo).number === want);
    if (idx === -1) { slots.push(null); continue; }
    slots.push(pool[idx]);
    pool.splice(idx, 1);
  }
  const jokers = pool.filter((t) => isOkeyTile(t, okeyInfo));
  let jokerIdx = 0;
  const filled = slots.map((t) => t ?? jokers[jokerIdx++]);
  if (filled.length !== tiles.length || filled.some((t) => !t)) return tiles;
  return filled;
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
export function canTackTile(groupTiles, groupType, newTile, side, okeyInfo) {
  if (groupType === 'cift' || !groupTiles || groupTiles.length === 0 || !newTile) return { valid: false };

  if (groupType === 'seri') {
    const win = pickSeriWindow(groupTiles, okeyInfo);
    if (!win) return { valid: false };
    // Seri 13 -> 1 sınırını AŞAMAZ (13'te bitenin sağına, 1'de başlayanın soluna eklenemez).
    const wanted = side === 'left' ? win.start - 1 : win.end + 1;
    if (wanted < 1 || wanted > 13) return { valid: false };

    // KRİTİK: Taş, o ucun beklediği TAM renk+sayı olmalı. Eskiden sadece
    // `validateGroup` çağrılıyordu; o küme (set) temelli çalıştığı ve sırayı
    // umursamadığı için 9-10-11 perinin SOLUNA 12 eklenmesini de kabul edip
    // masaya "12-9-10-11" gibi bozuk diziler yazıyordu. Gerçek Okey (joker)
    // her sayıyı temsil edebildiği için muaftır.
    if (!isOkeyTile(newTile, okeyInfo)) {
      const e = effectiveTile(newTile, okeyInfo);
      if (e.color !== win.color || e.number !== realNumber(wanted)) return { valid: false };
    }

    const newTiles = side === 'left' ? [newTile, ...groupTiles] : [...groupTiles, newTile];
    const result = validateGroup(newTiles, okeyInfo);
    if (!result.valid || result.type !== 'seri') return { valid: false };
    return { valid: true, newTiles };
  }

  // SET: sıra anlamsızdır, taş sona eklenir (4. renk eksikse geçerli olur).
  const newTiles = [...groupTiles, newTile];
  const result = validateGroup(newTiles, okeyInfo);
  if (result.valid && result.type === 'set') return { valid: true, newTiles };
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

// Kazananın bitiriş şekline bağlı özel bonuslar (bkz. computeRoundEnd):
//   - Okey ile bitirme (elindeki/çektiği son taş olarak GERÇEK Okey'i atarak
//     bitirmek): kazananın kendi ödülü zaten iki katına çıkıyordu (aşağıda).
//   - "Elden" bitirme: oyuncu bu TURA elini hiç açmamış olarak girip AYNI
//     turda tüm elini (tüm perlerini) açıp son taşla bitirirse.
// Her iki durumda da DİĞER oyuncuların bu tur sonu cezaları KATLANIR (bu iki
// bonus aynı anda gerçekleşirse -teorik olarak mümkün- çarpanlar birleşir).
export const OKEY_DISCARD_OPPONENT_MULTIPLIER = 2;
export const WENT_OUT_FROM_HAND_OPPONENT_MULTIPLIER = 2;

// Bir el (round) bittiğinde her oyuncunun bu turdaki net puan değişimini ve
// (Eşli modda) takım havuzlamasını hesaplar. `roomData.scores` zaten anlık
// (yandan-alma/açamama gibi) cezaları içerdiği için, o anlık cezaları
// roundStartScores'a göre ayrıştırıp tablo için ayrıca raporluyoruz.
export function computeRoundEnd({ players, scores, roundStartScores, hasOpened, openedWithPairs, racks, rules, teams, okeyInfo, foldMultiplier }, winnerUid, wonByOkeyDiscard, wentOutFromHand = false) {
  // Diğer (kazanmayan) oyuncuların bu turki cezasına uygulanan toplam katsayı.
  let opponentBonusMultiplier = 1;
  if (wonByOkeyDiscard) opponentBonusMultiplier *= OKEY_DISCARD_OPPONENT_MULTIPLIER;
  if (wentOutFromHand) opponentBonusMultiplier *= WENT_OUT_FROM_HAND_OPPONENT_MULTIPLIER;

  const baseDelta = {};
  players.forEach((uid) => {
    if (uid === winnerUid) {
      baseDelta[uid] = wonByOkeyDiscard ? -(PENALTY_POINTS * 2) : -PENALTY_POINTS;
      return;
    }
    if (!hasOpened?.[uid]) {
      baseDelta[uid] = NON_OPENER_PENALTY * opponentBonusMultiplier;
    } else {
      // ÇİFT ile açan oyuncu, elinde kalan taşların İKİ KATI ceza yazar;
      // Seri/Set ile açan taşların kendi değeri kadar ceza yazar (5. madde).
      const remaining = computeRemainingTilesPenalty(racks?.[uid], okeyInfo);
      baseDelta[uid] = (openedWithPairs?.[uid] ? remaining * PAIRS_OPENER_PENALTY_MULTIPLIER : remaining) * opponentBonusMultiplier;
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
    roundResult: { winnerUid, wonByOkeyDiscard, wentOutFromHand, foldMultiplier: multiplier, perPlayer },
  };
}
