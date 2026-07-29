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

// Filtrelenmiş, sönümlenen bir gürültü darbesi. `freqEnd` verilirse filtre
// frekansı süre boyunca `freq`'ten `freqEnd`'e süpürülür (patlama/silah
// seslerindeki karakteristik "yüksekten alçağa düşen" doku için).
function noiseBurst(ac, t0, { type = 'lowpass', freq, freqEnd, q, vol, dur }) {
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
  src.connect(filt); filt.connect(g); g.connect(ac.destination);
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

// --- İSABET: gemiye çarpan gülle + patlama ----------------------------------
// Gunshot'tan daha UZUN ve daha ALÇAK — geniş bir "boom", ardından kısa bir
// enkaz/metal parçalanma tıkırtısı.
function explosionHit(ac) {
  const t0 = ac.currentTime;
  noiseBurst(ac, t0, { type: 'lowpass', freq: 2600, freqEnd: 90, q: 0.5, vol: 1, dur: 0.55 });
  noiseBurst(ac, t0, { type: 'bandpass', freq: 2200, freqEnd: 1400, q: 1.1, vol: 0.5, dur: 0.06 });
  thump(ac, t0, { freq: 75, vol: 0.85, dur: 0.42 });
  // Enkaz/metal parçalanma tıkırtısı: birkaç kısa, dağınık yüksek-frekans tık.
  for (let i = 0; i < 5; i++) {
    const at = 0.05 + i * (0.05 + Math.random() * 0.05);
    noiseBurst(ac, t0 + at, { type: 'highpass', freq: 1800 + Math.random() * 1200, q: 2.2, vol: 0.12, dur: 0.05 });
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
