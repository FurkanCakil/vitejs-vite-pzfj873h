// NOT: Bu dosya sadece taş üretimi/dağıtımı ve ıstaka (rack) üzerinde taş/per
// hareketi için saf yardımcı fonksiyonlar içerir. Çekme/atma gibi tur mantığı
// bilinçli olarak burada YOKTUR (2. Faz kapsamı dışı).

export const COLORS = ['black', 'red', 'blue', 'yellow'];

// Renk körlüğü vb. erişilebilirlik için her renge eşlenen küçük sembol.
export const COLOR_SYMBOLS = { black: '♠', red: '♥', blue: '♦', yellow: '♣' };

export const COLOR_LABELS = { black: 'Siyah', red: 'Kırmızı', blue: 'Mavi', yellow: 'Sarı' };

// 2 satır x 15 sütun = 30 slot. 22 taş + rahat düzenleme payı için bolca yer.
export const RACK_ROW_LENGTH = 15;
export const RACK_SLOTS = RACK_ROW_LENGTH * 2;

// Eski (2x13 = 26 slotluk) ıstakalar hâlâ Firestore'da duruyor olabilir; bunlar
// satır yapısı korunarak yeni boyuta genişletilir (ilk satır ilk satıra, ikinci
// satır ikinci satıra). Beklenmedik uzunluklar da güvenle doldurulur/kırpılır.
export function normalizeRack(rack) {
  const empty = Array(RACK_SLOTS).fill(null);
  if (!Array.isArray(rack)) return empty;
  if (rack.length === RACK_SLOTS) return rack;

  const oldRowLength = rack.length % 2 === 0 ? rack.length / 2 : RACK_ROW_LENGTH;
  const next = [...empty];
  rack.forEach((tile, i) => {
    if (!tile) return;
    const row = Math.floor(i / oldRowLength);
    const col = i % oldRowLength;
    if (row > 1 || col >= RACK_ROW_LENGTH) {
      const spare = next.findIndex((s) => s === null);
      if (spare !== -1) next[spare] = tile;
      return;
    }
    next[row * RACK_ROW_LENGTH + col] = tile;
  });
  return next;
}

// El dağıtıldıktan sonra, ilk oyuncu oynamaya başlamadan ÖNCE herkese verilen
// "elini düzenle/perlerini diz" süresi. KULLANICI İSTEĞİ: 40sn -> 25sn
// (hamle süresi 45sn'ye çıktığı için bu ek hazırlık payı kısaltıldı).
// NOT: "Yardımlı" modda el zaten OTOMATİK dizilmiş geldiği için bu süre HİÇ
// verilmez (bkz. Okey101Game#assisted).
export const SETUP_DURATION_MS = 25000;

// Bir oyuncunun tek bir hamle (çek + at) için süresi. KULLANICI İSTEĞİ:
// 30sn -> 45sn. Burada (tiles.js'te) durur çünkü hem Okey101Game hem de
// gameLogic (koltuk devri sırasında hamle süresini tazelerken) aynı değeri
// kullanmak zorundadır — eskiden gameLogic'te 30000 SABİT KODLUYDU ve bu
// değer değiştiğinde sessizce tutarsız kalıyordu.
export const TURN_DURATION_MS = 45000;

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

// `starterUid`'e (verilmezse playerUids[0]'a) 22, diğerlerine 21 taş dağıtır;
// kalanlar çekme destesidir. Ayrıca kalan destenin en altından (jokerse bir
// üstünden) Gösterge taşını belirler.
//
// NOT: `starterUid` DİZİ SIRASINDAN (oturma düzeninden) AYRI bir kavramdır —
// oturma düzeni (playerUids sırası, dolayısıyla sol/sağ komşuluklar) bir oda
// için SABİT kalırken, HANGİ oyuncunun 22 taşla başlayacağı turdan tura
// değişir (bkz. Okey101Game: ilk el rastgele, sonrakiler saat yönünün
// tersine döner) — bu yüzden dizi sırasını bozmadan sadece kimin 22 taş
// alacağını parametreyle belirtiyoruz.
export function dealTiles(playerUids, starterUid = playerUids[0]) {
  const shuffled = shuffle(createTileSet());
  let cursor = 0;
  const racks = {};
  playerUids.forEach((uid) => {
    const count = uid === starterUid ? 22 : 21;
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

// Bir taşın JOKER (her taşın yerine geçebilen "Okey") olup olmadığını söyler.
// Bu SADECE gerçek Okey taşlarıdır: göstergenin 1 fazlası, aynı renk.
//
// ÖNEMLİ: "Sahte Okey" (isJoker) artık bir joker/wildcard DEĞİLDİR. Tek işlevi,
// o elin Okey'ini (göstergenin 1 fazlasını) temsil eden NORMAL bir taş olmaktır
// — bkz. `effectiveTile`. Bu yüzden ne joker sayılır, ne Okey gibi işaretlenir,
// ne de atıldığında Okey atma cezası doğurur.
export function isOkeyTile(tile, okeyInfo) {
  if (!tile || tile.isJoker) return false;
  if (!okeyInfo) return false;
  return tile.color === okeyInfo.color && tile.number === okeyInfo.number;
}

// Bir taşın oyun kurallarınca GEÇERLİ yüz değerini döndürür. Sahte Okey
// (isJoker), o elin Okey'inin renk/sayısına sahip normal bir taş gibi davranır;
// diğer tüm taşlar olduğu gibi kalır.
export function effectiveTile(tile, okeyInfo) {
  if (!tile) return tile;
  if (tile.isJoker && okeyInfo) return { ...tile, color: okeyInfo.color, number: okeyInfo.number };
  return tile;
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

// Oyuncunun ıstakayı düzenlemesi (sürükle-bırak) SADECE bir KONUM bilgisidir;
// ıstakada HANGİ taşların bulunduğuna her zaman sunucudaki hâli karar verir.
//
// Bu ayrım kritik: eskiden düzenleme, tüm ıstaka dizisini olduğu gibi üzerine
// yazıyordu. Oyuncu taşı çektikten hemen sonra (sunucudan gelen anlık güncelleme
// daha ıstakaya işlenmeden) taşlarını düzenlerse, elindeki BAYAT dizi sunucuya
// yazılıyor ve YENİ ÇEKİLEN TAŞ TAMAMEN KAYBOLUYORDU. Kaybolan taş yandan
// alınmış bir taşsa (`sideTake`) oyuncu ne elini açabiliyor, ne taşı geri
// koyabiliyor, ne de atabiliyordu — masa kalıcı olarak kilitleniyordu.
export function mergeRackLayout(serverRack, desiredRack) {
  const server = normalizeRack(serverRack);
  const desired = normalizeRack(desiredRack);
  const wantedIndex = new Map();
  desired.forEach((tile, i) => { if (tile) wantedIndex.set(tile.id, i); });

  const merged = Array(RACK_SLOTS).fill(null);
  const leftovers = [];
  server.forEach((tile, serverIdx) => {
    if (!tile) return;
    const idx = wantedIndex.get(tile.id);
    if (idx !== undefined && merged[idx] === null) merged[idx] = tile;
    else leftovers.push({ tile, serverIdx }); // istemcinin bilmediği (yeni çekilen) ya da çakışan taş
  });
  // Istemcinin hiç bilmediği taşlar (ör. az önce çekilen) önce SUNUCUDAKİ
  // slotlarında tutulmaya çalışılır; orası da doluysa ilk boş slota konur.
  leftovers.forEach(({ tile, serverIdx }) => {
    if (merged[serverIdx] === null) { merged[serverIdx] = tile; return; }
    const free = merged.findIndex((s) => s === null);
    if (free !== -1) merged[free] = tile;
  });
  return merged;
}

// Perler (groups) de aynı şekilde sunucudaki taş kümesine göre budanır:
// artık ıstakada olmayan taşlar gruptan düşer, 2'nin altına inen grup silinir.
export function pruneGroups(groups, rack) {
  const alive = new Set((rack || []).filter(Boolean).map((t) => t.id));
  const next = {};
  Object.entries(groups || {}).forEach(([gid, tileIds]) => {
    const kept = (tileIds || []).filter((id) => alive.has(id));
    if (kept.length >= 2) next[gid] = kept;
  });
  return next;
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
