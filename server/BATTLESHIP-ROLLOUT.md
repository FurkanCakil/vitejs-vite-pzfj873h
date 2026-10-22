# Amiral Battı: özel filo ve sunucu geçişi

22 Ekim 2026. Hazırlandı, yerelde sınandı; **henüz canlıda etkin değil**. XOX'un canlı sunucu akışı korunur. Aşağıdaki iki yeni ayar tanımlanmadığında Amiral Battı mevcut eski akışını kullanır.

## Düzeltilen riskler

- Kritik: eski ortak `ships` alanı rakibin konumlarını indiriyordu. Yeni oda belgesi bitmemiş filoları içermez; tam filolar ve eşleşme geçmişleri `serverBattleFleets/{roomId}` altında sunucuya özel kalır. Oyuncuya yalnız kendi `roomsV2/{roomId}/playerData/{uid}` belgesinin okuması açılır. Rakip ve seyirci bu belgeyi okuyamaz; kimse listeleyemez veya doğrudan yazamaz.
- Kritik: atış sonucu, sıra ve skor sunucuda hesaplanır. Aynı işlem yeniden gelince aynı yanıt döner; aynı sürümde iki farklı atıştan biri reddedilir. Gemiyi batırmaya özel kimlik/uzunluk sonucu verilmez; mevcut isabet/karavana kuralı korunur. Tam filolar yalnız maç sonucundan sonra açılır.
- Orta: filo sunucuda tam beş sabit gemi ve toplam 17 hücre olarak doğrulanır. Eksik/tekrar eden gemi, çakışma, geçersiz yön, sınır dışı konum ve uydurma alanlar reddedilir. İstemci uzunluk veya isabet değeri seçemez.
- Düşük: hedef hücreleri klavye ile kullanılabilen etiketli düğmelere çevrildi. Radarın dönen ışığının taşması `overflow: clip` ile sınırlandı; düğmeye odaklanmak ızgarayı etiketlerin altından kaydıramaz. Yerleşim gövdesi/döndürme/sürükleme boyutları değiştirilmedi.

## Oda ve tur davranışı

XOX ve Amiral Battı aynı doğrulanmış üyelik, sürüm, işlem kaydı, bağlantı ve hız sınırı akışını kullanır; oyunların eşleşme kuyrukları ayrıdır. Dosya adı geriye uyumluluk için `xox-rooms.js` olarak kaldı. Yeni oyun eylemleri `battleship.*` alanıyla ayrılır; XOX eylemi Amiral Battı odasında çalışamaz.

İki oyuncunun eşzamanlı Hazır isteği aynı yerleşim turuna bağlanır; eski bir turdan kalan istek yeni filoyu değiştiremez. Hazır olmayı iptal etmek yalnız rakip henüz hazır değilken mümkündür. İsabet sırayı korur, karavana rakibe geçirir. Yeni turda başlangıç değişir, skor kalır; hem özel hem açık filo görünümü temizlenir. Aynı Firebase UID çifti yeniden katıldığında kendi özel filolarıyla maçına dönebilir; yeni rakip eski özel filoları alamaz. Sekme kapatma, Bekle ve yeniden bağlanma davranışları ortak sunucu akışını kullanır.

## Kontroller

- 48 otomatik test; üretim derlemesi hem bayraklar kapalıyken hem açıkken, TypeScript ve değişen sunucu dosyalarının lint kontrolü geçti.
- Firestore/Auth emülatörlerinde toplam 19 senaryo (üç üst testle 22 sonuç): önceki 11 XOX/altyapı senaryosu ve 8 yeni Amiral Battı senaryosu. Rakip/seyirci/üyelikten ayrılan hesabın filo okuması, doğrudan yazma ve sunucu geçmişi okuması reddedildi.
- İki bağımsız yerel tarayıcı oturumunda beş gemi yerleşimi, döndürme/kaldırma, Hazır iptali, iki Hazır sonrası başlangıç, isabet/karavana, yenileme, tam maç/tek puan, rövanş/başlangıç değişimi ve 1:1 skor denendi. Botta yerleşim, bot yanıtı ve insan atışı çalıştı.
- 320/390 px viewport denemelerinde sayfa yatay taşmadı, hücreler kare kaldı; gözlenen konsollarda hata/uyarı yoktu. Bunlar gerçek Safari/Firefox/iOS ve uzun arka plan beklemesi testlerinin yerine geçmez.

## Performans ve sınırlar

- Orta tahmini etki: her genel oda güncellemesinde rakibin ve kendi filonun tamamını taşımak yerine normal oyunda yalnız atışlar ve genel durum taşınır. Kendi filo görünümü yerleşim/tur değişince güncellenir; bu etki için yük altında sayısal ölçüm yapılmadı.
- Düşük tahmini etki: normal bağlantı yenilemesi özel filo belgesini okumaz/yazmaz; mevcut bağlantı ve işlem kayıtları yenilenir. Atışta yetkili özel durumu okumak için ek bir sunucu okuması gerekir; toplam veritabanı işlem sayısının azaldığı iddia edilmez.
- Diğer oyunlar ve eski Amiral Battı belgeleri güvenli sayılmaz. Eski odalar taşınmaz; yeni istemcide yeni oda gerekir. Global oyuncu sayacı, anonim hesap açarak hız sınırını aşma ve token iptali denetimi önceki açık işlerdir. Ücretli plan, yeni IAM izni veya kalıcı anahtar gerekmez.

## Canlı açılış sırası — onay bekler

1. Firebase Console'da mevcut kuralları yeniden oku; test edilen `firestore.rollout.rules` dosyasını yayımla. Bu, XOX ve diğer oyunların mevcut kurallarını korurken kendi özel filonu okuma ve kimliği doğrulanmış oturumlara salt okunur Amiral Battı lobi özeti izni ekler. `server/firestore-v2.rules` tek başına yayımlanmaz.
2. Vercel'de yalnız Production için `BATTLESHIP_API_ENABLED=true` ve `VITE_SERVER_BATTLESHIP_ENABLED=true` ayarlarını ekle. Preview'a üretim erişimi açma.
3. Test edilmiş dalı ana dala gönder; yeni Production dağıtımında gerçek anonim kimliklerle özel filo erişimi, hazır, atış, galibiyet ve rövanşı tekrar doğrula.
4. Eski odalar ve eski istemciler geçişten yararlanmaz. Yeni oda/sayfa yenileme gereksinimini kullanıcıya bildir. Eski geniş izinleri kapatmak, diğer oyunların geçişinden ayrı bir adımdır.
