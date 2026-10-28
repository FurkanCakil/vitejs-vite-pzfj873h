# Amiral Battı gemi sürükleme iptali — 28–29 Ekim 2026

Genel denetimin bu aşaması, mevcut gemi yerleştirme etkileşimini küçük bir istemci değişikliğiyle düzeltir. 28 Ekim'deki yerel kabulün ardından kaynak `9e41735`, 29 Ekim 00:00:43 GMT+3'te Production Ready oldu; canlı kabul geçti. Yeni Firebase kuralı, API, IAM, ortam ayarı, anahtar, ücret veya zamanlanmış iş yok. Gemi gövdesi çizimi, döndürme merkezi, hücre/tahta CSS'si ve sunucu filo doğrulaması değişmez.

## Bulgular ve karar

- **Kritik:** İncelenen bölümde yeni kritik erişim açığı doğrulanmadı; genel denetimin açık sınırları korunur.
- **Orta:** Başka pointer'ın down/move/up/cancel olayları etkin gemi sürüklemesini değiştirebiliyordu. Sürükleme başlangıç pointer kimliğine aittir; ikinci parmak ve birincil olmayan düğme devralamaz.
- **Orta:** Blur veya lostpointercapture sonrası yarı saydam gemi/aday konum kalabiliyordu; yerleştirme kilidi değiştikten sonra gelen up da eski taşıma işlemini tamamlayabiliyordu. İptal, kilit/round/aşama/üyelik değişimi ve gizlenen belge aynı temizliği kullanır; hiçbir taşıma/kaldırma işlemi yapmaz. Uzun basma sayacı ve önizleme de temizlenir.
- **Düşük:** Son geçerli önizleme tahta dışında bırakılırken kalıcı konuma dönüşüyordu; son pointermove ile pointerup arasındaki koordinat değişimi de kaçırılıyordu. Hedef bırakma anında yeniden hesaplanır; bu filonun kendi tahtası ve envanteri dışı iptaldir. Envantere normal bırakma yine gemiyi kaldırır; dokunma menüsü, döndürme ve yeniden seçme korunur.

İptal sırasında önce sürükleme sahipliği temizlenir, sonra varsa pointer capture bırakılır; bu sırada doğabilecek kayıp olayı yeni bir taşıma işlemi oluşturmaz. Window up/cancel, kaynak hücre dışında gelen bırakma için yedektir; hücre olayıyla iki defa tamamlanmaz. Dinleyiciler unmount'ta, süreli uzun basma da iptal/unmount'ta temizlenir. Kaldır/döndür/sıfırla/hazır işlemleri etkin sürüklemeyi önce iptal eder.

## Dosya gerekçeleri

- `src/games/battleship/BattleshipGame.jsx`: Sahip pointer, gerçek bırakma hedefi ve yalnız iptal eden yaşam döngüsü temizliğiyle yanlış gemi taşımasını ve kalan hayalet görüntüyü önler.
- Bu dosya: Yeniden üretimi, kabul matrisi, tahmini etki ve doğrulamanın sınırlarını kaydeder.
- `server/README.md` ve `SECURITY-MIGRATION.md`: Denetimin son kabul durumunu bu kanonik kayda bağlar.

## Doğrulama ve sınırlar

Gerçek React bileşeni, StrictMode içinde yalnız yerel bir fixture'da iki sabit gemiyle çalıştırıldı; Firebase/Auth/API kullanılmadı. Kontrollü PointerEvent/blur olayları uygulama içindeki test düğmesinden gönderildi; sentetik pointer için capture çağrısı testte stub edildi. Bu gerçek çok parmak donanım testi değildir. İlk on senaryoda eski kodun altısı başarısızdı: blur, capture kaybı, ikinci pointer, tahta dışı bırakma, son bırakma koordinatı, kilit değişimi. Düzeltmeden sonra aşağıdaki on dört senaryo geçti:

1. Normal taşıma bir kez kaydedilir.
2. Sahip pointercancel gemiyi eski yerinde bırakır.
3. Blur aday konumu temizler; sonradan up değiştirmez.
4. Lostpointercapture taşıma yapmadan temizler.
5. İkinci pointer başka gemiyi devralamaz; ilk pointer normal tamamlar.
6. Tahta dışında bırakma önceki geçerli konumu uygulamaz.
7. Son bırakma koordinatı önceki hareket koordinatından önceliklidir.
8. Envantere normal bırakma gemiyi kaldırır.
9. Yerleştirme kilidi değişince eski sürükleme tamamlanmaz.
10. Küçük hareket tıklama menüsünü korur.
11. Gizlenen belge sürüklemeyi iptal eder.
12. Window up, kaynak dışındaki geçerli hedefi bir defa tamamlar.
13. Başka pointer'ın cancel olayı sahibi iptal etmez.
14. İptal edilen uzun basma önizlemeyi kaldırır.

Ayrı temiz sekmede gerçek fare drag'i (capture stub edilmeden) uçak gemisini C3→E5 taşıdı: gövde left/top %40/%40, en/boy %50/%10 ve opacity 1 oldu. Ardından menüden merkez çevresinde döndürmede left/top %60/%20, en/boy %10/%50 kaldı; gözlenen konsol temizdi. Fixture düzenlenirken oluşan createRoot/HMR uyarısı ürün hatası olarak sayılmadı; temiz sekmede tekrarlanmadı. 320 ve 390 piksel görünümde iki tahta 240×240, hücreler 24×24 kaldı. Telefon donanımı, Safari/Firefox/iOS, gerçek tam ekran veya tüm oyunların yeni maç kabulü değildir.

Mevcut 175 otomatik test geçti (13 emülatör üst testi normal komutta atlanır); yeni kontrollü tarayıcı senaryoları bu sayıya eklenmez. Lint sıfır hata/36 mevcut uyarı, mevcut TypeScript kontrolü ve tüm istemci oyun/sayaç bayrakları açık üretim derlemesi başarılı. Sunucu ve kural değişmediği için birleşik sunucu paketi bu aşamada yeniden çalıştırılmadı; önceki lobi aşamasının 101 senaryo/13 üst testle 114 başarılı sonucu tarihsel kanıttır. App.tsx mevcut tür kontrolü sınırı sürer. Geçici fixture üretim girişine dahil edilmedi ve push öncesi kaldırıldı.

## Canlı yayın ve kabul — 29 Ekim 2026

Kaynak `9e41735115da9aba8bc19b4c9e73d0678b354fcf`, [Vercel Production dağıtımında](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/JAmEXQkqgeLdEmzQWfcWHENuL882) 00:00:43 GMT+3'te Ready olarak doğrulandı. Canlı dosyalar test edilen açık yerel üretim çıktısıyla bayt düzeyinde eşleşti:

| Dosya | Bayt | SHA256 |
| --- | --- | --- |
| `/assets/index-B__eg9z6.js` | 554173 | `dc8f42ddac882a0e191ef4baf03c25be1894c278defb983413b92034d7b659c4` |
| `/assets/BattleshipGame-BpDZiaC-.js` | 37948 | `50cfa2eac917edd51ece5f6140c3bc3ccb6c34c50545606c361aa719f1f91842` |
| `/assets/index-8Qk80MEt.css` | 65596 | `e433d184fe814b48bbd3a2f331e6595ce5925eb5f99cbf781b56cc573c0c1c2b` |

Canlı sitenin yerel bot modunda uçak gemisi C3 başlangıcına yerleştirildi; gerçek fareyle E5'e taşındı (left/top %40/%40, en/boy %50/%10, opacity 1). Menüden merkez çevresinde dikeye döndü (left/top %60/%20, en/boy %10/%50); tahta dışına normal fare bırakması bu konumu korudu. Menüden Kaldır ardından boş kareye tıklama gemiyi geri koymadı; gövde sayısı sıfır, Hazır 0/5 kaldı. Normal çıkışla lobi/sayaç bire döndü; gözlenen konsol temizdi. Test sekmesi kapatıldı. Çevrimiçi oda/başka oyuncu verisi değiştirilmedi; bot masa durumu yereldir. Fiziksel çok parmak, tüm cihazlar veya yeni tam savaş/çevrimiçi ready kabulü olarak sunulmaz. İptal/kilit yarışlarının kanıtı yukarıdaki kontrollü bileşen senaryolarıdır.

## Tahmini etki

1. **Orta etkileşim doğruluğu:** Kesilen veya ikinci parmakla karışan taşıma filoyu yanlış değiştirmez; yerleştirme yeniden yapılabilir.
2. **Düşük kaynak etkisi:** Tek uzun basma sayacı ve sabit dört olay dinleyicisi yaşam döngüsünde temizlenir. Sunucu isteği/okuma sayısı artmaz; bellek, pil veya FPS kazancı ölçülmedi.
3. **Düşük paket etkisi:** Amiral Battı gzip yaklaşık 11,89→12,23 kB; ana JS yaklaşık 172,40→172,39 kB (ortak parça referansları), CSS `index-8Qk80MEt.css` aynı. Bu bir indirme hızlandırması değildir; ana parça büyüklük uyarısı sürer.

Genel denetim henüz bitmedi: son taramadaki sekiz orta bağımlılık kaydı, doğrudan Firestore token iptali, anonim UID/IP dolaşımı, gerçek cihaz/uzun arka plan/yük/bellek ve operasyonel saklama/izleme sınırları açık. Yeni bağımlılık taraması yapılmadan sekiz sayısı güncel tarama sonucu olarak sunulmaz.

Kaynaklar (28 Ekim 2026): [MDN Pointer Events/capture](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events), [W3C implicit capture release](https://www.w3.org/TR/pointerevents/#implicit-release-of-pointer-capture). Bunlar olay semantiğini destekler; ürün kabulü yukarıdaki testlerle sınırlıdır.
