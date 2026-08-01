import { useEffect } from 'react';
import { doc, setDoc, increment } from 'firebase/firestore';
import { db, appId } from '../firebase/config.js';

// Küresel "aktif kullanıcı" sayacının tek dokümanı — diğer tüm oda verileriyle
// AYNI yol düzenini (artifacts/{appId}/public/data/...) kullanır, böylece
// mevcut Firestore güvenlik kurallarının (rooms için zaten çalışan) kapsamına
// girer, ayrıca YENİ bir kural eklemeye gerek kalmaz.
export const presenceCounterRef = doc(db, 'artifacts', appId, 'public', 'data', 'serverStatus', 'info');

// NOT (mimari kısıt): Bu proje sadece Firestore kullanıyor, Realtime Database
// (RTDB) kurulu DEĞİL — Firestore'da RTDB'deki `onDisconnect` gibi SUNUCU
// TARAFLI "bağlantı koptu" tespiti YOKTUR. Bu yüzden azaltma (-1) İSTEMCİ
// TARAFLI en iyi çaba (best-effort) ile yapılır: normal kapanışlarda (sekmeyi
// kapatma, sayfadan ayrılma, React unmount) kusursuz çalışır; SADECE tarayıcı/
// işlem çökmesi ya da ani elektrik/ağ kesintisi gibi TAMAMEN anormal
// durumlarda sayaç bir süre yüksek kalabilir (drift) — bunu garantili
// önlemenin tek yolu RTDB + onDisconnect (ya da Cloud Functions) olurdu.
//
// Bu hook SADECE bu tekil dokümana YAZAR (setDoc + increment) — hiçbir okuma
// (onSnapshot/getDoc) YAPMAZ, okuma maliyeti sıfırdır. Sayacı GÖSTERMEK için
// ayrı ve sadece Lobby görünürken aktif olan bir onSnapshot kullanılır (bkz.
// Lobby.jsx) — böylece oyun içindeyken bu okuma hiç çalışmaz.
export default function usePresence(uid) {
  useEffect(() => {
    if (!uid) return undefined;

    let settled = false;
    const decrement = () => {
      if (settled) return;
      settled = true;
      // `merge: true`: doküman hiç yoksa (ilk kullanıcı) sorunsuz oluşturur;
      // `increment()` eksik/yok bir alanı da güvenle 0'dan başlatır.
      setDoc(presenceCounterRef, { activeUsers: increment(-1) }, { merge: true }).catch(() => {});
    };

    setDoc(presenceCounterRef, { activeUsers: increment(1) }, { merge: true }).catch(() => {});

    // `pagehide`, `beforeunload`'a göre mobil Safari/iOS dahil sekme kapatma
    // gibi durumlarda daha güvenilir tetiklenir; ikisi BİRDEN dinlenip HANGİSİ
    // önce ateşlerse o sayılır (`settled` bayrağı ikinci kez azaltmayı engeller).
    window.addEventListener('beforeunload', decrement);
    window.addEventListener('pagehide', decrement);

    return () => {
      window.removeEventListener('beforeunload', decrement);
      window.removeEventListener('pagehide', decrement);
      decrement();
    };
  }, [uid]);
}
