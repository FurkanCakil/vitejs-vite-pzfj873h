import { useEffect, useState } from 'react';

// Telefon ekranı (özellikle YATAY çevrildiğinde) için düzen kararlarında
// kullanılan canlı görüntü alanı ölçüleri.
//
// `visualViewport` tercih edilir: adres çubuğu gizlenip görünürken
// `innerHeight` telefon tarayıcılarında güncellenmeyebiliyor ve oyun alanı
// ekranın dışına taşıyordu.
const read = () => {
  if (typeof window === 'undefined') return { width: 1024, height: 768 };
  return {
    width: Math.round(window.visualViewport?.width || window.innerWidth || 1024),
    height: Math.round(window.visualViewport?.height || window.innerHeight || 768),
  };
};

export default function useViewport() {
  const [size, setSize] = useState(read);

  useEffect(() => {
    const update = () => setSize((prev) => {
      const next = read();
      return (prev.width === next.width && prev.height === next.height) ? prev : next;
    });
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  // "compact": dikey alanı çok kısıtlı ekran — pratikte telefonun YATAY hali.
  // Bu modda oyun tek ekrana sığdırılır (üst alan kendi içinde kaydırılır) ve
  // ıstakanın yan bölmeleri taşların yanına alınıp taşlar büyütülür.
  const isCompact = size.height < 560 && size.width > size.height;
  const isPhone = size.width < 640;

  return { ...size, isCompact, isPhone };
}
