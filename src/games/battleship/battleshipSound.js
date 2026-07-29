// Amiral Battı'ya özel, GERÇEKÇİ silah/patlama/su sesleri. Hepsi Web Audio ile
// SENTEZLENİR (dosya/asset yok) — src/utils/sound.js'teki jenerik saf-osilatör
// biplerinin aksine, gerçek bir top/patlama/su sesine yaklaşmak için GÜRÜLTÜ
// TABANLI (noise-based) sentezleme kullanılır (bkz. okeySound.js'teki aynı
// teknik: filtrelenmiş beyaz gürültü darbeleri).
//
// OYUN KURALIYLA İLGİLİ ÖNEMLİ NOT: Bir gemi TAMAMEN battığında SALDIRAN
// oyuncuya bunu belli eden farklı/özel bir ses YOKTUR — geminin son parçası
// olsun ya da olmasın HER İsabet tamamen AYNI patlama sesini üretir. Aksi
// halde ses, kaldırılan görsel/bildirim ipucunun yerine geçip "bu gemi tam
// battı" bilgisini yine de sızdırırdı (bkz. BattleshipGame.jsx'teki ilgili
// yorum). Sadece geminin SAHİBİNİN kendi ekranında (kendi tahtası zaten
// tamamen görünür olduğu için bilgi sızıntısı olmadan) çalan `ownShipSunk`
// bu kuralın istisnasıdır.
let ctx = null;
let noiseBuffer = null;

function audio() {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

// Beyaz gürültü tamponu (bir kez üretilip tüm efektlerde paylaşılır).
function noise(ac) {
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(ac.sampleRate * 1.2);
  noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

// Hafif bozunma (waveshaper) eğrisi — bir kez üretilip paylaşılır. Temiz
// filtrelenmiş gürültü tek başına kulağa "sentetik/dijital" geliyordu; gerçek
// patlamalardaki pürüzlü/kirli doku için tanh tabanlı yumuşak bir "grit"
// eklenir (bkz. `noiseBurst`'teki `drive` parametresi).
let distortionCurve = null;
function getDistortionCurve() {
  if (distortionCurve) return distortionCurve;
  const n = 2048;
  const amount = 24;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  distortionCurve = curve;
  return curve;
}

// Filtrelenmiş, sönümlenen bir gürültü darbesi. `freqEnd` verilirse filtre
// frekansı süre boyunca `freq`'ten `freqEnd`'e süpürülür (patlama/silah
// seslerindeki karakteristik "yüksekten alçağa düşen" doku için). `drive`
// (0'dan büyükse) darbeyi hafifçe bozarak (waveshaper) temiz/sentetik
// hissi kırar — gerçek bir patlamanın pürüzlü dokusunu taklit eder.
function noiseBurst(ac, t0, { type = 'lowpass', freq, freqEnd, q, vol, dur, drive = 0 }) {
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const filt = ac.createBiquadFilter();
  filt.type = type;
  filt.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== undefined) filt.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t0 + dur);
  if (q !== undefined) filt.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.01, dur * 0.08));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filt);
  if (drive > 0) {
    const shaper = ac.createWaveShaper();
    shaper.curve = getDistortionCurve();
    shaper.oversample = '2x';
    filt.connect(shaper); shaper.connect(g);
  } else {
    filt.connect(g);
  }
  g.connect(ac.destination);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

// Kısa, alçak frekanslı "tok" darbe — patlama/atışın göğüste hissedilen
// gövdesi (saf sinüs; gürültü katmanlarına düşük-frekans ağırlık katar).
function thump(ac, t0, { freq = 90, vol = 0.7, dur = 0.18 } = {}) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.4), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  osc.connect(g); g.connect(ac.destination);
  osc.start(t0); osc.stop(t0 + dur);
}

// --- ATIŞ: top/tüfek sesi ("bang") ------------------------------------------
// Gerçek bir silah sesi genelde İKİ katmandan oluşur: anlık YÜKSEK FREKANSLI
// bir "crack" (patlama anının keskin tıngırtısı) + hemen ardından alçak
// frekansta kısa bir namlu/gövde darbesi. Saf sinüs yerine gürültü kullanmak
// elektronik/dijital değil GERÇEK bir silah izlenimi verir.
function gunshot(ac) {
  const t0 = ac.currentTime;
  noiseBurst(ac, t0, { type: 'bandpass', freq: 3200, freqEnd: 900, q: 0.7, vol: 0.9, dur: 0.05 });
  noiseBurst(ac, t0, { type: 'lowpass', freq: 1100, freqEnd: 220, q: 0.8, vol: 0.55, dur: 0.14 });
  thump(ac, t0, { freq: 130, vol: 0.5, dur: 0.14 });
}

// Alt-bas "whoomp" — bir osilatör hızla yukarıdan aşağı çekilerek patlamanın
// göğüste hissedilen ağırlığını verir (saf gürültü tek başına bunu asla
// veremez; bu katman olmadan patlama "ince" ve yapay kalıyordu).
function subBoom(ac, t0, { freq = 160, freqEnd = 32, vol = 0.9, dur = 0.42 } = {}) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
  osc.connect(g); g.connect(ac.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

// --- İSABET: gemiye çarpan gülle + patlama ----------------------------------
// Gerçek bir patlama BEŞ katmandan oluşur (eski sürüm sadece 1-2 temiz
// gürültü süpürmesiyle "mekanik/dijital" kalıyordu):
//   1) Ani çarpma/tutuşma çatırtısı — çok kısa, keskin.
//   2) Alt-bas "whoomp" (subBoom) — göğüste hissedilen ağırlık.
//   3) Ana gövde — HAFİF BOZUNMUŞ (drive) geniş bant gürültü; bu "kirli" doku
//      temiz filtrelenmiş gürültünün sentetik hissini kırıp gerçek bir
//      patlamanın pürüzlü karakterini verir.
//   4) Uzun, alçak "gürleme" kuyruğu — su üstünde yayılan yankı hissi.
//   5) Rastgele zamanlanmış enkaz/metal parçalanma tıkırtıları.
function explosionHit(ac) {
  const t0 = ac.currentTime;
  noiseBurst(ac, t0, { type: 'bandpass', freq: 3600, freqEnd: 1200, q: 0.8, vol: 0.65, dur: 0.035 });
  subBoom(ac, t0, { freq: 160, freqEnd: 32, vol: 1, dur: 0.42 });
  noiseBurst(ac, t0 + 0.01, { type: 'lowpass', freq: 2200, freqEnd: 70, q: 0.6, vol: 0.9, dur: 0.6, drive: 12 });
  noiseBurst(ac, t0 + 0.05, { type: 'lowpass', freq: 500, freqEnd: 45, q: 0.4, vol: 0.32, dur: 0.9 });
  const debrisCount = 6;
  for (let i = 0; i < debrisCount; i++) {
    const at = 0.05 + i * (0.05 + Math.random() * 0.06);
    noiseBurst(ac, t0 + at, { type: 'bandpass', freq: 1500 + Math.random() * 2200, q: 3 + Math.random() * 3, vol: 0.1 + Math.random() * 0.08, dur: 0.03 + Math.random() * 0.03 });
  }
}

// --- IŞKA: suya düşen gülle (su sıçraması) ----------------------------------
function splashMiss(ac) {
  const t0 = ac.currentTime;
  noiseBurst(ac, t0, { type: 'lowpass', freq: 900, freqEnd: 200, q: 0.9, vol: 0.55, dur: 0.16 });
  noiseBurst(ac, t0 + 0.02, { type: 'bandpass', freq: 2600, freqEnd: 1200, q: 0.6, vol: 0.28, dur: 0.35 });
  noiseBurst(ac, t0 + 0.05, { type: 'lowpass', freq: 500, freqEnd: 150, q: 0.5, vol: 0.16, dur: 0.5 });
}

// --- KENDİ GEMİM BATTI: daha büyük/dramatik çift patlama --------------------
// Sadece geminin SAHİBİNİN kendi ekranında çalar (bkz. dosya başı notu).
function ownShipSunk(ac) {
  explosionHit(ac);
  const t0 = ac.currentTime + 0.22;
  noiseBurst(ac, t0, { type: 'lowpass', freq: 2000, freqEnd: 70, q: 0.5, vol: 0.8, dur: 0.7 });
  thump(ac, t0, { freq: 60, vol: 0.75, dur: 0.55 });
}

const SOUNDS = { shoot: gunshot, hit: explosionHit, miss: splashMiss, ownShipSunk };

export function playBattleshipSound(type) {
  try {
    const fn = SOUNDS[type];
    if (!fn) return;
    const ac = audio();
    if (!ac) return;
    fn(ac);
  } catch { /* ses hiçbir zaman oyunu bozmasın */ }
}
