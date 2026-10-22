# 101 Okey — doğrulama çekirdeği ve kalan geçiş

23 Ekim 2026. Okey çekirdeği dört kişilik oda API'sine ve kendi elini dinleyen istemciye bağlandı. `OKEY_API_ENABLED=true` ve `VITE_SERVER_OKEY_ENABLED=true` ayrı geçiş ayarlarıdır; varsayılan kapalıdır. Aşağıdaki yerel kabul kontrolleri geçti. Canlı kurallar/ayarlar ve gerçek çalışan işlev doğrulanmadan Okey'in canlı güvenlik geçişi tamamlandı denmemelidir.

## Mevcut akışta güvenli düzeltmeler

- Seri/set doğrulaması aynı grubun veya aynı taşın iki kez seçilmesini ve kayıp taşın filtrelenerek geçerli per sayılmasını reddeder; toplam puan tekrarlanan taşla yükseltilemez.
- Çift doğrulaması beş ayrı grup ve on ayrı taş gerektirir; aynı çiftin tekrar sayılması reddedilir.
- Süre aşımında yandan alınıp kullanılmamış taş, oyuncu önceden elini açmış olsa da geri konur; ardından kapalı desteden çekilip normal atış yapılır. Önceden atış reddediliyor, son kurtarma adımı yan taşı elde bırakarak sırayı ilerletebiliyordu.

Bu kontroller, legacy Firestore izinlerini veya kötü niyetli bir istemcinin doğrudan yazma imkanını kaldırmaz.

## Hazırlanan sunucu çekirdeği

- Dört kişilik dağıtımda 106 kanonik taş kullanılır; yalnız başlayan 22, diğerleri 21 taş alır, gösterge ayrılınca kapalı destede 20 taş kalır. Karıştırma Node `crypto.randomInt` kullanır.
- Kapalı komut şemaları yalnız taş kimliklerini kabul eder; oyuncu kimliği, taş yüzü, skor, sonuç veya saat istemciden alınmaz. Üyelik, sıra numarası, el kimliği, hazırlık ve sunucu son tarihi kontrol edilir. Tekrar aynı oyuncuya sıra geldiğinde eski tur komutu geçmez.
- Çekme/atma, yandan alma ve geri koyma, seri/set ve çift, katlama barajları/eş muafiyeti, gösterge eşinin yalnız ilk çift açılışında joker olması, büyük açılış ödülleri, yan taş cezası, işleme/Okey değişimi, takım puanı, deste bitişi ve yeni elin başlangıç sırası mevcut saf kural yardımcılarıyla hesaplanır.
- Her işlem yeni bir durum üretir; reddedilen işlem giriş durumunu değiştirmez. Bir yasal düşük toplamlı seri denemesi mevcut +101 cezasını üretir; bu, hata fırlatarak geri alınmaz. Gelecek işlem kaydı bu cezayı da yalnız bir kez uygulamalıdır.
- Bot kararlarına yalnız kendi eli ve açık masa verilir. Rakip eli veya kapalı deste sırası karar yardımcılarına geçirilmez. Her bot turu sınırlı sayıda adımla tamamlanır; bot ilerlemesi ve insan süre aşımı yalnız sunucu zamanına göre açılır.
- Genel görünüm açık alan listesinden üretilir; eller, taslak gruplar, kapalı deste ve gelecekte eklenen özel alanlar taşınmaz. Özel görünüm yalnız ilgili insan oyuncunun eli/taslak grupları ve el kimliğidir. Genel durumda yalnız deste/ıstaka sayıları vardır; arayüz bunları göstermeye zorlanmaz.

## Bağlanan oda ve istemci

`serverOkeyRooms/{roomId}` yetkili tam durumu ve UID dizilimine bağlı en çok sekiz maç geçmişini içerir; istemciler burayı okuyamaz. `roomsV2` yalnız genel durumu, `playerData/{uid}` yalnız ilgili insanın elini içerir. Her değişiklik, genel/kişisel görünümler ve işlem kaydı aynı transaction'da yazılır. Değişmeyen özel eller tekrar yazılmaz; genel belgede UID başına `handVersions` bulunur. İstemci el kimliği ve el sürümü eşleşene kadar son tutarlı görünümü korur; yeni elde önceki eli yeni masaya karıştırmaz.

Dört kişilik oda kurma/katılma, seyirci, sunucuda takım/kural yetkisi, iki kişilik takım kapasitesi, bot doldurma, üç saniyelik geri sayım ve bot koltuğuna onaylı geçiş bağlandı. Takımlar eksikse geri sayım başlamaz. İki kişilik oyunların yaşam döngüsü Okey'e uygulanmaz. Normal kopma koltuğu boşaltmaz; süreyi aktif başka bir oyuncunun isteği ilerletebilir. Açıkça ayrılan oyuncudan sonra kalan oyuncu Bekle derse eski el sunucuya özel arşivlenir; yeni dizilim yeni el/skorla başlar, aynı dört Firebase UID'si dönerse kendi maçları geri gelir. Yeni kişi başka insanın eski gizli elini alamaz. Bot koltuğunu onayla devralma mevcut özelliğin özel istisnasıdır.

Hızlı eşleşme en çok 30 oda içeren tek `okeyLobby/queue` belgesiyle eşzamanlı dört koltuğu doldurur; host bağlantısı 60 saniye içinde canlı olmalıdır. Özet sadece genel oda kodu/host/doluluk/zaman bilgisi içerir. Yeni kuyruk için giriş yapanlara `get`, listeleme/yazmaya ret kuralı eklendi. Kendi `playerData` kuralı mevcut Amiral Battı kuralıyla aynıdır; rakip/seyirci erişimi açılmaz. Legacy oda kuralları bu geçişte değiştirilmez; eski Okey odaları yeni istemcide devralınmaz, yeni oda gerekir.

İstemci kapalı destenin üst taşını tahmin etmez; çekilen taşı yalnız onaylı özel elinden öğrenir. Bot/süre ilerlemesini aktif oyuncular 1 saniyelik yerel kontrolle, sıraya göre kısa gecikmeyle tetikler; karar ve zaman sunucudan gelir. Kalıcı süreç, cron veya ücretli hizmet kurulmadı. Son 32 işlem yanıtı tutulur. Sıra/el kimliğine ek ayrı `playVersion`, kayıt listeden çıktıktan sonra eski ceza/işleme isteğinin aynı turda yeniden uygulanmasını engeller; yalnız ıstaka düzeni değişiklikleri bu sürümü arttırmaz.

Eski tarayıcı süre bitiminden sonra kurtarma işlemi yetişene kadar hamleyi kabul edebiliyordu. Yeni sunucu süre + mevcut 2 saniyelik tolerans sonrasında normal hamleyi reddeder; süreyi istemci uzatamaz. El açınca mevcut 15 saniye ek süre, bot karar kuralları ve takım puanları korunur. Botun ara çekme/açma/işleme/atma adımları tek transaction'da hesaplandığı için masa tamamlanan bot turunu birlikte görür.

## Canlıya açmadan önce kalan işler

1. Test edilen kodu kapalı Production ayarlarıyla yayımlayıp mevcut XOX/Amiral işlevlerinin çalışmasını kontrol etme.
2. Mevcut aşamalı kurallara sadece Okey eşleşme özeti ekini yayımlama ve iki Okey ayarını yalnız Production ortamında açma. Yeni IAM, kalıcı anahtar veya plan değişikliği gerekmez.
3. Gerçek anonim test kimlikleriyle kendi/rakip/seyirci el erişimi, sunucu deste erişim reddi, tekrar ceza/çekiş, bot, sonuç ve yeni el kontrollerini canlıda yapma. Ardından tarayıcı ve uygulama dosyası/yayın kaydını doğrulama.

## Doğrulama ve etkiler

Yeni çekirdek için 19, mevcut per/çift doğrulaması için 2 regresyon testi vardır. 24 rastgele tam el üç bot ve zaman aşımındaki insanla simüle edilir; her adımda 106 taşın kanonikliği/benzersizliği ve giriş durumunun değişmediği doğrulanır. Bu rastgele tekrarlar deterministik hedef senaryolarının yerine geçmez.

Okey için 11 yeni emülatör senaryosu ile toplam 30 senaryo/34 üst-alt test sonucu geçti. Dört eşzamanlı koltuk, erken başlama/erken bot oynatma reddi, host ve takım yetkisi, tek çekme/tek ceza, son 32 kayıt dışına çıkan eski cezanın reddi, eşzamanlı bot sürücüleri, koltuk devri, ayrılma/arşiv/yeni dizilim/aynı UID dönüşü, hızlı eşleşme ve bayat host, tek bitiriş ödülü, eski el reddi, yeni el ve sunucuda üç botla tam el sınandı. Gerçek demo Auth token'larıyla yalnız kendi elini okuma geçti; rakip/seyirci okuma, listeleme, doğrudan yazma ve sunucu deste belgesini okuma reddedildi.

Tarayıcıda iki bağımsız originle katılma, seri açma, sürükleyerek atma, yandan alma/geri koyma ve kapalı çekme denendi. Eşli modda bot doldurma, seyirci ve host onayıyla bot koltuğu devri geçti. Kontrollü ve 106 taşı koruyan yasal 127'lik bitiriş konumundan seri açma, son taşı ortaya atma, iki tarafta 101/-808 takım sonucu, yeni elde skorun korunması ve yenilemeyle kendi elini geri alma doğrulandı. Bu bitiriş bir hazırlanmış test konumudur; baştan sona elle oynanmış rastgele maç olarak raporlanmaz. 390/320 ekran kontrolleri geçti; 390 genişlikte taşlar 29×41 piksel oranını korudu. Eski emülatör durdurmalarına ait taşıma uyarıları görüldü; uygulama hatası gözlenmedi. Gerçek Safari/Firefox/iOS ve uzun süreli yük testi yapılmadı.

Yerel tarayıcıda yalnız demo emülatöründe oluşturulan özel test odasında açmış oyuncuya kullanılmamış yan taş ve dolacak süre verildi. Süre dolunca yan taş atan oyuncunun yığınına döndü, kapalı desteden bir taş çekildi, normal atış yapıldı ve sıra yalnız bir sonraki oyuncuya geçti. İlgili ıstaka 2'den 1 taşa, deste 40'tan 39'a indi; oda verisiyle ayrıca doğrulandı. Gözlenen konsolda hata/uyarı yoktu. 390 ve 320 genişliklerinde belge genişliği kaydırma genişliğine eşitti (375/305 kullanılabilir piksel); denenmiş görünümde yatay taşma yoktu. Bu, bütün cihaz ve masa durumlarının kontrolü değildir.

Beklenen ağ etkisi **orta**: genel oda güncellemelerinden eller/deste çıkarılır; yalnız değişen özel eller yazılır. CPU/okuma etkisi **orta**: botun ara kararları bellekte tek turda hesaplanır ve her ara adım için ayrı Firestore transaction'ı gerekmez. Gerçek yük altında süre veya kota tasarrufu ölçülmedi. Her normal Okey işlemi yetkili özel oda belgesini okur; bu okuma gizlilik/doğrulama için gereklidir. Sadece oyun hamleleri eşleşme kuyruğunu okumaz. Mevcut iki doğrulama düzeltmesinin maliyeti taş sayısıyla sınırlı küçük bir `Set` kontrolüdür; sayısal hız iddiası yoktur.

Örnek dört kişilik ilk elin yerel JSON ölçümünde tam durum 7025 bayt, genel görünüm 957 bayt ve tek oyuncunun özel görünümü 1325 bayttı. Bu örnek yalnız veri modeli farkını gösterir; Firestore belge/taşıma yükünü içermez ve canlı hız veya kota tasarrufu ölçümü değildir.
