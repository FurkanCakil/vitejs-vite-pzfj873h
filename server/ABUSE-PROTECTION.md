# API kötüye kullanım ve oturum kontrolü

27 Ekim 2026 — Hazırlık aşaması. Hesap durumu kontrolü varsayılan kapalı `AUTH_SESSION_CHECK_ENABLED` ayarı arkasındadır; bu kayıt anında yeni sürüm canlıya gönderilmedi, ayar açılmadı ve Vercel Firewall taslağı yayımlanmadı. Mevcut Firebase oda kuralları, IAM, hizmet hesabı, anahtar ve planlar değişmez.

## Bulgular ve küçük düzeltmeler

- **Orta:** Başarılı işlemler için UID başına veritabanı hız sınırı var; reddedilen girişimler sayılmaz ve yeni anonim UID aynı kişinin önceki sınırını devralmaz. API'nin önündeki Production'a özel IP tabanlı WAF kuralı, tek IP'deki farklı UID ve hatalı isteklerin toplamına kaba bir üst sınır getirir. Bu tekil insan doğrulaması değildir.
- **Orta:** İstemci, JSON olmayan 429/403/503 yanıtını bağlantı kaybı sayıp aynı isteği yeniden gönderiyordu. Sorun eski kaynakla testte yeniden üretildi; artık HTTP reddi doğru mesajla tek sefer işlenir. Başarılı isteğin yanıtı gerçekten kaybolursa aynı işlem kimliğiyle güvenli tekrar korunur.
- **Orta:** İmza/proje/süre denetimi tek başına hesabın sonradan kapatıldığını veya silindiğini sormaz. Yeni kontrol, resmi Admin SDK imza doğrulamasından **sonra**, yalnız o ID token'ın kendi hesabını Firebase `accounts:lookup` üzerinden sorar. İstek yalnız `idToken` içerir; UID filtresi veya yönetici kimliği gönderilmez. Yeni IAM izni gerekmez. Karşılık başka UID içerirse işlem yapılamaz.
- **Düşük:** Hesap hizmeti kesintisini yanlışlıkla 401 saymak token yenilemesini tetikleyebilirdi. Geçici hizmet/config/kota hatası artık güvenli 503 `authentication_unavailable`; hiçbir oyun yazması yapılmaz. Token yenilemesi sırasında kapatılmış hesap hatası da gereksiz ikinci HTTP isteği göndermeden anlaşılır mesajla biter.

## Oturum kontrolünün sınırı ve maliyeti

`AUTH_SESSION_CHECK_ENABLED=true` yalnız Production'da açılmak üzere hazırlanır. Mevcut `VITE_FIREBASE_API_KEY` genel proje anahtarı kullanılır; bu kalıcı hizmet hesabı anahtarı değildir. Üretim derlemesi, ayar açıksa gerekli anahtarın varlığını değerini yazdırmadan kontrol eder. Önizleme/yerel süreç üretim oyun API'sini açamaz. İstemci SDK'sı değiştirilmez.

- Her istekte mevcut Admin SDK imza/issuer/proje/son kullanım doğrulaması yine çalışır. Önbellek bu kontrolün yerine geçmez.
- Kullanıcının hesabına ait yanıtın UID'si eşleşmeli. Disabled/eksik/geçersiz/süresi geçmiş token yanıtı reddedilir. Firebase bir `validSince` sınırı döndürürse JWT'nin ilk `auth_time` değeriyle ayrıca karşılaştırılır; son token üretim zamanı `iat` ile kıyaslanmaz.
- Yeni anonim hesapta `validSince` olmayabildiği gerçek canlı kendi-test-hesabı yanıtıyla görüldü. Bu alan uydurulmaz; varsayılan 0'dır ve Firebase backend'in token/hesap reddi esas alınır. Bu yol, ayrı yönetici `checkRevoked` yetkisi verildiği veya bütün doğrudan Firebase okuma kanallarının anında iptal edildiği şeklinde sunulmaz.
- Olumlu sonuç aynı token için en çok 60 saniye / token bitimine kadar; bilinen olumsuz sonuç en çok 10 saniye tutulur. Hesap kapatma işlemi anlık bütün sunuculara yayılmış sayılmaz. Her yeni token yeniden kontrol edilir.
- Yalnız token+UID'nin SHA-256 özeti ve izin/son kullanım bilgisi RAM'de tutulur; ham token, e-posta/profil, IP ve hesap yanıtı saklanmaz veya loglanmaz. En çok 512 kayıt ve 32 eşzamanlı farklı sorgu; aynı sorgular birleştirilir. Sınır veya backend sorunu 503 verir, kontrol edilmemiş hesabı geçirmez. Zamanlayıcı/cron/veritabanı kaydı yoktur.
- Firebase çağrısı 5 saniyede zaman aşımına uğrar. Kesintide mevcut olumlu cache kendi süresi kadar kullanılabilir, sonra işlem geçici durur; kullanıcıya tekrar denemesi söylenir. Yeni anonim kimlik üretme/sign-out döngüsü eklenmez.

**Kalan sınır:** Firestore SDK'sının doğrudan oda/özel görünüm okumaları mevcut UID üyelik kurallarını kullanmaya devam eder. API'deki ek hesap kontrolü bu dinleyicilere uygulanmaz; stateless token'ın doğal süresi ve mevcut Firebase davranışı sürer. Anında bütün kanalları iptal etmek ayrı metadata/kural/işletim tasarımı gerektirir. Anonim UID/IP değiştirme de tam önlenmiş sayılmaz.

## Hazırlanan WAF kuralı

YapAI / `vitejs-vite-pzfj873h-1hy2`, yalnız Production; normalize Request Path **`/api/` ile başlar**; Fixed Window, **IP başına 1200 istek / 60 saniye**, aşımda 429. Bu endpoint altında şu anda tek oyun/ortak sayaç API'si vardır. Sayfa, görsel, script ve Firebase'in doğrudan bağlantıları bu kurala girmez. Üye başına mevcut sunucu sınırları ayrıca korunur.

Eşik, ortak okul/mobil NAT arkasındaki birkaç oyuncunun normal heartbeat/hamle trafiğine alan bırakır; kalabalık ortak ağ için sınırsız kullanım garantisi değildir. Sayaçlar bölge bazlıdır; farklı IP/bölgeler ve dağıtık saldırı genel proje kotasını yine zorlayabilir. Tam yük veya botnet testi yapılmaz. Hobby bir hız sınırı kuralı ve bir milyon allowed-request hakkı sunar; bu yeni ücretli plana/ödeme hesabına geçiş değildir ve sınırsız ücretsiz kullanım sözü vermez. Uygulama önünde reddedilen istek Firestore'a ulaşmaz.

## Doğrulama ve yayın sırası

1. Eski JSON-olmayan-yanıt hatası testte üretildi; yeni kodla HTTP redleri tekrarlanmaz, normal kayıp yanıt/aynı işlem kimliği ve 401'de tek yenileme korunur.
2. Token önbelleği, sorgu birleştirme/kapasite, bitiş, iptal zamanı, yeni token, backend hatası ve gizli ayrıntıların yansımaması birim testleriyle sınandı.
3. Yalnız demo emülatöründe gerçek token ile geçiş; test hesabını kapatma/yeniden açma, yapay iptal sınırı ve silinmiş test hesabının API yazmalarını durdurması doğrulandı. Canlı hesaplar bu yerel testte değiştirilmedi.
4. İlk birleşik pakette bir XOX eşleşme senaryosu başka test dosyalarının aynı kuyruğu farklı yapay saatlerle değiştirmesinden bozuldu. XOX yaşam döngüsü ve zaman sırası testlerine ayrı artifact alanları verildi; gerçek transaction yarış testleri korunur. Ürün oyun kodu bu nedenle değiştirilmedi. Alan ayrımından sonra aynı birleşik paket 97 senaryo / 13 üst testle 110 sonuç verdi; hepsi geçti.
5. 143 otomatik test, sıfır lint hatası/36 mevcut uyarı, tür/derleme ve birleşik 110 emülatör sonucu geçti; sonraki adımda kapalı ayarla kaynak yayımlanıp Ready ve mevcut oyunlar doğrulanır.
6. Ardından tek yeni Production oturum ayarı açılır, yeni ayarla dağıtım doğrulanır ve WAF taslağı yayımlanır. Gerçek kendi-test-kimliğinde normal işlemler; varsa yalnız kendi test hesabında kapatma/yeniden açma kontrolü; yedi yeni özel oda/sayaç ve yetkisiz erişim reddi denenir. Büyük istek yağmuru yapılmaz, sınırın yük altında aşıldığı iddia edilmez.

Yerel açık istemci derlemesi: ana JS `index-DtGtTNDz.js`, 553,11 kB / gzip 171,85 kB; önceki 171,66 kB'ye yaklaşık 0,19 kB ek. CSS `index-Tlx8d9Qx.css` değişmedi. Yeni ücretli paket bağımlılığı yok; sekiz orta UUID paket uyarısı bu aşamanın çözümü değildir.

## Tahmini hız/kota etkisi

- **Orta, saldırı anında:** WAF tarafından reddedilen API istekleri function/Firestore'a ulaşmaz; gerçek tasarruf ölçülmedi ve kabul edilen trafik yine kota tüketir.
- **Orta:** Hesap durumu sorgusu her hamlede yapılmaz; aynı token ve sıcak instance'ta bir dakikalık olumlu cache kullanılır. Soğuk veya ayrı instance'lar ek çağrı yapabilir; toplam proje kazancı ölçülmedi.
- **Düşük:** Düz metin/HTML reddinde gereksiz ikinci API isteği kalkar; tek olayda 2→1. Normal oyun hızı kazancı iddiası yoktur.

Kaynaklar (27 Ekim 2026): [Firebase oturum iptali ve ek backend çağrısı](https://firebase.google.com/docs/auth/admin/manage-sessions), [kendi hesabını okuma uç noktası](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/lookup), [Vercel hız sınırları](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting), [Vercel WAF kullanım koşulları](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing). Kaynaklar yapılandırma/arka plan bilgisidir; kullanıcı bu aşamada yeni bir sözleşme kabul etmiş sayılmaz.
