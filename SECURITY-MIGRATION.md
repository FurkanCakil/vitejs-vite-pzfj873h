# Oyun Portalı: güvenlik geçiş planı

26 Ekim 2026 — Satranç canlı geçişi: Özel açık kullanıcı onayıyla salt okunur kuyruk kuralı ve iki Production ayarı açıldı; test edilen kaynak yeniden yayımlanıp Ready oldu. Canlı API/tarayıcıda hamle, mat/tek puan, geri alma/beraberlik/teslim, rövanş, erişim reddi, yenileme, gerçek PGN panosu ve mobil kare oranı doğrulandı. Toplam 109 otomatik test ve 71 emülatör senaryosu / 79 sonuç başarılı. Eski Satranç odaları devralınmaz, yeni oda gerekir. Yeni IAM/anahtar/ücretli plan/cron yok. Ayrıntı `server/CHESS-MIGRATION.md` içindedir. Önceki hazırlık notları tarihseldir; Tavla, legacy geniş izinler, bağımlılık uyarıları ve gerçek cihaz/yük sınırları nedeniyle bütün site denetimi bitmedi.

26 Ekim 2026 — Satranç oda/istemci hazırlığı: Hamle ve tüm teklif/teslim/rövanş işlemleri sunucuya bağlandı; istemci V2 odalara doğrudan yazamaz. Uzun notasyon ayrı sunucu geçmişinde, son sekiz UID çiftiyle korunur. 109 otomatik test, 71 emülatör senaryosu / 79 sonuç ve iki yerel oyuncuyla oyun/teklif/yenileme/mobil kontrolleri geçti. İki yeni Satranç ayarı varsayılan kapalı, salt okunur kuyruk kuralı henüz canlıya yayımlanmadı. **Hazır bağlantı canlı açılış değildir; Satranç legacy riski açık kalır.** Açılış ve kabul koşulları `server/CHESS-MIGRATION.md` içindedir. Eski Satranç odaları devralınmayacaktır; yeni IAM/anahtar/ücretli plan/cron gerekmez. Önceki çekirdek notu tarihseldir.

26 Ekim 2026 — Satranç çekirdek hazırlığı: İptal sürükleme/aynı anda çift hamle/eski terfi konumu düzeltmeleri ve bağımsız sunucu hamle/sonuç/puan çekirdeği hazırlandı. 105 otomatik test ve mevcut 60 emülatör senaryosu / 67 sonuç başarılı. Ortak geçiş normal oyuncu, ön-hamle ve Stockfish tarafından kullanılır; tahta boyutu/notasyon düzeni ve bot seviyeleri korunur. **Satranç oda API'si, teklif/geri alma doğrulaması ve güvenli istemci bağlantısı henüz tamamlanmadı; canlı Satranç legacy yazma riski açık.** Kural/Production ayarı/IAM değişmez. Kanonik kayıt ve sonraki adımlar `server/CHESS-MIGRATION.md` içindedir.

26 Ekim 2026 — Dama canlı geçişi: Kaynak/hedef kareden yasal hareket/yeme/taç/zincir/sonuç/puanı sunucuda hesaplayan akış, kullanıcının açık onayıyla yeni odalarda açıldı. Salt okunur kuyruk kuralı ve iki ayar yalnız Production'da açık; yeni IAM, anahtar, ücretli plan veya cron yok. 92 otomatik test ve 60 emülatör senaryosu / 67 sonuç başarılı. Canlı API'de 35 yasal adımlı otomatik tam oyun/tek puan/rövanş/erişim reddi ve tarayıcıda karşılıklı hamle/yenileme/sürükleme geçti. Mevcut çapraz kural çeşidi ve tahta ölçüleri korundu. Eski Dama odaları devralınmaz, yeni oda gerekir. Kanıtlar `server/CHECKERS-ROLLOUT.md` içindedir. Satranç/Tavla ve legacy oda izinleri nedeniyle genel denetim bitmedi; aşağıdaki önceki aşama kayıtları tarihseldir.

26 Ekim 2026 — Connect 4 canlı geçişi: Yalnız sütunu kabul eden sunucu hamlesi mevcut güvenli oda akışına bağlandı; kullanıcının açık onayıyla salt okunur kuyruk kuralı ve iki ayar yalnız Production'da açıldı. Açık sürüm Ready; gerçek anonim kimliklerle hamle/tek puan/rövanş/erişim reddi ve canlı tarayıcıda yenileme/tam maç/rövanş geçti. 84 otomatik test ve 51 emülatör senaryosu / 57 sonuç başarılı. Eski Connect 4 odaları devralınmaz, yeni oda gerekir. Yeni IAM, anahtar, ücretli plan veya cron yok. Kanıtlar `server/CONNECT4-ROLLOUT.md` içindedir. Dama, Satranç, Tavla ve legacy oda izinleri nedeniyle genel denetim tamamlanmadı; aşağıdaki önceki aşama kayıtları tarihseldir.

Güncel durum — 23 Ekim 2026: Yeni XOX, Amiral Battı ve Okey odaları ile ortak oyuncu sayacı sunucu doğrulamasına geçti. Sayaç geçişi `0c56996` ile Production Ready oldu; iki ayar yalnız Production'da açıldı ve kullanıcının açık onayıyla eski `serverStatus` yazması kapatıldı. Gerçek anonim kimliklerle eski/yeni sayaç yazma reddi, özel kayıt gizliliği, çoklu sekme ve geç heartbeat kontrolü geçti. Güncel toplam 76 otomatik test, 42 emülatör senaryosu / 47 sonuçtur. Sayaç aşamasının kanonik kaydı `server/PRESENCE-ROLLOUT.md` içindedir. Aşağıdaki aşama kayıtları tarihsel sonuçları korur. Connect 4, Dama, Satranç, Tavla ve legacy oda izinleri nedeniyle tüm sitenin güvenlik geçişi tamamlanmadı.

22 Ekim 2026. Kullanıcının açık onayıyla XOX ve Amiral Battı için aşamalı canlı Firebase kuralları ve Production geçiş ayarları açıldı. Yeni odalar sunucuda doğrulanıyor; gerçek canlı kimliklerle hamle, skor, rövanş, özel filo gizliliği ve yetkisiz erişim kontrolleri geçti. Diğer oyunların ve eski odaların geniş izinleri korunuyor. Uygulanan kısmın ve eksiklerin ayrıntısı `server/README.md` içindedir.

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

## Amiral Battı canlı geçişi — 22 Ekim 2026

Özel filo belgeleri, sunucuda tam filo/atış/puan doğrulaması ve istemci bağlantısı tamamlandı. Toplam 48 otomatik test ve 19 emülatör senaryosu geçti; iki yerel oyuncuyla yerleşim, Hazır iptali, yenileme, galibiyet, rövanş ve 1:1 skor denendi. Kullanıcının açık onayıyla yeni kurallar yayımlandı, iki ayar yalnız Production ortamında açıldı ve `5096257` dağıtımı Ready oldu. Gerçek anonim kimliklerle özel filo gizliliği, hazır, atış/tek puan ve rövanş; tarayıcıda yerleşim, yenileme, 1:0 maç sonucu ve boş filo ile yeni tur doğrulandı. XOX'un canlı oluşturma/katılma/hamle/ayrılma akışı da geçti. Test kapsamı ve kalan sınırlar `server/BATTLESHIP-ROLLOUT.md` içindedir. Diğer oyunlar ve eski geniş izinler için geçiş tamamlanmadı.

## Okey çekirdek hazırlığı — 23 Ekim 2026

Bağımsız sunucu doğrulama çekirdeği, kapalı deste/elleri dışarı taşımayan genel ve kişisel görünümler hazırlandı. Henüz oda API'sine veya istemciye bağlı değildir; **Okey canlı güvenlik geçişi tamamlanmadı**. Mevcut oyun yolunda aynı taşın birden çok per/çiftte sayılması ve elini açmış oyuncunun süre aşımında yandan taşı geri koymaması düzeltildi. Toplam 69 otomatik test ve mevcut 19 emülatör senaryosu (üst testlerle 22 sonuç) geçti. Tarayıcıdaki yerel demo odasında yan taşı geri koyma, otomatik çekme/atma ve sıranın ilerlemesi gerçek oda verisiyle doğrulandı; 320/390 genişliklerinde yatay taşma ve gözlenen konsolda hata yoktu. Kalan dört kişilik oda yaşam döngüsü, atomik kayıtlar, istemci ve canlı kabul testleri `server/OKEY-MIGRATION.md` içindedir. Yeni yetki veya geçiş ayarı açılmadı.

## Okey oda ve istemci bağlantısı — 23 Ekim 2026

Çekirdek dört kişilik oda API'sine ve yalnız kendi elini dinleyen istemciye bağlandı; önceki bölüm ilk hazırlığın tarihsel kaydıdır. Ayrı Okey sunucu/istemci ayarları varsayılan kapalıdır. 69 otomatik test ve toplam 30 emülatör senaryosu/34 test sonucu geçti. Tek çekme/tek ceza, kayıt listeden çıktıktan sonra eski ceza reddi, eşzamanlı bot sürücüleri, gizlilik, takım/host yetkisi, bot koltuğu devri, ayrılma ve UID dizilimi geçmişi, tam bot eli, sonuç ve yeni el sınandı. Tarayıcıda iki bağımsız originle temel oyun, eşli/yardımlı kurallar, seyirci ve onaylı bot koltuğu devri, kontrollü yasal bitiriş, takım sonucu, yeni el ve yenileme geçti; 320/390 mobil görünüm kontrol edildi. Canlı açılış kabul adımları ve kalan sınırlar `server/OKEY-MIGRATION.md` içindedir.

## Okey canlı geçişi — 23 Ekim 2026

`cb0e06f` önce kapalı ayarlarla Ready oldu ve mevcut XOX/Amiral canlı temel akışları yeniden geçti. Kullanıcının devam/yayın yetkisiyle yalnız genel Okey eşleşme özeti kuralı eklendi ve iki Okey ayarı Production ortamında açıldı. [Açık sürüm](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/DygH6eSfFHtC8chiFzUYsUCdToDk) Ready oldu. Kendi elini okuma geçti; rakip/seyirci/oturumsuz el, özel belge listesi ve sunucu deste okuma ile doğrudan yazmalar reddedildi. Sahte skor/sıra/seyirci hamlesi, tekrar çekiş, botlarla tam el, yeni el, skor koruma ve başlangıç değişimi canlıda doğrulandı. Tarayıcıda özel el ve bot oyunu, kapalı çekiş, yenilemeyle aynı taşlar ve mobil görünüm geçti; canlı dosyalar üretim çıktısıyla aynıydı. Yeni IAM, kalıcı anahtar, ücretli plan veya zamanlanmış görev eklenmedi. Eski Okey odaları devralınmaz; legacy oda izinleri ve kalan oyunlar nedeniyle bütün sitenin denetimi tamamlanmadı.
