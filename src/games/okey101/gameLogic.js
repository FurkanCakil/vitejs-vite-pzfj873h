import { isOkeyTile, effectiveTile, TURN_DURATION_MS } from './tiles.js';

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

// ============================================================
// Katlamalı mod: per (seri/set) barajı
// ============================================================
// "Katlamalı" kuralı açıksa, elini per (Seri Aç) ile İLK açan oyuncunun
// toplam per değeri o TUR için bir "baraj" oluşturur. Bu baraj SABİT
// DEĞİLDİR: daha sonra biri bu barajı DAHA BÜYÜK bir toplamla geçerse
// (ör. Ali 39 ile açıp barajı kurmuşken sonra biri 44 ile açarsa), yeni
// baraj o ANDAN İTİBAREN o en yüksek sayı olur (bkz. Okey101Game —
// `foldBarrier` her başarılı per açılışında `total > barrier.total` ise
// güncellenir). Per ile açmaya çalışan (ve muaf olmayan) her oyuncu GÜNCEL
// barajı KESİN OLARAK GEÇMEK (>) zorundadır; aksi halde normal 101 barajını
// geçememiş gibi +101 ceza yer.

// Baraj gösterimi: "123 (41)" (3'e tam bölünüyorsa) ya da "124 (41 yan 1)"
// (bölümden kalan varsa). 3'e bölme, oyuncuların gerçek Okey masalarında
// puanı "lira/kat" birimine çevirmesine karşılık gelir.
export function formatFoldBarrier(total) {
  const div = Math.floor(total / 3);
  const rem = total % 3;
  return rem === 0 ? `${total} (${div})` : `${total} (${div} yan ${rem})`;
}

// `formatFoldBarrier`'ın SADECE parantez içindeki "tek" (lira/kat) kısmı —
// önündeki ham sayı ve dış parantez OLMADAN. KULLANICI İSTEĞİ: Yardımlı
// modda "42/101 (14 / 33 yan 2)" gibi bir ilerleme rozetinde HEM mevcut
// toplamın HEM DE hedefin "tek" değeri yan yana gösterilir — `formatFoldBarrier`
// ise her çağrıda kendi sayısını da tekrar yazdığı için o biçime uymuyordu.
export function tekLabel(total) {
  const div = Math.floor(total / 3);
  const rem = total % 3;
  return rem === 0 ? `${div}` : `${div} yan ${rem}`;
}

// 5. madde: Katlama SADECE seri/set açılışına değil, ÇİFT açılışına da
// uygulanır — ama para/puan yerine ÇİFT SAYISI üzerinden. İlk çift açan 5
// çiftle açtıysa, ondan sonra çiftle açacak (ve muaf olmayan) herkesin EN AZ
// 6 çift açması gerekir. Normalde (baraj yokken) ilk açılış için 5 çift şarttır.
//
// ÖNEMLİ (kullanıcı isteği): 5 bir ALT SINIRDIR, sabit bir sayı DEĞİL. Elinde
// 6-7 çift olan oyuncu bunların TAMAMINI tek seferde açabilir (ve katlamalı
// modda barajı doğrudan o sayıya kurar). Eskiden arayüz tam 5 çift seçilmesini
// dayatıyor, oyuncu 6. çifti seçince "Çift Aç" butonu kayboluyor; ancak 5 çift
// açtıktan SONRA 6.'sını ayrıca sürebiliyordu.
export const PAIRS_OPEN_MIN = 5;

export function requiredPairsToOpen(pairsBarrier, exempt) {
  if (!pairsBarrier || exempt) return PAIRS_OPEN_MIN;
  return Math.max(PAIRS_OPEN_MIN, pairsBarrier.count + 1);
}

// ============================================================
// Eşli (2v2): CEZA/PUAN TAKIMA yazılır
// ============================================================
// Kullanıcı isteği: Eşli oyunda hiçbir ceza bireysel tutulmaz. Bir oyuncunun
// aldığı her ceza (işlek/Okey atma, açamama, yandan alınan taş, baraj vb.)
// DOĞRUDAN TAKIM PUANINA yazılır. Uygulama biçimi: takımın iki üyesinin
// `scores` değeri HER ZAMAN aynı sayıyı — takımın toplam cezasını — tutar.
// Böylece hem tur içi anlık cezalar hem de tur sonu havuzlaması (bkz.
// computeRoundEnd) tek bir "takım puanı" olarak akar ve ekranda takım başına
// TEK bir rakam gösterilir.
export function teamMembersOf(uid, rules, teams) {
  if (rules?.gameType !== '2v2' || !teams) return [uid];
  const a = teams.A || []; const b = teams.B || [];
  if (a.includes(uid)) return a;
  if (b.includes(uid)) return b;
  return [uid];
}

// Bir oyuncuya (Eşli modda TAKIMININ TAMAMINA) puan ekler. Firestore alan
// güncellemelerini (`scores.<uid>`) ve güncellenmiş skor haritasını döndürür;
// çağıran taraf bunları kendi `update` nesnesine yayar.
export function addScoreDelta(data, uid, amount, baseScores = null) {
  const scores = { ...(baseScores || data.scores || {}) };
  const updates = {};
  teamMembersOf(uid, data.rules, data.teams).forEach((u) => {
    scores[u] = (scores[u] || 0) - amount;
    updates[`scores.${u}`] = scores[u];
  });
  return { updates, scores };
}

// ============================================================
// BÜYÜK AÇILIŞ ÖDÜLLERİ (kullanıcı isteği)
// ============================================================
// Tek bir açılışta olağanüstü bir el sergileyen oyuncu ÖDÜL (eksi puan) alır:
//   - ÇİFT ile açış:  7 çift -> -101,  9 çift -> -202
//   - SERİ/SET açış:  "tek" (toplam/3, bkz. formatFoldBarrier) 50'yi geçerse
//     -101, 60'ı geçerse -202.
// Ödüller KADEMELİDİR (toplanmaz): en yüksek eşiği hangisi karşılıyorsa o
// uygulanır. Eşli modda bu ödül de takım puanına yazılır.
export const BIG_OPEN_BONUS_1 = -101;
export const BIG_OPEN_BONUS_2 = -202;

export function pairsOpenBonus(pairCount) {
  if (pairCount >= 9) return BIG_OPEN_BONUS_2;
  if (pairCount >= 7) return BIG_OPEN_BONUS_1;
  return 0;
}

export function seriesOpenBonus(total) {
  const tek = Math.floor((total || 0) / 3);
  if (tek > 60) return BIG_OPEN_BONUS_2;
  if (tek > 50) return BIG_OPEN_BONUS_1;
  return 0;
}

// Bu oyuncu, `barrier`i KURAN oyuncunun (barrier.uid) barajından MUAF mı?
// - Henüz baraj yoksa (bu oyuncu barajı KURACAK ilk kişi) -> muaf (geçecek bir şey yok).
// - "Eşe katlama" AÇIKSA kimse muaf değildir (takım arkadaşı da geçmek zorunda).
// - Tekli (ffa) modda ya da takımlar tanımsızsa muafiyet kavramı yoktur.
// - Eşli modda "eşe katlama" KAPALIYSA, barajı kuran oyuncunun TAKIM ARKADAŞI muaftır.
export function isExemptFromFoldBarrier(uid, barrier, rules, teams) {
  if (!barrier) return true;
  if (barrier.uid === uid) return true;
  if (rules?.foldToPartnerEnabled) return false;
  if (rules?.gameType !== '2v2' || !teams) return false;
  const teamA = teams.A || []; const teamB = teams.B || [];
  return (teamA.includes(uid) && teamA.includes(barrier.uid)) || (teamB.includes(uid) && teamB.includes(barrier.uid));
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
    // 3. madde: 101 Okey'de seriler 13'te BİTER — 13'ten sonra 1 gelemez.
    // Bu yüzden pencere tamamen 1..13 aralığında kalmak ZORUNDADIR:
    //   start >= 1  ("0-1-2" gibi var olmayan bir seri olamaz)
    //   end   <= 13 ("12-13-1" / "13-1-2" gibi sarmalı seriler olamaz)
    for (let start = Math.max(1, max - total + 1); start <= Math.min(13, min); start++) {
      const end = start + total - 1;
      if (end > 13) continue;
      if (sorted.every((n) => n >= start && n <= end)) out.push({ color, start, end });
    }
  };

  collect(rawNumbers);

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
// SERİ (aynı renk, ardışık sayı; 3. madde: seri 13'te BİTER, 13'ten sonra 1
// GELEMEZ) olup olmadığını katı şekilde doğrular ve geçerliyse Okey ikamesi
// dahil gerçek puan değerini hesaplar. Sadece sayı toplamı YETERLİ DEĞİLDİR —
// dizilim de doğru olmalı.
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

// KULLANICI İSTEĞİ: Bir seri ıstakada KÜÇÜKTEN BÜYÜĞE (7-8-9) ya da BÜYÜKTEN
// KÜÇÜĞE (9-8-7) dizilmiş olabilir — ikisi de "düzgün dizilmiş" sayılır ve
// onaylanabilir. Ama KARIŞIK bir sıra (ör. 9-7-8) KABUL EDİLMEZ.
//
// `isProperlyOrderedGroup` sadece ARTAN sırayı kabul eder; ters dizilişi de
// kapsamak için taş dizisi bir de TERS ÇEVRİLEREK denenir. (Masaya açılırken
// diziliş zaten `orderGroupTiles` ile her koşulda artan sıraya normalize
// edilir — yani ekranda per her zaman 7-8-9 olarak görünür.)
export function isSequentiallyOrderedGroup(tiles, type, okeyInfo) {
  if (type !== 'seri' || !tiles || tiles.length < 3) return true;
  if (isProperlyOrderedGroup(tiles, type, okeyInfo)) return true;
  return isProperlyOrderedGroup([...tiles].reverse(), type, okeyInfo);
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

// ============================================================
// ÇİFT (pair) kuralları
// ============================================================
// Bir taş, ÇİFT oluştururken "her taşın eşi olabilen" bir joker mi?
//   - Gerçek Okey: her zaman (klasik kural).
//   - Sahte Okey: 2'li per yapmak için kullanılabilir (2. madde).
//   - GÖSTERGE ile aynı renk+sayıdaki taş: destede o taşın İKİ kopyası vardır
//     ve biri masada Gösterge olarak duruyordur — yani elindeki kopyanın eşi
//     ASLA gelemez. Bu yüzden (sadece ÇİFT ile AÇARKEN, bkz. `indicator`
//     parametresinin nerede verildiği) o taş istenen herhangi bir taşa
//     bağlanabilir. Seri/set açarken ya da işlerken bu geçerli DEĞİLDİR.
export function isPairWildcard(tile, okeyInfo, indicator = null) {
  if (!tile) return false;
  if (isOkeyTile(tile, okeyInfo)) return true;
  if (tile.isJoker) return true; // Sahte Okey
  if (indicator && tile.color === indicator.color && tile.number === indicator.number) return true;
  return false;
}

// İki taş geçerli bir ÇİFT oluşturuyor mu? (Jokerler için bkz. isPairWildcard.)
export function isValidPairTiles(a, b, okeyInfo, indicator = null) {
  if (!a || !b) return false;
  if (isPairWildcard(a, okeyInfo, indicator) || isPairWildcard(b, okeyInfo, indicator)) return true;
  const ea = effectiveTile(a, okeyInfo); const eb = effectiveTile(b, okeyInfo);
  return ea.color === eb.color && ea.number === eb.number;
}

// Çift açma / çift işleme: seçili her per TAM 2 taş olmalı ve geçerli bir
// çift oluşturmalı (bkz. isValidPairTiles).
//
// `minPairs`: bu açılış için gereken EN AZ çift sayısı. İlk açılışta normalde
// 5'tir; katlamalı modda masadaki çift barajı varsa (bkz. 5. madde) barajın
// bir fazlasıdır. Zaten açmış bir oyuncunun kalan çiftlerini sürmesinde 1'dir.
//
// `indicator`: SADECE ilk kez ÇİFT ile açarken verilir — Gösterge taşının
// joker sayılmasını sağlar (2. madde). Diğer tüm durumlarda null geçilmelidir.
export function validatePairs(groupsMap, tilesById, selectedGroupIds, okeyInfo, minPairs = 5, indicator = null) {
  if (selectedGroupIds.length < minPairs) return { valid: false };
  for (const gid of selectedGroupIds) {
    const tileIds = groupsMap[gid] || [];
    if (tileIds.length !== 2) return { valid: false };
    const tiles = tileIds.map((id) => tilesById[id]).filter(Boolean);
    if (tiles.length !== 2) return { valid: false };
    if (!isValidPairTiles(tiles[0], tiles[1], okeyInfo, indicator)) return { valid: false };
  }
  return { valid: true };
}

// Masadaki açık bir per/seriye (cift HARİÇ) tek bir taş eklemenin (işleme/tacking)
// diziyi bozup bozmadığını kontrol eder. Geçerliyse yeni taş dizisini döndürür.
// İŞLEME sırasında da seri 13 -> 1 sınırını AŞAMAZ: 13'te biten bir serinin
// sağına, 1'de başlayan bir serinin soluna taş eklenemez (bkz. 3. madde —
// sarmalı seriler `seriWindows` seviyesinde de tamamen yasak).
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

// SERİ ile açmış bir oyuncu elindeki çiftleri masaya sürdüğünde, o çiftler
// KENDİ perlerinin yanına DEĞİL, masada ÇİFT AÇMIŞ bir oyuncunun perlerinin
// yanına konur (gerçek masada çiftler tek bir yerde toplanır).
//
// Hedef seçimi:
//   - Oyuncunun KENDİSİ çift açanlardansa (çift açan kendi çiftini sürüyorsa)
//     hedef yine kendisidir.
//   - Eşli (2v2) modda EŞİ çift açmışsa: eşi.
//   - Aksi halde: çift açanlardan rastgele biri.
//   - Masada hiç çift açan yoksa null (çağıran taraf kendine yazar).
export function pickPairsHostUid(uid, openedWithPairs, rules, teams, random = Math.random) {
  const hosts = Object.keys(openedWithPairs || {}).filter((u) => openedWithPairs[u]);
  if (hosts.length === 0) return null;
  if (hosts.includes(uid)) return uid;

  if (rules?.gameType === '2v2' && teams) {
    const myTeam = (teams.A || []).includes(uid) ? (teams.A || []) : ((teams.B || []).includes(uid) ? (teams.B || []) : null);
    const partner = myTeam?.find((u) => u !== uid && hosts.includes(u));
    if (partner) return partner;
  }
  return hosts[Math.floor(random() * hosts.length)];
}

// Bir per'deki (seri/set/ÇİFT fark etmez) bir Okey/Sahte Okey'i, verilen taşla
// DEĞİŞTİRMENİN (okey işleği / handleTackTile'daki `replaceTileId` mekaniği)
// geçerli olup olmadığını kontrol eder — geçerliyse HANGİ joker'in (index)
// değişeceğini de döndürür. Hem "bu taş işlek mi?" (discard cezası) hem de
// gerçek Okey alma işlemi AYNI bu kurala göre çalışır: bir per'de mavi+sarı+
// kırmızı 13 + Okey varsa (4. renk siyah eksik), Okey siyah 13'ü temsil eder
// ve siyah 13 atılırsa/işlenirse tam bu fonksiyon onu yakalar. Aynı mantık
// bir çiftte (ör. kırmızı 13 + Okey) DİĞER kırmızı 13 için de geçerlidir.
// 6. madde (kullanıcı isteği): Sahte Okey, gerçek Okey'in YERİNE hiçbir
// zaman "satın alma/işleme" taşı olarak sürülemez. Aksi hâlde (Sahte Okey de
// isPairWildcard olduğu için) örneğin [kırmızı 5, Gerçek Okey] çiftinde
// Gerçek Okey'i Sahte Okey ile "değiştirmeye" çalışmak, kalan taraf zaten
// joker olduğu için isValidPairTiles'ı KOŞULSUZ geçer — yani per türü/rengi/
// sayısı hiç önemli olmadan HERHANGİ bir taş(!) o pozisyona oturabiliyordu.
// Bir joker'i SADECE temsil ettiği GERÇEK (joker olmayan) taş satın alabilir.
export function findJokerReplacements(groupTiles, groupType, newTile, okeyInfo) {
  if (!groupTiles || !newTile || isOkeyTile(newTile, okeyInfo) || newTile.isJoker) return [];
  const results = [];
  groupTiles.forEach((t, jokerIdx) => {
    if (!isOkeyTile(t, okeyInfo)) return;
    const newTiles = [...groupTiles]; newTiles[jokerIdx] = newTile;
    if (groupType === 'cift') {
      if (newTiles.length === 2 && isValidPairTiles(newTiles[0], newTiles[1], okeyInfo)) results.push({ jokerIdx, newTiles });
      return;
    }
    const result = validateGroup(newTiles, okeyInfo);
    if (result.valid && result.type === groupType) results.push({ jokerIdx, newTiles });
  });
  return results;
}

// Bir taşın "işlek" olup olmadığını kontrol eder: masadaki (herhangi bir
// oyuncunun) açık bir per'inin
//   a) sağına ya da soluna tam oturuyorsa (seri/set uç eklemesi, bkz. canTackTile), YA DA
//   b) içindeki bir Okey'in YERİNE geçebiliyorsa (seri/set/ÇİFT — bkz.
//      findJokerReplacements; ör. mavi+sarı+kırmızı 13 + Okey açıksa siyah 13,
//      ya da kırmızı 13 + Okey çifti açıksa diğer kırmızı 13),
// o taş işlektir. Okey/Sahte Okey taşının kendisi de HER ZAMAN işlek sayılır.
// Bu, "işlek ya da Okey bir taş atan oyuncuya +101 ceza yazılır" kuralını
// uygulamak için kullanılır (bkz. handleDiscardTile).
export function isTileTackable(tile, openedHandsAllPlayers, okeyInfo) {
  if (!tile) return false;
  if (isOkeyTile(tile, okeyInfo)) return true;
  for (const groups of Object.values(openedHandsAllPlayers || {})) {
    for (const g of (groups || [])) {
      if (!g) continue;
      if (g.type !== 'cift') {
        if (canTackTile(g.tiles, g.type, tile, 'left', okeyInfo).valid) return true;
        if (canTackTile(g.tiles, g.type, tile, 'right', okeyInfo).valid) return true;
      }
      if (findJokerReplacements(g.tiles, g.type, tile, okeyInfo).length > 0) return true;
    }
  }
  return false;
}

// isTileTackable ile AYNI taramayı yapar ama sadece true/false yerine TAM
// OLARAK HANGİ per(ler)e (hangi oyuncunun, kaçıncı grubu, hangi ucu/Okey'i)
// taşın oturduğunu döndürür. "İşlek taş attın!" cezası uygulandığında
// oyuncuya (ve masadaki herkese) taşın NEREYE oturduğunu 2-3sn yanıp
// söndürerek göstermek için kullanılır (bkz. Okey101Game#tackHint).
export function findTackableSpotsForTile(tile, openedHandsAllPlayers, okeyInfo) {
  const spots = [];
  if (!tile || isOkeyTile(tile, okeyInfo)) return spots;
  Object.entries(openedHandsAllPlayers || {}).forEach(([uid, groups]) => {
    (groups || []).forEach((g, groupIndex) => {
      if (!g) return;
      if (g.type !== 'cift') {
        if (canTackTile(g.tiles, g.type, tile, 'left', okeyInfo).valid) spots.push({ uid, groupIndex, side: 'left' });
        if (canTackTile(g.tiles, g.type, tile, 'right', okeyInfo).valid) spots.push({ uid, groupIndex, side: 'right' });
      }
      if (findJokerReplacements(g.tiles, g.type, tile, okeyInfo).length > 0) spots.push({ uid, groupIndex, side: 'replace' });
    });
  });
  return spots;
}

// ============================================================
// SEYİRCİNİN BOT KOLTUĞUNA GEÇMESİ
// ============================================================
// Host bir seyircinin "botun yerine geçme" teklifini kabul ettiğinde, masadaki
// bot kimliği (uid) her yerde seyircinin kimliğiyle DEĞİŞTİRİLİR. Oyun tam
// olarak kaldığı yerden sürer: botun ıstakası, açtığı perler, attığı taşlar,
// puanı ve (varsa) sırası olduğu gibi yeni oyuncuya geçer.
//
// Tüm oda belgesini tarayan tek bir güncelleme nesnesi döndürür.
export function buildSeatSwapUpdate(data, botUid, newUid, newName) {
  const renameKey = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const out = { ...obj };
    if (Object.prototype.hasOwnProperty.call(out, botUid)) {
      out[newUid] = out[botUid];
      delete out[botUid];
    }
    return out;
  };
  const swapUid = (uid) => (uid === botUid ? newUid : uid);
  const swapList = (list) => (list || []).map(swapUid);

  const isBotPlayer = { ...(data.isBotPlayer || {}) };
  delete isBotPlayer[botUid];

  const playerNames = renameKey(data.playerNames || {});
  playerNames[newUid] = newName || playerNames[newUid] || 'Oyuncu';

  const update = {
    players: swapList(data.players),
    playerNames,
    isBotPlayer,
    scores: renameKey(data.scores || {}),
    spectators: (data.spectators || []).filter((uid) => uid !== newUid),
    seatRequests: Object.fromEntries(
      Object.entries(data.seatRequests || {}).filter(([uid, req]) => uid !== newUid && req?.botUid !== botUid),
    ),
  };

  // Oyun içi (el sürerken) alanlar — oyun daha başlamadıysa bunlar yoktur.
  if (data.racks) update.racks = renameKey(data.racks);
  if (data.groups) update.groups = renameKey(data.groups);
  if (data.discardPiles) update.discardPiles = renameKey(data.discardPiles);
  if (data.openedHands) update.openedHands = renameKey(data.openedHands);
  if (data.hasOpened) update.hasOpened = renameKey(data.hasOpened);
  if (data.openedWithPairs) update.openedWithPairs = renameKey(data.openedWithPairs);
  if (data.takenOkeys) update.takenOkeys = renameKey(data.takenOkeys);
  if (data.roundStartScores) update.roundStartScores = renameKey(data.roundStartScores);
  if (data.teams) update.teams = { A: swapList(data.teams.A), B: swapList(data.teams.B) };
  if (data.turn) update.turn = swapUid(data.turn);
  if (data.starterUid) update.starterUid = swapUid(data.starterUid);
  if (data.host) update.host = swapUid(data.host);
  if (data.sideTake) update.sideTake = { ...data.sideTake, uid: swapUid(data.sideTake.uid), fromUid: swapUid(data.sideTake.fromUid) };
  if (data.foldBarrier) update.foldBarrier = { ...data.foldBarrier, uid: swapUid(data.foldBarrier.uid) };
  if (data.foldPairsBarrier) update.foldPairsBarrier = { ...data.foldPairsBarrier, uid: swapUid(data.foldPairsBarrier.uid) };
  if (data.roundResult) {
    update.roundResult = {
      ...data.roundResult,
      winnerUid: data.roundResult.winnerUid ? swapUid(data.roundResult.winnerUid) : data.roundResult.winnerUid,
      perPlayer: renameKey(data.roundResult.perPlayer || {}),
    };
  }
  // Devralınan bot sırasını oynayabilmesi için hamle süresi tazelenir.
  if (data.turn === botUid && !data.roundEnded && !data.setupPhase) {
    update.turnDeadline = Date.now() + TURN_DURATION_MS;
  }
  return update;
}

// ============================================================
// 5. FAZ: Tur sonu puanlama
// ============================================================
export const NON_OPENER_PENALTY = PENALTY_POINTS * 2; // 202 — elini açamayan oyuncu

// ÇİFT ile açan oyuncunun tur sonunda elinde kalan taşlara uygulanan ceza katı.
export const PAIRS_OPENER_PENALTY_MULTIPLIER = 2;

// Bir oyuncunun ıstakasında kalan taşların ceza değerini toplar. HER taş (Okey
// ve Sahte Okey dahil) kendi — Sahte Okey/Okey için temsil ettiği — YÜZ
// DEĞERİYLE sayılır.
//
// KURAL DEĞİŞİKLİĞİ (kullanıcı isteği): Okey eskiden elde kaldığında sabit 101
// ceza yazdırıyordu. Artık desteden çekilen ya da en baştan elinde dağıtılan
// bir Okey için ceza YOKTUR — sadece MASADAN İŞLEYEREK ALINAN (çalınan) Okey,
// kullanılmadan elde kalırsa +101 ceza doğurur (bkz. UNUSED_STOLEN_OKEY_PENALTY
// ve computeRoundEnd'deki `takenOkeys`).
export function computeRemainingTilesPenalty(rack, okeyInfo) {
  let sum = 0;
  (rack || []).forEach((tile) => {
    if (!tile) return;
    sum += effectiveTile(tile, okeyInfo).number || 0;
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

// Masadaki bir per'den işleyerek Okey ALAN (çalan) ama tur bitene kadar o
// Okey'i KULLANAMAYIP ıstakasında bırakan oyuncuya yazılan ek ceza. Gerçek
// masadaki "kullanamayacaksan okeyi çalma" kuralı: çalma anında okeyi
// kaptırana +101 yazılır (bkz. handleTackTile), çalan da kullanamazsa aynı
// bedeli öder. NOT: Okey zaten "elde kalan taş" olarak da 101 sayılır
// (computeRemainingTilesPenalty) — bu ceza onun ÜSTÜNE eklenir.
export const UNUSED_STOLEN_OKEY_PENALTY = PENALTY_POINTS;

// Bir oyuncunun masadan aldığı Okey'lerden KAÇ TANESİ hâlâ ıstakasında?
export function countUnusedStolenOkeys(rack, takenOkeyIds) {
  if (!takenOkeyIds || takenOkeyIds.length === 0) return 0;
  const taken = new Set(takenOkeyIds);
  return (rack || []).filter((tile) => tile && taken.has(tile.id)).length;
}

// Bir el (round) bittiğinde her oyuncunun bu turdaki net puan değişimini ve
// (Eşli modda) takım havuzlamasını hesaplar. `roomData.scores` zaten anlık
// (yandan-alma/açamama gibi) cezaları içerdiği için, o anlık cezaları
// roundStartScores'a göre ayrıştırıp tablo için ayrıca raporluyoruz.
export function computeRoundEnd({ players, scores, roundStartScores, hasOpened, openedWithPairs, racks, rules, teams, okeyInfo, foldMultiplier, takenOkeys }, winnerUid, wonByOkeyDiscard, wentOutFromHand = false) {
  // Diğer (kazanmayan) oyuncuların bu turki cezasına uygulanan toplam katsayı.
  let opponentBonusMultiplier = 1;
  if (wonByOkeyDiscard) opponentBonusMultiplier *= OKEY_DISCARD_OPPONENT_MULTIPLIER;
  if (wentOutFromHand) opponentBonusMultiplier *= WENT_OUT_FROM_HAND_OPPONENT_MULTIPLIER;

  // Kazananın Eşli (2v2) takım arkadaşı: kazananın eli bittiği an tur biter,
  // eşin ıstakasında kalan taşlar ONUN hatası değildir — bu yüzden eşe
  // "elde kalan taş" cezası YAZILMAZ (kullanıcı isteği).
  const winnerTeamUids = (rules?.gameType === '2v2' && teams)
    ? ([teams.A || [], teams.B || []].find((t) => t.includes(winnerUid)) || [])
    : [];

  const baseDelta = {};
  players.forEach((uid) => {
    if (uid === winnerUid) {
      baseDelta[uid] = wonByOkeyDiscard ? -(PENALTY_POINTS * 2) : -PENALTY_POINTS;
      return;
    }
    if (winnerTeamUids.includes(uid)) {
      baseDelta[uid] = 0;
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
    // Masadan çalınıp kullanılamayan her Okey için ek +101. Kazananın ıstakası
    // zaten boş olduğu için pratikte sadece kaybedenleri etkiler. Bu ceza
    // "elde kalan taş" katsayılarından (çift ×2, elden bitme ×2) BAĞIMSIZDIR —
    // çalma cezası sabittir, rakibin nasıl bittiğine göre katlanmaz.
    const unusedStolen = countUnusedStolenOkeys(racks?.[uid], takenOkeys?.[uid]);
    if (unusedStolen > 0) baseDelta[uid] += unusedStolen * UNUSED_STOLEN_OKEY_PENALTY;
  });

  // Eşli (2v2): takımın iki üyesinin bu turki delta'sı ortak havuzda toplanıp
  // ikisine de aynı şekilde uygulanır. Tur İÇİ (anlık) cezalar da zaten takıma
  // yazıldığı (bkz. addScoreDelta — iki üyenin `scores` değeri her zaman
  // takımın toplamıdır) için sonuç TEK bir takım puanıdır; iki üyenin puanı
  // birbirinin kopyasıdır, toplanmaz.
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
    const roundDelta = -(pooledDelta[uid] * multiplier);
    newScores[uid] = (scores?.[uid] || 0) + roundDelta;
    perPlayer[uid] = { interimPenalty, roundDelta, total: interimPenalty + roundDelta };
  });

  return {
    newScores,
    roundResult: { winnerUid, wonByOkeyDiscard, wentOutFromHand, foldMultiplier: multiplier, perPlayer },
  };
}
