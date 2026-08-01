import React from 'react';
import { ArrowLeft, Maximize, Check, Copy, Bot, Zap } from 'lucide-react';

// `isPublicRoom`: oda HIZLI EŞLEŞME ile kurulduysa true. KULLANICI İSTEĞİ —
// davet kodu yalnızca "arkadaşımla oynayacağım" senaryosuna ait bir özelliktir;
// rastgele eşleşilen bir masada gösterilmesi anlamsızdır, bu yüzden orada kod
// yerine sade bir "Hızlı Eşleşme" rozeti görünür.
export default function RoomHeader({ leaveRoom, toggleFullscreen, roomCode, copyToClipboard, copySuccess, isBotGame, isPublicRoom }) {
  return (
    <div className="w-full flex items-center justify-between mb-4 sm:mb-8">
      <button onClick={leaveRoom} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"><ArrowLeft className="w-5 h-5" /> Odadan Çık</button>
      <div className="flex items-center gap-2 sm:gap-4">
        <button onClick={toggleFullscreen} className="text-slate-400 hover:text-white transition-colors bg-slate-800 p-2 rounded-lg border border-slate-700 shadow-md" title="Tam Ekran Yap"><Maximize className="w-5 h-5" /></button>
        {isBotGame ? (
          <div className="flex items-center gap-2 bg-slate-800 px-4 py-2 rounded-full border border-slate-700 shadow-md">
            <Bot className="w-5 h-5 text-indigo-300" />
            <span className="text-sm text-slate-300 font-medium">Bot Modu</span>
          </div>
        ) : isPublicRoom ? (
          <div className="flex items-center gap-2 bg-slate-800 px-4 py-2 rounded-full border border-fuchsia-500/40 shadow-md">
            <Zap className="w-5 h-5 text-fuchsia-300" />
            <span className="text-sm text-slate-300 font-medium">Hızlı Eşleşme</span>
          </div>
        ) : (
          <div className="flex items-center gap-4 bg-slate-800 px-4 py-2 rounded-full border border-slate-700 shadow-md">
            <span className="text-sm text-slate-400 hidden md:block">Oda Kodu:</span>
            <span className="font-mono font-bold tracking-wider text-indigo-300 text-lg">{roomCode}</span>
            <button onClick={copyToClipboard} className="text-slate-400 hover:text-white relative" title="Kodu Kopyala">
              {copySuccess ? <Check className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5" />}
              {copySuccess && <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-700 text-white text-xs px-2 py-1 rounded shadow-lg">Kopyalandı!</span>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}