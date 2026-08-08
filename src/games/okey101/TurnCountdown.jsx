import React, { useEffect, useRef, useState } from 'react';
import { playOkeySound } from '../../utils/okeySound.js';

// Uyarı sesinin çalacağı saniyeler: 10'da bir kez "yaklaşıyor", son 5 saniyede
// her saniye "bitiyor". (bkz. okeySound#timeWarn/timeTick)
const WARN_AT = 10;
const URGENT_FROM = 5;

// PERFORMANS (KRİTİK): Tur geri sayımı eskiden Okey101Game'in KENDİ state'iydi
// ve her 250ms'de bir güncelleniyordu. Okey101Game ise masanın TAMAMINI
// (rakip koltukları, açılan eller paneli ve 30 slotluk ıstakasıyla PlayerRack
// dahil) render eden çok büyük bir bileşen; yani oyun boyunca SANİYEDE 4 KEZ
// tüm masa yeniden çiziliyordu. Taş sürüklerken/atarken hissedilen takılmanın
// en büyük kaynağı buydu (sürükleme sırasında her karede araya bu render'lar
// giriyordu).
//
// Sayaç artık kendi küçük bileşeninde yaşıyor: 250ms'lik tik SADECE bu
// rozeti yeniden çizer, masanın geri kalanına hiç dokunmaz.
//
// `warn` yalnızca SIRA BENDEYKEN true'dur: geri sayım rozeti rakip oynarken de
// görünür ama uyarı sesi sadece kendi hamlemde çalar.
export default function TurnCountdown({ deadline, active, warn = false }) {
  const [remaining, setRemaining] = useState(null);
  // Sayaç 250ms'de bir tıkladığı için aynı saniye 4 kez görülür; en son ses
  // çalınan saniyeyi tutup her saniye TEK bip garantiler.
  const lastBeepSecRef = useRef(null);

  useEffect(() => {
    if (!active || !deadline) { setRemaining(null); return; }
    // İlk tik sesSİZdir: normal akışta tur 45sn'den başlar, yani uyarı
    // bölgesinde değildir. Bileşen tur ortasında yeniden kurulursa (yeniden
    // bağlanma, sıra rozetinin yeniden takılması) geçmiş saniyelerin sesi
    // toplu halde patlamaz.
    let first = true;
    lastBeepSecRef.current = null;
    const tick = () => {
      const sec = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(sec);
      const wasFirst = first;
      first = false;
      if (!warn || wasFirst || sec === lastBeepSecRef.current) return;
      if (sec === WARN_AT) { lastBeepSecRef.current = sec; playOkeySound('timeWarn'); }
      else if (sec >= 1 && sec <= URGENT_FROM) { lastBeepSecRef.current = sec; playOkeySound('timeTick'); }
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [deadline, active, warn]);

  if (remaining === null) return null;

  return (
    <span className={`font-mono text-[10px] sm:text-xs px-2 py-0.5 rounded-full border tabular-nums ${remaining <= 10 ? 'text-red-300 border-red-500/50 bg-red-500/10' : 'text-slate-400 border-slate-600 bg-slate-900/50'}`}>
      {remaining}s
    </span>
  );
}
