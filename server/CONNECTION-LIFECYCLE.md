# Oda bağlantısı: sayfaya dönüş ve ağ değişimi

28 Ekim 2026 — Yerel doğrulama tamamlandı; bu kayıt hazırlanırken yeni sürüm henüz yayımlanmadı. Ortak bağlantı katmanı yedi sunucu oyununda kullanılır. Oyun kuralları, skor hesapları, özel el/filo izinleri, CSS ve tahta ölçüleri değiştirilmedi. Yeni Firebase kuralı, ortam ayarı, IAM, anahtar, ücretli hizmet veya zamanlanmış iş yok.

## Bulgular

- **Kritik:** Bu dar bağlantı incelemesinde yeni kritik bulgu doğrulanmadı; genel denetimin tamamı kapanmış sayılmaz.
- **Orta:** Oda dinleyicisinde `pagehide` bağlantıyı bırakırken `pageshow` dinlenmiyordu. Geri yüklenen sayfa hemen bağlantı yenilemek yerine 15 saniyelik aralığı veya ayrı bir görünürlük olayını bekleyebilirdi.
- **Orta:** Eski bağlantının bekleyen isteği yeni dönüş isteğini engelleyebiliyor, geç hata yeni ekranı örtebiliyor ve çıkış bildiriminden sonra çalışan heartbeat eski bağlantıyı yeniden açabiliyordu. Pagehide sonrasında aralık da kendi başına yeni istek atmayı sürdürüyordu. Üç regresyon eski bağlantı mantığından ayrılan aynı kodla testte üretildi.
- **Düşük:** Çevrimdışı aralık istekleri gereksiz token/ağ denemeleri oluşturuyordu. Sadece sekme gizlendi diye oyuncuyu oyundan çıkarmak da doğru değildir; normal görünürlük değişiminin mevcut davranışı korundu.

## Küçük değişikliklerin gerekçeleri

- `src/hooks/roomConnection.js`: Oyun verisinden bağımsız tarayıcı bağlantı yaşam döngüsünü küçük bir yardımcıya ayırır; sayfadan ayrılınca durur, dönüşte yeni bağlantı kimliğiyle hemen devam eder ve geciken eski isteğin temizliği yalnız eski kimliği hedefler.
- `src/hooks/serverXoxRoom.js`: Mevcut Firestore dinleyicisini koruyup yardımcıyı bağlar; yeni sayfa kimliği uygulamanın normal ayrılma isteğinde de kullanılan ortak `xoxSessionId()` kaydına yazılır.
- `src/hooks/roomConnection.test.js`: Sayfa dönüşü, gecikmiş istek, çevrimdışı/çevrimiçi geçiş, sıradan görünürlük, on iki ağ değişimi ve dinleyici/zamanlayıcı temizliğini beş testte sınar.
- `server/xox-lifecycle.integration.test.js`: Geciken eski heartbeat/disconnect ardından yeni bağlantının, tahtanın, sıranın ve skorun korunduğunu; yeni kimlikle normal ayrılmanın çalıştığını gerçek emülatör transactionlarında doğrular.
- `server/okey.integration.test.js`: Eski bağlantı temizliği ve süre dolumu sonrası geri dönen insanın koltuğu, turu ve özel eli korunurken yeni kimlikle gerçek çıkışın hâlâ bota devrettiğini doğrular.
- `server/README.md`, `SECURITY-MIGRATION.md`, bu dosya: Güncel doğrulama kapsamını, yayın durumunu, her değişikliğin gerekçesini ve kapanmayan sınırları korur.

Ağ bağlantısı kesilip geri gelmesi sayfadan ayrılma değildir: `offline` sırasında istek durur; `online` aynı bağlantı kimliğiyle ve eski isteği beklemeden devam eder. Böylece Okey’in sekiz sekmelik sunucu sınırı sırf sık mobil ağ değişimiyle tüketilmez. Gerçek `pagehide` sonrası dönüş ise eski disconnect'in yeni sayfayı düşürmemesi için yeni kimlik kullanır. Sıradan sekme gizleme çıkış sayılmaz. Sunucunun mevcut bağlantı süresi/gerçek ayrılma/Okey bot devri kuralları aynen geçerlidir; uzun kayıp sırasında rakip odayı kapatır veya koltuk bota devrolursa eski oyuna sınırsız dönüş sözü verilmez.

## Doğrulama

- Eski bağlantı kodunda üç yeni regresyon başarısız, normal görünürlük/temizlik testi başarılı oldu; düzeltme sonrası beş bağlantı testi geçti.
- 148 otomatik test geçti; 13 emülatör üst testi bu normal komutta bilerek atlanır. Ayrı tek temiz birleşik emülatör çalıştırmasında 99 senaryo + 13 üst test = 112 sonuç geçti; sıfır başarısız/atlanan sonuç.
- İlk yeni Okey testinde yapay saat 60 saniye ilerletilirken ilgisiz hostun bağlantısı da yanlışlıkla eskitildi ve doğal bot devri `not_a_player` verdi. Test düzeneği diğer oyuncuyu çevrimiçi tutacak şekilde düzeltildi; ürünün Okey süre/bot kodu değiştirilmedi. Ardından birleşik paket tamamen geçti.
- Lint sıfır hata / 36 mevcut uyarı; mevcut TypeScript kontrolü ve tüm oyun bayrakları açık üretim derlemesi geçti. App dosyasının önceki tür kontrolü sınırı sürer.
- Yerel tarayıcıda iki bağımsız origin/oyuncu ile özel XOX odası kuruldu; hamle, başka belgeye gidip geri dönme, aynı tahta/skor ve karşı hamle, normal çıkış ve odanın kapanması geçti. Gözlenen iki konsolda hata/uyarı yoktu. Bu gerçek gezinme dönüşü bfcache’in kesin kullanıldığı kanıtı sayılmaz; olay sıraları ayrıca kontrollü testte sınandı. Tam yedi maç, uzun arka plan veya gerçek iOS/Safari/Firefox testi değildir.
- Ana JS `index-DZ7uDeHD.js`: 553,74 kB / gzip 172,05 kB; önceki gzip 171,85 kB’ye yaklaşık 0,20 kB ek. CSS `index-Tlx8d9Qx.css` değişmedi. Oyun parçası dosya adları ortak ana paket referansı nedeniyle değişebilir.

## Tahmini hız/kota etkisi ve açık sınırlar

1. **Orta, yalnız dönüş anında:** Bağlantı yenilemesi sıradaki 15 saniyelik aralığı beklemez; gerçek ağ gecikmesi ve tarayıcının olayı ne zaman verdiği yine etkilidir. Normal hamle hızı artışı iddia edilmez.
2. **Düşük:** Bilinen çevrimdışı veya ayrılmış sayfa durumunda 15 saniyelik aralık yeni oda API isteği üretmez; gerçek toplam kota/pil tasarrufu ölçülmedi. Ortak oyuncu sayacı bu aşamada değiştirilmedi.
3. **Düşük:** Bağlantı başına tek aralık ve temizlenen olay dinleyicileri; sayfadan ayrılırken bekleyen isteğin ek temizliği en fazla o eski istek sonlandığında çalışır. Sunucu bağlantı/oda sınırları korunur.

Kalan genel işler: sekiz orta bağımlılık kaydı, doğrudan Firestore dinleyicilerinde bütün kanalları kapsayan anlık token iptali, anonim UID/IP dolaşımı, gerçek cihaz ve uzun arka plan/yük testleri, saklama ve operasyonel izleme. Bu düzeltme bunları tamamlamaz.

Kaynaklar (28 Ekim 2026): [MDN pageshow](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event), [MDN pagehide](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event), [Chrome sayfa yaşam döngüsü](https://developer.chrome.com/docs/web-platform/page-lifecycle-api). Tarayıcılar özellikle mobilde bütün kapanış olaylarını güvenilir biçimde göndermez; mevcut sunucu süre dolumu bu nedenle korunur.
