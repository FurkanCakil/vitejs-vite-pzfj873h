import React from 'react';
import { COLOR_SYMBOLS, effectiveTile } from './tiles.js';

// 4. madde: eski sarı (amber-600, #d97706) kırmızı (red-600, #dc2626) ile aynı
// sıcak/turuncumsu aile içinde kaldığı için uzaktan/küçük boyutta birbirine
// karışabiliyordu. yellow-500 (#eab308) belirgin şekilde SARI bir tondur
// (kırmızıdan çok daha uzak bir renk tekerleği açısı), hem daha AÇIK hem de
// taşın kendi kehribar (amber-50/100) zemininden hâlâ net ayırt edilebilir.
const COLOR_TEXT_CLASS = { black: 'text-slate-900', red: 'text-red-600', blue: 'text-blue-600', yellow: 'text-yellow-500' };

const SIZE_CLASS = {
  normal: 'w-8 h-11 sm:w-11 sm:h-16',
  large: 'w-11 h-16 sm:w-14 sm:h-20',
  small: 'w-6 h-8 sm:w-7 sm:h-9',
};

// Sınıf tabanlı boyutlar için yaklaşık piksel genişlikleri — Sahte Okey'in
// iç içe halka deseni SVG olduğu için bir piksel ölçüsüne ihtiyaç duyar.
const SIZE_PX = { normal: 36, large: 48, small: 26 };

// "small" boyutu (gösterge, açılan eller, rakip attıkları, atma rozeti vb.)
// çok daha küçük bir kutuya sığdığı için rakam/sembol yazı boyutları da ayrı
// tutulur — aksi halde "normal" boyutun font'u küçük kutuyu taşırıp rakamın
// üstten, sembolün alttan kutuyu aşmasına (düzensiz görünüme) yol açıyordu.
const NUMBER_TEXT_CLASS = { normal: 'text-base sm:text-xl', large: 'text-xl sm:text-2xl', small: 'text-[10px] sm:text-xs' };
const SYMBOL_TEXT_CLASS = { normal: 'text-[10px] sm:text-sm', large: 'text-sm sm:text-base', small: 'text-[7px] sm:text-[8px]' };

// Bir taşın en/boy oranı. Istaka genişliğinden hesaplanan piksel boyutlu
// (`width` prop'lu) taşlarda yükseklik bu orandan türetilir.
export const TILE_ASPECT = 1.42;

// `width` (px) verildiğinde taş, sınıf tabanlı sabit boyutlar yerine TAM O
// genişlikte çizilir ve tüm yazı boyutları da orantılı küçülüp büyür.
// Istaka artık 15 sütunu ekrana sığdıracak şekilde taş genişliğini kendisi
// hesapladığı için (bkz. PlayerRack) hem telefonda hem tam ekranda yatay
// kaydırma çubuğu oluşmaz.
const pxStyles = (width) => ({
  box: { width: `${width}px`, height: `${Math.round(width * TILE_ASPECT)}px` },
  number: { fontSize: `${Math.max(8, width * 0.58)}px` },
  symbol: { fontSize: `${Math.max(6, width * 0.34)}px` },
});

// Taş arkasının deseni: tek bir baklava dilimi. Taşın ARKA yüzü artık ÖN
// yüzüyle AYNI (kehribar) renk ailesindedir — sadece deste/ters çevrilmiş
// taşları "boş" gösteren bu desenle ayırt edilir; mavi/indigo bir "kart
// sırtı" görünümü YOKTUR.
function BackPattern({ px }) {
  const size = Math.max(6, Math.round((px || SIZE_PX.normal) * 0.4));
  return <div style={{ width: size, height: size }} className="rotate-45 rounded-[2px] border-2 border-amber-300 bg-amber-200/60" />;
}

// Taşın arka (kapalı) yüzü. Hem çekme destesinde hem de oyuncunun uzun basarak
// TERS ÇEVİRDİĞİ taşlarda (bkz. PlayerRack uzun basma) kullanılır. Ön yüzle
// birebir aynı kehribar zemin/çerçeve kullanılır (bkz. BackPattern).
export const TileBack = ({ size = 'small', width = null, className = '' }) => (
  <div
    style={width ? { width: `${width}px`, height: `${Math.round(width * TILE_ASPECT)}px` } : undefined}
    className={`${width ? '' : SIZE_CLASS[size]} rounded-md bg-gradient-to-b from-amber-50 to-amber-100 border border-slate-400 shadow-md shrink-0 flex items-center justify-center ${className}`}
  >
    <BackPattern px={width || SIZE_PX[size] || SIZE_PX.normal} />
  </div>
);

// Sahte Okey'in yüz deseni: iç içe geçmiş halkalar. Gerçek okey setlerindeki
// "sahte okey" taşı gibi kendine ait bir desendir — üzerinde sayı YAZMAZ,
// çünkü temsil ettiği sayı zaten o elin Okey'idir ve onu Göstergeden çıkarmak
// oyuncunun işidir (bkz. 3. madde: Okey'i belli eden çerçeve/rozetler kaldırıldı).
function FakeOkeyFace({ px }) {
  // Ölçüler viewBox birimindedir; taş büyüyüp küçülürken halkaların kalınlık
  // oranı sabit kalır (piksele bağlı bir kalınlık, büyük taşlarda halkaları
  // birbirine yapıştırıp tek bir leke gibi gösteriyordu).
  const size = Math.round(px * 0.66);
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-label="Sahte Okey" role="img">
      <circle cx="50" cy="50" r="44" fill="none" stroke="#1e293b" strokeWidth="9" />
      <circle cx="50" cy="50" r="27" fill="none" stroke="#1e293b" strokeWidth="9" />
      <circle cx="50" cy="50" r="9" fill="#1e293b" />
    </svg>
  );
}

// 4. madde: normal taşlarda ana simgenin (rakam) ALTINDA hep küçük bir ikinci
// işaret (renk sembolü) bulunur; Sahte Okey'de halkaların altı BOŞ kalınca
// düzen bozuk/eksik görünüyordu. Bu üç küçük nokta, o alt-orta boşluğu
// normal taşlarla AYNI ritimde doldurur ama renk/sayı SÖYLEMEZ (kimliği
// belli etmez) — sadece "burası kasıtlı olarak farklı bir taş" izlenimini
// tamamlar.
function FakeOkeyMark({ px }) {
  const dot = Math.max(2, Math.round(px * 0.05));
  return (
    <div className="flex items-center justify-center" style={{ gap: `${dot}px` }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: dot, height: dot, backgroundColor: '#1e293b' }} className="rounded-full opacity-70" />
      ))}
    </div>
  );
}

// Tek bir Okey taşının görsel temsili. Erişilebilirlik için sayının altında
// rengine karşılık gelen bir sembol de gösterilir (sadece renge güvenilmez).
//
// 3. madde: Okey (joker) taşı artık HİÇBİR şekilde işaretlenmez — ne fuşya
// çerçeve ne de "O" rozeti. Okey'i Göstergeden çıkarıp fark etmek oyuncunun
// kendi işidir. Aynı şekilde Sahte Okey'in "S" rozeti de kaldırıldı; onun
// yerine taşın kendisi iç içe halkalarla çizilir (bkz. FakeOkeyFace).
// YARDIMLI MOD (kullanıcı isteği): "işlek" (masadaki açık bir pere oturan)
// taşlarda, alt-orta renk sembolünün YERİNE bu işaret çizilir — oyuncu hangi
// taşını masaya işleyebileceğini (ve hangisini atarsa +101 ceza yiyeceğini)
// bir bakışta görür.
//
// Neden renk sembolünün yerine ve neden YEŞİL: taşın dört olası rengi
// (siyah/kırmızı/mavi/sarı) dışında bir renk seçildiği için bu işaret asla
// "taşın rengi" sanılmaz; üstteki rakam yerinde durduğu için taşın kimliği de
// kaybolmaz. Sadece yardımlı mod açıkken görünür.
function TackableMark({ px }) {
  return (
    <span
      style={{ fontSize: `${Math.max(7, px * 0.36)}px` }}
      className="leading-none flex items-center justify-center text-emerald-600 drop-shadow-[0_0_2px_rgba(16,185,129,0.8)]"
      aria-label="İşlek taş"
    >
      ★
    </span>
  );
}

const Tile = React.forwardRef(function Tile({ tile, selected, grouped, dragging, dimmed, faceDown = false, tackable = false, okeyInfo = null, size = 'normal', width = null, className = '', style, ...handlers }, ref) {
  if (!tile) return null;
  const shown = effectiveTile(tile, okeyInfo);
  const colorClass = COLOR_TEXT_CLASS[shown.color] || 'text-slate-700';
  const px = width ? pxStyles(width) : null;
  const facePx = width || SIZE_PX[size] || SIZE_PX.normal;

  return (
    <div
      ref={ref}
      style={px ? { ...px.box, ...style } : style}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      className={`relative select-none touch-none [-webkit-user-drag:none] ${px ? '' : SIZE_CLASS[size]} rounded-md border bg-gradient-to-b from-amber-50 to-amber-100 flex flex-col items-center justify-center shadow-md transition-transform
        ${selected ? 'ring-2 ring-yellow-400 -translate-y-2 border-yellow-400' : 'border-slate-400'}
        ${grouped ? 'ring-2 ring-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]' : ''}
        ${dragging ? 'opacity-30' : ''}
        ${dimmed ? 'opacity-60' : ''}
        ${className}`}
      {...handlers}
    >
      {faceDown ? (
        <BackPattern px={facePx} />
      ) : tile.isJoker ? (
        <div className="flex flex-col items-center justify-center gap-0.5">
          <FakeOkeyFace px={facePx} />
          {tackable ? <TackableMark px={facePx} /> : <FakeOkeyMark px={facePx} />}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-0.5">
          <span style={px?.number} className={`${px ? '' : NUMBER_TEXT_CLASS[size]} font-black leading-none flex items-center justify-center ${colorClass}`}>{shown.number}</span>
          {tackable
            ? <TackableMark px={facePx} />
            : <span style={px?.symbol} className={`${px ? '' : SYMBOL_TEXT_CLASS[size]} leading-none flex items-center justify-center ${colorClass}`}>{COLOR_SYMBOLS[shown.color]}</span>}
        </div>
      )}
    </div>
  );
});

// PERFORMANS: Aynı taş, aynı görsel durumla (Firestore'dan yeni veri gelmediği
// sürece `tile`/`okeyInfo` referansları SABİT kalır) tekrar tekrar render
// edilmesin diye memoize edilir. Bu, ıstakadaki 30 slot dışındaki taşların
// (rakip attıkları, gösterge, açılan eller, çekme/atma bölmeleri) ilgisiz bir
// state değişikliğinde (ör. 30sn geri sayımın her 250ms'de bir tetiklenmesi)
// gereksiz yere yeniden çizilmesini engeller.
export default React.memo(Tile);
