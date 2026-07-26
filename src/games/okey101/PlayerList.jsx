import React from 'react';
import { Crown, Bot as BotIcon, User } from 'lucide-react';

// Tekli (ffa) modda gösterilen düz oyuncu listesi: dolu koltuklar + boş koltuk yer tutucuları.
export default function PlayerList({ players, hostUid, maxPlayers }) {
  const seats = Array.from({ length: maxPlayers }, (_, i) => players[i] || null);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 md:p-5 w-full">
      <h3 className="text-lg font-bold text-slate-100 mb-4">Oyuncular</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {seats.map((p, i) => (
          <div key={p?.uid || `empty-${i}`} className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${p ? 'bg-slate-900 border-slate-600' : 'bg-slate-900/40 border-slate-700 border-dashed'}`}>
            {p ? (
              <>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${p.isBot ? 'bg-amber-600/30 text-amber-300' : 'bg-indigo-600/30 text-indigo-300'}`}>
                  {p.isBot ? <BotIcon className="w-4 h-4" /> : <User className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-bold text-slate-100 truncate">
                    {p.name}
                    {p.uid === hostUid && <Crown className="w-3.5 h-3.5 text-yellow-400 shrink-0" />}
                  </div>
                  <div className="text-[10px] text-slate-500">{p.isBot ? 'Bot' : 'Oyuncu'}</div>
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500 italic">Boş Koltuk</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
