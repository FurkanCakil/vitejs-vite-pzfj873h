# Sunucu güvenliği: XOX, Amiral Battı ve Okey geçişi

23 Ekim 2026. Kullanıcının yetkisiyle `firestore.rollout.rules` canlıya yayımlandı; XOX ve Amiral Battı'nın önceki ayarlarına ek `OKEY_API_ENABLED=true` ve `VITE_SERVER_OKEY_ENABLED=true` yalnız Vercel Production ortamında açık. XOX `26a9f06`, Amiral Battı `5096257`, Okey `cb0e06f` ile sunucu akışına geçti; üç oyunun gerçek sunucu akışları doğrulandı. Okey için yeni IAM, kalıcı anahtar veya ücretli plan gerekmedi. Preview sunucusu üretim erişimini kullanamaz. Diğer oyunların ve eski odaların geniş izinleri bu aşamada korunuyor; tüm sitenin güvenlik geçişi tamamlanmış değildir.

## Hazır olan parça

- Firebase Admin SDK, istemcinin Bearer ID token'ını doğrular; istekte gönderilen oyuncu numarası kimlik yerine geçmez.
- `room.create/join/spectate/match/heartbeat/disconnect/leave/wait/close`, `xox.move` ve rövanş isteme/kabul/ret eylemleri için ayrı, kapalı alan listeleri vardır. Sunucu üyeyi, sırayı, durumu ve kareyi doğrular; tahta, kazanan ve skoru hesaplar. Katılım/rövanş işlemleri de atomiktir.
- Oda sürümü ve işlem kimliği aynı Firestore transaction'ında doğrulanır. Tekrar iletilen bir hamle yeniden uygulanmaz; aynı kimliğin farklı içerikle kullanılması reddedilir.
- Oyuncu başına son 32 yanıt tutulur; ağ cevabı kaybolursa istemci aynı işlem kimliğiyle yeniden dener. Eski hamlenin yanıtı listeden çıksa da beklenen sürüm eski kaldığından hamle tekrar uygulanamaz. Oda oluşturma tekrarı son 32 kayıt içinde aynı odayı döndürür; bu sınırdan sonra sınırsız idempotency garantisi yoktur.
- 2 KB gövde, izinli alanlar, Bearer doğrulama, kaynak denetimi ve oyuncu başına 10 saniyede 30 başarılı eylem sınırı vardır. Hata yanıtlarına token ve veritabanı ayrıntısı eklenmez.
- Oyun durumu `roomsV2` altında; işlem kayıtları, hız sınırı ve bağlantı zamanları sunucuya özel belgelerde tutulur. Yeni oda kurma oyuncu başına dakikada 3, eşzamanlı bağlantı 8 sekme, seyirci 30, eşleşme kuyruğu 30 oda ve maç geçmişi 8 dizilimle sınırlıdır.
- Her sayfa kendi bağlantı kimliğini kullanır. Bir sekmenin kapanması aynı UID'nin diğer sekmesini düşürmez; bağlantı 15 saniyede yenilenir, 60 saniyede bayatlar. Hızlı eşleşme özel sunucu bağlantı kaydını doğrular. İstemci saati, yerel oyuncu numarası ve eski ortak sayaç eşleşme yetkisi vermez.
- İstemci yalnız Firebase UID'sinin oyuncu/seyirci olduğu yeni odayı dinleyebilir; oda listesi ve doğrudan yazma kapalıdır. Ortak eşleşme özeti yalnız oda kodu, host UID'si ve güncellik zamanı taşır. Normal kalp atışı oyun durumunu değiştirmiyorsa oda belgesi ve değişmeyen kuyruk yeniden yazılmaz.
- Vercel OIDC ve Google Workload Identity Federation kısa ömürlü kimlik kullanır. Kalıcı hizmet hesabı anahtarı üretilmez. Preview ve yerel süreçler üretim bağlantısını kullanamaz.

## Onaylanan bulut bağlantısı

Uygulanan izinlerin kaydı `gcp-access-plan.json` içindedir. Yalnız YapAI ekibinin `vitejs-vite-pzfj873h-1hy2` projesinin production ortamı kabul edilir. Proje kimliği de denetlendiği için aynı adı kullanan başka proje kabul edilmez.

Hizmet hesabı `oyun-portali-server@oyun-odasi-8ecee.iam.gserviceaccount.com` ve rolü, `(default)` veritabanıyla sınırlandırılmış `roles/datastore.user` olarak oluşturuldu. Bu rol o veritabanındaki tüm belgeleri okuma, oluşturma, güncelleme ve silme yetkisi verir; koleksiyon bazında IAM sınırı değildir. Firebase kullanıcı yönetimi, faturalandırma veya proje yöneticiliği verilmedi. Yalnız belirtilen Vercel kimliğine bu hizmet hesabını kullanmak için `roles/iam.workloadIdentityUser` verildi.

Kullanıcının kapsamı açık onayıyla havuz, sağlayıcı, hizmet hesabı ve IAM yetkileri kaydedildi; son izin ve veritabanı koşulu 22 Ekim 2026'da panelden doğrulandı. Kalıcı anahtar oluşturulmadı. Spark ve Hobby planları korunur; ücretli plan veya ödeme hesabı açılmadı.

Yalnız Vercel Production ortamında gereken sunucu ayarları:

| Ad | Değer |
| --- | --- |
| GCP_PROJECT_ID | oyun-odasi-8ecee |
| GCP_PROJECT_NUMBER | 687462141533 |
| GCP_WORKLOAD_IDENTITY_POOL_ID | oyun-portali-prod |
| GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID | vercel |
| GCP_SERVICE_ACCOUNT_EMAIL | oyun-portali-server@oyun-odasi-8ecee.iam.gserviceaccount.com |

Bu kimlikler gizli anahtar değildir; hiçbirinin başına `VITE_` konmamalıdır. XOX geçiş bayrakları yalnız Production ortamında açıktır. Yeni sunucu paketleri Node 22+ istediğinden dağıtım ve geliştirme Node 24'e sabitlenmiştir.

## Doğrulama

Üretim derlemesi `scripts/check-server-connection.mjs` ile sabit bir sunucu belgesini yalnız okumayı dener; belge yoksa da başarılı okuma yetkiyi doğrular. İçerik veya kimlik bilgisi yazdırılmaz, başarısızlık yayını durdurur. Yerel ve Preview derlemeleri bu kontrolü atlar. Bu kontrol derleme kimliğini sınar; çalışan function içindeki bağlantının ayrıca sınanması gerekir.

22 Ekim 2026: `c266a71` üretim dağıtımı **Ready** oldu; logda `Production server identity: Firestore read verified` görüldü. Canlı `/api/room-action` ve düzeltilen Preview sürümü `server_not_enabled` döndürüyor. 40 otomatik test ve 5 emülatör senaryosu geçti. [Vercel doğrulama kaydı](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/8V1eCiJWNNyML8bVeiqcnryAyk8K).

`npm test`: 69 test geçer; emülatör gerektiren dört suite normal komutta atlanır. Önceki 48 teste 19 Okey çekirdek ve 2 mevcut per/çift regresyon testi eklendi. Vercel'de görülen `ERR_REQUIRE_ESM` hatasını tekrar yakalamak için API, CommonJS → ESM desteği kapalı ayrı Node sürecinde de yüklenir. Firebase Admin 14'ün `jwks-rsa` bağımlılığı bu ortamda başlatılamadığından resmi 13.10.0 sürümü sabitlendi. Kaynak: [Firebase Admin hata kaydı](https://github.com/firebase/firebase-admin-node/issues/3181).

`npm run test:integration`: yalnız `demo-oyun-portali` projesi, `127.0.0.1:8180` Firestore ve `127.0.0.1:9199` Auth emülatörlerinde 30 senaryo çalıştırır (dört üst testle birlikte 34 test sonucu). XOX/Amiral'in mevcut 19 senaryosuna Okey'in 11 oda/hamle/gizlilik senaryosu eklendi. Eşzamanlı kazandıran hamle tek puan verir, farklı hamleler aynı oyun sürümünü kullanamaz, sahte skor ve oyuncu reddedilir, hız sınırı aşılınca oda değişmez, istemci yazma/listeme ve özel işlem kaydı okuma istekleri kurallardan geçemez. Java 21+ gerekir. Test hiçbir canlı veritabanına bağlanmaz.

`firestore.rollout.rules` emülatörde sınanan ve 22 Ekim'de canlıya yayımlanan aşamalı kurallardır: yeni odaları yalnız üyeleri okuyabilir, istemci yazmaları ve listeleme kapalıdır; diğer oyunların mevcut kuralları korunur. `server/firestore-v2.rules` eski oyunları kapsamayan referanstır ve tek başına canlıya yayımlanmamalıdır. Normal `firebase.json` veya otomatik kural yayını eklenmedi.

Canlı doğrulama: [26a9f06 Production dağıtımı](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/DdtJ9fdatqN249UARR9d8GaoES5U) Ready. Gerçek Firebase anonim test kimlikleriyle oda oluşturma ve aynı isteği tekrarlama, katılma, seyirci, beş hamlede galibiyet/tek puan, rakip onayıyla rövanş/başlangıç değişimi/skor koruma, ayrılma ve kapatma geçti. Üye olmayan ve oturumsuz oda okuma, oda listeleme, özel işlem kaydı okuma ve üyenin doğrudan yazma girişimi 403; seyirci hamlesi 403, sıra dışı hamle 409 ve sahte skor alanı 400 döndü. Yalnız yeni özel test odaları kullanıldı. Ayrıca gerçek tarayıcı istemcisi bağımsız test oyuncusuna katıldı, hamle yaptı, yenileme sonrası aynı tahtaya döndü ve maç sonucunu 1:0 gördü. Bu kontroller çalışan function içindeki anahtarsız Firestore okuma/yazma işlemini de doğrular.

22 Ekim paket taraması, uyumlu Admin SDK ile 26 uyarı bildirdi (10 yüksek, 16 orta). Önceki 18'e eklenen 8 orta uyarı Admin SDK'nın Google Cloud bağımlılıklarında eski `uuid` zincirinden geliyor; bildirilen sorun buffer verilerek çağrılan v3/v5/v6 yollarında. Bu uygulama Admin SDK'dan yalnız Auth kullanır, Firestore için ayrı güncel Google istemcisini kullanır. Uyarılar kapatılmış sayılmaz; Admin SDK 14'ün Vercel uyumluluğu düzeldiğinde tekrar değerlendirilmelidir. Kullanılmayan bağımlılıkların uyarılarını zorla kapatmak için desteklenmeyen sürüm override'ı eklenmedi.

## Kalan işler ve sınırlar

23 Ekim 2026: Okey çekirdeği dört kişilik oda API'sine ve özel el dinleyicisine bağlandı; kullanıcı yetkisiyle iki ayar yalnız Production'da açıldı. 11 yeni emülatör senaryosuyla toplam 30 senaryo/34 test sonucu geçti. Gerçek canlı kimliklerle özel el gizliliği, yazma reddi, tek çekiş, botlarla tam el, skor ve yeni el doğrulandı. Canlı tarayıcıda özel el, botlar, kapalı çekiş ve yenilemeyle aynı taşlara dönüş geçti. **Yalnız yeni Okey odalarının geçişi tamamlandı; eski odalar ve bütün site güvenli sayılmaz.** Ayrıntılar `OKEY-MIGRATION.md` içindedir.

Amiral Battı'nın özel filo/sunucu geçişi kullanıcının açık onayıyla canlıya açıldı. `BATTLESHIP_API_ENABLED=true` ve `VITE_SERVER_BATTLESHIP_ENABLED=true` yalnız Production ortamında açık; yeni `playerData` ve `battleshipLobby` kuralları yayımlandı. Gerçek kimliklerle gizlilik/hamle/skor/rövanş ve tarayıcıda yenileme/tam maç doğrulandı. XOX'un canlı oluşturma/katılma/hamle akışı da yeniden denendi. Kapsam ve kanıtlar `BATTLESHIP-ROLLOUT.md` içindedir.

1. XOX'ta gerçek Safari/Firefox/iOS cihazlarında ve uzun süre arka plana alınan sayfalarda ek uyumluluk testi. Yerel iki oturum ve canlı tarayıcı/API kontrolleri geçti; bütün cihaz/süre kombinasyonları sınanmadı.
2. XOX için operasyonel izleme ve test verilerinin saklama politikasının belirlenmesi; otomatik temizleme görevi kurulmadı.
3. Diğer oyunların sunucu geçişi ve eski geniş izinlerin kapatılması. Eski Amiral Battı/Okey dahil legacy odalar güvenli sayılmaz; yeni istemci bunları devralmaz.
4. Uygulama bütünlüğü/kötüye kullanım önlemleri ve operasyonel kotalar: mevcut hız sınırı yeni anonim hesap açarak aşılabilir; başarısız istekleri ve tüm siteye yapılan yükü sınırlamaz.
5. ID token doğrulaması imza, proje ve süre kontrollerini SDK ile yapar; kullanıcı iptali/devre dışı bırakma için ek Auth sorgusu yapılmaz. Mevcut anonim hesaplarda iptal edilen token'ın süresi dolana kadar kabul edilebilmesi kalan bir sınırdır; daha geniş Auth yönetimi izni verilmedi.
6. Normal Firebase Auth kalıcıdır; `inMemoryPersistence` yalnız giriş başarısız olunca fallback olarak kullanılır. Kimlik kurtarma akışı, herkesçe görülebilen yerel oyuncu numarasıyla koltuk devralmaya izin vermeyecek şekilde geçirilmelidir.

Kaynaklar: [Vercel OIDC/GCP](https://vercel.com/docs/oidc/gcp), [Firebase ID token doğrulama](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [Firestore IAM](https://firebase.google.com/docs/firestore/security/iam).

Yerel tarayıcı testi: npm run dev:xox yalnız demo emülatörünü açar; geliştirme API''si canlı projeyi, farklı emülatör adresini ve Vercel ortamını reddeder. Unsigned Auth token desteği yalnız bu yerel middleware içinde açık, üretim handler''ında kapalıdır. Tarayıcıda iki bağımsız oturumla davet, galibiyet/tek puan, rövanş, yenileme, hızlı eşleşme ve ayrılma/Bekle denendi; bot yanıtı ve 320/390 px kare oranları kontrol edildi. Yeni sürüm eski XOX odalarını devralmaz; kullanıcı yeni oda kurmalıdır. Diğer oyunlar henüz bu güvenlik modeline geçirilmedi.
