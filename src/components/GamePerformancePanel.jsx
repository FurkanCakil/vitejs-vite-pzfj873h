import React, { useState } from 'react';
import { gamePerformance, gamePerformancePanelRequested } from '../utils/gamePerformance.js';

export default function GamePerformancePanel() {
  const [report, setReport] = useState(null), [enabled, setEnabled] = useState(gamePerformance.isEnabled());
  if (!gamePerformancePanelRequested) return null;
  return <details className="fixed bottom-2 right-2 z-[100000] max-w-[min(92vw,520px)] rounded bg-slate-950 text-slate-200 p-2 text-xs border border-slate-600">
    <summary>Performans ölçümü (Okey / XOX)</summary>
    <p>Yalnız bu sekmede; en çok 10 dakika / 256 örnek. Veriler bellekte tutulur.</p>
    <div className="flex gap-2 my-2">
      <button onClick={() => { gamePerformance.setEnabled(!enabled); setEnabled(!enabled); }}>{enabled ? 'Ölçümü durdur' : 'Ölçümü aç'}</button>
      <button onClick={() => { gamePerformance.clear(); setReport(null); }}>Ölçümleri temizle</button>
      <button onClick={() => setReport(gamePerformance.report())}>Ölçüm raporunu yenile</button>
      <button onClick={() => {
        const data = gamePerformance.report(); setReport(data);
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'game-performance.json';
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Ölçüm JSON indir</button>
    </div>
    {report && <textarea aria-label="Performans ölçüm raporu" readOnly value={JSON.stringify(report)} className="w-full h-40 bg-slate-900" />}
  </details>;
}
