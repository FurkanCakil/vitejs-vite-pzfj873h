import React from 'react';
import { Crown, Bot as BotIcon, User } from 'lucide-react';
import { TileBack } from './Tile.jsx';
import Tile from './Tile.jsx';

// Diğer oyuncuların ıstakadaki taşları GÖSTERİLMEZ (hile önleme) — sadece isim,
// eldeki taş sayısı, skor ve (varsa) önlerindeki en üst attıkları taş gösterilir.
// `takeableUid` (bir önceki oyuncu, sırası bana geldiyse ve henüz çekmediysem)
// tıklanabilir hale gelir.
export default function OpponentStrip({ players, racks, discardPiles, scores, hostUid, myUid, takeableUid, onTakeDiscard }) {
  const others = players.filter((p) => p.uid !== myUid);
  return (
    <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-2">
      {others.map((p) => {
        const count = racks?.[p.uid]?.filter(Boolean).length ?? 0;
        const pile = discardPiles?.[p.uid] || [];
        const topDiscard = pile.length > 0 ? pile[pile.length - 1] : null;
        const isTakeable = takeableUid === p.uid && !!topDiscard;
        return (
          <div key={p.uid} className={`flex items-center justify-between gap-2 bg-slate-900/70 border rounded-lg px-3 py-2 ${isTakeable ? 'border-amber-400' : 'border-slate-700'}`}>
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${p.isBot ? 'bg-amber-600/30 text-amber-300' : 'bg-indigo-600/30 text-indigo-300'}`}>
                {p.isBot ? <BotIcon className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1 text-xs font-bold text-slate-200 truncate">
                  {p.name}
                  {p.uid === hostUid && <Crown className="w-3 h-3 text-yellow-400 shrink-0" />}
                </div>
                <div className="text-[10px] text-slate-500 font-mono">{scores?.[p.uid] ?? 0} puan</div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {topDiscard ? (
                <div
                  onClick={isTakeable ? () => onTakeDiscard?.(p.uid) : undefined}
                  title={isTakeable ? 'Bu taşı çek' : undefined}
                  className={isTakeable ? 'cursor-pointer ring-2 ring-amber-400 rounded-md animate-pulse' : ''}
                >
                  <Tile tile={topDiscard} size="small" />
                </div>
              ) : (
                <div className="w-4 h-6" />
              )}
              <div className="flex items-center gap-1">
                <TileBack size="small" />
                <span className="text-xs font-mono font-bold text-slate-300">{count}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
