import React from 'react';
import { Eye, Loader2 } from 'lucide-react';

// `isJoining`: izleyici olarak bağlanma isteği sürüyor. Düğme bu sırada
// KİLİTLENİR — iki hızlı dokunuş, aynı kişiyi izleyici listesine iki kez
// yazıp sayacı şişiriyordu (bkz. App.tsx#acceptSpectate).
export default function SpectatePrompt({ spectatePrompt, acceptSpectate, setSpectatePrompt, isJoining = false }) {
  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/90 flex flex-col items-center justify-center backdrop-blur-sm p-4 h-[100dvh]">
      <Eye className="w-16 h-16 text-indigo-500 mb-4" />
      <h2 className="text-2xl font-bold text-center mb-2">Bu Oda Dolu</h2>
      <p className="text-slate-300 text-center mb-8 max-w-md">Odaya zaten iki oyuncu bağlanmış durumda. Maçı seyirci olarak izlemek ister misiniz?</p>
      <div className="flex gap-4">
        <button onClick={acceptSpectate} disabled={isJoining} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed px-6 py-3 rounded-lg font-bold transition-colors flex items-center gap-2">
          {isJoining && <Loader2 className="w-4 h-4 animate-spin" />}{isJoining ? 'Bağlanılıyor...' : 'İzle'}
        </button>
        <button onClick={() => setSpectatePrompt(null)} disabled={isJoining} className="bg-slate-800 hover:bg-slate-700 border border-slate-600 disabled:opacity-60 px-6 py-3 rounded-lg font-medium transition-colors">Vazgeç</button>
      </div>
    </div>
  );
}