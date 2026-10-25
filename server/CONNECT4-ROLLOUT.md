# Connect 4 sunucu geçişi

25 Ekim 2026. Genel denetimin Connect 4 aşaması. Hazırlık ve yerel kabul testleri tamamlandı; canlı ayarlar açılıp gerçek üretim testleri geçmeden canlı güvenlik geçişi tamamlanmış sayılmaz.

## Bulgular ve değişikliklerin nedeni

- **Kritik:** Eski akış tahta, kazanan, sıra ve puanı istemciden yazıyordu; yeni sunucu eylemi yalnız sütun ve beklenen sürümü kabul ederek bütün sonucu kendisi hesaplar.
- **Orta:** İki eşzamanlı hamle aynı tahtayı ezebiliyordu; mevcut Firestore transaction/sürüm/işlem kimliği akışı tek hamle ve tek puan uygular.
- **Düşük:** Başarısız hamle yalnız konsola yazılıyordu; yeni akış kullanıcıya hata mesajı gösterir, sütunlar klavyeyle de seçilebilir.

Sunucu yerçekimini, dolu sütunu, 42 hücre/renk/taş sayısını, başlangıç sırasını, eski kazanmış tahta durumunu ve güvenli puan aralığını kontrol eder. Oyuncu koltuğu, canlı bağlantılar ve oyun türü mevcut sunucu odası akışında doğrulanır; seyirci hamle yapamaz. Yatay, dikey ve iki çaprazdaki sonuç ortak saf mantıkla hesaplanır. Beraberlik puan eklemez.

Mevcut iki kişilik oda yaşam döngüsü kullanılır: oluşturma, atomik eşleşme, katılma, seyirci, heartbeat, çoklu sekme, ayrılma, Bekle ve kapatma. Aynı UID çifti geri gelirse tahta/son taş/puan korunur; yeni rakip yeni oyun alır. Rövanş rakip onayı gerektirir, puanları korur, başlangıcı değiştirir ve son hamleyi temizler. Yerel bot akışı ayrı kalır; oyun tahtasının CSS boyutları değiştirilmedi.

## Yayın sırası ve kapsam

`CONNECT4_API_ENABLED` ve `VITE_SERVER_CONNECT4_ENABLED` varsayılan kapalıdır. Yeni eşleşme özeti `public/data/connect4Lobby/queue`, oda/host/güncellik alanlarını taşır; yalnız giriş yapanlara get izni, istemcilere listeleme/yazma yasağı verilir. `roomsV2` üyelik ve yazma kuralları zaten bu oda modelini kapsar. Diğer oyunlar ve eski oda izinleri korunur.

1. Ayarlar kapalı sürümü yayımla; mevcut XOX, Amiral, Okey ve sayaç canlı temel akışlarını kontrol et.
2. Yalnız `connect4Lobby/queue` salt okunur get kuralını mevcut kurallara ekle.
3. İki ayarı yalnız Vercel Production'da açıp yeniden yayımla; gerçek kimliklerle hamle/puan/erişim ve tarayıcı kontrollerini yap.
4. Eski Connect 4 odaları devralınmaz; yeni oda açılmalıdır. Güvensiz eski yola otomatik dönüş yapılmaz.

Yeni IAM, kalıcı anahtar, ücretli plan, cron veya ayrı API işlevi gerekmez. Mevcut Production OIDC kimliği ve `/api/room-action` kullanılır. Preview erişimi genişletilmez.

## Doğrulama

- 84 otomatik test geçti; normal testte emülatör gerektiren altı üst test atlanır.
- Temiz `demo-oyun-portali` emülatöründe 51 senaryo / altı üst testle 57 sonuç geçti. Yeni dokuz senaryo kapalı ayar/oyun ayrımı, aynı kazandıran isteğin tekrarı, yarışan farklı hamleler, sahte alan/seyirci/sıra reddi, dolu sütun, onaylı rövanş, atomik eşleşme/bayat kuyruk, çoklu sekme/ayrılma/geri dönüş ve gerçek Auth kurallarını kapsar. XOX/Amiral/Okey/sayaç regresyonları birlikte geçti.
- Üretim derlemesi Connect 4 ayarı açık ve kapalı geçti. TypeScript kontrolü geçti; App dosyasındaki mevcut tür kontrolünü kapatma sınırı sürer. Kod denetiminde sıfır hata, önceki 44 uyarı vardır.
- İki bağımsız yerel tarayıcı kimliğiyle özel oda/katılım, klavye ve fareyle yasal hamleler, 1:0 galibiyet, yenilemede aynı yedi taş ve skor, onaylı rövanşta boş tahta/aynı skor/diğer başlangıç geçti. Hızlı eşleşmede gerçek bekleyen oyuncu bir kişi göründü ve aynı oyuna katılım geçti. Yerel bot bir karşı hamle yaptı. Gözlenen konsollarda hata/uyarı yoktu.
- 390 pikselde hamleden önce/sonra hücreler 32×32, yatay taşma yok; tam ekranda yaklaşık 45,15×45,15 kareler korundu. 320 pikselde 32×32 hücreler ve taşmasız belge doğrulandı. Bunlar tarayıcı viewport ölçümleridir; gerçek telefon/Safari/Firefox/iOS testi değildir. Geçici viewport sıfırlandı.

## Tahmini performans etkisi ve kalan işler

1. **Orta, büyümede:** Connect 4 eşleşmesi tüm bekleyen oda sorgusu yerine en çok 30 girişli tek kuyruk belgesini kullanır; seçici yalnız açıkken dinler. Gerçek yükte gecikme/kota kazancı ölçülmedi; kalan eski oyunların ortak sorgusu sürer.
2. **Düşük:** Oyun paketi ayrı yüklenmeye devam eder; yeni açık ana paket 178,14 KB gzip, önceki sayaç sürümü 178,04 KB idi. Tahta en çok 42 hücreyle sınırlıdır; büyük arama/yeniden yazım eklenmedi.
3. **Ek maliyet:** Her hamle token doğrulama ve sunucu transaction'ı gerektirir; eski doğrudan istemci yazmasına göre ek okuma/çağrı vardır. Toplam kota azalması iddia edilmez.

Canlı sonuç henüz bekliyor. Dama, Satranç, Tavla ve legacy oda izinleri, anonim hesap yenileyerek hız sınırını aşma, ek token iptal kontrolü, bağımlılık uyarıları ve gerçek cihaz/yük testleri genel denetimde açıktır.
