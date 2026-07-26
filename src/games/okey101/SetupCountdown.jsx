import React, { useEffect, useState } from 'react';

// Hazırlık fazında ekranın üst-ortasında akan büyük geri sayım.
export default function SetupCountdown({ setupEndsAt }) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!setupEndsAt) { setRemaining(null); return; }
    const tick = () => setRemaining(Math.max(0, Math.ceil((setupEndsAt - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [setupEndsAt]);

  if (remaining === null || remaining <= 0) return null;

  return (
    <div className="w-full flex justify-center mb-2">
      <div className="bg-slate-900/95 border border-amber-500/50 rounded-2xl px-8 py-4 text-center shadow-2xl">
        <div className="text-[11px] sm:text-xs text-amber-300 font-bold uppercase tracking-widest mb-1">Taşlarını Dizmek İçin Kalan Süre</div>
        <div className="text-4xl sm:text-5xl font-black text-white tabular-nums">{remaining}</div>
      </div>
    </div>
  );
}
