# Sunucu zamanı ve Okey sayaçları

28 Ekim 2026 — Canlı doğrulama tamamlandı. `3dc01c3` kaynağı ana dala gönderildi ve [Production dağıtımı](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/CLYARUdtjpMVDEKiDFzYAaCHE11C) 18:44:37’de Ready oldu. Genel denetimin bu aşaması saat kaymasına odaklanır. Tahta/CSS, Stockfish seviyesi, oyun kuralları, puan hesabı ve sunucunun gerçek süre denetimleri değiştirilmedi. Yeni kural, IAM, anahtar, ortam ayarı, ücretli hizmet veya zamanlanmış iş yok.

## Bulgular ve gerekçeler

- **Kritik:** Bu dar zamanlayıcı/motor incelemesinde yeni kritik açık doğrulanmadı. Stockfish ve Tavla worker kapatma, bekleyen istek sonlandırma ve dinleyici kaldırma yolları incelendi; kesinleşmiş bir sızıntı bulunmadan yeniden yazılmadı. Bu bir uzun süreli bellek profili veya bütün motor hatalarının olmadığı garantisi değildir.
- **Orta:** Okey başlangıç, hazırlık, tur süresi ve otomatik başlangıç/tur denemeleri cihazın Date.now değerini kullanıyordu. Saat saatlerce yanlışsa sayaç sıfır/çok uzun görünebilir; arkadaki cihaz gecikmiş otomatik tur geçişi gönderebilir, öndeki cihaz gereksiz erken denemeler yapabilirdi. Sunucu zaten gerçek süreyi doğruladığından bu bir puan/süre hilesi açılışı değildir.
- **Orta:** Eski ortak sayaç düzeltmesi sabit bir wall-clock farkıydı. Cihaz saati daha sonra değişince sonuç yine sıçrıyor; geç gelen eski yanıt yeni zaman ölçümünün üzerine yazabiliyordu. İstemcinin geçersiz negatif zaman örneğini de kabul etmesi giderildi.
- **Düşük:** Okey’in sunucudan gelen işlek taş ipucunun görünme/bitme hesabı da cihaz saatine bağlıydı; aynı zaman tabanına geçirildi.

## Küçük değişiklikler

- `src/utils/serverClock.js`: Her sayfanın RAM’inde tek sunucu zamanı referansı ve monoton geçen süre tutar; en çok 30 saniyelik gidiş-dönüşü kabul eder, bozuk/negatif ve daha eski ölçümleri atlar. İlk geçerli cevap gelene kadar yerel saate döner. Hesap yalnız görsel/scheduling içindir; hamle yetkisi veya sunucunun zaman kararı bu değere dayanmaz.
- `server/http.js`: Başarılı doğrulanmış API yanıtına o anki sunucu zamanını ekler. Aynı işlem kimliğinin eski alındısı tekrar kullanılsa bile zaman güncel olur; oyun yazması yinelenmez. İstemciden zaman alanı kabul edilmez ve veritabanına zaman senkronizasyon kaydı yazılmaz.
- `src/utils/gameApi.js`: Yalnız başarılı yanıtın zamanını kullanır; token yenileme, güvenlik reddi ve aynı işlem kimliğiyle güvenli tekrar davranışı korunur. Token alma süresi ağ ölçümüne katılmaz.
- `src/utils/presenceProtocol.js`, `src/hooks/serverPresence.js`: Ortak oyuncu/oda listesi zamanı da aynı kaynaktan gelir. Mevcut heartbeat aralığı, kapasite, kimlik ve yetki akışı korunur; sahte/bozuk saat örneği kaynak olmaz.
- `src/games/okey101/okeyTiming.js`: Mevcut otomatik başlangıç/tur koşullarını saf yardımcıya ayırır; sıra/oyuncu gecikmesi, faz ve süre sınırlarını korurken sunucu zamanıyla deneme planlar. Geri sayım hesabı da burada ortaklaşır.
- `ServerOkey101Game.jsx`, `Okey101Lobby.jsx`, `SetupCountdown.jsx`, `TurnCountdown.jsx`: Mevcut küçük sayaç bileşenlerini ve tek saniyelik sürücüyü koruyarak bu hesapları kullanır; masanın tamamına yeni hızlı render döngüsü eklemez.
- `Okey101Game.jsx`: Sunucudan gelen işlek taş ipucunun görünürlüğünü ve kısa bitiş zamanlayıcısını ortak zamanla hesaplar; eski doğrudan yazma dalları yeniden yazılmadı.
- `serverClock.test.js`, `okeyTiming.test.js`, `gameApi.test.js`, `server/security.test.js`: Yanlış/sonradan değişen cihaz saati, geç yanıt, bozuk/yavaş örnek, oyuncu/faz sınırları, ortak aktif oyuncu sayısı, istemci zamanının gönderilmemesi/reddi ve tekrar yanıtta güncel sunucu zamanını sınar.
- `serverPresence.test.js`: Eski tek saat testi yeni kapsamlı saat testlerine taşındı; kapanış/gecikmiş heartbeat ve bağımsız sekme testleri korunur.
- `server/README.md`, `SECURITY-MIGRATION.md`, bu dosya: Aşama durumunu, gerekçeleri, kanıtları ve açık sınırları güncel tutar.

## Doğrulama

Eski hesap mantığında beş yeni test başarısız oldu: yanlış saatle sıfıra düşen Okey süresi, kalibrasyondan sonra cihaz saati değişimi, istek sırasında geri saat düzeltmesi, geç yanıtın yeni örneği ezmesi ve negatif örnek. Düzeltme sonrası 156 otomatik test geçti; normal komutta 13 emülatör üst testi bilerek atlanır. Tek temiz birleşik demo emülatör çalıştırmasında mevcut 99 senaryo + 13 üst test = 112 sonuç geçti. Lint sıfır hata/36 mevcut uyarı; mevcut TypeScript kontrolü ve tüm oyun bayrakları açık üretim derlemesi geçti. App dosyasının önceki tür kontrolü sınırı sürer.

Yalnız yerel geçici test sekmesi iki saat ileri Date.now ile açıldı; bilgisayarın saati değiştirilmedi. Gerçek demo Auth/Firestore/API ile özel Okey odası ve üç bot açıldı; başlangıç 3 saniye, hazırlık normal aralıkta gösterildi. Hazırlıkta +2 saatten -2 saate geçildiğinde kalan 22 saniye sıçramadı; faz otomatik bitti ve bot turu 44 saniye gösterdi. Botlar oynayıp insana geçti. İnsan sırasında yeniden +2 saate geçişte kalan 37 saniye saatlere/sıfıra sıçramadı. Normal saate geri dönülüp odadan çıkıldı; gözlenen konsol temizdi. Geçici sayfa/süreçler kaldırıldı. Bu tam doğal maç, OS saatini değiştirme, gerçek telefon/Safari/Firefox veya uzun uyku testi değildir.

Canlı kabulde uygulama dosyası yerel açık üretim çıktısıyla bayt düzeyinde eşleşti. Yeni gerçek anonim test kimliğiyle yalnız yeni özel XOX odası oluşturma, aynı işlem kimliğiyle aynı oda/sürümü koruyan tekrar, oda heartbeat, ortak sayaç heartbeat/leave ve normal oda çıkışı geçti. Başarılı yanıtlardaki serverNow tamsayısı HTTP Date zamanıyla makul aralıkta eşleşti; tekrar yanıtı güncel zamanı verdi. Oyun alındısı veya yetki alanına istemci zamanı eklenmedi.

Canlı tarayıcıda yalnız yeni özel Okey odası ve üç botla başlangıç, özel elin yüklenmesi, hazırlığın otomatik bitişi ve normal tur sayacı görüldü; normal çıkışla lobiye dönüldü. Gözlenen konsol temizdi. Mevcut oyuncu odalarına dokunulmadı; canlıda cihaz saatini değiştirme, tam doğal maç veya uzun uyku testi yapılmadı. Geçici dosyalar/sekme/süreçler temizlendi.

## Tahmini etki ve sınırlar

1. **Orta, cihaz saati yanlışken:** Gereksiz erken otomatik tur istekleri veya cihaz saatine bağlı uzun gecikme giderilir; doğru saatli normal maçın daha hızlı oynandığı iddia edilmez.
2. **Düşük:** Mevcut API/heartbeat yanıtları kullanılır; yeni ağ isteği, Firestore okuması/yazması veya zamanlayıcı yok. Başarılı oyun yanıtına yaklaşık 26 bayt zaman alanı eklenir; presence yanıtında alan zaten vardı. Gerçek toplam kota/pil/bellek kazancı ölçülmedi.
3. **Düşük paket etkisi:** Ana JS `index-C53b-HNc.js`, 554,05 kB / gzip 172,21 kB; önceki 172,05 kB’ye yaklaşık 0,16 kB ek. Okey parçası gzip 39,66 kB; CSS `index-Tlx8d9Qx.css` aynı. Diğer oyun parçalarının adları ortak ana paket referansından değişebilir.

Monoton zamanın OS uyku sırasında ilerlemesi platformlar arasında değişebilir. Mevcut sayfa/görünürlük/ağ dönüşü heartbeat’i ve her başarılı oyun yanıtı yeni referans sağlar; yanıt gelene kadar kusursuz uyku telafisi veya sıfır ağ gecikmesi sözü verilmez. Bir ölçümün yaklaşık hatası ağ/işlem gecikmesine bağlıdır. İlk başarılı yanıt öncesi ya da hizmet kesintisi ayrı sınırdır; gerçek bütün zaman kararları sunucuda kalır.

Genel denetimde sekiz orta bağımlılık kaydı, doğrudan Firestore dinleyicilerinin anlık token iptali, anonim UID/IP dolaşımı, gerçek cihaz/uzun arka plan/yük ve saklama/operasyonel izleme işleri açıktır.

Kaynaklar (28 Ekim 2026): [MDN performance.now ve uyku farkları](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now), [W3C High Resolution Time saat modeli](https://www.w3.org/TR/hr-time-3/). Bu kaynaklar zaman seçiminin nedenini açıklar; ürün testi yerel ve canlı kabul adımlarıyla sınırlıdır.
