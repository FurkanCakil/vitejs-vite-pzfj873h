// NOT: Bu dosya yalnızca oda/lobi altyapısı için "sahte oyuncu" (bot koltuğu)
// üretir. Botların 101 Okey oynama mantığı (taş çekme/atma/per hesaplama vb.)
// './botAI.js' dosyasındadır.

export const OKEY_BOT_PREFIX = 'OKEY_BOT_';

const BOT_DISPLAY_NAMES = [
  'Ayşe', 'Mehmet', 'Zeynep', 'Ali', 'Fatma', 'Can', 'Elif', 'Burak',
  'Deniz', 'Selin', 'Emre', 'Gizem', 'Kerem', 'Nazlı', 'Onur', 'Pınar',
  'Serkan', 'Tuğçe', 'Umut', 'Yasemin', 'Hakan', 'İrem', 'Barış', 'Ceren',
];

export function isBotUid(uid) {
  return typeof uid === 'string' && uid.startsWith(OKEY_BOT_PREFIX);
}

// `count` adet, `startIndex`'ten devam eden benzersiz bot koltuğu üretir.
//
// İsimler LİSTEDEKİ SIRAYA göre değil, HER ÇAĞRIDA rastgele karıştırılıp
// baştan seçilir. Eskiden isim = BOT_DISPLAY_NAMES[startIndex % 8] idi; host
// tek başınayken (yani hemen her oyunda) startIndex hep aynı (1, 2, 3...)
// olduğu için "Kalanı Botlarla Doldur" HER SEFERİNDE birebir aynı 3 ismi
// (Mehmet, Zeynep, Ali) üretiyordu.
//
// KULLANICI İSTEĞİ: 101 Okey'de bot ZORLUK SEVİYESİ KALDIRILDI. Sebep, bunun
// gerçek bir seçim olmamasıydı: üç seviyenin de karar mantığı BİREBİR AYNIydı
// (bkz. botAI.js — tek bir arama/heuristik seti vardır, `difficulty` hiçbir
// yerde okunmuyordu), yalnızca bot İSMİNİN sonundaki etiketi değiştiriyordu.
// Artık botlar sadece "Bot <İsim>" olarak adlandırılır.
export function createBotPlayers(count, startIndex) {
  const pool = [...BOT_DISPLAY_NAMES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const bots = [];
  for (let i = 0; i < count; i++) {
    const idx = startIndex + i;
    const uid = `${OKEY_BOT_PREFIX}${idx}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const displayName = pool[i % pool.length];
    const name = `Bot ${displayName}`;
    bots.push({ uid, name });
  }
  return bots;
}
