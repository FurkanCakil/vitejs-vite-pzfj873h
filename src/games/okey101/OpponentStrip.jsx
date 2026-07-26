import React from 'react';
import { Crown, Bot as BotIcon, User } from 'lucide-react';
import { TileBack } from './Tile.jsx';

// Diğer oyuncuların taşları GÖSTERİLMEZ (hile önleme) — sadece isim ve elindeki
// taş sayısı (ters çevrili taş yığını olarak) gösterilir.
export default function OpponentStrip({ players, racks, hostUid, myUid }) {
  const others = players.filter((p) => p.uid !== myUid);
  return (
    <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-2">
      {others.map((p) => {
        const count = racks?.[p.uid]?.filter(Boolean).length ?? 0;
        return (
          <div key={p.uid} className="flex items-center justify-between gap-2 bg-slate-900/70 border border-slate-700 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${p.isBot ? 'bg-amber-600/30 text-amber-300' : 'bg-indigo-600/30 text-indigo-300'}`}>
                {p.isBot ? <BotIcon className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
              </div>
              <span className="text-xs font-bold text-slate-200 truncate">{p.name}</span>
              {p.uid === hostUid && <Crown className="w-3 h-3 text-yellow-400 shrink-0" />}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <TileBack size="small" />
              <span className="text-xs font-mono font-bold text-slate-300">{count}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
