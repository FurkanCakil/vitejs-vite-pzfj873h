# Eski oda erişiminin kapatılması

27 Ekim 2026 — Canlı kapatma tamamlandı. Önce `70092eb` istemcisi Production Ready oldu (15:31:52), ana JavaScript yerel açık derlemeyle bayt düzeyinde eşleşti ve XOX/sayaç çalışması doğrulandı. Ardından Firebase kuralları 15:34'te yayımlandı; boş satırlar dışında kaynakla tam eşleştiği ve yayımlanmamış taslak kalmadığı doğrulandı. Eski sekmeler yenilenir; eski oda verisi silinmedi ve yeni odalara taşınmadı. Yeni oda gerekir. IAM, anahtar, ortam ayarı, ücretli plan veya zamanlanmış iş eklenmedi.

## Bulgu ve düzeltme nedenleri

- **Kritik:** Yedi yeni oyun sunucuya taşınmış olsa da eski `rooms` belgeleri herkese okunabilir/oluşturulabilir ve herhangi bir giriş yapan tarafından değiştirilebilirdi. Hazırlanan kural eski odaların tüm istemci erişimini kapatır; yeni `roomsV2`, özel el/filo, eşleşme ve sayaç izinleri korunur.
- **Orta:** Ana uygulama ve lobi eski oda sorgusu, katılım, seyirci ve yazma geri dönüşlerini hâlâ taşıyordu. Bu yollar kaldırıldı; kapalı sunucu ayarı artık eski güvensiz yola dönmez. Oyun mekaniği ve tahta CSS'i değiştirilmedi.
- **Orta:** Eski `sessionStorage` kodu eski dinleyiciyi açabiliyordu. Ayrı depolama yardımcısı yalnız v2 işaretli geçerli kodu geri yükler; eski/bilinmeyen protokolü temizler ve yeni oda gerektiğini söyler. Yerel işaret sunucu üyeliği sağlamaz.
- **Orta:** Okey veya seyirci normal çıkışında üyelik HTTP yanıtından önce kaldırılınca yanlış oturum-sonlandı uyarısı çıkabiliyordu. Eşzamanlı çıkış işareti ve oda kodu kontrolü, beklenen dinleyici reddini temiz çıkış olarak işler; geç yanıt başka odayı kapatmaz.
- **Düşük:** Eski sayaç okuma/yazma yedeği ve oda ısıtma okuması gereksizdi. İstemci yalnız sunucu sayacını kullanır; eski sayaç okuması da kapatılır. Sunucu presence kodu eski odaları eşleşme adayı ilan etmez.

## Doğrulama

- 128 otomatik test geçti; emülatör gerektiren 11 üst test normal komutta atlanır. Yeni dört depolama testi eski protokol, normal v2 yenileme, kapalı ortam ve engellenen tarayıcı depolamasını kapsar.
- Temiz demo emülatöründe 91 senaryo / 11 üst testle **102 sonuç** geçti. Son eski sayaç okuma reddi eklemesinden sonra legacy ve presence testleri yeniden **15 sonuç** ile geçti. Canlı projeye bağlanılmaz.
- Eski yedi oyun belgesinde anonim/eski üye/dış kullanıcı okuma/listeleme/yazma reddi, alt belge gizliliği, kod çakışması ve API'nin eski odayı devralmaması sınandı. Gerçek eski veriler silinmez.
- TypeScript ve diff kontrolü temiz; lint sıfır hata, mevcut 36 uyarı. Bu uyarılar çözüldü sayılmaz.
- Tüm sunucu istemci ayarları açık derleme başarılı: `index-YYy92vMJ.js`, 552,54 kB / gzip 171,66 kB; CSS 65,50 / 11,60 kB. Varsayılan kapalı ayar derlemesi de hazırlıkta geçti.
- İki bağımsız yerel tarayıcıyla eski oturumun temizlenmesi/eski kodun reddi; XOX hamle/yenileme/yeniden katılım; seyirci ve temiz çıkış; Okey özel el/botla başlama/ayrılanın bota dönüşmesi; normal Okey çıkış uyarısı düzeltmesi; Connect 4 hızlı eşleşme/sayaç/karşılıklı hamle/yenileme ve yerel XOX bot yanıtı doğrulandı.
- 320 ve 390 piksel lobi/eşleşme panelinde yatay taşma görülmedi. Gerçek iOS/Safari/Firefox testi değildir. Kullanılan beş demo odası normal çıkışla kapatıldı, geçici test dosyaları kaldırıldı.

## Canlı kabul ve yayın kanıtı

- [70092eb Production yayını](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/AKtKUztA16fwRe2dSJZaFBtSX8M5) Ready; ana dosya `/assets/index-YYy92vMJ.js` test edilen dosyayla aynı.
- Gerçek Firebase anonim test kimlikleri ve oturumsuz isteklerle eski oda/sayaç get-list ve yeni rastgele test kimliğine create/maskeli patch girişimleri 403 döndü. Mevcut eski odalar okunmadı, değiştirilmedi veya silinmedi. Eski örnek koda v2 join/spectate 404/room_not_found verdi.
- Yedi eşleşme özetinde oturumsuz get 403; kimlikli get, mevcut belge için 200 veya hiç oluşmamış boş kuyruk için 404 verdi. Belgenin yokluğu yetki reddi değildir; istemci bunu boş kuyruk olarak gösterir.
- Yeni yedi oyun türünde özel oda oluşturma/katılım/üye okuma/normal ayrılma ve kapalı durum doğrulandı. Üye olmayan/oturumsuz oda okuma, oda listesi ve üyenin doğrudan maskeli yazması reddedildi. Amiral Battı'da kendi özel filo görünümü okunabildi, rakip/dış kullanıcı reddedildi. Okey'de iki botla gerçek dağıtımdan sonra kendi el okuması geçti; rakip/dış kullanıcı reddedildi. Sayaç heartbeat/özet/leave geçti.
- Test düzeneğinin ilk denemelerinde henüz oluşmamış kuyruk ve dağıtılmamış Okey el belgesi yanlışlıkla 200 bekledi; ayrıca bir Okey komutunda zorunlu sürüm eksikti. Bu varsayımlar düzeltildi, kalan testler tamamlandı. Önceki denemelerin test odaları da `finally` içindeki normal çıkışlarla kapatıldı ve kapalı durumları doğrulandı. Bunlar ürün hatası olarak raporlanmaz.
- Canlı tarayıcıda aktif sayaç, eski kod için yeni oda mesajı ve yedi boş eşleşme seçeneği görüldü; gözlenen konsolda hata/uyarı yoktu. Okey odası botlarla açıldı, özel taşlar gösterildi, yenilemeyle aynı ele geri dönüldü ve normal çıkışla lobiye dönüldü. Bu son kontrol doğal tam maç veya tüm tarayıcı garantisi değildir.
- Kural kanıtı yerel `eski-oda-kurallari-canli-2026-10-27.png` görüntüsünde; tam değişen dosyalar ve dosya başına nedenler teslim ZIP/TXT paketindedir. Geçici doğrulama kodu ve token'lar depoya alınmaz.

## Hız etkisi ve sınırlar

1. **Orta:** Eski lobi oda koleksiyonu dinleyicisi kaldırıldı; belge sayısına bağlı okumalar artık yapılmaz. Tasarruf eski oda sayısına bağlıdır; ölçülmüş yüzde iddiası yoktur.
2. **Düşük:** Ana dosya gzip 178,67 → 171,66 kB: yaklaşık 7,01 kB / %3,9 azalma. Bu bütün sayfanın veya oynanışın %3,9 hızlandığı anlamına gelmez.
3. **Düşük:** Her oturumdaki gereksiz eski oda ısıtma okuması ve kapalı ortamın eski sayaç girişimleri kaldırıldı. Yeni oyun/sayaç sunucu isteklerinin kota maliyeti devam eder.

Genel denetim henüz bitmedi: bağımlılık uyarıları (son kayıt 10 yüksek / 16 orta), anonim hesap yenileyerek hız sınırını aşma, token iptal kontrolü, gerçek cihaz/uzun süre arka plan ve yük testleri ile operasyonel saklama/izleme işleri ayrı kalır. Mevcut verilerin toplu silinmesi veya ücretli hizmet açılması bu aşamanın parçası değildir.
