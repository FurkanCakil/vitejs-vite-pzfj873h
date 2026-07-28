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
// `vertical`: SOL ve SAĞ koltuklar, gerçek bir masada olduğu gibi yanlarda
// DİKEY durur (avatar üstte, isim ve puan altında) — yatay kartlar masanın
// iki yanında gereksiz genişlik kaplayıp ortadaki alanı daraltıyordu.
function Seat({ player, score, isHost, isCurrentTurn, compact, vertical = false }) {
  if (!player) return null;

  const avatar = (
    <div className={`rounded-full flex items-center justify-center shrink-0 ${compact ? 'w-5 h-5' : 'w-6 h-6 sm:w-8 sm:h-8'} ${player.isBot ? 'bg-amber-600/30 text-amber-300' : 'bg-indigo-600/30 text-indigo-300'}`}>
      {player.isBot ? <BotIcon className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5 sm:w-4.5 sm:h-4.5'} /> : <User className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5 sm:w-4.5 sm:h-4.5'} />}
    </div>
  );
  const frame = `bg-slate-900/70 border rounded-lg ${isCurrentTurn ? 'border-indigo-500/70 ring-1 ring-indigo-500/40' : 'border-slate-700'}`;

  if (vertical) {
    // İsim DİKEY (yukarıdan aşağı akan, harfleri 90° yatık) yazılır — hem
    // masaya "bir tık büyütülmüş" okunaklı bir isim koyar hem de koltuğun
    // GENİŞLİĞİNİ daraltarak yanlarda merkez sütuna (deste/gösterge/açılan
    // eller) yer açar (kullanıcı isteği). Skor yatay kalır (tek-iki haneli
    // sayı zaten dar).
    return (
      <div className={`relative flex flex-col items-center text-center ${frame} ${compact ? 'gap-1 px-1 py-1.5 w-11' : 'gap-1.5 px-1.5 py-2 w-12 sm:w-14'}`}>
        {isHost && <Crown className={`absolute -top-1.5 -right-1.5 text-yellow-400 drop-shadow shrink-0 ${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />}
        {avatar}
        <span
          title={player.name}
          className={`font-bold text-slate-200 [writing-mode:vertical-rl] truncate ${compact ? 'text-[10px] max-h-16' : 'text-[11px] sm:text-sm max-h-28 sm:max-h-36'}`}
        >
          {player.name}
        </span>
        <div className={`text-slate-500 font-mono leading-tight ${compact ? 'text-[8px]' : 'text-[9px] sm:text-[10px]'}`}>{score ?? 0}</div>
      </div>
    );
  }

  return (
    <div className={`flex items-center min-w-0 ${frame} ${compact ? 'gap-1.5 px-1.5 py-1' : 'gap-2 sm:gap-2.5 px-2 py-1.5 sm:px-3.5 sm:py-2.5'}`}>
      {avatar}
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

// Bir rakibin ATTIĞI taşın durduğu bölme: taşı ATAN ile taşı ALAN oyuncunun
// arasında durur. Kimin kime attığı zaten masa geometrisinden (üstteki
// soldakine, sağdaki üsttekine atar) belli olduğu için altına isim yazılmaz.
//
// Bölme, kendi ıstakamın üstündeki "Soldan Çek" / "Sağa At" bölmeleriyle AYNI
// dilde çizilir: taş yokken bile KESİK ÇİZGİLİ boş bir yer olarak durur —
// böylece "buraya taş atılacak" bilgisi masadan okunur ve taş gelip gittikçe
// layout zıplamaz.
const DISCARD_TILE_W = { compact: 30, normal: 42 };

function DiscardSlot({ tile, okeyInfo, compact }) {
  const tileW = compact ? DISCARD_TILE_W.compact : DISCARD_TILE_W.normal;
  const slotW = Math.round(tileW * 1.18);
  const slotH = Math.round(slotW * TILE_ASPECT);
  return (
    <div
      style={{ width: `${slotW}px`, height: `${slotH}px` }}
      className="rounded-lg border-2 border-dashed border-slate-600/70 bg-slate-900/40 flex items-center justify-center shrink-0"
    >
      {tile && <Tile tile={tile} width={tileW} okeyInfo={okeyInfo} />}
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
export default function OpponentStrip({ topSeat, leftSeat, rightSeat, hostUid, turnUid, okeyInfo, compact = false, turnBanner = null, centerExtra = null, children }) {
  const seatProps = (seat, vertical = false) => seat ? {
    player: seat.player,
    score: seat.score,
    isHost: seat.player.uid === hostUid,
    isCurrentTurn: turnUid === seat.player.uid,
    compact,
    vertical,
  } : null;

  return (
    <div className={`w-full flex flex-col items-center ${compact ? 'gap-1' : 'gap-1.5 sm:gap-2'}`}>
      {/* Tur bandı ("Sıra Sende!" / "X oynuyor...") masanın ORTASINDA değil,
          en üstteki oyuncunun DA üstünde durur — orta alan açılan perlere
          kalsın diye (bkz. Okey101Game#turnBanner). */}
      {turnBanner}

      {/* Üstteki oyuncu */}
      <div className="w-full flex justify-center">
        {topSeat && <Seat {...seatProps(topSeat)} />}
      </div>

      {/* Atış bölmeleri: sol taraf = ÜSTTEKİ'nin SOLDAKİ'ne attığı taş, sağ
          taraf = SAĞDAKİ'nin ÜSTTEKİ'ne attığı taş. Kimin kime attığı masa
          geometrisinden zaten belli olduğu için isim yazılmaz. Bölmeler
          gidecekleri koltuğa doğru (köşelere) yerleşir ve taş yokken de
          kesik çizgili olarak durur (bkz. DiscardSlot). */}
      {/* Bölmeler ayrıca ~1 taş kadar DIŞA ve YUKARI kaydırılır (sol bölme sol-üst,
          sağ bölme sağ-üst çaprazına): taşın masanın ortasından değil, atan
          oyuncunun köşesinden çıkıyormuş izlenimi verir. `-mt` ile yukarı
          çekmek, altındaki 3 sütunlu masa satırının konumunu DEĞİŞTİRMEZ
          (bölmeler kendi satırında akıştan taşar). */}
      <div className="w-full flex items-start justify-between px-[14%] sm:px-[20%] -mt-1">
        <div className={`flex justify-start ${compact ? '-translate-x-6 -translate-y-1.5' : '-translate-x-10 -translate-y-2.5'}`}>
          {leftSeat && topSeat && <DiscardSlot tile={topSeat.topDiscard} okeyInfo={okeyInfo} compact={compact} />}
        </div>
        <div className={`flex justify-end ${compact ? 'translate-x-6 -translate-y-1.5' : 'translate-x-10 -translate-y-2.5'}`}>
          {rightSeat && topSeat && <DiscardSlot tile={rightSeat.topDiscard} okeyInfo={okeyInfo} compact={compact} />}
        </div>
      </div>

      {/* Sol / Orta (deste + gösterge) / Sağ.
          Telefonda (dar ekran) sol+sağ koltuklar yan yana bir satırda, orta alan
          onların ALTINDA durur — 3 sütunlu kare düzen dar ekrana sığmıyor ve
          koltuklar desteyle üst üste biniyordu. sm ve üstünde gerçek kare masa. */}
      {/* `items-start` (items-center DEĞİL): orta sütun artık deste/gösterge
          ALTINA açılan eller panelini de aldığı için (bkz. `centerExtra`)
          çok daha uzun olabiliyor — sol/sağ koltuklar bu durumda dikeyde
          ORTALANMAK yerine üstte sabit kalır, tıpkı gerçek bir masada
          oyuncunun sabit bir yerde oturup ortadaki yığının büyümesi gibi. */}
      <div className={`w-full flex items-start ${compact ? 'grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-1' : 'flex-col gap-2 sm:grid sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start'}`}>
        {/* NOT: Koltuk sarmalayıcılarında `justify-self-start/end` KULLANILMAZ.
            O, grid hücresini içeriğe göre boyutlandırıp (stretch yerine) hücre
            genişliğinden TAŞMASINA izin veriyordu — uzun oyuncu isimleri +
            geniş bir orta blok (Deste + Gösterge + barajlar) olduğunda isim
            kartları ortadaki bloğun ÜSTÜNE biniyordu. Bunun yerine hücre
            gerilir (stretch) ve içerik `flex justify-*` ile hizalanır; böylece
            `min-w-0` gerçekten devreye girip isimler kısalır (truncate).
            (İsimler artık DİKEY yazıldığı için koltuklar zaten dar — sütun
            genişliği `auto`ya çevrildi, merkez sütun `1fr` ile kalan TÜM
            genişliği alır.) */}
        {/* `w-full` ŞART: dar (telefon DİKEY) ekranda bu sarmalayıcı gerçek bir
            flex satırıdır ve `justify-between` ancak tam genişlikteyken sol/sağ
            koltukları iki uca yaslar. w-full olmadan satır içeriğe göre daralıp
            iki koltuğu yan yana (ikisi de solda) bırakıyordu. `sm` ve üstünde
            zaten `contents` olduğu için bu genişliğin hiçbir etkisi yoktur. */}
        <div className={`w-full flex justify-between items-start gap-2 ${compact ? 'contents' : 'sm:contents'}`}>
          <div className={`shrink-0 ${compact ? 'col-start-1 row-start-1 flex justify-start' : 'sm:col-start-1 sm:row-start-1 sm:flex sm:justify-start'}`}>
            {leftSeat && <Seat {...seatProps(leftSeat, true)} />}
          </div>
          <div className={`shrink-0 ${compact ? 'col-start-3 row-start-1 flex justify-end' : 'sm:col-start-3 sm:row-start-1 sm:flex sm:justify-end'}`}>
            {rightSeat && <Seat {...seatProps(rightSeat, true)} />}
          </div>
        </div>

        {/* Merkez sütun: deste/gösterge (children) ÜSTTE, açılan eller
            (centerExtra) ALTINDA — kullanıcı isteği: sol/sağ oyuncular
            gerçekten bu bloğun yanında dursun, üstünde değil. */}
        <div className={`min-w-0 flex flex-col items-center gap-2 ${compact ? 'col-start-2 row-start-1' : 'sm:col-start-2 sm:row-start-1'}`}>
          <div className="flex justify-center">{children}</div>
          {centerExtra && <div className="w-full flex justify-center">{centerExtra}</div>}
        </div>
      </div>
    </div>
  );
}
