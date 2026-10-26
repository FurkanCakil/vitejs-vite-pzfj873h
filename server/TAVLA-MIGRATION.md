# Tavla: sunucu geçişi

## Güncel durum — 27 Ekim 2026

Tavla'nın sunucu çekirdeği, oda/yaşam döngüsü ve istemci bağlantısı hazırdır. `TAVLA_API_ENABLED` ve `VITE_SERVER_TAVLA_ENABLED` varsayılan kapalıdır. Yeni kuyruk kuralı kaynakta hazırlanmıştır; **bu belge canlı açılışın tamamlandığını göstermez**. Firebase/Vercel ayarları açılana kadar canlı Tavla legacy oda yolundadır. Önceki altı oyun ve sayaç geçişi korunur. Yeni IAM, kalıcı anahtar, ücretli plan veya zamanlanmış iş gerekmez.

Canlıya açılınca eski Tavla odaları devralınmayacak; yeni oda gerekir. Legacy `rooms` koleksiyonunun geniş izinlerini kapatmak bu oyunun geçişinden sonraki ayrı kabul işidir. Genel site denetimi henüz bitmedi.

## Kapalı canlı sürümün doğrulanması

[7fb9f60 işlev değişikliği](https://github.com/FurkanCakil/vitejs-vite-pzfj873h/commit/7fb9f6029d4efe1a76edb9ed9298873625feb8ad) ana dala gönderildi; [Production yayını](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/39hd73CDYQLL6WUWZnbfmPkQzLyA) 27 Ekim 2026 saat 02:10:19'da Ready oldu. Canlı ana uygulama SHA-256 özeti yerel kapalı üretim çıktısıyla aynıydı. Gerçek yeni anonim test kimliğiyle Tavla oluşturma 503/server_not_enabled döndü; yeni sistem kapalıdır. Yeni kuyruk kuralı henüz yayımlanmadı ve iki Production ayarı açılmadı.

Mevcut XOX, Amiral Battı, Okey, Connect 4, Dama ve Satranç için yalnız yeni özel test odası oluşturma/katılma/normal ayrılma geçti; altı odanın son durumunun kapalı olduğu doğrulandı. Sayaç heartbeat/leave de başarılı. Başka kullanıcı odalarına dokunulmadı. Bu, yeni Tavla'nın canlı kabul testi değildir; o yalnız kural/ayarlar açıldıktan sonra yapılabilir. Yerel tarayıcı/emülatör/üretim derlemesi ile kapalı canlı kontrol birlikte hazırlık kabulünü oluşturur.

## Bulgular ve değişiklik nedenleri

| Önem | Dosyalar | Neden |
| --- | --- | --- |
| Kritik, canlı açılış bekliyor | `server/games/tavla.js`, `server/xox-rooms.js` | Zar, yasal hamle, geri alma, küp ve puanı tarayıcıya güvenmeden sunucuda belirlemek; sürüm ve işlem kimliğiyle çift zar/puanı önlemek. |
| Kritik, canlı açılış bekliyor | `server/room-schema.js`, `src/utils/gameApi.js`, `src/App.tsx` | Yalnız izinli eylemleri kabul etmek; UID, zar, tahta, puan veya geri alma konumu gönderilememesi ve yeni odaların doğru yola bağlanması için. |
| Orta | `src/games/backgammon/TavlaGame.jsx` | Aynı anda gelen ikinci eylemi referans kilidiyle engellemek, bayat taş seçimini temizlemek, sunucu hatasını oyuncuya göstermek ve seyircinin eşit açılışı sıfırlamasını önlemek. |
| Orta | `src/games/backgammon/TavlaGame.jsx` (açılış satırı) | 320 pikselde kesilen Zar At düğmesini sarılan satıra almak; tahta oranı/sınıflarını değiştirmeden düğmeyi erişilebilir tutmak. |
| Düşük | `src/games/backgammon/state.js`, Tavla bileşeni | Zar tüketimi ve mars/katmerli mars hesabını ortaklaştırmak, değişmez tahta için gereksiz derin kopyayı kaldırmak ve mevcut noktalara klavye/etiket desteği eklemek. |
| Orta, büyümede | `src/components/Lobby.jsx`, oda sunucusu | Eşleşmeyi en çok 30 girişli, 60 saniye geçerli sunucu kuyruğundan saymak; özel/oynanan veya bayat odaları bekleyen gibi göstermemek. |
| Güvenlik hazırlığı | `firestore.rollout.rules`, `server/firestore-v2.rules` | Yeni `tavlaLobby/queue` için yalnız oturumlu get hazırlamak; liste ve doğrudan yazmayı kapalı tutmak. Referans `firestore-v2.rules` tek başına canlıya yayımlanmaz. |
| Doğrulama | `server/tavla.test.js`, `server/tavla.integration.test.js`, `package.json`, `scripts/dev-xox.mjs` | Tavla'yı demo emülatörüne ve önceki oyunlarla birlikte regresyona eklemek; üretim kimliğini yerel teste taşımamak. |
| Kayıt | Bu dosya, `server/README.md`, `SECURITY-MIGRATION.md` | Hazır kapalı sürümle tamamlanmış canlı geçişi ayırmak; açılış koşulları ve doğrulama sınırlarını korumak. |

## Korunan kurallar ve sunucu sınırları

- Beyaz 0→23, siyah 23→0 ilerler; oyuncu başına 15 pul. Kırık pul önce girer; tek rakip pul kırılır, en az iki rakip pulu kapıdır.
- Açılışta her oyuncu bir zar atar, büyük atan bu iki zarla başlar. Eşitlikte yalnız oyuncuların sürümlü sıfırlama isteği kabul edilir; iki istek yarışırsa biri geçer. Eşzamanlı farklı açılış isteklerinden biri eski sürümle reddedilirse oyuncu güncel durumdan tekrar atar.
- Normal çift zar dört hamledir. En fazla zar kullanma ve yalnız tek zar oynanabiliyorsa büyüğünü oynama kuralı korunur. Yasal hamle kalmayınca sıra otomatik geçer; zar tekrar atılamaz.
- Geri alma yalnız aynı sıranın hareket aşamasında ve en az bir zar kullanıldıysa, o sıranın sunucuda alınmış konumuna döner. Sıra geçtikten/oyun bittikten sonra geri alma yoktur; yeni bir hak eklenmedi.
- Küp yalnız zar atmadan, sıra sahibi ve küp sahibi/merkezdeyse teklif edilir. Teklif çözülmeden zar/hamle yoktur. Rakip kabul edince küp ikiye katlanır ve rakibe geçer; ret önceki küp kadar puan verir. Güvenli tamsayı sınırı aşılmaz.
- Normal 1, mars 2, katmerli mars 3 küp çarpanı korunur. Son pul/ret puanı yalnız bir kez uygulanır. Rövanş rakip onayı ister, puanı korur, renkleri değiştirir ve açılış zarına döner. Crawford veya başka yeni turnuva kuralları eklenmedi.
- Üyelik, canlı iki bağlantı, oyun türü/durumu, sıra, sürüm, 24 nokta, 15'er pul korunumu, zar tüketimi ve skor kontrol edilir. Yeni oyun zarları Node `crypto.randomInt` ile transaction dışında bir kez örneklenir; transaction tekrarı zarı değiştirmez. Kayıtlı işlem cevabı ağ tekrarında tekrar kullanılır. Önbellekteki son 32 cevabın sınırı mevcut sistemle aynıdır.
- Ayrılma/bekleme ve aynı UID çiftinin dönüşü tam sırayı, zarları, renkleri, küpü ve geri alma konumunu geri getirir; yeni rakip yeni oyun alır. Son sekiz dizilim sınırı korunur. Oda ve kuyruk istemciden yazılamaz; üyeler odalarını, kimlikliler yalnız eşleşme özetini okuyabilir.
- Botlar mevcut yerel Worker yolunda ve mevcut zorluklarında kalır. Çok oyunculu oyun zarları sunucudadır; yerel bot modu hile korumalı rekabetçi sunucu oyunu değildir.

## Doğrulama

- 122 otomatik test geçti; `npm test` toplam 131 sonuçta dokuz emülatör üst testini ayrı çalıştırılmak üzere atlar. 13 yeni Tavla çekirdek testi açılış/tie, çift, kırık pul/yeme, maksimum zar/büyük zar, geri alma, üç puan türü, küp onayı/ret/üst sınır, bozuk girdi ve ilk konumdan tam oyunu kapsar. Sabit test zarlarıyla 107 yasal hamle, yeme ve dokuz çift içeren oyun tamamlandı; her adımda 15'er pul korunumu ve yalnız son anda puan doğrulandı. Bu, gerçek rastgele zarlara yönelik istatistiksel adalet testi veya insanlarca oynanmış maç değildir.
- Temiz `demo-oyun-portali` emülatöründe 80 senaryo ve dokuz üst testle 89 sonuç geçti; önceki altı oyunun ve sayacın regresyonları dahil. Yeni dokuz Tavla senaryosu kapalı ayar/oyun ayrımı, sunucu zarı/tekrar, yarışan hamle/geri alma, tie yarışı/kapalı giriş, küp/rövanş/tek puan, son pul/sahte alan/seyirci, çoklu sekme ve aynı UID geri dönüşü, atomik eşleşme/bayat host ve gerçek Auth erişim reddini kapsar. Tie ve bitiş konumları yalnız demo emülatöründe hazırlanmış fikstürlerdir; canlıya oyun durumu enjekte edilmedi.
- Gerçek yerel uygulamada iki bağımsız origin/UID ile özel oda/davet, açılış, klavye ve tıklama hamlesi, geri alma, iki zarı tüketerek sıra devri, küp kabulü, yenilemede aynı tahta/zar/küp, sonraki küp reddinde 2:0 ve rakip onaylı renk değiştiren rövanş geçti. Yerel kolay bot açılıp kendi turunu oynadı ve sırayı insana bıraktı. Gözlenen konsollar hata/uyarı içermedi. Test odası normal ayrılmayla kapatıldı; geçici sekmeler ve viewport temizlendi.
- 390 pikselde 276×368, 320 pikselde 206×274,67 tahta ve yatay taşmasız belge ölçüldü. 320 pikselde kesilen açılış düğmesi önce yeniden üretildi, düzenleme sonrası tamamı içeride görüldü. Yatay 844×390 tam ekran görünümünde yaklaşık 346,69×260,02 tahta gözlendi; otomasyon tam ekrandan kendiliğinden çıktığı için kalıcı native fullscreen doğrulaması sayılmaz. Gerçek telefon/Safari/Firefox/iOS testi yapılmadı.
- TypeScript geçti; lint sıfır hata/38 mevcut uyarı. `App.tsx` dosyasındaki mevcut `@ts-nocheck` sınırı sürer. Tavla açık ve kapalı üretim derlemesi geçti; yerel kimlik kontrolü üretim ortamı olmadığı için beklenen şekilde atlanır, kapalı gerçek Vercel Ready yukarıda ayrıca doğrulandı.

## Performans ve kalan kabul işi

Tahmini **orta, büyümede:** sınırlı eşleşme kuyruğu yalnız seçici açıkken dinlenir; legacy ortak sorgu bu geçiş kapanana kadar sürer. Tahmini **düşük:** gereksiz 24 noktalı derin kopya kaldırılır ve ortak hesaplar tekrarı azaltır. Toplam hız/kota tasarrufu ölçülmedi; sunucu doğrulaması çağrı/transaction maliyeti ekler.

Önceki altı oyun ve sayaç açıkken Tavla kapalı ana paket 575,90 KB / 178,64 KB gzip; Tavla açık 576,12 KB / 178,67 KB gzip. Tavla parçası 32,34 KB / 8,97 KB gzip; CSS 65,50 KB / 11,60 KB gzip. Bu küçük artış performans kazancı olarak sunulmaz.

Canlı açılışta yalnız `tavlaLobby/queue` salt okunur bloğu yayımlanmalı, `TAVLA_API_ENABLED=true` / `VITE_SERVER_TAVLA_ENABLED=true` yalnız Production'da açılmalı, son ayarlarla yeniden derlenmeli. Gerçek yeni test kimlikleriyle zar/hamle/küp/puan/rövanş/erişim reddi ve canlı tarayıcı akışı ayrıca sınanmalı. Yeni IAM/anahtar/ücret gerekmez. Eski odalara sessiz geçiş yoktur. Daha sonra legacy geniş oda izinleri, 26 bağımlılık uyarısı, anonim UID yenileyerek sınır aşma, ek token iptal kontrolü ve gerçek cihaz/yük sınırları ele alınmalıdır.
