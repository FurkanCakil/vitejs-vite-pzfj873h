# Satranç doğrulaması: çekirdek hazırlığı

26 Ekim 2026. **Satranç canlı güvenlik geçişi tamamlanmadı.** Bu aşama, küçük arayüz/kural düzeltmeleri ile oda API'sinden bağımsız sunucu çekirdeğini kapsar. `server/games/chess.js` henüz `executeRoomAction` veya HTTP eylem şemasına bağlanmadı. Canlı satranç odaları legacy modelde kalır; tahta/skor yazma yetkisi hâlâ hileye açıktır. Firebase kuralı, Production ayarı, IAM, anahtar, ücretli plan veya zamanlanmış iş değiştirilmez.

## Bulgular ve değişiklik gerekçeleri

| Önem | Dosya | Değişiklik ve nedeni |
| --- | --- | --- |
| Kritik, açık | `server/games/chess.js` | Üyelik, sıra, durum, renk, tahta, sayaç/geçmiş ve skor kontrollerinden sonra kaynak/hedef/terfiden sonucu türeten bağımsız çekirdek hazırlandı; istemci hesaplarına güvenmeden oda geçişini sınamak için. Canlıya bağlı değildir. |
| Orta | `src/games/chess/ChessGame.jsx` | `pointercancel` artık bırakma sayılmaz; kayıp capture, pencere odağı/görünürlüğü ve konum/sıra değişimi sürüklemeyi temizler, çünkü iptal olayı istemeden hamleye dönüşebiliyordu. |
| Orta | `src/games/chess/ChessGame.jsx` | Eşzamanlı gönderim referansla kilitlenir ve gerçek/premove hamlesi güncel taş/konumla yeniden doğrulanır; React state güncellenmeden gelen ikinci olayın yeniden yazmasını engellemek için. |
| Orta | `src/games/chess/ChessGame.jsx` | Terfi penceresi başladığı tahta ve sırayla bağlıdır; konum değişince kapanır ve dört seçenek de tekrar doğrulanır, eski piyon kopyasıyla işlem yapılmaması için. |
| Orta | `src/games/chess/ChessGame.jsx` | İyimser görünüm, henüz değişmemiş onaylı oda verisiyle hemen silinmez; hamle daha gönderilirken eski sıraya geri dönme sorununu önlemek için. |
| Düşük | `src/games/chess/ChessGame.jsx` | Kabul edilen tek hamle geri alındığında eski `previousState` temizlenir; aynı geri alma kaydının yeniden kullanılmaması için. Sunucu onayı yerine geçmez. |
| Orta, bozuk/eski konum sınırı | `src/games/chess/logic.js` | Geçerken alma hedefi boş olmalı ve uygun sırada yan karede karşı piyon bulunmalı; olmayan piyonun alınmasını engellemek için. Şah gerçek hamlede alınamaz, tehdit haritasında kalır; rok simülasyonu kaleyi de taşır. |
| Düşük | `src/games/chess/move.js` | Değişmez ortak hamle geçişi; normal oyuncu, ön-hamle, Stockfish ve hazırlanan sunucu aynı rok/yeme/terfi/SAN/sonuç hesabını kullansın diye. |
| Doğrulama | `server/chess.test.js` | On iki senaryo; çekirdeğin üyelik/sıra/tahta reddini, özel hamlelerini, sonucu, puanı ve PGN'yi sınar. |
| Doğrulama | `src/games/chess/logic.test.js` | Beş standart perft konumunda üç derinliğe kadar toplamlar; özel hamle düzeltmelerinin yasal seçenekleri eksiltmediğini kontrol etmek için. |
| Kayıt | `server/README.md`, `SECURITY-MIGRATION.md`, bu dosya | Hazır çekirdekle tamamlanmış canlı geçişin karıştırılmaması için durum, kanıt ve sonraki kabul işleri kaydedildi. |

Tahta ölçüleri ve notasyon düzeninin CSS sınıfları değiştirilmedi. Kolay/orta/zor Stockfish ayarları değiştirilmedi. Mevcut otomatik üç tekrar/50 hamle beraberliği korunur; FIDE'nin hakemli oyundaki talep/75 hamle mekanizması bu aşamada eklenmez. Bu, sitenin bütün satranç kurallarının FIDE ile eksiksiz aynı olduğu iddiası değildir.

## Doğrulama ve sınırları

- 105 otomatik test geçti (normal `npm test` toplam 112; yedi emülatör üst testi burada atlanır). Önceki 92 teste 12 çekirdek ve bir perft regresyonu eklendi.
- Mevcut 60 emülatör senaryosu / yedi üst testle 67 sonuç geçti; diğer beş oyunun ve sayacın oda/erişim regresyonlarıdır. **Yeni Satranç oda entegrasyonu testi değildir.** Yalnız `demo-oyun-portali`, `127.0.0.1:8180` ve `127.0.0.1:9199` kullanıldı; üretim verisi değiştirilmedi.
- Mevcut TypeScript kontrolü ve üretim derlemesi geçti. Kod denetleyicide 0 hata, önceki 44 uyarı sürer. `App.tsx` içindeki mevcut `@ts-nocheck` nedeniyle sonuç bütün uygulamanın tür güvenliği değildir.
- Kural düzeltmesinden önce iki bağımsız küçük konumda olmayan piyonla geçerken alma ve karşı şahı alma hamlesinin listelenmesi yeniden üretildi; yeni regresyonlar ikisini reddeder. Bunlar normal başlangıçtan yasal hamlelerle oluşan oyunlar olarak sunulmaz.
- Perft: başlangıç 20/400/8902; Kiwipete 48/2039/97862; diğer dört standart konum 14/191/2812, 6/264/9467, 44/1486/62379 ve 46/2079/89890. Yalnız standart satranç; Chess960 desteği eklenmedi.
- Geçici yerel React test sayfasında önceki arayüz ile yeni arayüz karşılaştırıldı: hedefte `pointercancel` eskiden bir yazma ve e4 üretiyor, yeni sürüm sıfır yazmayla e2'yi koruyor. Aynı event döngüsündeki iki hedef tıklaması eskiden iki, yeni sürüm bir yerel yazma yapıyor. Bu sentetik olay testi gerçek dokunmatik cihaz testi değildir; sayfa/dosya dağıtıma alınmadı.
- Hazırlanmış dört parçalı yerel terfi konumunda gxh8=N, alınan kale ve materyal beraberliği görüldü; bu doğal oynanmış tam maç değildir. Sıra değişince eski terfi penceresinin kapandığı kontrol edildi.
- Gerçek uygulamanın yerel kolay bot yolunda Stockfish açılışı/yanıtı, tıklama, native sürükleme, SAN ve panoya standart PGN kopyalama geçti. 390/320 genişliklerinde hamleden sonra kare en/boy oranı eşit ve belge genişliği viewport içinde kaldı. Tam ekran arayüzünde notasyon gizlendi; çıkınca döndü. Gözlenen konsolda uyarı/hata yoktu.
- Gerçek Safari/Firefox/iOS, uzun oyun/yük ve tüm çok oyunculu yarış senaryoları sınanmadı. Yeni sunucu çekirdeği hiçbir canlı hamleyi henüz yetkilendirmez.

## Sonraki küçük adımlar

1. Beraberlik teklifi/kabul/ret, tek hamle geri alma/kabul/ret ve teslim olmayı sunucuda doğrula; oyuncu kendi teklifini kabul edemesin, sonlanmış oyunda puan tekrar yazılmasın.
2. Mevcut `roomsV2` yaşam döngüsüne ve ayrı varsayılan-kapalı ayarlara bağla. Aynı UID çiftinin tam geçmiş/notasyon/renk/önceki konumunu geri getir; yeni oyuncuda sıfırla. Geçmiş ve Firestore belge boyutu sınırını ölç; notasyonu sessizce kesme.
3. İstemciyi yalnız eylem göndermeye geçir; ön-hamle/terfi/iyimser görünüm sürüm reddiyle tutarlı kalsın. Yeni kuyruk yalnız eşleşme seçici açıkken dinlensin. Bot yerel kalır.
4. Emülatörde gerçek Auth gizliliği/yazma reddi, eşzamanlı hamle, tekrar final isteği, rövanş, çoklu sekme, ayrılma/geri dönüş; iki tarayıcıyla teklifler, PGN, tam maç ve mobil oranı sına.
5. Hazır/test edilmiş kapalı sürümü yayımla; oda modeli açılmadan önce kapsamı kullanıcıya bildir. Açılışta eski Satranç odalarının devralınmayacağını açıkla. Yeni kural/iki Production ayarı ve canlı API/tarayıcı kabul kontrolü ayrı adımdır.

## Performans değerlendirmesi

- **Düşük, uygulandı:** Aynı anda iki hamle gönderimi tek yazmaya iner; yerel karşılaştırmada 2→1 görüldü. Bu toplam site kotasının yarıya inmesi değildir.
- **Düşük, uygulandı:** Hamle uygulaması tek ortak modüle taşındı; tekrar eden kural kodu azaldı. Gerçek kullanıcı yükünde süre/ağ kazancı ölçülmedi; yeniden doğrulama bir miktar ek CPU gerektirir.
- **Düşük, uygulandı:** Onaylı konum imzası yalnız ilgili oda verisi değişince hesaplanır; sürükleme hareketlerinde bütün notasyon tekrar serileştirilmez. Uzun oyunlarda gerçek süre kazancı ölçülmedi.
- **Orta, öneri:** Satranç geçişinde sınırlı kuyruk ve yalnız gerektiğinde dinleme, geniş legacy oda taramasını azaltabilir. Henüz uygulanmadı veya ölçülmedi.
- Sunucu geçişi token/transaction maliyeti getirecektir; mevcut Spark/Hobby için ücretsiz/sınırsız kullanım ya da kota tasarrufu garantisi verilmez.

Kaynaklar (26 Ekim 2026'da kontrol edildi): [FIDE 2023 kuralları, özellikle 1.4.1, 3.7, 3.8, 9.2–9.3](https://handbook.fide.com/chapter/E012023), [Stockfish standart perft konumları](https://github.com/official-stockfish/Stockfish/blob/master/tests/perft.sh), [alt derinlik perft sonuçları](https://www.chessprogramming.org/Perft_Results). Bu kaynaklar uygulamanın canlı güvenliğinin tamamlandığına kanıt değildir.
