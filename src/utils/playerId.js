// CİHAZ BAŞINA SABİT OYUNCU KİMLİĞİ (9 haneli) ve ona dayalı "masa dizilimi"
// yardımcıları.
//
// NEDEN GEREKLİ: Bir odadaki skorlar Firebase'in anonim `uid`'sine göre
// tutuluyordu ve boşalan koltuğa giren YENİ oyuncu, o koltukta bıraktığı
// skoru DEVRALIYORDU (bkz. App.tsx#attemptJoinRoom'daki "resume" dalı). Yani
// 3-1 önde biten bir XOX maçından sonra rakip çıkıp yerine bambaşka biri
// girdiğinde skor 3-1'den devam ediyordu. Kalıcı bir oyuncu kimliğiyle artık
// "masada kim var" sorusunun cevabı kişiye bağlanır: dizilim değişirse maç
// sıfırdan başlar, ESKİ dizilim geri gelirse kaldığı yerden devam eder.
//
// HANE SAYISI: 9 hane -> 9x10^8 (900 milyon) olası kimlik. İki kimliğin
// çakışması ancak o iki cihaz AYNI odada buluşursa bir anlam ifade eder;
// bu ölçekte olasılık ihmal edilebilir. Daha kısa (6-7 hane) bir kimlik
// gözle takip edilmesi kolay olsa da çakışma payını gereksiz yükseltir,
// daha uzunu ise ekranda okunmaz hale gelir.

const PLAYER_ID_KEY = 'playerId';

const randomPlayerId = () => {
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return String(100000000 + (buf[0] % 900000000));
  } catch {
    return String(100000000 + Math.floor(Math.random() * 900000000));
  }
};

// Modül içi önbellek: `localStorage` engelliyse (bkz. App.tsx'teki safeStorage
// notu) kimlik en azından SAYFA AÇIK KALDIĞI sürece sabit kalsın.
let cached = null;

export function getPlayerId() {
  if (cached) return cached;
  try {
    const saved = localStorage.getItem(PLAYER_ID_KEY);
    if (saved && /^\d{9}$/.test(saved)) { cached = saved; return cached; }
  } catch { /* depolama engelliyse yeni kimlik üret */ }
  cached = randomPlayerId();
  try { localStorage.setItem(PLAYER_ID_KEY, cached); } catch { /* yok say */ }
  return cached;
}

// Ekranda okunaklı gösterim: "123 456 789".
export function formatPlayerId(id) {
  if (!id) return '';
  return `${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6)}`;
}

// --- Masa dizilimi (lineup) -------------------------------------------------
// Bir koltuğun sahibi öncelikle KALICI oyuncu kimliğiyle temsil edilir. Botların
// (ve kimliği henüz yazılmamış eski odaların) kimliği olmadığı için sabit
// `uid`'leri yedek olarak kullanılır — bot uid'leri sabit olduğundan bu da
// kararlı bir anahtar üretir.
const tokenFor = (uid, playerIds) => (playerIds?.[uid] ? `p:${playerIds[uid]}` : `u:${uid}`);

// Masadaki oyuncu kümesini temsil eden, SIRADAN BAĞIMSIZ tek bir anahtar.
// Aynı kişiler masaya (hangi sırayla otururlarsa otursunlar) geri geldiğinde
// aynı anahtar üretilir — skorun kaldığı yerden devam etmesini sağlayan şey bu.
export function lineupKey(players, playerIds) {
  return (players || []).map((uid) => tokenFor(uid, playerIds)).sort().join('|');
}

// NOT: uid <-> token dönüşümünün ASIL uygulaması `utils/matchState.js`
// içindedir (encodeUids/decodeUids) — orası maç durumunun TAMAMINDA
// (hem anahtarlarda hem değerlerde, özyinelemeli) çalışır. Burada bir zamanlar
// aynı işi tek seviyede yapan `byToken`/`byUid` yardımcıları da vardı; hiçbir
// yerden çağrılmadıkları için kaldırıldı.
