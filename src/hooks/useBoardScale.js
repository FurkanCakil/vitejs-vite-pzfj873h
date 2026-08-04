import { useEffect, useRef, useState } from 'react';

// Telefonda tam ekranken SADECE TAHTAYI (üstteki başlık/skor tablosuna
// dokunmadan) ekrana sığdırır: tahta, ekranın büyük bir bölümünü kaplayacak
// kadar büyütülür; skor tablosu kendi doğal boyutunda kalır ve gerekirse
// yukarı kaydırılarak görülür. Böylece OYNAMAK için hiç kaydırma gerekmez.
//
// `active` false iken (masaüstü, tam ekran değilken, veya bu davranışı
// istemeyen oyunlarda) hiçbir stil uygulanmaz.
//
// ÖNEMLİ TASARIM NOTLARI (hepsi gerçek hatalardan çıkarıldı):
//
//  * Tahtaya inline `width` YAZILMAZ. Yazılırsa `offsetWidth` o sabit değeri
//    döndürmeye başlar ve "doğal genişlik" ölçümü sonsuza dek donar; telefon
//    dikeyden yataya çevrilince (Tailwind breakpoint'i değişip hücreler
//    büyüdüğü halde) tahta eski ölçüde kalıp içeriğin taşmasına / üst üste
//    binmesine yol açıyordu.
//
//  * `boardStyle`'da `flexShrink: 0` şart: sarmalayıcının yüksekliği sabit
//    olduğu için, tahta bir flex öğesiyse dikeyde EZİLİYOR (damada kareler
//    yassılaşıp taşlar oval görünüyordu). Sarmalayıcılar da blok düzeninde
//    tutulur.
//
//  * Kullanılabilir yükseklik, tahtanın ekrandaki KONUMUNDAN (getBoundingClientRect)
//    hesaplanmaz. Tam ekran içeriği dikeyde ortalandığı için konum ölçeğe,
//    ölçek de konuma bağlı olur ve değerler salınıma girer. Bunun yerine
//    "tahta DIŞINDAKİ içeriğin yüksekliği" (kart yüksekliği - sarmalayıcı
//    yüksekliği) kullanılır; bu değer ölçekten bağımsızdır.
export default function useBoardScale(active, { maxScale = 2.4 } = {}) {
  const wrapRef = useRef(null);
  const boardRef = useRef(null);
  const [fit, setFit] = useState({ scale: 1, naturalH: 0, measured: false });

  useEffect(() => {
    if (!active) { setFit({ scale: 1, naturalH: 0, measured: false }); return undefined; }
    const wrap = wrapRef.current; const board = boardRef.current;
    if (!wrap || !board) return undefined;

    const recalc = () => {
      // offsetWidth/offsetHeight transform'dan etkilenmez — halihazırda bir
      // scale uygulanmış olsa bile hep DOĞAL (ölçeklenmemiş) boyutu verir.
      const naturalW = board.offsetWidth; const naturalH = board.offsetHeight;
      const availW = wrap.clientWidth;
      const viewportH = window.visualViewport?.height || window.innerHeight;

      // Tahta dışındaki içerik (skor tablosu, durum yazısı, kart dolgusu):
      // ölçekten BAĞIMSIZ olduğu için ölçüm döngüye girmez.
      const card = wrap.offsetParent || wrap.parentElement;
      const otherH = card ? Math.max(0, card.offsetHeight - wrap.offsetHeight) : 0;

      // Tahta, kendisi dışındaki içerikten ARTAN alanı bire bir doldurur:
      // böylece OYNAMAK için hiç kaydırma gerekmez (kullanıcının asıl isteği).
      // Tahtaya daha çok yer açmanın yolu, ekranı taşırmak değil, yatayda
      // skor tablosunu sıkılaştırmaktır (bkz. oyun bileşenlerindeki
      // `boardFit` ile daralan başlıklar).
      const availH = viewportH - otherH - 16;
      if (!availW || availH <= 0 || !naturalW || !naturalH) return;

      const scale = Math.min(maxScale, availW / naturalW, availH / naturalH);
      setFit((prev) => (prev.scale === scale && prev.naturalH === naturalH && prev.measured
        ? prev
        : { scale, naturalH, measured: true }));
    };

    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(wrap);
    ro.observe(board);
    window.visualViewport?.addEventListener('resize', recalc);
    window.addEventListener('resize', recalc);
    window.addEventListener('orientationchange', recalc);
    return () => {
      ro.disconnect();
      window.visualViewport?.removeEventListener('resize', recalc);
      window.removeEventListener('resize', recalc);
      window.removeEventListener('orientationchange', recalc);
    };
  }, [active, maxScale]);

  const wrapStyle = active && fit.measured
    ? { height: Math.ceil(fit.naturalH * fit.scale), width: '100%', overflow: 'hidden' }
    : undefined;
  const boardStyle = active && fit.measured
    ? { transform: `scale(${fit.scale})`, transformOrigin: 'top center', flexShrink: 0 }
    : undefined;

  return { wrapRef, boardRef, wrapStyle, boardStyle };
}
