# Satranç botunda iptal ve durum temizliği — 29 Ekim 2026

Genel denetimin bu dar aşaması, satranç botunun artık geçerli olmayan aramasını ve düşünme durumunu temizler. Kaynak `5b7278e`, 29 Ekim 00:17:31 GMT+3'te Production Ready oldu; canlı kabul ve kesinti sonrası son kontrol tamamlandı. Stockfish 18 dosyaları, kolay/orta/zor Skill Level ve depth değerleri, kolayın mevcut rastgele hamle oranı, normal 1,1–2 saniyelik asgari düşünme süresi ve tahta/notasyon/CSS değişmez. Yeni API, Firebase kuralı, IAM, ayar, anahtar, ücret veya zamanlanmış iş yok.

## Bulgular ve karar

- **Kritik:** İncelenen bot bölümünde yeni kritik erişim açığı doğrulanmadı; bu yerel bot değişikliği sunucu güvenliğini genişletmez.
- **Orta:** Bot düşünürken tur iptal edilirse effect'in finally bölümü bilerek atlanıyordu; `botThinking=true` yeni insan turuna kalabiliyordu. Gerçek bileşende eski kodla yeni tur hâlâ Bot Düşünüyor gösterdi. İptal temizliği düşünme durumunu sıfırlar; rol/sıra/sonuç değişiminde eski çalışma yeni durumu değiştiremez.
- **Düşük:** Sonuç yok sayılsa bile artık gerekmeyen Stockfish araması ve asgari düşünme sayacı devam ediyordu. Temizlik aramaya stop gönderir, bekleyen isteği null ile sonuçlandırır; gecikme sayacını hem kaldırır hem bekleyen promise'i çözer. Sadece clearTimeout yapıp promise'i askıda bırakılmaz.
- **Düşük dayanıklılık:** Kontrollü postMessage hatası motorun mevcut hata/yeniden deneme yoluna hemen aktarılır; bekleyen arama 90 saniyelik güvenlik süresine kadar kalmaz. Bu kontrollü hata enjeksiyonudur, doğal bir cihaz hatasının yaygınlığı ölçülmedi.

UCI stop'tan sonra eski arama bir bestmove daha üretebilir. İptalde bu yanıt için mevcut discard sayacı artırılır; arama sahipliği hemen bırakılır. İkinci iptal veya boş motora stop gönderilmez, böylece sonraki geçerli bestmove yanlışlıkla yutulmaz. Aynı yordam yeni istek eski isteği geçersiz kıldığında da kullanılır. Süre aşımı ve worker restart/unmount davranışı korunur.

## Dosya gerekçeleri

- `src/games/chess/stockfishEngine.js`: İptal edilen isteği sonuçlandıran, tek stop gönderen ve geç eski cevabı yeni aramadan ayıran ortak cancelSearch ekler; gönderim hatasını mevcut motor hata akışına bağlar.
- `src/games/chess/ChessGame.jsx`: İptalde bot düşünme yazısını ve asgari bekleme sayacını temizler; bekleme promise'ini de çözüp motor aramasını durdurur.
- Bu dosya: Yeniden üretim, protokol/gerçek motor kabulü, her dosyanın gerekçesi ve sınırları kaydeder.
- `server/README.md`, `SECURITY-MIGRATION.md`: Son denetim kabulünü bu kanonik kapsama bağlar.

## Yerel doğrulama

Gerçek ChessGame ve useStockfish, StrictMode içinde yalnız yerel fixture'da çalıştırıldı; Firebase/Auth/API kullanılmadı. İlk iki regresyon eski kodda başarısızdı: yeni insan turunda düşünme yazısı kaldı ve artık gerekmeyen aramaya stop gitmedi. Düzeltme sonrası ikisi geçti. Kontrollü Worker ile altı protokol senaryosu da geçti: iptalin pending isteği null ile bitirmesi/tek stop; boşta veya yinelenen iptalin stop üretmemesi; eski bestmove'un yeni isteği tamamlamaması; normal aramanın doğru sonucu/sonrasında ek stop olmaması; iki iptal edilen aramanın üçüncü isteği tamamlamaması; postMessage hatasında hemen sonuç/hata ekranı. Ayrı yeniden başlatma düğmesi motoru tekrar hazır yaptı. Bunlar gerçek işlemci/worker kesintisi değildir; denetlenebilir protokol hata enjeksiyonudur.

Ayrı sayfada gerçek dağıtılan Stockfish 18 Worker/WASM dosyaları ve değiştirilmemiş kanca kullanıldı: başlangıç konumunda depth 2 yasal d2d4; depth 40 araması 50 ms sonra iptal edilip null; hemen ardından e4 sonrası siyah konumunda depth 2 yasal e7e5 geldi. Beyaz eski cevap siyah hamlesi kabul edilmedi. Bu testte depth 40 yalnız iptal senaryosudur; üretim bot depth değerleri değişmedi. Normal motor testinde gözlenen konsol temizdi.

Ayrı temiz gerçek bileşen sekmesinde normal Teslim Ol→Emin misin?→Yeniden Oyna düğmeleriyle insan başlayan tur Senin Sıran gösterdi; e2→e4 normal hamlesi notasyona yazıldı. 320 pikselde 64 karenin en/boyu yaklaşık 31,08, 390 pikselde hamle sonrası 39,83 piksel olarak eşitti. Gözlenen konsol temizdi. Fixture düzenleme sırasında oluşan createRoot/HMR uyarısı temiz sekmede tekrarlanmadı; ürün hatası diye sayılmadı. Gerçek telefon/Safari/Firefox/iOS, tam ekran veya uzun yük/bellek testi değildir.

Mevcut 175 otomatik test geçti; 13 emülatör üst testi normal komutta bilerek atlanır. Kontrollü tarayıcı/motor kontrolleri otomatik test sayısına eklenmedi. Lint sıfır hata/36 mevcut uyarı, mevcut TypeScript kontrolü ve bütün istemci oyun/sayaç bayrakları açık üretim derlemesi geçti. App.tsx mevcut tür kontrolü sınırı sürer. Sunucu/kural değişmediğinden birleşik sunucu paketi yeniden çalıştırılmadı; önceki lobi aşamasının 101 senaryo/13 üst testle 114 sonucu tarihsel kanıttır. Geçici fixture'lar push öncesi kaldırıldı; gerçek Stockfish test sekmesi kapanınca worker temizlendi ve geliştirme sunucusu kapatıldı. Tavla kancasının istek kimliği/zaman aşımı/unmount akışı da incelendi; bu aşamada yeni bir doğrulanmış Tavla hatası veya değişikliği yok.

## Canlı kabul — 29 Ekim 2026

Kaynak `5b7278effa71427d975cc2b82bb7144d6a5f823c`, [Vercel Production ayrıntısında](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/Ep93hajueciPQwXeKSrsJmPNqNUL) 00:17:31 GMT+3'te Ready olarak doğrulandı. Kesinti sonrası kaynağın Ready olduğu ve canlı ana JS/CSS/Satranç parçasının test edilen yerel açık üretim çıktısıyla aynı kaldığı tekrar kontrol edildi:

| Dosya | Bayt | SHA256 |
| --- | --- | --- |
| `/assets/index-C69f5u0L.js` | 554173 | `687403426536c078ca19e0f9fb5e8727cedfb666ee68123c7365726237f50f4b` |
| `/assets/ChessGame-DUS35U02.js` | 40136 | `5cc6f10a553edf0d76c599ac392835bd371d714bc233d044b93229b4e3fbfdb4` |
| `/assets/index-8Qk80MEt.css` | 65596 | `e433d184fe814b48bbd3a2f331e6595ce5925eb5f99cbf781b56cc573c0c1c2b` |

Canlı sitenin yerel Orta bot modunda e4→e6 ve d4→d5, normal teslim ve iki ardışık rövanşta renk/sıra değişimi ve 0:2 skor korunumu gözlendi. İnsan başlayan sonraki tur Senin Sıran gösterdi. Teslim onayına kadar botun bazı hamleleri tamamlanmıştı; bütün canlı denemelerde bestmove öncesi kesin durdurma yapıldığı iddia edilmez. İptal yarışının kanıtı yukarıdaki kontrollü Worker ve gerçek depth 40 motor testidir.

Kesinti nedeniyle sonucu kaydedilmeyen son adım yeni temiz canlı bot masasında tamamlandı: e4'e c5 karşılığı geldi, notasyon ve insan sırası güncellendi, gözlenen konsol temizdi. Normal çıkışla lobiye dönüldü ve sayaç bir gösterdi; test sekmesi kapatıldı. Çevrimiçi oda/başka oyuncu verisi değiştirilmedi; bot oyun durumu yereldir. Bu tam maç, bütün cihazlar veya yeni çevrimiçi oyun kabulü değildir. Canlı ekran ve tam dosya teslimiyle aşama kapatılır; genel denetim aşağıdaki sınırlar nedeniyle sürer.

## Tahmini etki ve açık sınırlar

1. **Orta gereksiz CPU etkisi:** Geçersiz kalan derin aramanın tamamlanması beklenmeden stop istenir. Motorun durma gecikmesi platforma bağlıdır; CPU/pil/FPS yüzdesi veya bellek tasarrufu ölçülmedi.
2. **Düşük süre/kaynak etkisi:** İptal edilmiş asgari düşünme sayacı ve bekleyen promise tutulmaz; boş motora gereksiz stop gönderilmez. Normal bot hamlesinin yapay düşünme süresi kısaltılmadı.
3. **Düşük paket etkisi:** Satranç parçası gzip yaklaşık 12,80→12,88 kB; ana dosya yaklaşık 172,40 kB, CSS `index-8Qk80MEt.css` aynı. Diğer parçaların hash'i ortak ana referansından değişebilir. Bu indirme hızlandırması değildir; mevcut ana parça büyüklük uyarısı sürer.

Genel denetim tamamlanmadı: son taramadaki sekiz orta bağımlılık kaydı, doğrudan Firestore token iptali, anonim UID/IP dolaşımı, gerçek cihaz/uzun arka plan/yük/bellek ve operasyonel saklama/izleme sınırları açık. Yeni bağımlılık taraması yapılmadı.

Kaynaklar (29 Ekim 2026): [Resmî Stockfish UCI stop ve son bestmove örneği](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html#stop), [React effect yaşam döngüsü ve cleanup](https://react.dev/reference/react/useEffect). Kaynaklar protokol/yaşam döngüsü anlamını destekler; ürün kabulü yukarıdaki testlerle sınırlıdır.
