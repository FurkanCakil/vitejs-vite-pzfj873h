# Okey ıstaka yazım sırası

28 Ekim 2026 — Genel denetimin bu dar aşaması, son düzenleme kaydını bekleyen per açma ve bileşen kapanışını düzeltir. Oyun kuralları, skorlar, CSS/tahta boyutları, özel el yetkileri ve sunucu API'si değişmedi. Yeni kural, IAM, ortam ayarı, anahtar, ücret veya zamanlanmış iş yok.

## Bulgular

- **Kritik:** Bu bölümde yeni kritik açık doğrulanmadı; sunucu per/taş/puan doğrulaması korunur.
- **Orta:** A düzenlemesi kaydedilirken gelen B düzenlemesi, `flushRackWrite()` bekleyen açma isteğinin beklediği promise'e dahil değildi. A bitince açma B'den önce kuyruğa girebiliyor, sunucu henüz yeni grup kimliklerini bilmediği için işlem reddedilebiliyordu. Eski gerçek fonksiyon kaynak kodundan çalıştırılarak A/B gönderildiği halde B tamamlanmadan açmanın ilerlediği yeniden üretildi.
- **Orta:** Unmount yalnız debounce zamanlayıcısını temizliyordu; A'nın devamı bekleyen B'yi gönderebiliyor ve eski bileşenin boşalma bildirimini çalıştırabiliyordu. Henüz gönderilmeyen işleri emekliye ayıran durdurma eklendi; zaten gönderilmiş isteğin sunucuda iptal edildiği iddia edilmez.
- **Düşük:** Başarısız kayıt sonrasında bağımlı per açma da ilerliyordu; açık başarısızlık veya kapanma durumunda açma artık gönderilmez.

## Dosya gerekçeleri

- `src/games/okey101/rackWriteQueue.js`: Birleştirilen son kayıt dahil bütün yazımlar bitene kadar bekleyen küçük kuyruk, mevcut tek istek ve 140 ms debounce davranışını korur.
- `src/games/okey101/PlayerRack.jsx`: Aynı görsel iyimser katmanı kuyruğa bağlar, güncel kayıt callback'ini kullanır ve dört seri/çift açma yolunu kayıt/kapanış sonucuna bağlar.
- `src/games/okey101/rackWriteQueue.test.js`: Altı test; açma sırası, yoğun düzenleme birleştirme, kapanış, bağımsız yeni mount, hata sonrası toparlanma ve son yanıtla aynı anda gelen düzenlemeyi sınar.
- Bu dosya, `server/README.md`, `SECURITY-MIGRATION.md`: Doğrulama kapsamını ve genel denetimin kalan sınırlarını kaydeder.

## Doğrulama

162 otomatik test; normal test komutunda 13 emülatör üst testi bilerek atlanır. Lint sıfır hata/36 mevcut uyarı, mevcut TypeScript kontrolü ve bütün oyun bayrakları açık üretim derlemesi geçti. Bu aşamada birleşik 99 senaryolu sunucu emülatör paketi tekrar çalıştırılmadı; önceki saat aşamasının 112 başarılı sonucu tarihsel kalır. App dosyasının önceki tür kontrolü sınırı sürer.

React StrictMode altında gerçek PlayerRack bileşeni geçici yerel sayfada kontrollü kayıt yanıtlarıyla çalıştırıldı. İki farklı onaylı per düzeni ve hemen Seri Aç isteğinden sonra A tamamlanınca B başladı, açma bekledi; B tamamlanınca açma yeni onaylı grup kimlikleriyle geçti. İkinci denemede aynı sırada bileşen kaldırılıp A tamamlandı; B veya açma gönderilmedi. Gözlenen konsol temizdi. Bu kontrollü bileşen denemesindeki yazıcı gerçek Firebase değildir; oyun sunucusuna açma veya puan yazıldığı iddia edilmez.

Ayrı demo Firebase Auth/Firestore/API masasında üç botla yardımlı oyun, Seri Diz/Çift Diz/Seri Diz, yenilemede aynı el/grup düzenine dönüş ve normal çıkış geçti. Bu tam doğal maç, gerçek gecikmeli ağ veya telefon/Safari/Firefox testi değildir. Geçici test sayfaları kaynak paketine alınmaz.

## Tahmini etki

1. **Orta, yalnız hızlı düzenleme/açma durumunda doğruluk:** Son per onayı beklenir; gereksiz reddedilen açma isteği önlenebilir. Ağ yanıtı beklemek gerektiğinden salt hamle hızı artışı değildir.
2. **Düşük istek/bellek etkisi:** Kapanıştan sonra bekleyen düzenleme ve bileşen bildirimi çalışmaz; zaten uçuşta olan istek tamamlanır. Uzun kullanımda bellek/pil veya toplam kota tasarrufu ölçülmedi.
3. **Düşük paket etkisi:** Okey parçası gzip 39,66 → 39,83 kB; ana dosya 172,21 → 172,22 kB. CSS `index-Tlx8d9Qx.css` aynı. Diğer oyun parçalarının hash değişimi ortak ana dosya referansındandır.

Stockfish/Tavla motor kapanışları, ses ve ölçüm dinleyicileri de incelendi; bu turda bu bölümlerde yeni kesin sızıntı doğrulanmadı, geniş yeniden yazım yapılmadı. Bu uzun bellek profili değildir. Genel denetim; sekiz orta bağımlılık kaydı, doğrudan Firestore token iptali, anonim UID/IP dolaşımı, gerçek cihaz/uzun arka plan/yük ve operasyonel saklama/izleme sınırları nedeniyle tamamlanmış sayılmaz.
