import React from 'react';
import { Crown, Bot as BotIcon, User } from 'lucide-react';
import { TileBack } from './Tile.jsx';
import Tile from './Tile.jsx';

// Diğer oyuncuların ıstakadaki taşları GÖSTERİLMEZ (hile önleme) — sadece isim,
// eldeki taş sayısı, skor ve (varsa) önlerindeki en üst attıkları taş gösterilir.
function Seat({ player, rackCount, topDiscard, score, isHost, isTakeable, isCurrentTurn, onTakeDiscard, orientation }) {
  if (!player) return null;
  const vertical = orientation === 'left' || orientation === 'right';
  return (
    <div className={`flex ${vertical ? 'flex-col' : 'flex-row'} items-center gap-2 bg-slate-900/70 border rounded-lg px-3 py-2 ${isTakeable ? 'border-amber-400' : isCurrentTurn ? 'border-indigo-500/60' : 'border-slate-700'}`}>
      <div className="flex items-center gap-2 min-w-0">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${player.isBot ? 'bg-amber-600/30 text-amber-300' : 'bg-indigo-600/30 text-indigo-300'}`}>
          {player.isBot ? <BotIcon className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-xs font-bold text-slate-200 truncate">
            {player.name}
            {isHost && <Crown className="w-3 h-3 text-yellow-400 shrink-0" />}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">{score ?? 0} puan</div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {topDiscard ? (
          <div
            onClick={isTakeable ? onTakeDiscard : undefined}
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
          <span className="text-xs font-mono font-bold text-slate-300">{rackCount}</span>
        </div>
      </div>
    </div>
  );
}

// Masayı 4 oyuncunun tam bir kare oluşturacağı şekilde dizer: ben her zaman
// alttayım (ıstakam ayrı render edilir), SOLUMDAKİ rakip = taşını alabileceğim
// (prevUid/takeableUid), SAĞIMDAKİ rakip = taşımı atacağım kişi (nextUid),
// ÜSTTEKİ = kalan 4. oyuncu (Eşli modda bu her zaman eşimdir — bkz. Okey101Game
// içindeki 2v2 oturma sırası düzenlemesi). `children` orta alana (çekme
// destesi/gösterge/kendi atışım) yerleştirilir.
export default function OpponentStrip({ topSeat, leftSeat, rightSeat, hostUid, turnUid, takeableUid, onTakeDiscard, children }) {
  const seatProps = (seat, orientation) => seat ? {
    player: seat.player,
    rackCount: seat.rackCount,
    topDiscard: seat.topDiscard,
    score: seat.score,
    isHost: seat.player.uid === hostUid,
    isTakeable: takeableUid === seat.player.uid && !!seat.topDiscard,
    isCurrentTurn: turnUid === seat.player.uid,
    onTakeDiscard: () => onTakeDiscard?.(seat.player.uid),
    orientation,
  } : null;

  return (
    <div className="w-full grid grid-cols-[1fr_minmax(0,2fr)_1fr] grid-rows-[auto_auto] gap-2 items-center">
      <div className="col-start-1 col-span-3 flex justify-center">
        {topSeat && <Seat {...seatProps(topSeat, 'top')} />}
      </div>
      <div className="col-start-1 row-start-2 flex justify-start">
        {leftSeat && <Seat {...seatProps(leftSeat, 'left')} />}
      </div>
      <div className="col-start-2 row-start-2 flex justify-center">
        {children}
      </div>
      <div className="col-start-3 row-start-2 flex justify-end">
        {rightSeat && <Seat {...seatProps(rightSeat, 'right')} />}
      </div>
    </div>
  );
}
