# Dama sunucu geçişi

26 Ekim 2026. Genel denetimin Dama aşaması. Yerel hazırlık ve testler tamamlandı; canlı geçiş ayarları henüz açılmadı. Yeni oda yolunun üretimde doğrulanması bekliyor.

## Bulgular ve çözüm

- **Kritik:** Eski odada tahta, alınan taş, taç, kazanan ve skor tarayıcı tarafından yazılıyordu; yeni istek yalnız kaynak/hedef kare ve beklenen sürümü kabul eder, bütün hamleyi sunucu hesaplar.
- **Orta:** Aynı sürüme yarışan hamleler ve eski sürükleme bilgisi tutarsızlık yaratabiliyordu; sunucu transaction/işlem kimliğiyle tek hamle uygular, arayüz bırakmadan önce güncel taşı/hamleyi doğrular ve tahta/sıra değişiminde sürükleme kopyasını temizler.
- **Düşük:** Hamle hatası yalnız konsola yazılıyordu; kullanıcıya açıklama gösterilir, kareler klavyeyle de seçilebilir.

Mevcut kural çeşidi korunur: 8×8 çapraz hareket, kısa adımlı şah, taşta ileri hareket/yeme, bütün tahta için zorunlu yeme, aynı taşla zincirleme yeme ve taç alınan adımda şah olarak zincire devam etme. Türk damasının düz hareket/uzun şah kurallarına geçilmedi; en uzun zinciri zorunlu yapma veya yeni beraberlik kuralı eklenmedi.

Sunucu oyuncu/rengi, sıra, 64 hücre/taş tipi/siyah kare, taş sayıları, zorunlu yeme ve zincir, taç, rakibin taşsız/hareketsiz kalması ve güvenli skor aralığını doğrular. Kazanan yalnız bir puan alır. Kimlik ve alınan taş indeksi istemciden kabul edilmez. Oluşturmadaki renk sunucuda rastgele belirlenir; beyaz başlar. Rövanş rakip onayıyla puanı korur, renkleri değiştirir, zinciri temizleyip 24 taşla yeniden başlar.

Mevcut güvenli iki kişilik oda yaşam döngüsü kullanılır: oluşturma/katılma, seyirci, eşleşme, bağlantı yenileme, çoklu sekme, ayrılma/Bekle/kapatma. Aynı UID çifti dönerse renkler, tahta, sıra, zincir ve skor geri gelir; yeni rakip yeni oyun alır. Yerel bot yolu korunur. Tahtanın CSS ölçüleri değiştirilmedi.

## Yayın ve sınırlar

`CHECKERS_API_ENABLED` ve `VITE_SERVER_CHECKERS_ENABLED` varsayılan kapalıdır. Yeni `public/data/checkersLobby/queue` yalnız oda/host/güncellik özeti taşır; giriş yapanlara get, istemcilere listeleme/yazma yasağı gerekir. Mevcut `roomsV2` üyelik ve yazma kuralları yeni Dama odalarını da kapsar. Diğer oyunların ve legacy odaların izinleri korunur.

1. Kapalı ayarlı kodu yayımla; mevcut dört oyun ve sayaç canlı temel akışlarını doğrula.
2. Canlı açılış için özel kullanıcı onayından sonra yalnız salt okunur Dama kuyruk kuralını yayımla.
3. İki ayarı yalnız Vercel Production'da açıp test edilen kaynağı yeniden yayımla; gerçek kimlikle hamle/sonuç/erişim ve tarayıcı kontrollerini tamamla.
4. Eski Dama odaları devralınmaz; yeni oda açılmalıdır. Güvensiz eski yola otomatik dönüş yapılmaz.

Yeni IAM, kalıcı anahtar, ücretli plan, cron veya ayrı API işlevi gerekmez; mevcut Production OIDC kimliği ve `/api/room-action` kullanılır. Preview erişimi genişletilmez.

## Doğrulama

- 92 otomatik test geçti; normal komutta emülatör gerektiren yedi üst test atlanır.
- Temiz demo emülatöründe 60 senaryo / yedi üst testle 67 sonuç geçti; önceki XOX, Amiral, Okey, Connect 4 ve sayaç regresyonları birlikte başarılı. Dokuz yeni senaryo kapalı ayar, renk/beyaz başlangıç/oyun ayrımı, eşzamanlı hamle/seyirci/sahte veri, zorunlu/zincirleme yeme, taç/tek puan, rövanş, atomik eşleşme/bayat host, çoklu sekme/aynı çiftin geri dönüşü ve gerçek Auth kurallarını kapsar. Zincirin ortasında geri dönüş kontrolü güçlendirilip Dama'nın 10 sonucu ayrıca yeniden geçti.
- Açık ve kapalı üretim derlemeleri, mevcut TypeScript kontrolü ve kod denetimi geçti (sıfır hata, önceki 44 uyarı). App dosyasındaki mevcut tür kontrolünü kapatma sınırı sürer.
- Yerelde iki bağımsız kimlikle özel oda, beyaz başlangıç, klavye/tıklama hamlesi ve siyahın ters perspektifinde sürükleme geçti. Hazırlanmış geçerli üç taşlı demo konumunda taç/zincir, zincir ortasında yenileme, zorunlu taş vurgusu ve 1:0 sonuç doğrulandı; bu doğal oynanmış tam manuel maç değildir. Rövanşta renkler değişti, 12+12 taş ve aynı skor korundu. Gerçek bir bekleyen kişi seçicide bir göründü ve hızlı eşleşme iki oyuncuyu aynı oyuna aldı. Yerel bot karşı hamle yaptı; gözlenen konsollarda hata/uyarı yoktu.
- 390 pikselde hücreler yaklaşık 31,52×31,52; hamle sonrası tam ekranda 43,58×43,58; 320 pikselde 26,68×26,68 idi. Yatay taşma yoktu ve geçici viewport sıfırlandı. Bunlar tarayıcı ölçümleridir; gerçek telefon/Safari/Firefox/iOS testi değildir. Eski sürükleme yarışının tarayıcıda birebir yeniden üretimi yapılmadı; yeni bırakma/güncellik kontrolleri kodda, normal sürükleme arayüzde doğrulandı.

## Tahmini performans ve kalan işler

1. **Orta, büyümede:** Dama eşleşmesi en çok 30 girişli tek kuyruk kullanır ve seçim ekranı açıkken dinlenir; bütün legacy oda sonuçlarına ihtiyaç duymaz. Kalan oyunların ortak sorgusu sürer; gerçek yük kazancı ölçülmedi.
2. **Düşük:** Açık ana paket 178,26 KB gzip (önceki 178,14 KB); Dama ayrı yüklenmeye devam eder. Hamle kontrolü 64 hücreyle sınırlıdır, sunucuya bot araması taşınmadı. Sürükleme konumu her pikselde React state yazmadan güncellenir.
3. **Ek maliyet:** Token doğrulama ve sunucu transaction'ı doğrudan istemci yazmasına göre ek çağrı/okuma gerektirir; toplam kota tasarrufu iddia edilmez.

Canlı Dama geçişi henüz tamamlanmadı. Satranç/Tavla, legacy oda izinleri, anonim kimlik yenileyerek sınır aşma, ek token iptal kontrolü, bağımlılık uyarıları ve gerçek cihaz/yük testleri genel denetimde açıktır.
