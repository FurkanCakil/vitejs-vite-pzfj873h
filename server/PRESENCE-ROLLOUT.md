# Doğrulanmış oyuncu sayacı ve eski oyun eşleşmesi

23 Ekim 2026. Genel denetimin sayaç aşaması. Diğer oyunların istemci hamle/skor yetkisi ve eski oda izinleri bu değişiklikle kapanmaz.

## Sorun ve davranış

Eski `serverStatus/info` belgesini herhangi bir anonim kullanıcı bütünüyle değiştirebiliyordu. Yeni akış mevcut `/api/room-action` üzerinden doğrulanmış Firebase UID'si ve sunucu zamanını kullanır. İstek yalnız sekme kimliği ve isteğe bağlı oda kodu taşır; UID, oyuncu numarası, zaman, toplam veya shard kabul edilmez. Aynı UID'nin sekmeleri bir kişi sayılır; ayrı anonim kimliklerin aynı gerçek insana ait olduğu kanıtlanamaz.

Oda kodu yalnız sunucuda gerçekten üyesi olunan, herkese açık ve bekleyen odaysa özete eklenir. Özel/oynanan odalar ve üyesi olunmayan kodlar yayımlanmaz. İstemci normal oyunlarda kod göndermez; ek oda doğrulaması yalnız eski oyunların herkese açık bekleme ekranında gerekir. XOX/Amiral/Okey eşleşme kuyrukları kendi mevcut sunucu kayıtlarını kullanır.

## Sınırlı kayıtlar ve zaman

- UID'nin SHA-256 özeti sabit 16 parçadan birini belirler. Sunucuya özel `serverPresence/{00..15}` gerçek sekmeleri, hız sınırını ve son sekiz işlem yanıtını taşır. `public/data/presenceV2/{00..15}` yalnız UID başına son görülme ve doğrulanmış açık bekleme odası zamanlarını içerir. Giriş yapanlar özeti okuyabilir; istemciler hiçbirini doğrudan yazamaz.
- Heartbeat 20 saniye, tazelik 75 saniyedir. Lobby beş saniyede bir süreyi yeniden değerlendirir; yeni yazma gelmese de hayalet oyuncu sayılmaz. Diğer sekmenin güncel olması eski oda sekmesini canlı tutmaz.
- Son sekmenin kapanması kişiyi kaldırır; bir sekmenin kapanması diğerini düşürmez. Kapanışla yarışan heartbeat iki dakikalık kapalı sekme kaydıyla engellenir. Kayıp yanıt aynı eylem kimliğiyle tekrarlanınca ikinci kez uygulanmaz. Offline/online yeni kayıt açar; eski yanıt yeni kaydı kapatamaz.
- Sunucu yanıtıyla hesaplanan saat farkı sayımda kullanılır; bilgisayar saatini değiştirmek gelecekte zaman yazdıramaz. Ağ gecikmesinin tamamen giderildiği iddia edilmez.
- UID başına sekiz aktif/en çok 16 toplam sekme, on saniyede 30 başarılı eylem; parça başına en çok 128 kimlik ve özel JSON'da 700 KB sınırı vardır. Dolu bölüm kontrollü hata döndürür. Sınırsız kapasite veya gerçek insan sayımı iddiası yoktur.
- Eski kayıtlar bölümün sonraki işleminde budanır. Sabit 16 özel/genel belge dışında biriken oturum belgesi yoktur; cron/TTL hizmeti açılmaz. Sessiz bölümde eski özet kalabilir; istemci tazelik filtresi saymaz.

## İstemci ve yayın

Lobi ve eski oyunların hızlı eşleşmesi aynı özet adaptörünü kullanır. Eski oyun katılım transaction'ı 16 sabit özet belgesini birlikte okur; mevcut sıra/renk/oda kurma davranışını değiştirmez. Sayaç dinleyicisi oyun ekranında kapanır.

`PRESENCE_API_ENABLED` ve `VITE_SERVER_PRESENCE_ENABLED` uygulama varsayılanında kapalıdır. Açıldıktan sonra eski yazma yoluna otomatik dönüş yoktur. `firestore.rollout.rules` son durumda eski `serverStatus` yazmasını kapatır; diğer oyunların legacy oda izinlerini korur.

1. Bayraklar kapalı kodu yayımla ve mevcut oyunları doğrula.
2. Yeni salt okunur `presenceV2` kuralını ekle; eski sayaç yazmasını hazırlıkta koru.
3. Yalnız Production'da iki bayrağı açıp yeniden yayımla; sayaç, sekme ve eski oyun eşleşmesini doğrula.
4. Son kurallarla eski `serverStatus` yazmasını kapat; gerçek anonim kimliklerle yazma/özel kayıt okuma reddini doğrula. Eski açık sekmeler yenilenmelidir.

Yeni IAM, kalıcı anahtar, ücretli plan veya zamanlanmış iş gerekmez. Mevcut Production kimliği kullanılır; Preview erişimi genişletilmez. Canlı sonuçlar kalıcı denetim kaydına eklenir.

## Doğrulama ve maliyet

76 otomatik test, 42 emülatör senaryosu / beş üst testle 47 sonuç geçti. Sekiz yeni emülatör senaryosu kapalı bayrak/sahte alan, yinelenen istek/çoklu sekme, açık oda üyeliği/özel oda gizleme, oda süresi, geç heartbeat, sekme/hız sınırı, kapasite/budama ve gerçek Auth kurallarını kapsar. Önceki XOX, Amiral ve Okey regresyonları birlikte geçti.

Tarayıcıda iki bağımsız origin iki kişi sayıldı; ikinci aynı-origin sekmesi sayıyı artırmadı. Kopya sekmesini kapatma ve yenileme iki kişiyi korudu. Eski Connect 4'te gerçek bekleyen oyuncu görüldü ve yeni özetle katılım iki kişiyi aynı oyuna aldı. Bu kontroller gerçek cihaz/uzun süreli yük testinin yerine geçmez.

- **Orta, büyümede:** Tek ortak yazma noktası 16 parçaya ayrılır; sabit belge sayısı ve budama sınırsız birikmeyi önler. Aynı kimliğin sık sekme bildirimleri 15 saniyeden daha sık aynı özeti yayımlamaz. Gerçek yükte süre/kapasite ölçülmedi.
- **Düşük:** İlk istemci paketine sıkıştırılmış yaklaşık 0,64 KB eklenir; oyunlar ayrı yüklenir.
- **Ek maliyet:** Güvenli heartbeat normalde iki okuma ve bir/iki yazma yapar; eski public oda üyeliğinde iki ek okuma vardır. Eski yol doğrudan tek ortak yazma yapıyordu. Firestore kotası azaldı denmez. Bir sunucu çağrısı eklenir; ayrı API işlevi oluşturulmaz. Yoğun trafikte kullanım ölçülmelidir.

Yeni anonim kimlik açarak sınırları aşma, güçlü hesap kimliği, diğer oyunlar, legacy oda izinleri ve bağımlılık uyarıları genel denetimde açık kalır.
