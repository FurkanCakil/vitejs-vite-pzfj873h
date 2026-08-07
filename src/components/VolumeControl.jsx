import React, { useEffect, useRef, useState } from 'react';
import { Volume2, Volume1, VolumeX } from 'lucide-react';
import { getVolume, setVolume, subscribeVolume } from '../utils/audioBus.js';
import { playSound } from '../utils/sound.js';

// Bilgisayardaki ses simgesinin aynısı: simgeye tıklayınca altında bir çubuk
// açılır, çubuk sürüklenerek seviye ayarlanır. TAMAMEN SOLA çekilince seviye 0
// olur ve tüm sesler tamamen kesilir (bkz. utils/audioBus.js).
//
// Bu bileşen uygulamada TEK ses kontrolüdür: hem lobide hem de bütün oyunların
// içinde aynı düğme görünür ve aynı (tarayıcıda kalıcı) tercihi yönetir.
//
// `variant`:
//   'header'   -> lobi/oda başlığındaki normal düğme
//   'floating' -> tam ekran ve telefon-yatay (başlığın gizlendiği) modlarda
//                 ekrana sabitlenen küçük düğme
export default function VolumeControl({ variant = 'header', className = '' }) {
  const [volume, setVol] = useState(() => getVolume());
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => subscribeVolume(setVol), []);

  // Panel dışına tıklanınca kapan. `pointerdown` kullanılır: telefonda `click`
  // beklenirse panel, dokunulan öğe tepki verdikten sonra kapanıyordu.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const percent = Math.round(volume * 100);
  const Icon = volume <= 0 ? VolumeX : (volume < 0.5 ? Volume1 : Volume2);

  // Seviye değiştikten SONRA (sürükleme bırakılınca / tuş kalkınca) kısa bir
  // "dın" çalar: kullanıcı yeni seviyeyi kulağıyla doğrulayabilsin. Sürükleme
  // BOYUNCA çalmaz, yoksa her pikselde bir ses üst üste binerdi.
  const previewLevel = () => { if (getVolume() > 0) playSound('countdownTick'); };

  const isFloating = variant === 'floating';
  const buttonClass = isFloating
    ? `text-slate-200 bg-slate-900/80 border border-slate-600 p-1.5 rounded-lg backdrop-blur-sm transition-colors ${volume <= 0 ? 'text-slate-500' : 'hover:text-white'}`
    : `flex items-center justify-center bg-slate-800 border border-slate-700 rounded-lg p-2 shadow-md transition-colors ${volume <= 0 ? 'text-slate-500 hover:text-slate-300' : 'text-slate-300 hover:text-white'}`;
  const iconClass = isFloating ? 'w-4 h-4' : 'w-5 h-5';

  return (
    // DİKKAT: Yüzen varyantta `relative` EKLENMEZ. Konum sınıfları Tailwind
    // çıktısında `.fixed` -> `.relative` sırasıyla üretildiği için, ikisi
    // birlikte yazıldığında `relative` kazanır ve düğme ekrana sabitlenmez.
    // `fixed` zaten konumlandırılmış bir kap olduğundan alttaki `absolute`
    // panel doğru hizalanır.
    <div ref={rootRef} className={`${isFloating ? '' : 'relative shrink-0'} ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={volume <= 0 ? 'Ses kapalı — seviyeyi ayarla' : `Ses seviyesi: %${percent}`}
        aria-label="Ses seviyesi"
        aria-expanded={open}
        className={buttonClass}
      >
        <Icon className={iconClass} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-[9500] bg-slate-800 border border-slate-600 rounded-xl shadow-2xl px-3 py-2.5 flex items-center gap-2 w-[190px]"
          // Panelin kendi içindeki tıklamalar dışarı sızıp (ör. oyun tahtası)
          // istemsiz bir hamleyi tetiklemesin.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => { setVolume(volume > 0 ? 0 : 1); }}
            title={volume > 0 ? 'Sesi kapat' : 'Sesi aç'}
            aria-label={volume > 0 ? 'Sesi kapat' : 'Sesi aç'}
            className="shrink-0 text-slate-300 hover:text-white transition-colors"
          >
            {volume <= 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={percent}
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
            onPointerUp={previewLevel}
            onKeyUp={previewLevel}
            aria-label="Ses seviyesi çubuğu"
            className="volume-slider flex-1 min-w-0"
            style={{ '--vol-fill': `${percent}%` }}
          />

          <span className="shrink-0 text-[11px] font-mono font-bold text-slate-300 tabular-nums w-8 text-right">
            {percent}
          </span>
        </div>
      )}
    </div>
  );
}
