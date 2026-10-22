# Oyun Portalı: güvenlik geçiş planı

22 Ekim 2026. Kullanıcının açık onayıyla XOX için aşamalı canlı Firebase kuralları yayımlandı ve iki Production geçiş bayrağı açıldı. Yeni XOX odaları sunucuda doğrulanıyor; gerçek canlı kimliklerle hamle, skor, rövanş ve yetkisiz erişim kontrolleri geçti. Diğer oyunların eski izinleri korunuyor. Uygulanan kısmın ve eksiklerin ayrıntısı `server/README.md` içindedir.

## Doğrulanan sorun ve sınır

Kullanıcının paylaştığı Firestore kuralları, kimlik doğrulaması olmadan oda okumaya/oluşturmaya ve herhangi bir anonim oturumun herhangi bir odayı değiştirmesine izin veriyor. Ortak oda belgesi Amiral Battı filolarını, Okey ellerini ve desteyi içeriyor. Hamleler ve skorlar istemciden yazılıyor. Arayüz kontrolleri kötü niyetli bir istemciyi durduramaz.

Firestore okuma yetkisi belge düzeyindedir: aynı belgenin içindeki rakip elini kurallarla gizlemek mümkün değildir. Kaynak: https://firebase.google.com/docs/firestore/security/rules-fields

Bu denetimde yapılan atomik işlem ve giriş kontrolleri normal kullanım hatalarını azaltır; hile korumasının yerine geçmez. Paylaşılan kuralların canlıda aynı olduğu 21 Ekim 2026'da Firebase Console'dan doğrulandı.

## Önerilen geçiş

1. **Kalıcı ve doğrulanabilir oyuncu kimliği.** Firebase anonim oturumu yenilemede korunmalı; yerel 9 haneli oyuncu numarası yalnızca görüntüleme amacı taşımalı. Sunucu isteklerinde Firebase ID token doğrulanmalı. Eski oyuncu numarasını bilmek koltuk devralma yetkisi vermemeli. Çoklu sekme ve oturum yenileme davranışı test edilmeli.
2. **Yeni sürümlü oda modeli.** Yeni odalar ayrı bir `roomsV2` alanında açılmalı. Genel durum belgesi yalnızca herkese gösterilecek oyun durumunu taşımalı. Oyuncuya özel belgeler sadece ilgili kimliğe okunabilir olmalı. Okey destesi ve oyunun yetkili tam durumu yalnızca sunucu tarafından erişilebilir ayrı belgelerde tutulmalı. Genel lobi kaydına yalnızca oyun türü, doluluk ve katılım durumu konmalı.
3. **Sunucu eylemleri.** Oda oluşturma/katılma/ayrılma, hamle, hazır olma, yeniden oynama ve skor güncelleme sunucuda doğrulanmalı. İstekler `roomId`, `actionId`, beklenen tur sürümü ve oyun türüne göre izin verilen eylem alanlarını içermeli. Sunucu oyuncu üyeliğini, sırayı, durum sürümünü, koordinatları ve yasal hamleyi kontrol etmeli; tekrar gelen aynı eylem ikinci kez uygulanmamalı. Zarlar, deste, bot hamleleri ve sonuçlar sunucuda üretilmeli. Hız sınırı ve yük boyutu sınırı olmalı.
4. **Kurallar ve sayaç.** Oyun durumu/skoruna doğrudan istemci yazmaları kapatılmalı. Her bağlantı kaydı kendi UID alanında tutulmalı; istemci yalnızca kendi bağlantısını güncelleyebilmeli. Aktif kişi sayacı doğrulanmış oturumdan üretilmeli. Mevcut tek ortak sayaç belgesi ölçeklenebilirlik ve yetkilendirme açısından kaldırılmalı.

## Küçük adımlarla uygulama sırası

- Önce yerel Firebase Emulator üzerinde kimlik ve erişim kuralları testleri, ardından basit XOX için sunucu akışı hazırlanır.
- Oda daveti, hızlı eşleşme, seyirci, yeniden bağlanma ve rövanş çalıştıktan sonra diğer oyunlar tek tek geçirilir.
- Amiral Battı atış sonucu sunucudan döner; istemci rakibin filosunu indirmez. Okey dağıtımı ve botlar sunucuda çalışır; oda sahibi de diğer elleri göremez.
- Eski odalar sessizce yeni kimliklere bağlanmaz. Dağıtım öncesi eski oturumların bitirilmesi ve sayfa yenileme gereksinimi kullanıcıya bildirilir. Eski güvensiz yazma yolu açık bırakılırsa geçiş tamamlanmış sayılmaz.
- Önce sunucu ve yeni kurallar, sonra yeni istemci yayımlanır; eski istemcinin yeni odalara yazamadığı doğrulanır. Güvensiz kurallara otomatik geri dönüş yapılmaz.

## Yayın öncesi kabul testleri

- Üçüncü oyuncu odayı, skoru, üyeliği veya sayacı başkası adına değiştiremez.
- Rakibin filosu, eli ve deste ağ yanıtlarında bulunmaz; seyirci de okuyamaz.
- Aynı hamlenin tekrarı, sıra dışı hamle, eski sürüm, geçersiz koordinat, sahte skor ve sahte zar reddedilir.
- İki oyuncunun eşzamanlı katılması, aynı anda tıklaması, bağlantı kaybı, yenileme ve oda sahibinin ayrılması veri kaybettirmez.
- Tüm oyunların bot/insan, rövanş ve mobil akışları geçer. İstemci tarafından yapılan yetkisiz yazmalar Emulator testlerinde reddedilir.

## Uygulamadan önce netleştirilecekler

22 Ekim 2026: İlk sunucu hazırlığı `c266a71` ile ana dala gönderildi ve Vercel Production dağıtımı Ready oldu. Üretim derlemesindeki anahtarsız Firestore okuma kontrolü geçti; oyun API'si kapalı, istemci ve canlı kurallar eski akışı kullanıyor. Bu yalnız altyapı bağlantısının doğrulanmasıdır; aşağıdaki geçiş işleri tamamlanmış değildir.

Kullanıcı 18 Ekim 2026'da Firebase projesinin ücretsiz **Spark** planında olduğunu doğruladı; 21 Ekim'de panelden de doğrulandı. Vercel projesi **YapAI / vitejs-vite-pzfj873h-1hy2**, planı **Hobby** ve OIDC issuer modu **Team**. Kullanıcının açık onayıyla Vercel OIDC → Google Workload Identity Federation erişimi kuruldu. Yalnız bu projenin production kimliği yeni hizmet hesabını kullanabilir; veritabanı yetkisi `(default)` ile sınırlandırıldı ve 22 Ekim'de panelden doğrulandı. Kalıcı anahtar, Cloud Functions/Blaze geçişi veya ücretli plan değişikliği yapılmadı. Bu bir sınırsız ücretsiz kullanım garantisi değildir. Çalışan sunucu işlevindeki Firebase bağlantısının testi, tüm oyunların geçişi ve eski yetkilerin kapatılması hâlâ gereklidir. Bu geçiş oturumları ve oda modelini etkilediği için kullanıcıya bildirilmeden canlıya uygulanmaz.

Kaynaklar: https://firebase.google.com/docs/functions/quotas ve https://vercel.com/docs/functions/runtimes/node-js

Firebase/Tailwind ana sürüm yükseltmeleri ayrıca ele alınmalıdır; ilk denetimde kalan 18 paket uyarısını zorla kapatmak için otomatik ana sürüm değişikliği yapılmadı. Sunucu hazırlığının uyumlu Admin SDK sürümüyle 22 Ekim taramasında toplam 26 uyarı var (10 yüksek, 16 orta); ek 8 orta uyarının bağımlılık zinciri ve çalışma zamanı sınırı `server/README.md` içinde açıklanır. Bu sayılar bağımsız canlı site açıklarının sayısı değildir; kapatılmış olarak raporlanmamalıdır.

## XOX canlı geçişi — 22 Ekim 2026

Yeni XOX oda kurma/katılma, hızlı eşleşme, izleyici, hamle, rövanş, ayrılma ve yeniden bağlanma akışları sunucuya bağlandı. 43 otomatik test ve 11 emülatör senaryosu geçti. İki bağımsız yerel tarayıcı oturumuyla oynanış, tek puan, rövanş, yenileme, eşleşme ve Bekle akışı denendi; 320/390 px kare oranı kontrol edildi. Kullanıcının açık onayından sonra `firestore.rollout.rules` yayımlandı ve iki Production bayrağı açıldı; `26a9f06` dağıtımı Ready oldu. Gerçek canlı anonim kimliklerle katılma, seyirci, galibiyet/tek puan, rövanş, ayrılma/kapatma ve yetkisiz okuma/yazma kontrolleri geçti. Tarayıcı istemcisinde canlı katılım, hamle, yenilemeyle aynı tahtaya dönüş ve 1:0 maç sonucu doğrulandı. Diğer oyunların mevcut izinleri bu aşamada korunur; tüm sitenin güvenliği tamamlanmış sayılmaz. Eski XOX odaları yeni istemcide devralınmaz, yeni oda açmak gerekir. Önceki altyapı bölümlerindeki API kapalı açıklamaları geçiş öncesi tarihsel kayıttır.
