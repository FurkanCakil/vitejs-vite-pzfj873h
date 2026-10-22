# 101 Okey — doğrulama çekirdeği ve kalan geçiş

23 Ekim 2026. **Bu aşama Okey'in canlı sunucu geçişi değildir.** `games/okey.js` henüz API'ye veya istemciye bağlı değildir; canlı Firebase kuralları, Vercel ayarları ve mevcut oda modeli değiştirilmedi. Yeni çekirdek ana pakete veya çalışan oyun API'sine import edilmez. İstemcinin elleri/desteyi okuyabildiği mevcut Okey açığı bu hazırlıkla kapanmış sayılmaz.

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

Mevcut tarayıcı, süre bitiminden sonra kurtarma işlemi yetişene kadar hamleyi kabul edebiliyor. Hazırlanan çekirdek süre + mevcut 2 saniyelik tolerans sonrasında normal hamleyi reddeder; bu davranış canlıya bağlanmadan önce tarayıcıda sınanıp kullanıcıya açıklanmalıdır.

## Bağlanmadan önce zorunlu işler

1. Okey için dört kişilik oda/lobi işlemleri, sunucuda takım ve kural doğrulaması, bot doldurma, üç saniyelik geri sayım, seyirci/bot koltuğu devri ve sunucu bağlantı kayıtları. İki kişilik XOX/Amiral oda mantığı Okey'e doğrudan uygulanmamalı.
2. Yetkili tam durumun sunucuya özel belgede tutulması; genel/oyuncuya özel görünümlerin aynı Firestore transaction'ında yazılması. Mevcut `playerData` üyelik kuralının bot koltuğu devri ve el değişimindeki etkisi emülatörde sınanmalı.
3. İstek zarfı (oda/işlem kimliği), doğrulanmış Firebase UID, hız sınırı ve tekrar kaydı. Çekirdek bunların yerine geçmez. İşlemin ağ tekrarı veya iki eşzamanlı istek çift taş/çift ceza üretememeli. Mevcut 2 KB sınırına göre ıstaka/grup yükü ayrıca doğrulanmalı.
4. İstemcide yalnız kendi özel elini dinleme; diğer ellerin ve kapalı destenin indirilmesini kaldırma. `performDraw` şu anda kapalı destenin üstünü okuyarak iyimser taş gösteriyor; yeni akışta kapalı taş, yetkili kendi el görünümü gelmeden bilinemez. Dinleyiciler iki belge farklı zamanda geldiğinde `roundId` üzerinden birleştirilmeli; yeni el eski elle karışmamalı.
5. Bot/süre aşımı ilerlemesini aktif istemcilerin zamanlı isteğiyle tetikleme; Vercel sürecinde kalıcı zamanlayıcı veya tarayıcıda bot adına hamle kullanmama. Sunucu zamanı/işlem kimliği iki istemcinin aynı botu iki kez oynatmasını önlemeli. Otomatik cron kurulmadı.
6. Emülatörde tam oda yaşam döngüsü, eşzamanlılık, yetkisiz el/deste okuma-yazma ve koltuk devri testleri; iki/çoklu tarayıcıda mobil, sürükleme, sayaç, yeniden bağlanma, takım, tam oyun ve yeni el testleri.
7. Tamamlanmış geçişi ayrı kapalı ayarlarla yayımlama; yeni izin ve eski oda kapsamını kullanıcıya somut olarak gösterme. Canlı açılış doğrulanmadan güvenli geçiş tamamlandı denmemeli.

## Doğrulama ve etkiler

Yeni çekirdek için 19, mevcut per/çift doğrulaması için 2 regresyon testi vardır. 24 rastgele tam el üç bot ve zaman aşımındaki insanla simüle edilir; her adımda 106 taşın kanonikliği/benzersizliği ve giriş durumunun değişmediği doğrulanır. Bu rastgele tekrarlar deterministik hedef senaryolarının yerine geçmez.

Yerel tarayıcıda yalnız demo emülatöründe oluşturulan özel test odasında açmış oyuncuya kullanılmamış yan taş ve dolacak süre verildi. Süre dolunca yan taş atan oyuncunun yığınına döndü, kapalı desteden bir taş çekildi, normal atış yapıldı ve sıra yalnız bir sonraki oyuncuya geçti. İlgili ıstaka 2'den 1 taşa, deste 40'tan 39'a indi; oda verisiyle ayrıca doğrulandı. Gözlenen konsolda hata/uyarı yoktu. 390 ve 320 genişliklerinde belge genişliği kaydırma genişliğine eşitti (375/305 kullanılabilir piksel); denenmiş görünümde yatay taşma yoktu. Bu, bütün cihaz ve masa durumlarının kontrolü değildir.

Beklenen ağ etkisi **orta**: genel oda güncellemelerinden eller/deste çıkarılınca her oyuncuya taşınan veri azalır; henüz uygulama bağlantısı olmadığı için canlı hızlanma yoktur. CPU etkisi **düşük/orta**: botun ara kararları bellekte tek turda hesaplanır; henüz Firestore bağlantısı bulunmadığından işlem/okuma tasarrufu ölçülmüş sayılmaz. Mevcut iki doğrulama düzeltmesinin maliyeti taş sayısıyla sınırlı küçük bir `Set` kontrolüdür; ölçülebilir hız iddiası yoktur.

Örnek dört kişilik ilk elin yerel JSON ölçümünde tam durum 7025 bayt, genel görünüm 957 bayt ve tek oyuncunun özel görünümü 1325 bayttı. Bu örnek yalnız veri modeli farkını gösterir; Firestore belge/taşıma yükünü içermez ve canlı hız veya kota tasarrufu ölçümü değildir.
