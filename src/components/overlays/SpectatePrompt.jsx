import React from 'react';
import { Eye } from 'lucide-react';

export default function SpectatePrompt({ spectatePrompt, acceptSpectate, setSpectatePrompt }) {
  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/90 flex flex-col items-center justify-center backdrop-blur-sm p-4 h-[100dvh]">
      <Eye className="w-16 h-16 text-indigo-500 mb-4" />
      <h2 className="text-2xl font-bold text-center mb-2">Bu Oda Dolu</h2>
      <p className="text-slate-300 text-center mb-8 max-w-md">Odaya zaten iki oyuncu bağlanmış durumda. Maçı seyirci olarak izlemek ister misiniz?</p>
      <div className="flex gap-4">
        <button onClick={acceptSpectate} className="bg-indigo-600 hover:bg-indigo-500 px-6 py-3 rounded-lg font-bold transition-colors">İzle</button>
        <button onClick={() => setSpectatePrompt(null)} className="bg-slate-800 hover:bg-slate-700 border border-slate-600 px-6 py-3 rounded-lg font-medium transition-colors">Vazgeç</button>
      </div>
    </div>
  );
}