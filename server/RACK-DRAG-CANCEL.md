# Okey sürükleme iptali ve mobil görünüm denetimi

28 Ekim 2026 — `8ced908` ana dala gönderildi; [Production yayını](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/aD8pYd6912qj7nuLUm1oYJp4QvGy) 22:01:00’de Ready oldu. Genel denetimin bu dar aşaması ıstakadaki sürükleme iptalini düzeltir. Oyun kuralları, puan, CSS/tahta boyutları ve özel el yetkileri korunur. Sunucu/API, Firebase kuralı, IAM, ortam ayarı, anahtar, ücret veya zamanlanmış iş değişmedi.

## Bulgular ve değişiklik gerekçeleri

- **Kritik:** Bu bölümde yeni kritik açık doğrulanmadı; gerçek hamle/per/puan kararı sunucuda kalır.
- **Orta:** Istaka slotu, iade ve atma hedeflerindeki pointercancel, normal pointerup ile aynı bitirişe bağlıydı. İptal son hedefe taş taşıma/atma/işleme isteği üretebiliyordu. Eski gerçek PlayerRack bileşeninde atma hedefi üzerinde sentetik pointercancel, bir discard isteği üretti; odak kaybından sonra gelen bırakma da aynı sonucu verdi.
- **Orta:** Odak/görünürlük/pointer capture kaybı temizlenmiyordu; hayalet veya uzun basma zamanlayıcısı sürebiliyor, olaylarda pointerId ayrılmadığından ikinci parmak ilk sürüklemeyi değiştirebiliyordu. İptal artık yalnız görsel/hedef/RAF/uzun basma durumunu temizler; normal bırakma yalnız sürüklemeyi başlatan pointer tarafından tamamlanır.
- **Düşük:** Sağ/orta fare düğmesiyle veya mevcut sürüklemenin üzerine ikinci bir pointer ile yeni sürükleme başlatılması engellendi. Sahiplik veya sürüklenen taşlar kaybolduğunda hareket iptal edilir.

`src/games/okey101/PlayerRack.jsx` içindeki küçük değişiklik; iptal ile bitirişi ayırır, pointer kimliğini izler ve pencere/sekme olaylarına temizlenen dört dinleyici bağlar. Normal pointerup önce React hedefinde işlenir; pencere dinleyicisi yalnız artakalanı iptal eder. Yeni bir oyun döngüsü veya zamanlayıcı eklenmez. Bu dosya, `server/README.md` ve `SECURITY-MIGRATION.md` doğrulama kapsamını ve açık sınırları kaydeder.

## Doğrulama

Mevcut 162 otomatik test geçti; yeni otomatik test sayısı iddia edilmez. Normal test komutunda 13 sunucu emülatör üst testi bilerek atlanır. Lint sıfır hata/36 mevcut uyarı, mevcut TypeScript kontrolü ve bütün oyun bayrakları açık üretim derlemesi başarılı. App dosyasının önceki tür kontrolü sınırı sürer. Bu aşamada birleşik sunucu emülatör test paketi tekrar çalıştırılmadı; önceki aşamadaki 99 senaryo/13 üst test/112 sonuç tarihsel kalır.

Geçici yerel sayfada React StrictMode altında gerçek PlayerRack ve kontrollü PointerEvent dizileriyle sekiz senaryo sınandı:

1. Atma hedefinde pointercancel: sıfır oyun isteği, hayalet kalmadı.
2. Atma hedefinde blur ardından pointerup: sıfır oyun isteği, hayalet kalmadı.
3. lostpointercapture: sıfır oyun isteği, hayalet kalmadı.
4. İlgisiz ikinci pointer iptali ardından ana pointer bırakma: tek normal atma isteği.
5. Normal ana pointer bırakma: tek normal atma isteği.
6. Başka taşta ikinci pointerdown/move/up: ana sürüklemeyi devralmadı; ana iptal sonrası sıfır oyun isteği.
7. Boş slot üstünde iptal: sıfır layout isteği.
8. Boş slota normal bırakma: tek layout isteği.

Bu yazıcı gerçek Firebase değildir; canlıya hamle/puan yazıldığı veya donanımın gerçekten pointercancel ürettiği iddia edilmez. Sentetik dizinin donanım capture'ı bulunmadığından yalnız test kaynağının setPointerCapture çağrısı fixture içinde etkisizleştirildi; ürün kodu capture kullanmaya devam eder. HMR sırasında geçici test girişinin yeniden createRoot uyarısı oluştu; temiz yeniden açılmış sekmedeki sekiz son kabulün gözlenen konsolu temizdi. Yardımcılar kaynak/yayın paketine alınmaz.

Ayrı demo Auth/Firestore/API ile özel Okey masası ve üç bot açıldı. 390×844 görünümde gerçek fare sürüklemesiyle kırmızı 12 ilk slottan boş 29. slota taşındı; yenilemede aynı yerde kaldı. Normal çıkışla lobiye dönüldü. Gözlenen konsol temizdi. 320×740 ve 390×844 dikey ölçümlerinde 30 slot yatay belge sınırında kaldı; dikey sayfa kaydırması normaldir. 844×390 kompakt görünümde 30 slotun en altı yaklaşık 376 pikseldeydi ve yüksekliğe sığdı. Viewport ayarı geri alındı.

Satrançta 320 pikselde kareler eş oranlıydı; 390 pikselde e4 ve botun d5 cevabı/notasyon görüldü, yaklaşık 31,67×31,67 kare ölçüsü korundu ve belge yatay taşmadı. 320 piksel çok dar görünümde okunabilirlik hakkında tam cihaz kullanılabilirlik sonucu çıkarılmaz. Bu sadece masaüstü Chromium viewport kontrolüdür; gerçek iOS/Safari/Firefox, dokunmatik donanım, tam doğal maç veya uzun süreli bellek/uyku/yük testi değildir.

Canlı ana JS/Okey parçası/CSS test edilen üretim çıktısıyla bayt düzeyinde eşleşti. Yalnız yeni özel Okey masası ve üç botla normal fare sürüklemesiyle mavi 6 ilk slottan boş 29. slota taşındı; yenilemede aynı yerde kaldı. Normal çıkışla lobiye dönüldü, gözlenen konsol temizdi. Mevcut kullanıcı odalarına dokunulmadı; canlıda sentetik iptal, geçersiz hamle veya tam maç denenmedi. Yerel test yardımcıları kaldırıldı ve demo sunucu/emülatörlerin 5173/8180/9199 dinleme portları kapalı doğrulandı.

## Tahmini etki ve açık sınırlar

1. **Orta doğruluk etkisi:** İptal edilen hareket oyun isteğine dönüşmez; mobil kesintilerde istemsiz hamle önlenir. Normal oyunun hızlandığı iddia edilmez.
2. **Düşük kaynak etkisi:** İptalde bekleyen hedef RAF'ı ve mevcut uzun basma zamanlayıcısı temizlenir; kapanışta dört yeni dinleyici kaldırılır. Toplam pil/bellek/kota tasarrufu ölçülmedi.
3. **Düşük paket etkisi:** Okey gzip 39,83 → 39,97 kB; ana JS 172,22 kB, CSS `index-Tlx8d9Qx.css` aynı. Diğer parça adları ortak ana dosya referansından değişebilir.

Genel denetim; sekiz orta bağımlılık kaydı, doğrudan Firestore token iptali, anonim UID/IP dolaşımı, gerçek cihaz/uzun arka plan/yük ve operasyonel saklama/izleme sınırları nedeniyle tamamlanmış sayılmaz. Bu aşamada tüm yedi oyunun yeni mobil/tam maç testi yapıldığı iddia edilmez.

Kaynaklar (28 Ekim 2026): [MDN pointercancel](https://developer.mozilla.org/en-US/docs/Web/API/Element/pointercancel_event), [W3C Pointer Events olay iptali ve capture](https://www.w3.org/TR/pointerevents/). Kaynaklar olay semantiğini destekler; ürün sonucu yukarıdaki kontrollü ve demo testleriyle sınırlıdır.
