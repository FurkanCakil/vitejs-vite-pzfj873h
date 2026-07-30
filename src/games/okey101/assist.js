// "YARDIMLI MOD" (rules.assistedEnabled) yardımcıları — saf fonksiyonlar,
// Firestore/React YOK.
//
// KULLANICI İSTEĞİ: Yeni/öğrenen oyuncular için arayüz destekleri. Bu dosya
// bunlardan İKİSİNİ üretir:
//   1) "Seri Diz": elden en değerli seri/set (per) kombinasyonunu bulup
//      ıstakayı bu perler ONAYLANMIŞ (groups) halde yeniden dizer.
//   2) "Çift Diz": elindeki TÜM geçerli çiftleri per yapar; elde Okey / Sahte
//      Okey / Gösterge eşi (bkz. gameLogic#isPairWildcard) varsa bunlar boşta
//      kalan EN YÜKSEK sayılı taşa bağlanır.
//
// ÖNEMLİ: Oyunun KURALLARINA hiç dokunulmaz. Üretilen perler, oyuncunun elle
// "Per Onayla" ile kurabileceği perlerle BİREBİR aynı doğrulayıcılardan
// (validateGroup / isValidPairTiles) geçer — yardımlı mod hiçbir zaman
// oynanamayacak bir per üretemez.

import { RACK_ROW_LENGTH, RACK_SLOTS, effectiveTile, isOkeyTile } from './tiles.js';
import { isPairWildcard, isValidPairTiles, validateGroup } from './gameLogic.js';
import { pickBotMelds } from './botAI.js';

const effNumber = (tile, okeyInfo) => (effectiveTile(tile, okeyInfo)?.number ?? 0);

let gidCounter = 0;
const nextGid = () => `G${Date.now()}_${gidCounter++}_${Math.floor(Math.random() * 1000)}`;

// Elindeki TÜM geçerli çiftleri döndürür (botAI#pickBotPairs'ten farkı: orada
// açılış için GEREKEN sayıda çift hedeflenir ve Okey ancak gerekiyorsa
// harcanır; burada kullanıcı açıkça "elindeki bütün çiftler per yapılsın"
// dediği için hiçbir üst sınır yoktur ve joker/gösterge eşi BİLEREK en yüksek
// sayılı boş taşa bağlanır).
export function pickAllPairs(handTiles, okeyInfo, indicator = null) {
  const wildcards = [];
  const normals = [];
  (handTiles || []).forEach((t) => {
    if (!t) return;
    if (isPairWildcard(t, okeyInfo, indicator)) wildcards.push(t);
    else normals.push(t);
  });

  // Aynı renk+sayı taşlar ikili ikili eşlenir; tek kalan taş "boşta" sayılır.
  const byKey = new Map();
  normals.forEach((t) => {
    const e = effectiveTile(t, okeyInfo);
    const key = `${e.color}-${e.number}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(t);
  });

  const pairs = [];
  const spare = [];
  byKey.forEach((arr) => {
    let i = 0;
    for (; i + 1 < arr.length; i += 2) pairs.push([arr[i], arr[i + 1]]);
    if (i < arr.length) spare.push(arr[i]);
  });

  // Joker/gösterge eşleri EN YÜKSEK sayılı boş taşa bağlanır (kullanıcı isteği)
  // — böylece elde kalırsa en çok ceza yazdıracak taş kurtarılmış olur.
  spare.sort((a, b) => effNumber(b, okeyInfo) - effNumber(a, okeyInfo));
  const unusedWildcards = [];
  wildcards.forEach((w) => {
    const partner = spare.shift();
    if (partner) pairs.push([partner, w]);
    else unusedWildcards.push(w);
  });
  // Bağlanacak normal taş kalmadıysa jokerler kendi aralarında eşleşir
  // (iki Okey de geçerli bir çifttir — bkz. gameLogic#isValidPairTiles).
  for (let i = 0; i + 1 < unusedWildcards.length; i += 2) {
    pairs.push([unusedWildcards[i], unusedWildcards[i + 1]]);
  }

  return pairs
    .filter(([a, b]) => isValidPairTiles(a, b, okeyInfo, indicator))
    .map((tiles) => ({ tiles, type: 'cift' }));
}

// Perleri (melds) ıstakaya yerleştirir ve `groups` haritasını üretir.
//
// KULLANICI İSTEĞİ: perler "ıstakanın en sol üstünden sağa doğru, üst satır
// biterse sol alttan sağa doğru" sıralanır — yani bir per ASLA satır sonunda
// bölünmez, sığmıyorsa bütün halinde bir alt satıra iner. `rowLength` ekrandaki
// gerçek satır uzunluğudur (geniş ekranda 15, dar telefonda 10 — bkz.
// PlayerRack#rackColumns).
//
// Perler arasına GÖRSEL AYIRICI olarak birer boş slot bırakılmaya çalışılır
// (aksi halde iki komşu per tek bir blok gibi görünüyor). Yer yetmezse
// (ör. 11 çiftlik bir el) ayırıcılar bırakılır, en son çare olarak satır
// hizalaması da bırakılıp taşlar sırayla dizilir — hiçbir koşulda taş
// KAYBOLMAZ.
function placeMelds(melds, leftovers, rowLength, { separator, rowAware }) {
  const rack = Array(RACK_SLOTS).fill(null);
  const groups = {};
  const rows = Math.max(1, Math.floor(RACK_SLOTS / rowLength));
  // KÖK NEDEN DÜZELTMESİ ("perler arasında boşluk yok" / "diğer taşlardan
  // ayrılmıyor"): perin taşlarından SONRA bırakılan tek-slotluk ayırıcı boş
  // kalıyordu AMA aşağıdaki "leftovers" (perlere girmeyen taşlar) döngüsü
  // "İLK BOŞ SLOTU" arayarak dolduruyordu — yani tam da bu ayırıcı boşluklar
  // leftover taşlarla anında dolduruluyor, perler arasındaki görsel ayrım
  // hiç oluşmuyordu. Ayırıcı olarak bırakılan slotlar artık `reserved`e
  // eklenir; leftover doldurma bunları KESİNLİKLE atlar.
  const reserved = new Set();

  // `next`: perin yerleşeceği ilk slot (düz/flat indeks).
  let next = 0;
  for (const meld of melds) {
    const len = meld.tiles.length;
    if (rowAware) {
      // Per bu satırın sonuna sığmıyorsa BÜTÜN HALİNDE bir alt satıra iner.
      let row = Math.floor(next / rowLength);
      let col = next % rowLength;
      while (row < rows && col + len > rowLength) { row += 1; col = 0; }
      if (row >= rows) return null; // sığmadı — çağıran daha gevşek bir modu dener
      next = row * rowLength + col;
    }
    if (next + len > RACK_SLOTS) return null;
    meld.tiles.forEach((tile, i) => { rack[next + i] = tile; reserved.add(next + i); });
    groups[nextGid()] = meld.tiles.map((t) => t.id);
    const meldEnd = next + len;
    if (separator && meldEnd < RACK_SLOTS) reserved.add(meldEnd); // ayırıcı boşluk KORUNUR
    next = meldEnd + (separator ? 1 : 0);
  }

  // Perlere girmeyen taşlar, perlerin/ayırıcıların HİÇ dokunmadığı ilk boş
  // slottan başlayarak sırayla konur.
  let cursor = 0;
  for (const tile of leftovers) {
    while (cursor < RACK_SLOTS && (rack[cursor] !== null || reserved.has(cursor))) cursor += 1;
    if (cursor >= RACK_SLOTS) return null;
    rack[cursor] = tile;
  }
  return { rack, groups };
}

// Perler yerleştirildikten sonra kalan taşları düzenli göstermek için renk +
// sayı sırasına dizer (oyuncu elinde ne kaldığını bir bakışta görsün).
function tidyLeftovers(tiles, okeyInfo) {
  return [...tiles].sort((a, b) => {
    const ea = effectiveTile(a, okeyInfo); const eb = effectiveTile(b, okeyInfo);
    if (ea.color !== eb.color) return String(ea.color).localeCompare(String(eb.color));
    return (ea.number || 0) - (eb.number || 0);
  });
}

// Verilen perleri ıstakaya diz; sırayla daha gevşek yerleşim modlarını dener.
function arrange(melds, handTiles, okeyInfo, rowLength) {
  const used = new Set(melds.flatMap((m) => m.tiles.map((t) => t.id)));
  const leftovers = tidyLeftovers(handTiles.filter((t) => t && !used.has(t.id)), okeyInfo);
  const attempts = [
    { separator: true, rowAware: true },
    { separator: false, rowAware: true },
    { separator: true, rowAware: false },
    { separator: false, rowAware: false },
  ];
  for (const opts of attempts) {
    const result = placeMelds(melds, leftovers, rowLength, opts);
    if (result) return result;
  }
  return null;
}

// "Seri Diz": elden en değerli seri/set kombinasyonunu (botun açılış için
// kullandığı AYNI arama — botAI#pickBotMelds) bulup ıstakayı bu perler
// onaylanmış halde yeniden dizer. `null` dönerse dizilecek bir şey yok.
export function buildSeriesArrangement(rack, okeyInfo, rowLength = RACK_ROW_LENGTH) {
  const handTiles = (rack || []).filter(Boolean);
  if (handTiles.length === 0) return null;
  const melds = pickBotMelds(handTiles, okeyInfo)
    // Emniyet: pickBotMelds zaten doğrulanmış perler döndürür, ama yardımlı
    // mod hiçbir koşulda geçersiz bir per ONAYLAMAMALI.
    .filter((m) => validateGroup(m.tiles, okeyInfo).valid);
  if (melds.length === 0) return null;
  return arrange(melds, handTiles, okeyInfo, rowLength);
}

// "Çift Diz": elindeki tüm geçerli çiftleri per yapıp ıstakayı yeniden dizer.
export function buildPairsArrangement(rack, okeyInfo, indicator = null, rowLength = RACK_ROW_LENGTH) {
  const handTiles = (rack || []).filter(Boolean);
  if (handTiles.length === 0) return null;
  const pairs = pickAllPairs(handTiles, okeyInfo, indicator);
  if (pairs.length === 0) return null;
  return arrange(pairs, handTiles, okeyInfo, rowLength);
}

// Yardımlı modda ıstakanın sağ üstünde gösterilen "onaylanmış per toplamı"
// için: SADECE 3+ taşlı (seri/set) perlerin gerçek puan değeri toplanır.
// Çiftler (2 taş) 101 hesabına girmez — onların açılış ölçütü SAYIdır
// (bkz. gameLogic#validatePairs), bu yüzden toplama dahil edilmezler.
export function confirmedMeldTotal(groups, rack, okeyInfo) {
  const byId = new Map();
  (rack || []).forEach((t) => { if (t) byId.set(t.id, t); });
  let total = 0;
  Object.values(groups || {}).forEach((tileIds) => {
    if (!tileIds || tileIds.length < 3) return;
    const tiles = tileIds.map((id) => byId.get(id)).filter(Boolean);
    if (tiles.length !== tileIds.length) return;
    const result = validateGroup(tiles, okeyInfo);
    if (result.valid) total += result.value;
  });
  return total;
}

// Yardımlı modda oyuncunun ıstakasındaki GERÇEK Okey taşlarının id'leri —
// bunlar kendiliğinden ters çevrilerek gösterilir (gerçek masada okeyi fark
// edip ters koymak gibi; bkz. PlayerRack uzun-basma işareti).
export function findOkeyTileIds(rack, okeyInfo) {
  return (rack || []).filter((t) => t && isOkeyTile(t, okeyInfo)).map((t) => t.id);
}
