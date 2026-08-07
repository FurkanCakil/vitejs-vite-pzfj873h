// 101 Okey'e özel ses efektleri. Hepsi Web Audio ile SENTEZLENİR (dosya/asset
// yok) — gerçek bir okey masasındaki tahta taş seslerini taklit eder.
//
// TASARIM NOTU (v3 — "cız" hissi düzeltildi):
//   v1: gövde için SAF OSİLATÖR tonu kullanıyordu -> sentetik/dijital duyuluyordu.
//   v2: osilatör kalktı ama gövde YÜKSEK Q'lu bandpass + tiz highpass "kenar"
//       katmanıyla kuruluyordu. Yüksek Q dar bir bant demektir ve dar bant
//       gürültü ISLIK gibi ÇINLAR; üstelik 1.5kHz+ highpass katmanı tıslama
//       (hiss) ekliyordu. İkisi birlikte kulakta "cıız" olarak duyuluyordu.
//   v3 (bu sürüm): TOK bir tahta darbesi için doğru reçete —
//       * merkez frekanslar belirgin şekilde AŞAĞI çekildi (tiz değil, gövdeli),
//       * Q düşürüldü (geniş bant = çınlamayan, "tak" gibi kuru bir vuruş),
//       * ana katman LOWPASS'tır (tıslamayı komple keser),
//       * tiz "kenar" katmanı ya kaldırıldı ya da duyulur-duyulmaz seviyeye
//         indirildi (sadece darbenin başlangıcına netlik katsın diye).
// Ses bağlamı ve seviye kontrolü artık UYGULAMA GENELİNDE tek merkezden gelir
// (bkz. utils/audioBus.js): eskiden bu modülün kendine ait bir AudioContext'i,
// kendi master gain'i ve kendi "kapalı/açık" tercihi vardı — o tercih sadece
// 101 Okey'in seslerini etkiliyordu. Artık lobideki/oyunlardaki tek ses
// çubuğu bütün oyunların sesini birlikte yönetir.
import { getAudioContext, getMaster, isMuted } from './audioBus.js';

let noiseBuffer = null;

// NOT: Bu dosyada bir zamanlar 101 Okey'in ESKİ aç/kapa düğmesi için
// `isOkeySoundMuted`/`setOkeySoundMuted`/`subscribeOkeySoundMuted` sarmalayıcıları
// vardı. O düğme kaldırılıp yerini uygulama geneli ses çubuğuna bıraktığından
// (bkz. components/VolumeControl.jsx + utils/audioBus.js) hiçbir yerden
// çağrılmıyorlardı; kaldırıldılar.

function audio() {
  return getAudioContext();
}

// Beyaz gürültü tamponu (bir kez üretilip tüm efektlerde paylaşılır).
function noise(ac) {
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(ac.sampleRate * 0.4);
  noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function noiseBurst(ac, t0, { type = 'lowpass', freq, q, vol, dur }) {
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const filt = ac.createBiquadFilter();
  filt.type = type;
  filt.frequency.setValueAtTime(freq, t0);
  if (q !== undefined) filt.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  src.connect(filt); filt.connect(g); g.connect(getMaster());
  src.start(t0); src.stop(t0 + dur);
}

// Tek bir TOK tahta darbesi ("tak"). Üç geniş bantlı katman:
//   1) body  : alçak-orta bandpass, DÜŞÜK Q -> çınlamayan gövde
//   2) thump : lowpass -> darbenin ağırlığı/tokluğu (tıslama yok)
//   3) edge  : çok kısık, çok kısa üst-orta dokunuş -> vuruşun netliği
//   freq : gövde merkez frekansı (yüksek = daha ince ama HÂLÂ tok)
function woodClick(ac, { freq = 400, vol = 0.4, dur = 0.055, at = 0 } = {}) {
  const t0 = ac.currentTime + at;
  noiseBurst(ac, t0, { type: 'bandpass', freq, q: 1.3, vol, dur });
  noiseBurst(ac, t0, { type: 'lowpass', freq: freq * 1.6, q: 0.6, vol: vol * 0.95, dur: dur * 0.8 });
  noiseBurst(ac, t0, { type: 'bandpass', freq: freq * 3.4, q: 0.9, vol: vol * 0.1, dur: dur * 0.22 });
}

// Alçalan/sönümlenen kısa rüzgar (eli masaya açma anı). Lowpass'ı süpürerek
// "fışş" sesini yumuşatır; bilerek kısık tutulur.
function windSweep(ac, { dur = 0.55, vol = 0.16 } = {}) {
  const t0 = ac.currentTime;
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  src.loop = true;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2200, t0);
  lp.frequency.exponentialRampToValueAtTime(280, t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.18); // hızlı yüksel
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);     // sonra sön
  src.connect(lp); lp.connect(g); g.connect(getMaster());
  src.start(t0); src.stop(t0 + dur + 0.02);
}

// Bir tık dizisi. `spread` toplam yayılma süresi, `count` tık sayısı.
//
// Tıklar RASTGELE değil, EŞİT ARALIKLARLA (her birine küçük bir rastgele
// kayma eklenerek) dizilir: saf rastgele dağılımda tıklar sık sık üst üste
// binip "tek bir cascade gürültüsü" gibi duyuluyordu. Eşit aralık, gerçek bir
// dağıtımdaki gibi ayrı ayrı seçilebilen "tak ... tak ... tak" ritmi verir —
// TOPLAM SÜREYİ UZATMADAN araları açar.
function clatter(ac, { count, spread, freq, vol, dur }) {
  const step = spread / Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    const jitter = (Math.random() - 0.5) * step * 0.45;
    woodClick(ac, {
      freq: freq * (0.82 + Math.random() * 0.42),
      vol: vol * (0.7 + Math.random() * 0.3),
      dur: dur * (0.85 + Math.random() * 0.3),
      at: Math.max(0, i * step + jitter),
    });
  }
}

export const OKEY_SOUNDS = {
  // Istakadaki taşa dokunma / sürükleyip bırakma — en kalın, en tok tık.
  tile: (ac) => woodClick(ac, { freq: 340, vol: 0.42, dur: 0.06 }),
  // Desteden ya da soldan taş ÇEKME — dokunmadan biraz daha canlı ama yine tok.
  draw: (ac) => woodClick(ac, { freq: 470, vol: 0.38, dur: 0.055 }),
  // Masaya taş atma (kendi atışımız ve solumuzdakinin bize attığı taş) —
  // aynı tahta ailesi ama belirgin şekilde İNCE (yine de çınlamayan).
  discard: (ac) => woodClick(ac, { freq: 700, vol: 0.36, dur: 0.05 }),
  // Okey'i uzun basıp ters çevirme — çok kısık, kısa bir çevirme sesi.
  flip: (ac) => woodClick(ac, { freq: 950, vol: 0.13, dur: 0.04 }),
  // Eli ortaya açma — kısa, sönen rüzgar.
  open: (ac) => windSweep(ac, { dur: 0.55, vol: 0.16 }),
  // El bitti — taşlar devriliyor (kısa, yoğun tıkırtı).
  roundEnd: (ac) => clatter(ac, { count: 11, spread: 0.42, freq: 420, vol: 0.32, dur: 0.055 }),
  // El başlıyor — taşlar dağıtılıyor. Tık SAYISI azaltıldı (13 -> 9) ama
  // yayılma AYNI kaldı: böylece toplam süre uzamadan tıklar arası boşluk
  // belirgin şekilde açıldı (kullanıcı isteği: "biraz yavaşlat ama süreyi uzatma").
  deal: (ac) => clatter(ac, { count: 9, spread: 0.55, freq: 460, vol: 0.3, dur: 0.055 }),
  // Taş İŞLEME (açık bir pere tek taş ekleme / Okey çalma) — KULLANICI
  // İSTEĞİ: belirgin bir ses değil, "cılız" (çok dikkat çekmeyen) bir taş
  // koyma tıkırtısı. `tile`/`draw`/`discard` ile aynı aileden ama en düşük
  // sesli varyant (flip'ten bile daha kısık).
  tack: (ac) => woodClick(ac, { freq: 520, vol: 0.11, dur: 0.045 }),
};

// 101 Okey ses efektlerini çalar. Bilinmeyen bir tür ya da desteklenmeyen /
// engellenmiş bir ses bağlamı sessizce yok sayılır — ses ASLA oyunu bozmaz.
export function playOkeySound(type) {
  try {
    if (isMuted()) return; // susturulmuşken ses bağlamını hiç uyandırma
    const fn = OKEY_SOUNDS[type];
    if (!fn) return;
    const ac = audio();
    if (!ac) return;
    fn(ac);
  } catch { /* ses hiçbir zaman oyun akışını engellemesin */ }
}
