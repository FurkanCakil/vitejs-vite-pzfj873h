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
- [02fdde1 Production yayını](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/2Zjkz9RGcB4yEXiBcnj4fj8L3P25) 29 Ekim 19:56:28 GMT+3'te Ready oldu. Canlı 14 uygulama dosyasının tümü yerel çıktıyla aynı; GET 405, tokensız POST 401, yabancı Origin POST 403 ve üçünde de no-store doğrulandı. HTTP kabulü `sunucu-tani-canli-http-2026-10-29.json` dosyasında.
- Canlı tarayıcıda sayaç/lobi, yeni özel XOX oda/yenilemeyle aynı masaya dönüş/normal çıkış ve yeni özel Okey oda/normal çıkış geçti. İki odanın da çıkıştan sonra yeniden katılımı “Bu oda kapalı” ile reddedildi; açık test odası bırakılmadı. Gözlenen konsolda hata/uyarı yoktu. Bu iki tam maç veya gerçek Brave/Android testi değildir.
- Canlıya hata üretilerek arıza/kota zorlanmadı. Hata sınıflandırması ve gerçek günlük alıcısının başarısız olması kontrollü testte doğrulanır. Önceki tek 500 olayı tekrarlanmadığı için onun giderildiği sonucu çıkarılmaz.

## Kullanım ve sınırlar

Vercel Runtime Logs'da `game_api_failure` ara; istek günlüğündeki aynı zaman, durum ve deployment ile birlikte değerlendir. Kayıtlar mevcut Vercel altyapısındadır; yeni analiz SDK'sı, dış servis, kimlik bilgisi, ortam değişkeni, IAM veya ücretli hizmet yoktur. Bu bir alarm/izleme otomasyonu değildir.

Sınır **süreç başınadır**, bütün dağıtıma ait küresel hız sınırı değildir; soğuk/ayrı instance kendi sınırına sahiptir. Uygulama çalışmadan önceki platform hataları, süreç ölümü veya yakalayıcıya ulaşmayan kopmalar bu kayıtla garanti edilmez. Önceki `INTERNAL_FUNCTION_INVOCATION_FAILED` olayı için kök neden hâlâ açık. Brave/gerçek Android cihaz kabulü bu sunucu yayınının testi değildir.

Mevcut `OPERATIONS.md` tanı kaydını kullanma sınırını; `AUDIT-CLOSEOUT.md`, `README.md` ve ana güvenlik kaydı güncel test/yayın durumunu görünür kılar. Değişen sekiz dosyanın tamamı gerekçeleriyle ZIP/TXT olarak teslim edilir. Yerel günlükler sonuç kaydı alındıktan sonra kaldırılır.

**Düşük kaynak etkisi:** Normal istek günlük yazmaz; hata anındaki kayıtlar küçük ve sınırlıdır. Hız/kota/pil tasarrufu ölçülmedi. Paket uyarıları ve diğer denetim sınırları [OPERATIONS.md](OPERATIONS.md) içinde açık kalır.
