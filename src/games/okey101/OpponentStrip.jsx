import React from 'react';
import { Crown, Bot as BotIcon, User } from 'lucide-react';
import Tile from './Tile.jsx';

// Diğer oyuncuların ıstakadaki taşları/taş SAYISI GÖSTERİLMEZ (hile önleme +
// istenmeyen bilgi kirliliği) — sadece isim, skor ve (varsa) en son attıkları
// taş gösterilir. Son atılan taş, kartın masa MERKEZİNE bakan köşesinde
// (benim kendi atma bölmemin ıstakamın köşesinde durması gibi) çapraz bir
// rozet olarak yüzer.
function Seat({ player, topDiscard, score, isHost, isTakeable, isCurrentTurn, onTakeDiscard, orientation, okeyInfo }) {
  if (!player) return null;
  const vertical = orientation === 'left' || orientation === 'right';
  // Her oyuncunun attığı taş, taşı ATTIĞI kişiye doğru (masanın o yönüne)
  // konumlanır: üstteki soldakine atar, sağdaki üsttekine atar. Soldaki bana
  // attığı için onun taşı burada DEĞİL, benim ıstakamın sol üstünde gösterilir.
  const badgePos = orientation === 'right' ? '-top-4 -left-4' : '-bottom-4 -left-4';
  return (
    <div className={`relative flex ${vertical ? 'sm:flex-col' : 'flex-row'} items-center gap-2 bg-slate-900/70 border rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 min-w-0 ${isTakeable ? 'border-amber-400' : isCurrentTurn ? 'border-indigo-500/60' : 'border-slate-700'}`}>
      <div className="flex items-center gap-2 min-w-0">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${player.isBot ? 'bg-amber-600/30 text-amber-300' : 'bg-indigo-600/30 text-indigo-300'}`}>
          {player.isBot ? <BotIcon className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[11px] sm:text-xs font-bold text-slate-200 truncate">
            <span className="truncate">{player.name}</span>
            {isHost && <Crown className="w-3 h-3 text-yellow-400 shrink-0" />}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">{score ?? 0} puan</div>
        </div>
      </div>

      {topDiscard && orientation !== 'left' && (
        <div
          onClick={isTakeable ? onTakeDiscard : undefined}
          title={isTakeable ? 'Bu taşı çek' : `${player.name} bu taşı attı`}
          className={`absolute ${badgePos} z-10 ${isTakeable ? 'cursor-pointer ring-2 ring-amber-400 rounded-md animate-pulse' : ''}`}
        >
          <Tile tile={topDiscard} size="small" okeyInfo={okeyInfo} />
        </div>
      )}
    </div>
  );
}

// Masayı 4 oyuncunun tam bir kare oluşturacağı şekilde dizer: ben her zaman
// alttayım (ıstakam ayrı render edilir), SOLUMDAKİ rakip = taşını alabileceğim
// (prevUid/takeableUid), SAĞIMDAKİ rakip = taşımı atacağım kişi (nextUid),
// ÜSTTEKİ = kalan 4. oyuncu (Eşli modda bu her zaman eşimdir — bkz. Okey101Game
// içindeki 2v2 oturma sırası düzenlemesi). `children` orta alana (çekme
// destesi/gösterge/kendi atışım) yerleştirilir.
export default function OpponentStrip({ topSeat, leftSeat, rightSeat, hostUid, turnUid, takeableUid, onTakeDiscard, okeyInfo, children }) {
  const seatProps = (seat, orientation) => seat ? {
    player: seat.player,
    topDiscard: seat.topDiscard,
    score: seat.score,
    isHost: seat.player.uid === hostUid,
    isTakeable: takeableUid === seat.player.uid && !!seat.topDiscard,
    isCurrentTurn: turnUid === seat.player.uid,
    onTakeDiscard: () => onTakeDiscard?.(seat.player.uid),
    orientation,
    okeyInfo,
  } : null;

  // Dar ekranlarda (telefon) 3 sütunlu kare düzen sığmıyor ve koltuk kartları
  // ortadaki deste/gösterge ile üst üste biniyordu; bu yüzden mobilde dikey
  // (üst koltuk → sol+sağ koltuklar → orta alan) akışa geçilir, sm ve üstünde
  // gerçek kare masa düzeni kullanılır.
  return (
    <div className="w-full flex flex-col items-center gap-2 sm:grid sm:grid-cols-[1fr_minmax(0,2fr)_1fr] sm:grid-rows-[auto_auto] sm:items-center">
      <div className="w-full flex justify-center sm:col-start-1 sm:col-span-3">
        {topSeat && <Seat {...seatProps(topSeat, 'top')} />}
      </div>

      <div className="w-full flex justify-between items-start gap-2 sm:contents">
        <div className="min-w-0 sm:col-start-1 sm:row-start-2 sm:flex sm:justify-start">
          {leftSeat && <Seat {...seatProps(leftSeat, 'left')} />}
        </div>
        <div className="min-w-0 sm:col-start-3 sm:row-start-2 sm:flex sm:justify-end">
          {rightSeat && <Seat {...seatProps(rightSeat, 'right')} />}
        </div>
      </div>

      <div className="flex justify-center sm:col-start-2 sm:row-start-2">
        {children}
      </div>
    </div>
  );
}
