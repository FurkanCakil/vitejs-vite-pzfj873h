// TÜM oyunların (ve lobinin) ses çıkışının geçtiği TEK merkez.
//
// NEDEN: Eskiden üç ayrı ses modülü (utils/sound.js, utils/okeySound.js,
// games/battleship/battleshipSound.js) HER BİRİ kendi `AudioContext`'ini açıp
// doğrudan `ctx.destination`'a bağlanıyordu. Bunun iki sonucu vardı:
//   1) Ses seviyesi tek bir yerden ayarlanamıyordu — "sesi kapat" tercihi
//      sadece 101 Okey'in kendi seslerini susturuyordu.
//   2) Tarayıcılar sayfa başına açılabilen AudioContext sayısını sınırlar;
//      her modülün kendi bağlamını açması gereksiz bir israftı.
// Artık TEK bir AudioContext ve TEK bir "master gain" düğümü var; her ses o
// düğümden geçtiği için ses seviyesi tüm uygulamada anında geçerli olur.
//
// Seviye 0..1 aralığında saklanır; 0 = tamamen sessiz (bkz. VolumeControl:
// çubuk tamamen sola çekilince buraya 0 yazılır).

const VOLUME_KEY = 'soundVolume';
// Bu özellikten ÖNCEKİ sürümde 101 Okey'in tek-bit ("kapalı/açık") tercihi bu
// anahtarda tutuluyordu. Sesi kapatmış bir kullanıcının tercihi güncellemeden
// sonra kaybolmasın diye, henüz bir seviye kaydı yoksa bu eski anahtar okunur.
const LEGACY_MUTE_KEY = 'okeySoundMuted';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function readInitialVolume() {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw !== null && raw !== '') {
      const n = Number(raw);
      if (Number.isFinite(n)) return clamp01(n);
    }
    if (localStorage.getItem(LEGACY_MUTE_KEY) === '1') return 0;
  } catch { /* depolama engelliyse varsayılana düş */ }
  return 1;
}

let volume = readInitialVolume();
let ctx = null;
let master = null;
const listeners = new Set();

export function getVolume() { return volume; }
export function isMuted() { return volume <= 0; }

export function setVolume(next) {
  const v = clamp01(Number(next) || 0);
  if (v === volume) return;
  volume = v;
  try { localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* yok say */ }
  if (master && ctx) {
    // `setValueAtTime` yerine kısa bir rampa: sürgü sürüklenirken her adımda
    // ani sıçrama yapılırsa o an çalan sesler "çıt" diye kırılır.
    try { master.gain.setTargetAtTime(v, ctx.currentTime, 0.01); } catch { /* yok say */ }
  }
  listeners.forEach((fn) => { try { fn(v); } catch { /* dinleyici hatası sesi bozmasın */ } });
}

// React tarafının (ses simgesi/çubuk) durumu takip edebilmesi için abonelik.
export function subscribeVolume(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Paylaşılan AudioContext. Tarayıcılar kullanıcı etkileşimi olmadan başlatılan
// bağlamları askıya alır; her çalmadan önce devam ettirmeyi deneriz.
export function getAudioContext() {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.setValueAtTime(volume, ctx.currentTime);
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

// Tüm ses modülleri son gain düğümlerini BURAYA bağlar (ctx.destination'a
// DEĞİL) — ses seviyesinin tek noktadan yönetilmesini sağlayan şey budur.
export function getMaster() {
  if (!master) getAudioContext();
  return master;
}
