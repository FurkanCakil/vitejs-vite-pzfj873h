import React from 'react';
import { Users, X } from 'lucide-react';

export default function LeftOverlay({ leftOverlayTimer, setLeftOverlayTimer }) {
  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/80 flex flex-col items-center justify-center backdrop-blur-sm p-4 h-[100dvh]">
      <div className="bg-slate-800 p-8 rounded-2xl border border-slate-600 shadow-2xl flex flex-col items-center max-w-sm w-full relative transition-all duration-300 transform scale-100 opacity-100">
        <button onClick={() => setLeftOverlayTimer(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"><X className="w-6 h-6" /></button>
        <Users className="w-16 h-16 text-red-400 mb-4 opacity-80" />
        <h2 className="text-xl font-bold text-center mb-2">Rakibiniz Ayrıldı</h2>
        <p className="text-slate-400 text-center mb-6 text-sm">Oyun sonlandırıldı ve lobiye döndünüz.</p>
        <div className="w-12 h-12 rounded-full border-4 border-slate-700 flex items-center justify-center font-mono font-bold text-lg text-slate-300">{leftOverlayTimer}</div>
      </div>
    </div>
  );
}