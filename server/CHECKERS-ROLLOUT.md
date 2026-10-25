# Dama sunucu geçişi

26 Ekim 2026. Dama'nın yeni odaları kullanıcının açık onayıyla canlı sunucu akışına geçti; üretim kabul testleri tamamlandı. Legacy oda izinleri ve kalan oyunlar nedeniyle genel denetim henüz bitmedi.

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

## Canlı hazırlık kontrolü — 26 Ekim 2026

`10fb997` ana dala gönderildi ve [kapalı ayarlı Production](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/5xDnGchjpfWR5jcHHwEEHkRjhNYP) Ready oldu. Gerçek yeni anonim test kimlikleriyle Dama oluşturma `server_not_enabled` döndü. Mevcut XOX, Amiral, Okey ve Connect 4 özel oda oluşturma/katılma/normal ayrılma ile sayaç heartbeat/ayrılma akışları geçti. Yalnız kendi yeni özel test odaları kullanıldı.

Hazırlıkta mevcut canlı kurallar kaynakla karşılaştırıldı; yalnız yeni `checkersLobby/queue` bloğu taslak olarak eklendi. Kullanıcı bu oyunu canlıya açmayı ayrıca onayladıktan sonra kural 26 Ekim 01:03'te yayımlandı ve `CHECKERS_API_ENABLED=true` / `VITE_SERVER_CHECKERS_ENABLED=true` yalnız Production'da Config olarak kaydedildi; Preview/Development seçilmedi. Son kaynak güncel ayarlarla yeniden derlendi ve [açık Production sürümü](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/ATqcuMd9ZegzvM88oeUSV7hBu9uy) Ready oldu. Diğer oyunların izinleri ve eski sayaç yazma yasağı korundu. Eski Dama odaları yerine yeni oda açılmalıdır.

## Canlı kabul sonucu — 26 Ekim 2026

Canlı ana uygulama dosyasının SHA-256 özeti yerel açık üretim çıktısıyla aynıydı. Gerçek anonim test kimlikleriyle yinelenen oluşturma aynı odayı döndürdü; sıra dışı ve seyirci hamlesi, sahte puan ve taç alanları reddedildi. Başlangıçtaki 24 taştan yalnız yasal hamlelerle oluşturulmuş 35 adımlı otomatik test oyunu canlı API üzerinden tamamlandı: taş alma, taç ve zincir görüldü; zincirde başka taşa geçme reddedildi. Son hamlenin eşzamanlı tekrarında yalnız tek puan yazıldı. Bu, insanlarca oynanmış rekabetçi bir maç değildir; üretime tahta/sonuç enjekte edilmedi.

Rövanş kendi isteğini kendisinin kabul etmesini reddetti; rakip onayı sonrası puan korundu, renkler değişti, beyaz başladı, zincir temizlendi ve 24 taş döndü. Oturumsuz/üye olmayan oda okuma, oda listesi, sunucu işlem/bağlantı kayıtları ve doğrudan oda/kuyruk yazma 403 döndü. Kimlikli kuyruk okuma yetkisi geçti; henüz kuyruk belgesi oluşmadığında 404 alınması izin reddi değildir.

Canlı tarayıcı ayrı özel test oyuncusuna katıldı, klavye/tıklamayla hamle gönderdi ve karşı hamleden sonra yenilemeyle aynı iki hamleyi korudu. Sürükle-bırak gerçek hedef kareye taş taşıdı; sürükleme kopyası kalmadı ve gözlenen konsolda hata/uyarı yoktu. Yalnız kendi yeni özel test odaları kullanıldı; tarayıcı ve sunucu test oyuncuları normal ayrılmayla çıkınca kapalı oda durumu doğrulandı. Yerel demo sunucusu ve test sekmeleri kapatıldı.

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

Yeni Dama odalarının canlı geçişi tamamlandı. Satranç/Tavla, legacy oda izinleri, anonim kimlik yenileyerek sınır aşma, ek token iptal kontrolü, bağımlılık uyarıları ve gerçek cihaz/yük testleri genel denetimde açıktır.
