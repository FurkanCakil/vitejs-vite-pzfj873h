# Genel denetim kapanış kapsamı

29 Ekim son güncelleme: Kullanıcının açık yayın yetkisiyle sınırlı sunucu tanısı canlıya alındı; 183 otomatik test ve aynı kaynakla tamamlanmış 114 birleşik emülatör sonucu doğrulandı. Canlı API retleri, yeni özel XOX/Okey oda/çıkış/kapalı oda reddi başarılı; uygulama dosyaları aynı. Bu yeni bir genel cihaz kabulü veya eski tek 500 olayının çözümü değildir. Ayrıntılar [DIAGNOSTICS.md](DIAGNOSTICS.md) içinde; aşağıdaki önceki kapanış sayıları tarihsel kapsamlarını korur.

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
- [2c226f5 Production yayını](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/7vzykyDi3SXKVB9GNvn5fEGRAD73), 29 Ekim 19:10:29 GMT+3'te Ready oldu. Vercel yeni yapılandırmayı kabul etti; gerçek alan adındaki 14 sürümlü dosyanın tümü GET ile yerel çıktıyla birebir eşleşti ve immutable başlığını taşıdı.
- Canlı HTML 200 ve `max-age=0, must-revalidate`; Stockfish JS/WASM ve favicon 200, doğru MIME türü ve önceki yeniden doğrulama ayarıyla döndü. API GET 405 ve izinli Origin ile tokensız POST 401 verdi; ikisinde de `no-store` korundu. Genel dört koruma başlığı bu yanıtlarda doğrulandı. `/assets/` altındaki olmayan bir test yolu hâlâ 404 verdi; dizin kuralı bu yanıta da uzun önbellek başlığı ekler. Bu dizin yalnız Vite'ın değişmez içerik hash'li çıktılarına ayrılmalıdır; elle değişen dosyalar buraya konmamalıdır.
- Canlı tarayıcıda lobi/sayaç, gerçek Stockfish motorunun yüklenmesi, Orta botun beyazla e3 hamlesi/notasyon/insan sırası ve normal çıkış geçti. Gözlenen konsolda hata/uyarı yoktu. Bütün oyunlarda yeni tam maç veya gerçek cihaz testi yapıldığı iddia edilmez; oyun kaynakları ve CSS değişmedi.

Bu başlık tamamlandı. HTTP kabul kaydı `yukleme-baslik-kontrolu-2026-10-29.json`, canlı ekran `yukleme-baslik-canli-2026-10-29.png`; tüm değişen dosyalar gerekçeleriyle ZIP ve kopyalanabilir TXT olarak teslim edilir. `vercel.json` güvenli yanıt/önbellek davranışını ekler; bu belge kalan işi ve doğrulama sınırlarını sabitler; iki mevcut giriş belgesi yeni sonucu görünür kılar.

### Tahmini hız etkisi

1. **Orta, tekrar ziyaret:** Sürümlü dosya hâlâ tarayıcı önbelleğindeyse yeniden doğrulama isteği gerekmeyebilir. İlk indirme boyutu veya ilk açılış hız kazancı yoktur; milisaniye/yüzde ölçülmedi.
2. **Orta potansiyel, uygulanmadı:** Yaklaşık 7,30 MB Stockfish WASM için içerik hash'iyle sürümleme gelecekte tekrar ziyaret indirmesini azaltabilir. Aynı adlı JS/WASM çiftine uzun immutable önbellek verilmedi; sürüm uyuşmazlığı riski vardır.
3. **Düşük/orta potansiyel, uygulanmadı:** Ana parçayı daha fazla bölmek ilk yükü azaltabilir; mevcut oyun tembel yüklemesi korunur. Ölçüm olmadan büyük paket düzenlemesi yapılmadı.

## Kapanış başlıklarının güncel durumu

2. **Uyumluluk:** Erişilebilir Chromium'da mevcut sonuçlarla aşağıdaki yeni kontroller birleştirildi. Gerçek iPhone/Safari, Firefox, fiziksel dokunmatik ve çok saatli/yüklü bellek doğrulaması **açıktır**; kısa gezinme oturumuyla bu boşluklar kapatılmaz.
3. **Bağımlılıklar, oturum ve kötüye kullanım:** İnceleme ve kalan risk kaydı tamamlandı; risklerin kendisi çözülmüş sayılmadı. 29 Ekim taramasındaki 8 orta UUID zinciri, doğrudan Firestore token iptali ve anonim UID/IP dolaşımı için mevcut koruma ve sonraki koşul [OPERATIONS.md](OPERATIONS.md) içinde. Admin 14.5'in önceki başlatma hatası nedeniyle zorla ana sürüm yükseltilmedi.
4. **İşletim ve teslim:** Kota modeli, izleme/arıza sırası, saklama ve güvenli temizlik önkoşulları [OPERATIONS.md](OPERATIONS.md) içinde tamamlandı. Yeni alarm, zamanlanmış iş, veri silme veya ücretli hizmet açılmadı. Temizleme süresi onaylanmış politika değildir; mevcut veri korunur.

Bu kapanış, denetim ve yapılabilen doğrulamaların teslimidir; açık güvenlik ve dış ortam testlerini gizleyen bir “bütün site hatasız/güvenli” kabulü değildir. Bundan sonraki iş açık risk/ortam maddelerine göre seçilir; yeni bir büyük yeniden yazım varsayılmaz.

## 2. Hata kurtarmada oyuncu kimliği ve mobil kabul

### Bulgu, değişiklik ve nedenler

- **Kritik:** Bu aşamada yeni kritik bulgu yok.
- **Orta, düzeltildi:** Hata ekranındaki eski “Yerel Verileri Temizle”, adında firebase bulunan IndexedDB veritabanlarını silmeye çalışıyordu. Anonim kimliği kaybetmek oda koltuğuna dönüşü engelleyebilir; açık SDK bağlantıları silmeyi bekletebilir. Eski gerçek metot yalnız sahte veritabanı API'siyle çalıştırıldığında 1 silme girişimi, yeni işlevle 0 görüldü; canlı kimlik/veritabanı silinmedi.
- `src/components/ErrorBoundary.jsx`: Kurtarma yalnız oda kaydı temizliğine bağlanır; düğme “Oda Kaydını Temizle” olarak yaptığı işi söyler. Diğer “Masaya Geri Dön” yenilemesi korunur.
- `src/utils/savedRoomRecovery.js`: Aktif oda için sessionStorage ve eski localStorage kaydını korumalı siler, sonra yeniler; Firebase IndexedDB'ye veya isim/ses tercihlerine dokunmaz.
- `src/utils/savedRoomRecovery.test.js`: İki yeni test kimlik veritabanına hiç erişilmemesini, ilgisiz verilerin korunmasını ve iki depolamanın erişim/silme hatalarından sonra yeniden yüklemeyi sınar.
- Mevcut `roomRecovery.js` ve eski iki oda toparlama testi korunmuştur. Yeni yardımcı ayrı adla tutulur; isim çakışması yerelde fark edilip yayın öncesi giderildi.

### Doğrulama

- Yalıtılmış yerel gerçek ErrorBoundary ekranında düğmeye basıp yenileme sonrası iki oda kaydı null; IndexedDB kimlik işareti, isim ve ses tercihi aynı kaldı. Bu gerçek Firebase hesabı testi değil, gerçek tarayıcı depolaması ve gerçek bileşen testidir. 320 pikselde yatay taşma olmadı; kontrollü hata günlüğü fixture'ın beklenen sonucudur.
- Yeni toplam **177 otomatik test**, 0 başarısız; normal komutta emülatör gerektiren 13 üst test atlandı. Önceki 175 test korunur. Lint 0 hata/36 mevcut uyarı, tür kontrolü ve tüm Production istemci bayrakları açık derleme başarılı. Sunucu/kural değişmediği için birleşik emülatör paketi bu aşamada yeniden çalıştırılmadı; önceki 114 sonuç tarihsel kanıttır.
- Yeni ana JS `index-Dhdlowt6.js`, yaklaşık 553,96 kB / gzip 172,36 kB; CSS `index-8Qk80MEt.css` aynı. Oyun tahtası, CSS, seviye, kurallar ve Stockfish dosyaları değiştirilmedi. Kurtarma yolunda gereksiz veritabanı listeleme/silme kalktı (**düşük** kaynak etkisi); normal oyun hızı/yüzde kazancı ölçülmedi.

### Uyumluluk matrisi

| Ekran/akış | Bu turdaki kapsam | Sonuç / sınır |
| --- | --- | --- |
| Lobi ve 7 oyunlu eşleşme seçicisi | Canlı 320 piksel; sunucudan onaylı boş kuyruklar | Yatay taşma yok; seçici kapatılıp normal oyuna geçildi |
| XOX | Canlı yerel Kolay bot, 320/390; merkez hamlesi ve normal çıkış | 9 kare oranını korudu; tam maç tekrarı değil |
| Tavla | Canlı yerel Kolay bot açılışı, 320/390; zar düğmesi ve çıkış | Açılış kontrolleri taşmadı; bu tur tam maç yapılmadı |
| Dama | Canlı yerel Kolay bot tahtası, 320/390; çıkış | Ekran taşmadı; tam maç/taş alma kabulü önceki kayıtlardır |
| Connect 4 | Canlı yerel Kolay bot tahtası, 320/390; çıkış | Ekran taşmadı; tam maç tekrarı değil |
| Amiral Battı | Canlı yerel bot filo yerleştirme ekranı, 320/390; çıkış | Ekran taşmadı; önceki sürükleme/iptal kabulü tarihsel kayıt |
| Satranç | Canlı Orta bot, e4 ve bot yanıtı, 320/390 normal/tam ekran geçişi | 64 kare eş oran; tam ekranda notasyon gizli, çıkınca geri; oyun seviyeleri aynı |
| Okey | Yeni özel test odası/botlu masa, 320/390 ve 844×390 yatay; yenileme ve normal çıkış | Lobi/masa taşmadı; 30 ıstaka yuvasının içeriği yenilemeden sonra aynı; çıkışla lobi/sayaç geri geldi |

Canlı ölçüm dosyası `genel-denetim-mobil-kontrol-2026-10-29.json` içinde ekran/viewport genişliği tutulur. Bu, gerçek cihaz dokunma veya heap profili değildir. Kaynakta incelenen abonelik/interval/resize/worker temizliği için tek bir oturumdan “bellek sızıntısı yok” sonucu çıkarılmaz; fiziksel cihaz, çok saatli uyku ve yük/heap ölçümü kalan doğrulama işidir.

**Açık gözlem:** Mevcut `7c496f6` canlı sürümde Okey sırasında tek `service_unavailable` bağlantı uyarısı görüldü. Vercel Request Logs'da 29 Ekim 19:30:05 GMT+3 `/api/room-action` POST isteği 500 / `INTERNAL_FUNCTION_INVOCATION_FAILED` gösterdi; takip eden istekler 200 ve normal çıkış/lobi sayacı başarılıydı. Aynı pencerenin Runtime Logs görünümünde ek hata ayrıntısı yoktu. Konsol tamamen temiz diye sunulmaz; [bu kod tek başına uygulama veya ortam kök nedenini ayırt etmez](https://vercel.com/docs/errors/internal_function_invocation_failed). Kota aşımı veya kod hatası olduğu varsayılmadı; tekrarlanırsa aynı zaman/istek tanısıyla araştırılacak. Bu tek gözlem yeni kurtarma düzeltmesinden önce oluştu ve onunla düzelmiş sayılmaz.

### Yayın kabulü

[141686f kaynağının Production yayını](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/7n7RMLxPMTGXh2TfV7VUWuD3DLgC) 29 Ekim 19:33:00 GMT+3'te Ready oldu. Gerçek alan adının HTML'si yeni ana dosyayı kullanıyor; 14 sürümlü dosyanın tümü yerel derlemeyle birebir eşleşti. HTML güncelliği, frame-ancestors ve nosniff korundu. Bu aşamanın HTTP kayıt dosyası `genel-denetim-son-yayin-kontrolu-2026-10-29.json` içindedir.

Yeni sürümde lobi/sayaç, yeni özel XOX odası oluşturma ve yenilemeyle aynı odaya dönüş doğrulandı. İlk çıkış gözlemi tamamlanmadığından oda yeni sekmeden aynı kimlikle yeniden açıldı; normal çıkışın lobiye döndürmesi beklendi, ardından aynı kodla katılımın “Bu oda kapalı” reddi verdiği doğrulandı. Test odası sunucuda kapalıdır; bu son kısa kabulün gözlenen konsolu temizdi. Canlıda hata ekranı kasıtlı çökertilmedi; yeni kurtarma davranışının gerçek bileşen/IndexedDB kanıtı yukarıdaki yalıtılmış yerel testtir.

Geçici fixture ve sunucu kaldırılır; değişen yedi dosya gerekçeleriyle tam TXT/ZIP, bütün Git proje dosyaları ayrıca sürüm bilgili ZIP olarak teslim edilir. Fiziksel cihaz/çok saatli yük-heap ve yukarıdaki açık riskler bu teslimle kapanmaz. Saklama süresi kararı ve otomatik temizlik uygulaması yapılmadı; kayıt, ileride gerekecek onayın yerine geçmez.

Kaynaklar (29 Ekim 2026): [Vercel headers yapılandırması](https://vercel.com/docs/project-configuration/vercel-json), [Vercel önbellek başlıkları](https://vercel.com/docs/caching/cache-control-headers), [MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors), [UUID bildirimi](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Canlı sonuçlar kaynak belgelerden çıkarım değildir; aşağıdaki kabul kaydıyla doğrulanır.
