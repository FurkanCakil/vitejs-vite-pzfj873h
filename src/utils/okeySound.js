// 101 Okey'e özel ses efektleri. Hepsi Web Audio ile SENTEZLENİR (dosya/asset
// yok) — gerçek bir okey masasındaki tahta/plastik taş seslerini taklit eder.
//
// TASARIM NOTU (v2 — "dijital" hissi düzeltildi): İlk sürüm bir osilatörün
// (üçgen dalga) SAF TONUNU "gövde rezonansı" olarak kullanıyordu; saf bir ton
// kulağa kaçınılmaz olarak sentetik/dijital gelir — gerçek hiçbir katı cisim
// öyle titreşmez. Artık HİÇBİR osilatör YOK: her ses tamamen FİLTRELENMİŞ
// GÜRÜLTÜ katmanlarından oluşuyor (çarpma + gövde + tok/thump), tıpkı gerçek
// foley kayıtlarının çalışma mantığı gibi. Bu hem daha organik/tahtamsı hem
// de daha KISA/toktur (gereksiz "çınlama" yok).
let ctx = null;
let noiseBuffer = null;

function audio() {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Tarayıcılar, kullanıcı etkileşimi olmadan başlatılan bağlamları askıya
    // alır; her çalmadan önce devam ettirmeyi deneriz.
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
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

function noiseBurst(ac, t0, { type = 'bandpass', freq, q = 2, vol, dur }) {
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const filt = ac.createBiquadFilter();
  filt.type = type; filt.frequency.setValueAtTime(freq, t0); if (q !== undefined) filt.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filt); filt.connect(g); g.connect(ac.destination);
  src.start(t0); src.stop(t0 + dur);
}

// Tek bir "tahta/kemik taş" tıkırtısı — HER ZAMAN filtrelenmiş gürültüden
// kurulur (saf osilatör tonu YOK), üç katman:
//   1) crack : çok kısa, tiz, highpass'lı gürültü — çarpmanın "kenarı"
//   2) body  : bandpass'lı gürültü rezonansı — taşın "dolu" gövdesi
//   3) thump : kısa, alçak bandpass — masaya/ıstakaya değme ağırlığı
//   freq  : gövde/filtre merkez frekansı (yüksek = daha ince ses)
//   vol   : 0..1 tepe ses seviyesi
//   dur   : toplam süre (sn) — bilerek KISA tutulur (gerçek tık ~40-90ms)
//   at    : bağlam zamanına göre gecikme (sn) — art arda tık dizmek için
function woodClick(ac, { freq = 1000, vol = 0.35, dur = 0.06, at = 0 } = {}) {
  const t0 = ac.currentTime + at;
  noiseBurst(ac, t0, { type: 'highpass', freq: freq * 1.9, q: 0.7, vol: vol * 0.55, dur: dur * 0.35 });
  noiseBurst(ac, t0, { type: 'bandpass', freq, q: 3.4, vol, dur });
  noiseBurst(ac, t0, { type: 'bandpass', freq: freq * 0.3, q: 1.1, vol: vol * 0.6, dur: dur * 0.8 });
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
  lp.frequency.setValueAtTime(2600, t0);
  lp.frequency.exponentialRampToValueAtTime(320, t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.18); // hızlı yüksel
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);     // sonra sön
  src.connect(lp); lp.connect(g); g.connect(ac.destination);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

// Rastgele aralık/tonda bir tık dizisi — "taşların devrilmesi" (tur sonu) ve
// "taşların dağıtılması" (el başı) için. Toplam algılanan süre `spread + dur`
// civarındadır; gerçek bir okey masasındaki taş dağıtma/karıştırma sesi gibi
// KISA ve YOĞUN olsun diye 1 saniyeyi geçmeyecek şekilde ayarlanmıştır.
function clatter(ac, { count, spread, freq, vol, dur }) {
  for (let i = 0; i < count; i++) {
    woodClick(ac, {
      freq: freq * (0.75 + Math.random() * 0.6),
      vol: vol * (0.6 + Math.random() * 0.4),
      dur: dur * (0.8 + Math.random() * 0.4),
      at: Math.random() * spread,
    });
  }
}

export const OKEY_SOUNDS = {
  // Istakadaki taşa dokunma / sürükleyip bırakma — kalın, gövdeli tık.
  tile: (ac) => woodClick(ac, { freq: 800, vol: 0.34, dur: 0.055 }),
  // Masaya taş atma (kendi atışımız ve solumuzdakinin bize attığı taş) —
  // aynı tahta ailesi ama belirgin şekilde İNCE.
  discard: (ac) => woodClick(ac, { freq: 1900, vol: 0.3, dur: 0.045 }),
  // Okey'i uzun basıp ters çevirme — çok kısık, kısa bir çevirme sesi.
  flip: (ac) => woodClick(ac, { freq: 2600, vol: 0.1, dur: 0.035 }),
  // Eli ortaya açma — kısa, sönen rüzgar.
  open: (ac) => windSweep(ac, { dur: 0.55, vol: 0.16 }),
  // El bitti — taşlar devriliyor (kısa, yoğun tıkırtı).
  roundEnd: (ac) => clatter(ac, { count: 12, spread: 0.4, freq: 950, vol: 0.28, dur: 0.05 }),
  // El başlıyor — taşlar dağıtılıyor. GERÇEK bir okey masasındaki gibi kısa
  // ve yoğun: toplam süre ~0.75sn'yi (eski sürümde 1.1sn+ idi) geçmez.
  deal: (ac) => clatter(ac, { count: 13, spread: 0.55, freq: 1150, vol: 0.24, dur: 0.045 }),
};

// 101 Okey ses efektlerini çalar. Bilinmeyen bir tür ya da desteklenmeyen /
// engellenmiş bir ses bağlamı sessizce yok sayılır — ses ASLA oyunu bozmaz.
export function playOkeySound(type) {
  try {
    const fn = OKEY_SOUNDS[type];
    if (!fn) return;
    const ac = audio();
    if (!ac) return;
    fn(ac);
  } catch { /* ses hiçbir zaman oyun akışını engellemesin */ }
}
