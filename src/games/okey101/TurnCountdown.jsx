import React, { useEffect, useState } from 'react';

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
export default function TurnCountdown({ deadline, active }) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!active || !deadline) { setRemaining(null); return; }
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [deadline, active]);

  if (remaining === null) return null;

  return (
    <span className={`font-mono text-[10px] sm:text-xs px-2 py-0.5 rounded-full border tabular-nums ${remaining <= 10 ? 'text-red-300 border-red-500/50 bg-red-500/10' : 'text-slate-400 border-slate-600 bg-slate-900/50'}`}>
      {remaining}s
    </span>
  );
}
