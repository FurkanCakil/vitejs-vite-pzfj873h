# Oyun Portalı: güvenlik geçiş planı

18 Ekim 2026. Bu dosya bir uygulama planıdır; aşağıdaki geçiş henüz uygulanmadı ve canlı Firebase kuralları değiştirilmedi.

## Doğrulanan sorun ve sınır

Kullanıcının paylaştığı Firestore kuralları, kimlik doğrulaması olmadan oda okumaya/oluşturmaya ve herhangi bir anonim oturumun herhangi bir odayı değiştirmesine izin veriyor. Ortak oda belgesi Amiral Battı filolarını, Okey ellerini ve desteyi içeriyor. Hamleler ve skorlar istemciden yazılıyor. Arayüz kontrolleri kötü niyetli bir istemciyi durduramaz.

Firestore okuma yetkisi belge düzeyindedir: aynı belgenin içindeki rakip elini kurallarla gizlemek mümkün değildir. Kaynak: https://firebase.google.com/docs/firestore/security/rules-fields

Bu denetimde yapılan atomik işlem ve giriş kontrolleri normal kullanım hatalarını azaltır; hile korumasının yerine geçmez. Paylaşılan kuralların hâlen canlıda aynı olup olmadığı yönetim panelinden ayrıca doğrulanmalıdır.

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

Kullanıcı 18 Ekim 2026'da Firebase projesinin ücretsiz **Spark** planında olduğunu doğruladı. Cloud Functions for Firebase yayını Blaze gerektirdiğinden, önce mevcut Vercel projesinde Node.js sunucu işlevleri kullanma seçeneği incelenecek. Bu bir ücretsiz kullanım garantisi değildir; mevcut Vercel planı, sınırlar, güvenli sunucu kimliği ve dağıtım erişimi henüz doğrulanmadı. Bu bilgiler olmadan hizmet/maliyet veya yayın süresi taahhüt edilmez. Anahtarlar sohbete ya da Git'e konmaz. Bu geçiş oturumları ve oda modelini etkilediği için kullanıcıya bildirilmeden canlıya uygulanmaz.

Kaynaklar: https://firebase.google.com/docs/functions/quotas ve https://vercel.com/docs/functions/runtimes/node-js

Firebase/Tailwind ana sürüm yükseltmeleri ayrıca ele alınmalıdır; denetimde kalan 18 paket uyarısını zorla kapatmak için otomatik ana sürüm değişikliği yapılmadı. Bu sayı 18 bağımsız canlı site açığı anlamına gelmez; bağımlılık zinciri ve kullanılan çalışma ortamı ayrı değerlendirilmelidir.
