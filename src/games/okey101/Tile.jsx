import React from 'react';
import { COLOR_SYMBOLS, effectiveTile } from './tiles.js';

const COLOR_TEXT_CLASS = { black: 'text-slate-900', red: 'text-red-600', blue: 'text-blue-600', yellow: 'text-amber-600' };

const SIZE_CLASS = {
  normal: 'w-8 h-11 sm:w-11 sm:h-16',
  large: 'w-11 h-16 sm:w-14 sm:h-20',
  small: 'w-6 h-8 sm:w-7 sm:h-9',
};

// "small" boyutu (gösterge, açılan eller, rakip attıkları, atma rozeti vb.)
// çok daha küçük bir kutuya sığdığı için rakam/sembol yazı boyutları da ayrı
// tutulur — aksi halde "normal" boyutun font'u küçük kutuyu taşırıp rakamın
// üstten, sembolün alttan kutuyu aşmasına (düzensiz görünüme) yol açıyordu.
const NUMBER_TEXT_CLASS = { normal: 'text-base sm:text-xl', large: 'text-xl sm:text-2xl', small: 'text-[10px] sm:text-xs' };
const SYMBOL_TEXT_CLASS = { normal: 'text-[10px] sm:text-sm', large: 'text-sm sm:text-base', small: 'text-[7px] sm:text-[8px]' };
const JOKER_TEXT_CLASS = { normal: 'text-lg sm:text-2xl', large: 'text-2xl sm:text-3xl', small: 'text-xs sm:text-sm' };

// Bir taşın en/boy oranı. Istaka genişliğinden hesaplanan piksel boyutlu
// (`width` prop'lu) taşlarda yükseklik bu orandan türetilir.
export const TILE_ASPECT = 1.42;

// `width` (px) verildiğinde taş, sınıf tabanlı sabit boyutlar yerine TAM O
// genişlikte çizilir ve tüm yazı/rozet boyutları da orantılı küçülüp büyür.
// Istaka artık 15 sütunu ekrana sığdıracak şekilde taş genişliğini kendisi
// hesapladığı için (bkz. PlayerRack) hem telefonda hem tam ekranda yatay
// kaydırma çubuğu oluşmaz.
const pxStyles = (width) => {
  const height = Math.round(width * TILE_ASPECT);
  return {
    box: { width: `${width}px`, height: `${height}px` },
    number: { fontSize: `${Math.max(8, width * 0.58)}px` },
    symbol: { fontSize: `${Math.max(6, width * 0.34)}px` },
    joker: { fontSize: `${Math.max(10, width * 0.72)}px` },
    badge: {
      width: `${Math.max(10, width * 0.4)}px`,
      height: `${Math.max(10, width * 0.4)}px`,
      fontSize: `${Math.max(6, width * 0.26)}px`,
      top: `${-Math.max(3, width * 0.13)}px`,
      right: `${-Math.max(3, width * 0.13)}px`,
    },
  };
};

export const TileBack = ({ size = 'small', width = null, className = '' }) => (
  <div
    style={width ? { width: `${width}px`, height: `${Math.round(width * TILE_ASPECT)}px` } : undefined}
    className={`${width ? '' : SIZE_CLASS[size]} rounded-md bg-gradient-to-br from-indigo-700 to-indigo-900 border border-indigo-950 shadow-md shrink-0 ${className}`}
  />
);

// Tek bir Okey taşının görsel temsili. Erişilebilirlik için sayının altında
// rengine karşılık gelen bir sembol de gösterilir (sadece renge güvenilmez).
//
// Sahte Okey (isJoker) artık joker değil; o elin Okey'ini temsil eden normal
// bir taştır. Bu yüzden `okeyInfo` verildiğinde temsil ettiği renk/sayı ile
// çizilir ve sadece küçük bir "S" rozetiyle sahte olduğu belirtilir.
const Tile = React.forwardRef(function Tile({ tile, selected, grouped, dragging, dimmed, isOkey, okeyInfo = null, size = 'normal', width = null, className = '', style, ...handlers }, ref) {
  if (!tile) return null;
  const shown = effectiveTile(tile, okeyInfo);
  const unresolvedJoker = tile.isJoker && !okeyInfo;
  const colorClass = unresolvedJoker ? 'text-purple-700' : COLOR_TEXT_CLASS[shown.color];
  const px = width ? pxStyles(width) : null;

  return (
    <div
      ref={ref}
      style={px ? { ...px.box, ...style } : style}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      className={`relative select-none touch-none [-webkit-user-drag:none] ${px ? '' : SIZE_CLASS[size]} rounded-md bg-gradient-to-b from-amber-50 to-amber-100 border flex flex-col items-center justify-center shadow-md transition-transform
        ${selected ? 'ring-2 ring-yellow-400 -translate-y-2 border-yellow-400' : 'border-slate-400'}
        ${grouped ? 'ring-2 ring-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]' : ''}
        ${isOkey ? 'ring-2 ring-fuchsia-500 shadow-[0_0_10px_rgba(217,70,239,0.7)]' : ''}
        ${dragging ? 'opacity-30' : ''}
        ${dimmed ? 'opacity-60' : ''}
        ${className}`}
      {...handlers}
    >
      {isOkey && (
        <span
          style={px ? { position: 'absolute', ...px.badge } : undefined}
          className={`${px ? '' : 'absolute -top-1.5 -right-1.5 text-[9px] sm:text-[10px] w-3.5 h-3.5 sm:w-4 sm:h-4'} bg-fuchsia-600 text-white rounded-full flex items-center justify-center font-black leading-none shadow`}
        >O</span>
      )}
      {tile.isJoker && !isOkey && (
        <span
          style={px ? { position: 'absolute', ...px.badge } : undefined}
          title="Sahte Okey"
          className={`${px ? '' : 'absolute -top-1.5 -right-1.5 text-[8px] sm:text-[9px] w-3.5 h-3.5 sm:w-4 sm:h-4'} bg-slate-500 text-white rounded-full flex items-center justify-center font-black leading-none shadow`}
        >S</span>
      )}
      {unresolvedJoker ? (
        <span style={px?.joker} className={`${px ? '' : JOKER_TEXT_CLASS[size]} leading-none flex items-center justify-center`}>🃏</span>
      ) : (
        <div className="flex flex-col items-center justify-center gap-0.5">
          <span style={px?.number} className={`${px ? '' : NUMBER_TEXT_CLASS[size]} font-black leading-none flex items-center justify-center ${colorClass}`}>{shown.number}</span>
          <span style={px?.symbol} className={`${px ? '' : SYMBOL_TEXT_CLASS[size]} leading-none flex items-center justify-center ${colorClass}`}>{COLOR_SYMBOLS[shown.color]}</span>
        </div>
      )}
    </div>
  );
});

export default Tile;
