// 101 Okey'e özel ses efektleri. Hepsi Web Audio ile SENTEZLENİR (dosya/asset
// yok) — gerçek bir okey masasındaki tahta taş seslerini taklit eder.
//
// Tasarım notu: bir "tahta tık" sesi = çok kısa bir gürültü patlaması (taşın
// çarpma anı) + hızla sönen bir gövde tonu (tahtanın rezonansı). Bandpass
// filtrenin merkez frekansı sesin KALINLIĞINI belirler: ıstakadaki taşa
// dokunmak kalın/gövdeli, masaya taş atmak daha İNCE bir tık çıkarır.

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

// Tek bir "tahta taş" tıkırtısı.
//   freq  : gövde/filtre merkez frekansı (yüksek = daha ince ses)
//   vol   : 0..1 tepe ses seviyesi
//   dur   : toplam süre (sn)
//   at    : bağlam zamanına göre gecikme (sn) — art arda tık dizmek için
function woodClick(ac, { freq = 900, vol = 0.35, dur = 0.075, at = 0 } = {}) {
  const t0 = ac.currentTime + at;

  // 1) Çarpma anı: bandpass'tan geçen kısa gürültü patlaması.
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.setValueAtTime(freq, t0); bp.Q.value = 1.6;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(vol, t0);
  ng.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 0.55);
  src.connect(bp); bp.connect(ng); ng.connect(ac.destination);
  src.start(t0); src.stop(t0 + dur);

  // 2) Tahta gövdesinin kısa rezonansı — sesin "boş/plastik" değil DOLU
  //    duyulmasını sağlar.
  const osc = ac.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq * 0.42, t0);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.26, t0 + dur);
  const og = ac.createGain();
  og.gain.setValueAtTime(vol * 0.55, t0);
  og.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(og); og.connect(ac.destination);
  osc.start(t0); osc.stop(t0 + dur);
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
// "taşların dağıtılması" (el başı) için.
function clatter(ac, { count, spread, freq, vol, dur }) {
  for (let i = 0; i < count; i++) {
    woodClick(ac, {
      freq: freq * (0.8 + Math.random() * 0.5),
      vol: vol * (0.65 + Math.random() * 0.35),
      dur,
      at: Math.random() * spread,
    });
  }
}

export const OKEY_SOUNDS = {
  // Istakadaki taşa dokunma / sürükleyip bırakma — kalın, gövdeli tık.
  tile: (ac) => woodClick(ac, { freq: 760, vol: 0.32, dur: 0.08 }),
  // Masaya taş atma (kendi atışımız ve solumuzdakinin bize attığı taş) —
  // aynı tahta ailesi ama belirgin şekilde İNCE.
  discard: (ac) => woodClick(ac, { freq: 1750, vol: 0.3, dur: 0.06 }),
  // Okey'i uzun basıp ters çevirme — çok kısık, kısa bir çevirme sesi.
  flip: (ac) => woodClick(ac, { freq: 2400, vol: 0.11, dur: 0.05 }),
  // Eli ortaya açma — kısa, sönen rüzgar.
  open: (ac) => windSweep(ac, { dur: 0.55, vol: 0.16 }),
  // El bitti — taşlar devriliyor.
  roundEnd: (ac) => clatter(ac, { count: 14, spread: 0.5, freq: 900, vol: 0.3, dur: 0.07 }),
  // El başlıyor — taşlar dağıtılıyor (daha seyrek, daha uzun).
  deal: (ac) => clatter(ac, { count: 18, spread: 1.1, freq: 1100, vol: 0.24, dur: 0.06 }),
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
