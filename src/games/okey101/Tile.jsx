import React from 'react';
import { COLOR_SYMBOLS } from './tiles.js';

const COLOR_TEXT_CLASS = { black: 'text-slate-900', red: 'text-red-600', blue: 'text-blue-600', yellow: 'text-amber-600' };

const SIZE_CLASS = {
  normal: 'w-9 h-12 sm:w-11 sm:h-16',
  small: 'w-4 h-6',
};

export const TileBack = ({ size = 'small', className = '' }) => (
  <div className={`${SIZE_CLASS[size]} rounded-md bg-gradient-to-br from-indigo-700 to-indigo-900 border border-indigo-950 shadow-md shrink-0 ${className}`} />
);

// Tek bir Okey taşının görsel temsili. Erişilebilirlik için sayının altında
// rengine karşılık gelen bir sembol de gösterilir (sadece renge güvenilmez).
const Tile = React.forwardRef(function Tile({ tile, selected, grouped, dragging, dimmed, size = 'normal', className = '', style, ...handlers }, ref) {
  if (!tile) return null;
  const colorClass = tile.isJoker ? 'text-purple-700' : COLOR_TEXT_CLASS[tile.color];

  return (
    <div
      ref={ref}
      style={style}
      className={`relative select-none touch-none ${SIZE_CLASS[size]} rounded-md bg-gradient-to-b from-amber-50 to-amber-100 border flex flex-col items-center justify-center shadow-md transition-transform
        ${selected ? 'ring-2 ring-yellow-400 -translate-y-2 border-yellow-400' : 'border-slate-400'}
        ${grouped ? 'ring-2 ring-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]' : ''}
        ${dragging ? 'opacity-30' : ''}
        ${dimmed ? 'opacity-60' : ''}
        ${className}`}
      {...handlers}
    >
      {tile.isJoker ? (
        <span className="text-lg sm:text-2xl leading-none">🃏</span>
      ) : (
        <>
          <span className={`text-base sm:text-xl font-black leading-none ${colorClass}`}>{tile.number}</span>
          <span className={`text-[10px] sm:text-sm leading-none mt-0.5 ${colorClass}`}>{COLOR_SYMBOLS[tile.color]}</span>
        </>
      )}
    </div>
  );
});

export default Tile;
