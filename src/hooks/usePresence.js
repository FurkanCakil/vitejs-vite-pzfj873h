import { useEffect } from 'react';
import { doc, runTransaction, setDoc, deleteField } from 'firebase/firestore';
import { db, appId } from '../firebase/config.js';

// Küresel "aktif kullanıcı" dokümanı — diğer tüm oda verileriyle AYNI yol
// düzenini (artifacts/{appId}/public/data/...) kullanır.
export const presenceCounterRef = doc(db, 'artifacts', appId, 'public', 'data', 'serverStatus', 'info');

// ============================================================
// NEDEN SAYAÇ (increment) DEĞİL, "HEARTBEAT" (kalp atışı)?
// ============================================================
// İlk sürüm tek bir `activeUsers` sayısını `increment(+1)` / `increment(-1)`
// ile güncelliyordu. KULLANICI RAPORU: "sadece ben kullanırken 18 aktif oyuncu
// göründü". Kök neden yapısaldı: +1 GARANTİLİ yazılır ama -1 yalnızca sekme
// DÜZGÜNCE kapanırsa yazılabilir. Tarayıcı çökmesi, sekmenin bellek yüzünden
// atılması, internetin aniden kesilmesi, telefonda uygulamanın öldürülmesi ya
// da bir test/otomasyon oturumu -1'i kaçırır. Kaçırılan her -1 sayacı KALICI
// olarak şişirir; sayacın kendini toparlaması İMKÂNSIZDIR (geçmişi bilmez).
// Firestore'da RTDB'deki `onDisconnect` gibi sunucu taraflı bir kopma tespiti
// de yoktur, yani -1'i güvenilir kılmanın bir yolu yoktu.
//
// ÇÖZÜM: Sayı TUTMAK yerine, her sekme kendi "son görüldüm" zamanını yazar:
//   sessions: { <oturumId>: <epoch ms> }
// Aktif kullanıcı = son FRESH_MS içinde haber vermiş oturum sayısı. Böylece
// kaybolan bir sekme kendiliğinden (en geç FRESH_MS sonra) sayımdan düşer —
// sistem KENDİ KENDİNİ ONARIR, kalıcı şişme mümkün değildir.
//
// MALİYET: Tek doküman, tek dinleyici (bkz. Lobby.jsx — dinleyici yalnızca
// lobi ekranı açıkken kuruludur, oyun içinde hiç okuma olmaz). Yazma:
// kullanıcı başına 60 saniyede 1.
const HEARTBEAT_MS = 60_000;
// Bu süre içinde haber vermiş oturumlar "çevrimiçi" sayılır. Heartbeat
// aralığının yeterince üzerinde tutulur ki geçici bir ağ hıçkırığı ya da
// arka plana alınmış bir sekme (tarayıcılar arka planda zamanlayıcıları
// kısar) yanlışlıkla düşmesin.
const FRESH_MS = 150_000;
// Bu kadar eskimiş kayıtlar dokümandan TAMAMEN silinir (doküman sonsuza dek
// büyümesin diye). Sayımı zaten etkilemiyorlardı.
const PRUNE_MS = 10 * 60_000;

// Dokümandaki oturum haritasından o anki aktif kullanıcı sayısını üretir.
// Saf fonksiyon — Lobby hem ilk snapshot'ta hem de periyodik tazelemede
// (oturumlar zamanla bayatlar) bunu yeniden çağırır.
export function countActiveSessions(sessions, now = Date.now()) {
  if (!sessions || typeof sessions !== 'object') return 0;
  return Object.values(sessions).filter((t) => typeof t === 'number' && now - t < FRESH_MS).length;
}

export default function usePresence(uid) {
  useEffect(() => {
    if (!uid) return undefined;

    // Oturum kimliği SEKME BAŞINADIR (uid başına değil): aynı kullanıcı iki
    // sekme açtıysa bu gerçekten iki aktif oturumdur ve biri kapanınca
    // diğeri etkilenmemelidir.
    const sessionId = `${uid}_${Math.random().toString(36).slice(2, 10)}`;
    let stopped = false;

    const beat = async () => {
      try {
        await runTransaction(db, async (t) => {
          const snap = await t.get(presenceCounterRef);
          const now = Date.now();
          const sessions = { ...(snap.data()?.sessions || {}) };
          Object.keys(sessions).forEach((key) => {
            if (typeof sessions[key] !== 'number' || now - sessions[key] > PRUNE_MS) delete sessions[key];
          });
          sessions[sessionId] = now;
          // `activeUsers`: ESKİ (hatalı) sayaç alanı. İlk yazımda temizlenir ki
          // eski sürümden kalan şişmiş değer ortalıkta kalmasın.
          t.set(presenceCounterRef, { sessions, activeUsers: deleteField() }, { merge: true });
        });
      } catch { /* ağ/izin hatası sayacı bozmasın — bir sonraki atışta düzelir */ }
    };

    // Temiz kapanışta kendi kaydımızı hemen sileriz (sayı ANINDA düşsün).
    // Kaçırılırsa da sorun değildir: kayıt FRESH_MS sonra kendiliğinden
    // sayımdan düşer — bu tasarımın tüm amacı buydu.
    const leave = () => {
      if (stopped) return;
      stopped = true;
      setDoc(presenceCounterRef, { sessions: { [sessionId]: deleteField() } }, { merge: true }).catch(() => {});
    };

    beat();
    const interval = setInterval(() => { if (!stopped) beat(); }, HEARTBEAT_MS);
    window.addEventListener('beforeunload', leave);
    window.addEventListener('pagehide', leave);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', leave);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [uid]);
}
