# Genel denetim kapanış kapsamı

29 Ekim 2026. Yedi oyunun sunucu doğrulaması, özel el/filo gizliliği, skor koruması ve eski oda/sayaç erişiminin kapatılması önceki canlı kabullerde tamamlandı. Bu kayıt, genel denetimin son dört başlığını ve doğrulama sınırlarını sabitler; yüzde veya bütün olası hataların bulunması garantisi değildir.

## 1. Dosya yolları ve HTTP yükleme ayarları

### Bulgular ve küçük düzeltme

- **Kritik:** Bu kapanış taramasında yeni kritik bulgu yok.
- **Orta:** Canlı HTML'de çerçeveye gömülmeyi sınırlandıran başlık yoktu. `vercel.json`, `frame-ancestors 'self'` ve `X-Frame-Options: SAMEORIGIN` ekler; diğer kökenlerden iframe içine alma engellenir. Aynı köken ve normal gezinme korunur. Bu tam bir XSS CSP politikası değildir.
- **Düşük:** İçerik hash'i taşıyan `/assets/` dosyaları da `max-age=0, must-revalidate` dönüyordu. Yalnız bu dizine bir yıl `immutable` tarayıcı önbelleği eklenir; içerik değişince Vite yeni dosya adı üretir. `public/` altındaki dosyalar bu dizine elle konmamalıdır.
- **Düşük:** Genel MIME sezme ve referrer başlıkları eksikti. `nosniff` ve `strict-origin-when-cross-origin` eklenir; doğru JS/CSS/WASM MIME türleri canlı kabulde sınanır.

HTML'nin yeniden doğrulanması, API'nin kendi `no-store` başlığı ve hash içermeyen Stockfish yollarının mevcut önbelleği korunur. İşlev, Firebase kuralı, ortam değişkeni, IAM, ücretli plan, zamanlanmış iş ve veri silme değişikliği yoktur.

### Kontroller

- Kaynak içindeki import/dynamic import/new URL yollarına odaklanan tarama 193 göreli başvuruda eksik dosya bulmadı. Dinamik üretilen tüm yollar veya dış bağlantılar için genel garanti değildir.
- Taze `npm test`: 175 başarılı, 0 başarısız, emülatör gerektiren 13 üst test atlandı. Bu değişiklikte sunucu emülatör paketi tekrar çalıştırılmadı; 28 Ekim'deki 101 senaryo/13 üst test/114 sonuç tarihsel kanıttır.
- Lint 0 hata/36 mevcut uyarı; TypeScript ve tüm Production istemci bayrakları açık derleme geçti. `App.tsx` içindeki mevcut `@ts-nocheck` nedeniyle tüm uygulama için tür güvenliği iddiası yoktur.
- Ana JS `index-C69f5u0L.js` (554173 bayt), CSS `index-8Qk80MEt.css` (65596 bayt) ve Satranç parçası `ChessGame-DUS35U02.js` (40136 bayt) önceki çıktıyla SHA256 düzeyinde aynı. Ana parça için 500 kB derleme uyarısı sürer.
- Yayın kabulü henüz yapılmadı; Ready, gerçek HTTP ve tarayıcı sonuçları aşağıya eklenecek.

### Tahmini hız etkisi

1. **Orta, tekrar ziyaret:** Sürümlü dosya hâlâ tarayıcı önbelleğindeyse yeniden doğrulama isteği gerekmeyebilir. İlk indirme boyutu veya ilk açılış hız kazancı yoktur; milisaniye/yüzde ölçülmedi.
2. **Orta potansiyel, uygulanmadı:** Yaklaşık 7,30 MB Stockfish WASM için içerik hash'iyle sürümleme gelecekte tekrar ziyaret indirmesini azaltabilir. Aynı adlı JS/WASM çiftine uzun immutable önbellek verilmedi; sürüm uyuşmazlığı riski vardır.
3. **Düşük/orta potansiyel, uygulanmadı:** Ana parçayı daha fazla bölmek ilk yükü azaltabilir; mevcut oyun tembel yüklemesi korunur. Ölçüm olmadan büyük paket düzenlemesi yapılmadı.

## Kalan üç kapanış başlığı

2. **Uyumluluk ve uzun oturum:** Mevcut dar ekran/oyun kabul kayıtlarını tek matriste birleştirmek; erişilebilir tarayıcıda kalan menü/gezinme/uzun oturum ve bellek gözlemlerini tamamlamak. Gerçek iPhone/Safari, Firefox ve fiziksel dokunmatik test edilmeden geçti sayılmayacak. Kısa masaüstü testinden uzun süre/yük garantisi çıkarılmaz.
3. **Bağımlılıklar, oturum ve kötüye kullanım:** 29 Ekim'deki taze npm taraması 0 yüksek/kritik ve aynı 8 orta kayıt gösterir; Admin/Google Cloud zincirindeki UUID uyarısı açıktır. Admin 14.5 önceki ayrı uyumluluk denemesinde başlamadığı için zorla yükseltilmez. API oturum kontrolü doğrudan Firestore dinleyicilerinin token iptalini anında kesmez; anonim UID/IP dolaşımı ve dağıtık yük kalan sınırlardır. Bunlar çalışır kabul edilen korumalarla birlikte açıkça raporlanacak; çözülmemiş riskler kapalı gösterilmeyecek.
4. **İşletim ve son teslim:** Spark/Hobby kota ve veri saklama/izleme seçeneklerini mevcut mimariye göre belgelemek; son bulgu/kanıt ve tam dosya paketlerini birleştirmek. Yeni zamanlanmış iş, veri silme veya ücretli hizmet ayrıca yetkilendirilmeden açılmaz.

Bu üç başlık yeni üç büyük oyun geçişi demek değildir. İnceleme sonunda somut yeni hata çıkarsa küçük düzeltme ve ilgili kabul eklenir; erişilemeyen ortamlar ve mimari sınırlar açık maddelerle teslim edilir.

Kaynaklar (29 Ekim 2026): [Vercel headers yapılandırması](https://vercel.com/docs/project-configuration/vercel-json), [Vercel önbellek başlıkları](https://vercel.com/docs/caching/cache-control-headers), [MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors), [UUID bildirimi](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Canlı sonuçlar kaynak belgelerden çıkarım değildir; aşağıdaki kabul kaydıyla doğrulanır.
