import { useEffect, useRef, useState } from 'react';

// Telefonda tam ekranken bir oyunun tahtası + skor tablosu ekran yüksekliğine
// SIĞMIYORSA (kaydırmadan tamamı görünmüyorsa) içeriği oranlı küçültüp
// (CSS transform: scale) tam olarak kalan alana oturtur. `active` false iken
// (masaüstü, tam ekran değilken, veya bu davranışı istemeyen oyunlarda —
// örn. 101 Okey ve Amiral Battı, orada kendi düzenleri zaten farklı çalışıyor)
// hiçbir stil uygulanmaz, içerik olduğu gibi render edilir.
//
// `outerRef`, boyutu içerikten BAĞIMSIZ (CSS ile sabit — örn. h-[100dvh])
// gerçek "kullanılabilir alan" öğesine aittir; döngüsel ölçüm sorunu
// yaşamamak için bu ref'in yüksekliğini biz asla JS ile değiştirmeyiz.
export default function useFitScale(active, outerRef) {
  const innerRef = useRef(null);
  const [fit, setFit] = useState({ scale: 1, naturalW: 0, naturalH: 0, measured: false });

  useEffect(() => {
    if (!active) { setFit({ scale: 1, naturalW: 0, naturalH: 0, measured: false }); return undefined; }
    const outer = outerRef.current; const inner = innerRef.current;
    if (!outer || !inner) return undefined;

    const recalc = () => {
      const cs = getComputedStyle(outer);
      const availW = outer.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
      const availH = outer.clientHeight - parseFloat(cs.paddingTop || '0') - parseFloat(cs.paddingBottom || '0');
      // offsetWidth/offsetHeight transform'dan etkilenmez — halihazırda bir
      // scale uygulanmış olsa bile hep DOĞAL (ölçeklenmemiş) boyutu verir.
      const naturalW = inner.offsetWidth; const naturalH = inner.offsetHeight;
      if (!availW || !availH || !naturalW || !naturalH) return;
      const scale = Math.min(1, availW / naturalW, availH / naturalH);
      setFit((prev) => (prev.scale === scale && prev.naturalW === naturalW && prev.naturalH === naturalH && prev.measured
        ? prev
        : { scale, naturalW, naturalH, measured: true }));
    };

    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [active, outerRef]);

  const wrapperStyle = active && fit.measured ? { height: Math.ceil(fit.naturalH * fit.scale), overflow: 'hidden' } : undefined;
  const innerStyle = active && fit.measured ? { transform: `scale(${fit.scale})`, transformOrigin: 'top center', width: fit.naturalW, flexShrink: 0 } : undefined;

  return { innerRef, wrapperStyle, innerStyle };
}
