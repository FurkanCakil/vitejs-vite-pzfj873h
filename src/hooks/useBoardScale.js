import { useEffect, useRef, useState } from 'react';

// Telefonda tam ekranken SADECE TAHTAYI (üstteki başlık/skor tablosuna
// dokunmadan) altında kalan boş alanı dolduracak şekilde büyütür — gerekirse
// (alan yetmiyorsa) küçültür de. Önceki yaklaşım (useFitScale, kaldırıldı)
// başlık+skor+tahta hepsini TEK PARÇA halinde ekrana sığdırıyordu; bu da
// tahtanın gereğinden fazla küçülmesine yol açıyordu (kullanıcı raporu).
// Skor tablosu artık kendi doğal boyutunda kalıyor (gerekirse sayfa
// kaydırılarak görülür), sadece tahta kalan alanı kullanır.
//
// `active` false iken (masaüstü, tam ekran değilken, veya bu davranışı
// istemeyen oyunlarda) hiçbir stil uygulanmaz.
export default function useBoardScale(active, maxScale = 2.4) {
  const wrapRef = useRef(null);
  const boardRef = useRef(null);
  const [fit, setFit] = useState({ scale: 1, naturalW: 0, naturalH: 0, measured: false });

  useEffect(() => {
    if (!active) { setFit({ scale: 1, naturalW: 0, naturalH: 0, measured: false }); return undefined; }
    const wrap = wrapRef.current; const board = boardRef.current;
    if (!wrap || !board) return undefined;

    const recalc = () => {
      // offsetWidth/offsetHeight transform'dan etkilenmez — halihazırda bir
      // scale uygulanmış olsa bile hep DOĞAL (ölçeklenmemiş) boyutu verir.
      const naturalW = board.offsetWidth; const naturalH = board.offsetHeight;
      const availW = wrap.clientWidth;
      // `wrap` kendi transform edilmiyor, o yüzden konumu tahtanın altında
      // kalan gerçek boşluğu hesaplamak için güvenilir bir referans noktası.
      const viewportH = window.visualViewport?.height || window.innerHeight;
      const availH = viewportH - wrap.getBoundingClientRect().top - 10;
      if (!availW || !availH || !naturalW || !naturalH) return;
      const scale = Math.min(maxScale, availW / naturalW, availH / naturalH);
      setFit((prev) => (prev.scale === scale && prev.naturalW === naturalW && prev.naturalH === naturalH && prev.measured
        ? prev
        : { scale, naturalW, naturalH, measured: true }));
    };

    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(wrap);
    ro.observe(board);
    window.visualViewport?.addEventListener('resize', recalc);
    window.addEventListener('resize', recalc);
    return () => { ro.disconnect(); window.visualViewport?.removeEventListener('resize', recalc); window.removeEventListener('resize', recalc); };
  }, [active, maxScale]);

  const wrapStyle = active && fit.measured
    ? { height: Math.ceil(fit.naturalH * fit.scale), width: '100%', overflow: 'hidden', position: 'relative' }
    : undefined;
  const boardStyle = active && fit.measured
    ? { transform: `scale(${fit.scale})`, transformOrigin: 'top center', width: fit.naturalW, marginLeft: 'auto', marginRight: 'auto' }
    : undefined;

  return { wrapRef, boardRef, wrapStyle, boardStyle };
}
