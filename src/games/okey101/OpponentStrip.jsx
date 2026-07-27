import React from 'react';
import { Crown, Bot as BotIcon, User, ArrowRight } from 'lucide-react';
import Tile from './Tile.jsx';

// Diğer oyuncuların ıstakadaki taşları/taş SAYISI GÖSTERİLMEZ (hile önleme +
// istenmeyen bilgi kirliliği) — sadece isim ve skor gösterilir. Attıkları taş
// bu karttan ayrı, ATAN ile ALAN oyuncunun tam ORTASINDA duran bir şeritte
// gösterilir (bkz. DiscardFloat).
function Seat({ player, score, isHost, isCurrentTurn }) {
  if (!player) return null;
  return (
    <div className={`flex items-center gap-1.5 sm:gap-2 bg-slate-900/70 border rounded-lg px-1.5 py-1 sm:px-3 sm:py-2 min-w-0 ${isCurrentTurn ? 'border-indigo-500/70 ring-1 ring-indigo-500/40' : 'border-slate-700'}`}>
      <div className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center shrink-0 ${player.isBot ? 'bg-amber-600/30 text-amber-300' : 'bg-indigo-600/30 text-indigo-300'}`}>
        {player.isBot ? <BotIcon className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> : <User className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[10px] sm:text-xs font-bold text-slate-200">
          <span className="truncate max-w-[72px] sm:max-w-[120px]">{player.name}</span>
          {isHost && <Crown className="w-3 h-3 text-yellow-400 shrink-0" />}
        </div>
        <div className="text-[9px] sm:text-[10px] text-slate-500 font-mono leading-tight">{score ?? 0} puan</div>
      </div>
    </div>
  );
}

// Atılan bir taşın "uçuş" rozeti: taşı ATAN ile taşı ALAN oyuncunun tam
// ortasında durur ve altında "Atan → Alan" yazar; böylece masada kimin kime
// attığı tek bakışta anlaşılır.
function DiscardFloat({ tile, fromName, toName, okeyInfo }) {
  if (!tile) return null;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <Tile tile={tile} size="small" okeyInfo={okeyInfo} />
      <div className="flex items-center gap-0.5 text-[8px] sm:text-[9px] text-slate-500 font-bold leading-none max-w-[92px] sm:max-w-[140px]">
        <span className="truncate">{fromName}</span>
        <ArrowRight className="w-2 h-2 shrink-0" />
        <span className="truncate">{toName}</span>
      </div>
    </div>
  );
}

// Masayı 4 oyuncunun tam bir kare oluşturacağı şekilde dizer: ben her zaman
// alttayım (ıstakam ayrı render edilir), SOLUMDAKİ rakip = taşını alabileceğim
// (prevUid), SAĞIMDAKİ rakip = taşımı atacağım kişi (nextUid), ÜSTTEKİ = kalan
// 4. oyuncu (Eşli modda bu her zaman eşimdir). `children` orta alana (çekme
// destesi/gösterge) yerleştirilir.
//
// Tur akışı: SOL → BEN → SAĞ → ÜST → SOL. Yani sağdaki üsttekine, üstteki
// soldakine, soldaki de bana atar. Soldakinin bana attığı taş burada DEĞİL,
// kendi ıstakamın üstündeki "Soldan Çek" bölmesinde gösterilir.
export default function OpponentStrip({ topSeat, leftSeat, rightSeat, hostUid, turnUid, okeyInfo, myName = 'Sen', children }) {
  const seatProps = (seat) => seat ? {
    player: seat.player,
    score: seat.score,
    isHost: seat.player.uid === hostUid,
    isCurrentTurn: turnUid === seat.player.uid,
  } : null;

  const hasFloat = !!(topSeat?.topDiscard || rightSeat?.topDiscard);

  return (
    <div className="w-full flex flex-col items-center gap-1.5 sm:gap-2">
      {/* Üstteki oyuncu */}
      <div className="w-full flex justify-center">
        {topSeat && <Seat {...seatProps(topSeat)} />}
      </div>

      {/* Atılan taşlar: sol yarının ortası = ÜSTTEKİ'nin SOLDAKİ'ne attığı taş,
          sağ yarının ortası = SAĞDAKİ'nin ÜSTTEKİ'ne attığı taş. */}
      {hasFloat && (
        <div className="w-full max-w-md sm:max-w-2xl flex items-start">
          <div className="flex-1 flex justify-center">
            {topSeat?.topDiscard && leftSeat && (
              <DiscardFloat tile={topSeat.topDiscard} fromName={topSeat.player.name} toName={leftSeat.player.name} okeyInfo={okeyInfo} />
            )}
          </div>
          <div className="flex-1 flex justify-center">
            {rightSeat?.topDiscard && topSeat && (
              <DiscardFloat tile={rightSeat.topDiscard} fromName={rightSeat.player.name} toName={topSeat.player.name} okeyInfo={okeyInfo} />
            )}
          </div>
        </div>
      )}

      {/* Sol / Orta (deste + gösterge) / Sağ.
          Telefonda (dar ekran) sol+sağ koltuklar yan yana bir satırda, orta alan
          onların ALTINDA durur — 3 sütunlu kare düzen dar ekrana sığmıyor ve
          koltuklar desteyle üst üste biniyordu. sm ve üstünde gerçek kare masa. */}
      <div className="w-full flex flex-col items-center gap-2 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
        <div className="w-full flex justify-between items-start gap-2 sm:contents">
          <div className="min-w-0 sm:col-start-1 sm:row-start-1 sm:justify-self-start">
            {leftSeat && <Seat {...seatProps(leftSeat)} />}
          </div>
          <div className="min-w-0 sm:col-start-3 sm:row-start-1 sm:justify-self-end">
            {rightSeat && <Seat {...seatProps(rightSeat)} />}
          </div>
        </div>

        <div className="sm:col-start-2 sm:row-start-1 flex justify-center">
          {children}
        </div>
      </div>

      {/* Soldaki bana atıyor: kimin kime attığı akışı burada da hatırlatılır. */}
      {leftSeat && (
        <div className="flex items-center gap-1 text-[9px] sm:text-[10px] text-slate-600 font-bold">
          <span className="truncate max-w-[90px]">{leftSeat.player.name}</span>
          <ArrowRight className="w-2.5 h-2.5" />
          <span className="text-slate-500 truncate max-w-[90px]">{myName}</span>
        </div>
      )}
    </div>
  );
}
