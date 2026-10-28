# Oyuncu sayacında ağ ve sayfa dönüşü

28 Ekim 2026 — `92436a9` ana dala gönderildi; [Production yayını](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/5GsQfMa7EE7kJpvfYiiDVM2b5arM) 23:20:31’de Ready oldu. Genel denetimin bu dar aşaması aktif oyuncu sayacının istemci bağlantı yaşam döngüsünü düzeltir. UID/sayım/zaman kararları sunucuda kalır. Sekme/hız/kapasite sınırları, 20 saniye heartbeat ve 75 saniye tazelik korunur. Yeni API, Firebase kuralı, IAM, ortam ayarı, anahtar, ücret veya zamanlanmış iş yok. Oyunlar, CSS/tahta ve skorlar değişmedi.

## Bulgular ve karar

- **Kritik:** İncelenen bölümde yeni kritik erişim açığı doğrulanmadı. Doğrudan Firestore token iptali ve UID/IP dolaşımı önceki açık sınırlar olarak kalır.
- **Orta:** Offline sonrasında görünürlük/pageshow, sayaç bağlantısını ağ hâlâ kapalıyken yeniden açabiliyordu. Başlangıçta navigator.onLine=false de dikkate alınmıyordu. Çevrimdışı olduğu bilinen sayfa yeni heartbeat başlatmaz.
- **Orta:** Her offline/online yeni kimlik oluşturup eski kimliği emekliye ayırıyordu; hızlı mobil ağ geçişleri sunucunun sekiz aktif/en fazla 16 toplam sekme geçmişini tüketebiliyordu. Ağ değişimi aynı sunucu oturumunu korur; gerçekten pagehide ile ayrılma sonrası pageshow yeni kimlik kullanır. Sunucu sınırları yükseltilmedi.
- **Düşük:** Ağdan dönüş eski bekleyen isteği beklemez; eski istekten gelen sonuç/hata güncel bağlantıyı veya saat ölçümünü değiştirmez. Park edilmiş sayfa sıradan visibilitychange ile tekrar açılmaz.

Ağ kopması sırasında leave gönderilmez; bu istek çevrimdışıyken güvenilir biçimde teslim edilemez. Başka sekme yoksa kopan kişinin görünürlüğü mevcut 75 saniyelik sunucu tazeliği ve lobinin beş saniyelik yeniden sayım aralığıyla biter. Sıfır gecikmeli gerçek bağlantı/human sayımı garantisi değildir. Sayfadan ayrılma/kapanış normal keepalive leave ve geç heartbeat temizliğini kullanmaya devam eder.

## Her dosyanın gerekçesi

- `src/hooks/serverPresence.js`: Ağ kaybı, park edilmiş sayfa ve kapatılmış oturumu ayırır; ağ dönüşünde aynı kimlikle yeni yerel istek tutucusu kullanır ve geç yanıtı sınırlar.
- `src/hooks/serverPresence.test.js`: Önceki ağda yeni kimlik beklentisini düzelterek sekiz yeni davranış testi ekler; toplam on yaşam döngüsü testi kapanış, çevrimdışı açılış, görünürlük, 20 ağ geçişi, eski yanıt, sunucunun emekliye ayırdığı kimlik ve dinleyici temizliğini kapsar.
- `server/presence.integration.test.js`: Gerçek demo transaction'larıyla 20 ağ dönüşünde tek sunucu oturumu ve normal son çıkışta genel özetten kalkmayı sınar.
- Bu dosya, `server/README.md`, `SECURITY-MIGRATION.md`, `server/PRESENCE-ROLLOUT.md`: Güncel davranışı ve eski aşamanın tarihsel sınırlarını kaydeder.

## Doğrulama

Eski kodda beş regresyon başarısız oldu. Düzeltme sonrası 170 otomatik test geçti; normal komutta 13 emülatör üst testi bilerek atlanır. Lint sıfır hata/36 mevcut uyarı, mevcut TypeScript kontrolü ve bütün oyun bayrakları açık üretim derlemesi başarılı. App dosyasının önceki tür kontrolü sınırı sürer.

Tek temiz demo Auth/Firestore emülatör çalıştırmasında 100 senaryo + 13 üst test = 113 başarılı sonuç, sıfır hata elde edildi (yaklaşık 38,3 saniye test süresi). Yeni senaryo gerçek özel/genel presence kayıtlarını kullandı; yapay sunucu saatinde her döngü bir saniye ilerleyerek 20 ağ kopma/dönme uyguladı. API çağrıları gerçek serverPresence yordamından gerçek demo Firestore transaction'larına gitti; pencere/görünürlük olayları EventTarget ile kontrollüydü. Tek session kaydı korundu, too_many_tabs/too_many_actions olmadı ve son normal leave genel üyeyi kaldırdı. Sekme/hız sınırlarını gerçekten aşan mevcut ret testleri de geçti; limitler gevşetilmedi.

Bu donanım ağını kapatıp açma, gerçek telefon/Safari/Firefox, uzun uyku/bellek/yük veya bütün oyunların yeni tam maç testi değildir. Yeni başlatılmayan istek kontrolü navigator.onLine ve browser olaylarının bildirdiği durumla sınırlıdır; onLine=true gerçek internet erişimini garanti etmez. Mevcut başarısız API hata akışı korunur.

Canlı ana JS ve CSS yerel açık üretim çıktısıyla bayt düzeyinde eşleşti. Aynı mevcut test kimliğiyle iki canlı sekmede bir oyuncu görüldü; bir sekmeden başka belgeye gidip geri dönünce sayaç bir kaldı, diğer sekme kapanınca kalan sayfa çalıştı. Eşleşme seçicisinde yedi oyun Bekleyen yok gösterdi; gözlenen konsol temizdi. Eşleşme başlatılmadı, oda veya diğer kullanıcı verisi değiştirilmedi. Bu gezinmenin bfcache kullandığı kesinleştirilmedi; sentetik ağ olayları gerçek ağ kesintisi değildir. Ağ/istek yarışları otomatik ve demo transaction testleriyle sınırlıdır. Demo emülatörleri normal kapandı.

## Tahmini etki

1. **Orta doğruluk:** Sık ağ değişimi sekme geçmişini gereksiz tüketmez; sayacın sunucu limitine takılması önlenir. Diğer gerçek sekmelerin sınırları korunur.
2. **Düşük istek/kayıt etkisi:** Denetlenen 20 ağ döngüsünde 20 yeni kimlik/leave yerine tek kimlik kullanılır; çevrimdışı heartbeat başlamaz. Toplam kota/pil/bellek tasarrufu veya gerçek saldırı yükü kazancı ölçülmedi.
3. **Düşük paket etkisi:** Ana JS gzip 172,22 → 172,27 kB; Okey gzip 39,97 kB ve CSS `index-Tlx8d9Qx.css` aynı. Diğer oyun parçalarının hash değişimi ortak ana dosya referansından olabilir.

Lobi/oda dinleyicilerinin unmount yolları ve erişim doğrulama akışı da incelendi; bu aşamada yeni bir izin değişikliği yapılmadı. Genel denetim; son taramadaki sekiz orta bağımlılık kaydı, doğrudan Firestore iptali, anonim UID/IP dolaşımı, gerçek cihaz/uzun arka plan/yük ve operasyonel saklama/izleme sınırları nedeniyle tamamlanmış değildir.

Kaynaklar (28 Ekim 2026): [MDN navigator.onLine ve sezgisel sınırları](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine), [MDN online olayı](https://developer.mozilla.org/en-US/docs/Web/API/Window/online_event). Bunlar platform semantiğini destekler; ürün kabulü yukarıdaki testlerle sınırlıdır.
