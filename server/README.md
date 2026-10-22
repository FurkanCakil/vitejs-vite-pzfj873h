# Sunucu güvenliği: ilk uygulama adımı

22 Ekim 2026. Bu paket bir geçiş hazırlığıdır. Mevcut istemci hâlâ eski odaları kullanır; canlı kurallar değiştirilmedi. `GAME_API_ENABLED` ayarlanmadığı sürece yeni `/api/room-action` yolu 503 döndürür. Bu bayrak, aşağıdaki eksikler tamamlanmadan açılmamalıdır.

## Hazır olan parça

- Firebase Admin SDK, istemcinin Bearer ID token'ını doğrular; istekte gönderilen oyuncu numarası kimlik yerine geçmez.
- Yalnız `xox.move` kabul edilir. Sunucu, üye/sıra/durum/kare denetiminden sonra tahta, kazanan ve skoru hesaplar.
- Oda sürümü ve işlem kimliği aynı Firestore transaction'ında doğrulanır. Tekrar iletilen bir hamle yeniden uygulanmaz; aynı kimliğin farklı içerikle kullanılması reddedilir.
- Her oyuncu/oda için son 32 yanıt tutulur. Eski bir yanıt bu listeden çıksa da beklenen sürüm eski kaldığından işlem tekrar uygulanamaz.
- 2 KB gövde, izinli alanlar, Bearer doğrulama, kaynak denetimi ve oyuncu başına 10 saniyede 30 başarılı eylem sınırı vardır. Hata yanıtlarına token ve veritabanı ayrıntısı eklenmez.
- Oyun durumu `roomsV2` altında; işlem kayıtları ve hız sınırı sunucuya özel ayrı belgelerde tutulur.
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

Bu kimlikler gizli anahtar değildir; hiçbirinin başına `VITE_` konmamalıdır. `GAME_API_ENABLED` bu aşamada tanımlanmamalıdır. Yeni sunucu paketleri Node 22+ istediğinden dağıtım ve geliştirme Node 24'e sabitlenmiştir.

## Doğrulama

Üretim derlemesi `scripts/check-server-connection.mjs` ile sabit bir sunucu belgesini yalnız okumayı dener; belge yoksa da başarılı okuma yetkiyi doğrular. İçerik veya kimlik bilgisi yazdırılmaz, başarısızlık yayını durdurur. Yerel ve Preview derlemeleri bu kontrolü atlar. Bu kontrol derleme kimliğini sınar; çalışan function içindeki bağlantının ayrıca sınanması gerekir.

22 Ekim 2026: `c266a71` üretim dağıtımı **Ready** oldu; logda `Production server identity: Firestore read verified` görüldü. Canlı `/api/room-action` ve düzeltilen Preview sürümü `server_not_enabled` döndürüyor. 40 otomatik test ve 5 emülatör senaryosu geçti. [Vercel doğrulama kaydı](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/8V1eCiJWNNyML8bVeiqcnryAyk8K).

`npm test`: mevcut 30 teste ek 10 sunucu testi. Vercel'de görülen `ERR_REQUIRE_ESM` hatasını tekrar yakalamak için API, CommonJS → ESM desteği kapalı ayrı Node sürecinde de yüklenir. Firebase Admin 14'ün `jwks-rsa` bağımlılığı bu ortamda başlatılamadığından resmi 13.10.0 sürümü sabitlendi. Emülatör suite'i normal komutta atlanır. Kaynak: [Firebase Admin hata kaydı](https://github.com/firebase/firebase-admin-node/issues/3181).

`npm run test:integration`: yalnız `demo-oyun-portali` projesi, `127.0.0.1:8180` Firestore ve `127.0.0.1:9199` Auth emülatörlerinde 5 senaryo çalıştırır. Eşzamanlı kazandıran hamle tek puan verir, farklı hamleler aynı sürümü kullanamaz, sahte skor ve oyuncu reddedilir, hız sınırı aşılınca oda değişmez, istemci yazma/listeme ve özel işlem kaydı okuma istekleri kurallardan geçemez. Java 21+ gerekir. Test hiçbir canlı veritabanına bağlanmaz.

`server/firestore-v2.rules` yalnız emülatör için hedef kurallardır; mevcut siteye yayımlanırsa eski odalar çalışmaz. Bu nedenle normal `firebase.json` veya canlı kuralları yayımlayan komut eklenmedi.

22 Ekim paket taraması, uyumlu Admin SDK ile 26 uyarı bildirdi (10 yüksek, 16 orta). Önceki 18'e eklenen 8 orta uyarı Admin SDK'nın Google Cloud bağımlılıklarında eski `uuid` zincirinden geliyor; bildirilen sorun buffer verilerek çağrılan v3/v5/v6 yollarında. Bu uygulama Admin SDK'dan yalnız Auth kullanır, Firestore için ayrı güncel Google istemcisini kullanır. Uyarılar kapatılmış sayılmaz; Admin SDK 14'ün Vercel uyumluluğu düzeldiğinde tekrar değerlendirilmelidir. Kullanılmayan bağımlılıkların uyarılarını zorla kapatmak için desteklenmeyen sürüm override'ı eklenmedi.

## Kalan işler ve sınırlar

1. Onaylı bulut bağlantısının gerçek Vercel function içinde doğrulanması.
2. Sunucu üzerinden oda kurma/katılma/ayrılma, rövanş, lobi özeti ve yeniden bağlanma; ardından XOX istemci entegrasyonu. Mevcut arayüz bu API'yi henüz çağırmaz.
3. Diğer oyunların geçişi; Amiral Battı filoları ve Okey ellerinin oyuncuya özel belgelerle ayrılması. Legacy odalar güvenli sayılmaz.
4. Uygulama bütünlüğü/kötüye kullanım önlemleri ve operasyonel kotalar: mevcut hız sınırı yeni anonim hesap açarak aşılabilir; başarısız istekleri ve tüm siteye yapılan yükü sınırlamaz.
5. ID token doğrulaması imza, proje ve süre kontrollerini SDK ile yapar; kullanıcı iptali/devre dışı bırakma için ek Auth sorgusu henüz yapılmaz. Bu sınır etkinleştirme öncesi ayrıca değerlendirilmelidir.
6. Normal Firebase Auth kalıcıdır; `inMemoryPersistence` yalnız giriş başarısız olunca fallback olarak kullanılır. Kimlik kurtarma akışı, herkesçe görülebilen yerel oyuncu numarasıyla koltuk devralmaya izin vermeyecek şekilde geçirilmelidir.

Kaynaklar: [Vercel OIDC/GCP](https://vercel.com/docs/oidc/gcp), [Firebase ID token doğrulama](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [Firestore IAM](https://firebase.google.com/docs/firestore/security/iam).
