# Sınırlı sunucu hata tanısı

29 Ekim 2026. Kullanıcı kalan kontrollerden sonra canlı yayını açıkça yetkilendirdi. Bu değişiklik, önceki Okey kontrolünde görülen tek 500 hatasının kök nedenini bulmuş veya düzeltmiş sayılmaz; sonraki uygulama hatalarında ayrım yapabilmek içindir.

## Bulgu ve dosyaların gerekçesi

- **Kritik:** Bu değişiklik incelemesinde yeni kritik bulgu yok.
- **Orta:** Uygulamanın yakaladığı beklenmeyen SDK hatası güvenli genel 503 dönüyordu; hangi aşama veya hata sınıfında olduğu sunucu günlüğünde ayırt edilemiyordu. Ham hatayı yazmak token/veritabanı ayrıntısı sızdırabileceğinden eklenmedi.
- `server/diagnostics.js`: Yalnız sabit olay/aşama/kategori etiketleri kaydeder; aynı kategori/aşama dakikada bir, her çalışan süreçte toplam en çok sekiz kayıt. Bilinmeyen kod tek unknown kategorisine iner; rastgele hata kodları birikmez. Mesaj, stack, cause, token, UID, oda kodu, istek gövdesi, URL veya sağlayıcı yanıtı kaydedilmez.
- `server/http.js`: Yakalanan sunucu hatasını request/authentication/action/response aşamasına bağlar. Mevcut HTTP kodları, genel kullanıcı yanıtı, no-store, doğrulama ve işlem kimliği davranışı korunur. Normal başarı, beklenen 4xx reddi ve kapalı Preview tanı gürültüsü üretmez. Kayıt hatası API yanıtını değiştiremez.
- `server/diagnostics.test.js`: Gizli ayrıntılara erişmeme, 2000 farklı kodda sınırlı kayıt, tekrar/burst/zaman penceresi, bozuk günlük alıcısı, HTTP aşaması/yanıtı ve beklenen retlerin sessizliğini sınar.
- Bu belge ve mevcut giriş kayıtları: yayın kanıtını, sınırları ve her dosyanın nedenini korur.

Örnek güvenli kayıt: `{"event":"game_api_failure","phase":"action","category":"resource_exhausted"}`. Bu, SDK'nın bildirdiği sınıftır; tek başına günlük proje kotasının bittiğini kanıtlamaz. Oturum hizmeti, veritabanı yetkisi, süre aşımı ve bağlantı gibi bilinen sınıflar ayrılır; bilinmeyen ayrıntı uydurulmaz.

## Kontroller

- Bu turda taze 183 otomatik test geçti; normal komutta emülatör gerektiren 13 üst test atlandı. Altı yeni tanı testi bu toplamın içindedir.
- Kesintiden önce aynı sunucu kaynaklarıyla başlatılan tek birleşik demo emülatör paketi tamamlandı: 101 senaryo + 13 üst test = **114 başarılı sonuç**, 0 başarısız/atlanmış. Günlükte normal kapanış doğrulandı. Yalnız `demo-oyun-portali`, 127.0.0.1:8180/9199 kullanıldı; canlı veriyle yük testi yapılmadı. Sonraki değişiklik yalnız testte lint uyarısını gideren getter gövdesidir.
- Lint 0 hata/36 mevcut uyarı, mevcut kapsamda TypeScript ve tüm Production istemci bayrakları açık derleme geçti. Ana JS `index-Dhdlowt6.js` ve CSS `index-8Qk80MEt.css` öncekiyle aynı; görsel/tahta/Stockfish veya tarayıcı uygulama kodu değişmedi.
- Canlı kabul aşağıya eklenecek. Canlıya hata üreterek arıza/kota zorlanmayacak; hata sınıflandırması kontrollü testte doğrulanır.

## Kullanım ve sınırlar

Vercel Runtime Logs'da `game_api_failure` ara; istek günlüğündeki aynı zaman, durum ve deployment ile birlikte değerlendir. Kayıtlar mevcut Vercel altyapısındadır; yeni analiz SDK'sı, dış servis, kimlik bilgisi, ortam değişkeni, IAM veya ücretli hizmet yoktur. Bu bir alarm/izleme otomasyonu değildir.

Sınır **süreç başınadır**, bütün dağıtıma ait küresel hız sınırı değildir; soğuk/ayrı instance kendi sınırına sahiptir. Uygulama çalışmadan önceki platform hataları, süreç ölümü veya yakalayıcıya ulaşmayan kopmalar bu kayıtla garanti edilmez. Önceki `INTERNAL_FUNCTION_INVOCATION_FAILED` olayı için kök neden hâlâ açık. Brave/gerçek Android cihaz kabulü bu sunucu yayınının testi değildir.

**Düşük kaynak etkisi:** Normal istek günlük yazmaz; hata anındaki kayıtlar küçük ve sınırlıdır. Hız/kota/pil tasarrufu ölçülmedi. Paket uyarıları ve diğer denetim sınırları [OPERATIONS.md](OPERATIONS.md) içinde açık kalır.
