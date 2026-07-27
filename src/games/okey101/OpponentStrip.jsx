import React from 'react';
import { Crown, Bot as BotIcon, User } from 'lucide-react';
import Tile, { TILE_ASPECT } from './Tile.jsx';

// Diğer oyuncuların ıstakadaki taşları/taş SAYISI GÖSTERİLMEZ (hile önleme +
// istenmeyen bilgi kirliliği) — sadece isim ve skor gösterilir. Attıkları taş
// bu karttan ayrı, ATAN ile ALAN oyuncunun tam ORTASINDA duran bir şeritte
// gösterilir (bkz. DiscardFloat).
// `compact` (telefon YATAY): Tailwind kırılma noktaları GENİŞLİĞE bakar, bu
// yüzden 740px genişliğindeki bir yatay telefon "sm" sayılıp koltukları masaüstü
// boyutunda çiziyor ve 360px'lik yüksekliği tüketiyordu. Kompakt modda bu
// büyümeler bilinçli olarak devre dışı bırakılır.
function Seat({ player, score, isHost, isCurrentTurn, compact }) {
  if (!player) return null;
  return (
    <div className={`flex items-center bg-slate-900/70 border rounded-lg min-w-0 ${compact ? 'gap-1.5 px-1.5 py-1' : 'gap-2 sm:gap-2.5 px-2 py-1.5 sm:px-3.5 sm:py-2.5'} ${isCurrentTurn ? 'border-indigo-500/70 ring-1 ring-indigo-500/40' : 'border-slate-700'}`}>
      <div className={`rounded-full flex items-center justify-center shrink-0 ${compact ? 'w-5 h-5' : 'w-6 h-6 sm:w-8 sm:h-8'} ${player.isBot ? 'bg-amber-600/30 text-amber-300' : 'bg-indigo-600/30 text-indigo-300'}`}>
        {player.isBot ? <BotIcon className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5 sm:w-4.5 sm:h-4.5'} /> : <User className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5 sm:w-4.5 sm:h-4.5'} />}
      </div>
      <div className="min-w-0">
        <div className={`flex items-center gap-1 font-bold text-slate-200 ${compact ? 'text-[10px] leading-tight' : 'text-[11px] sm:text-sm'}`}>
          <span className={`truncate ${compact ? 'max-w-[70px]' : 'max-w-[80px] sm:max-w-[140px]'}`}>{player.name}</span>
          {isHost && <Crown className={`text-yellow-400 shrink-0 ${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />}
        </div>
        <div className={`text-slate-500 font-mono leading-tight ${compact ? 'text-[9px]' : 'text-[10px] sm:text-xs'}`}>{score ?? 0} puan</div>
      </div>
    </div>
  );
}

// Atılan bir taşın "uçuş" rozeti: taşı ATAN ile taşı ALAN oyuncunun tam
// ortasında durur. Kimin kime attığı zaten masa geometrisinden (üstteki
// soldakine, sağdaki üsttekine atar) belli olduğu için altına ayrıca isim
// yazılmaz — sadece taş, biraz büyütülmüş halde gösterilir.
function DiscardFloat({ tile, okeyInfo, compact }) {
  if (!tile) return null;
  return <Tile tile={tile} width={compact ? 22 : 30} okeyInfo={okeyInfo} />;
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
export default function OpponentStrip({ topSeat, leftSeat, rightSeat, hostUid, turnUid, okeyInfo, compact = false, children }) {
  const seatProps = (seat) => seat ? {
    player: seat.player,
    score: seat.score,
    isHost: seat.player.uid === hostUid,
    isCurrentTurn: turnUid === seat.player.uid,
    compact,
  } : null;

  // 2. madde: bu şerit eskiden SADECE bir atış varken (hasFloat) render
  // ediliyordu — ilk bot taşını attığı an bu satır aniden BELİRİP altındaki
  // her şeyi (tur bilgisi, açılan eller, ıstaka) aşağı itiyor, bu da "ekran
  // hafif kayıyor" diye hissedilen ani sıçramanın kaynağıydı. Artık şerit
  // HER ZAMAN render edilir (yüksekliği baştan ayrılır); içindeki taş(lar)
  // sadece varsa gösterilir — layout hiçbir zaman zıplamaz.
  const floatWidth = compact ? 22 : 30;
  const floatHeight = Math.round(floatWidth * TILE_ASPECT);

  return (
    <div className={`w-full flex flex-col items-center ${compact ? 'gap-1' : 'gap-1.5 sm:gap-2'}`}>
      {/* Üstteki oyuncu */}
      <div className="w-full flex justify-center">
        {topSeat && <Seat {...seatProps(topSeat)} />}
      </div>

      {/* Atılan taşlar: sol yarının ortası = ÜSTTEKİ'nin SOLDAKİ'ne attığı taş,
          sağ yarının ortası = SAĞDAKİ'nin ÜSTTEKİ'ne attığı taş. Kimin kime
          attığı masa geometrisinden zaten belli olduğu için isim yazılmaz. */}
      <div className="w-full max-w-md sm:max-w-2xl flex items-start" style={{ minHeight: `${floatHeight}px` }}>
        <div className="flex-1 flex justify-center">
          {topSeat?.topDiscard && leftSeat && <DiscardFloat tile={topSeat.topDiscard} okeyInfo={okeyInfo} compact={compact} />}
        </div>
        <div className="flex-1 flex justify-center">
          {rightSeat?.topDiscard && topSeat && <DiscardFloat tile={rightSeat.topDiscard} okeyInfo={okeyInfo} compact={compact} />}
        </div>
      </div>

      {/* Sol / Orta (deste + gösterge) / Sağ.
          Telefonda (dar ekran) sol+sağ koltuklar yan yana bir satırda, orta alan
          onların ALTINDA durur — 3 sütunlu kare düzen dar ekrana sığmıyor ve
          koltuklar desteyle üst üste biniyordu. sm ve üstünde gerçek kare masa. */}
      <div className={`w-full flex items-center ${compact ? 'grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-1' : 'flex-col gap-2 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center'}`}>
        {/* NOT: Koltuk sarmalayıcılarında `justify-self-start/end` KULLANILMAZ.
            O, grid hücresini içeriğe göre boyutlandırıp (stretch yerine) hücre
            genişliğinden TAŞMASINA izin veriyordu — uzun oyuncu isimleri +
            geniş bir orta blok (Deste + Gösterge + barajlar) olduğunda isim
            kartları ortadaki bloğun ÜSTÜNE biniyordu. Bunun yerine hücre
            gerilir (stretch) ve içerik `flex justify-*` ile hizalanır; böylece
            `min-w-0` gerçekten devreye girip isimler kısalır (truncate). */}
        <div className={`w-full flex justify-between items-start gap-2 ${compact ? 'contents' : 'sm:contents'}`}>
          <div className={`min-w-0 ${compact ? 'col-start-1 row-start-1 flex justify-start' : 'sm:col-start-1 sm:row-start-1 sm:flex sm:justify-start'}`}>
            {leftSeat && <Seat {...seatProps(leftSeat)} />}
          </div>
          <div className={`min-w-0 ${compact ? 'col-start-3 row-start-1 flex justify-end' : 'sm:col-start-3 sm:row-start-1 sm:flex sm:justify-end'}`}>
            {rightSeat && <Seat {...seatProps(rightSeat)} />}
          </div>
        </div>

        <div className={`flex justify-center ${compact ? 'col-start-2 row-start-1' : 'sm:col-start-2 sm:row-start-1'}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
