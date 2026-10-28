# Lobi özetlerinde sunucu onayı — 28 Ekim 2026

Genel denetimin bu dar aşaması, aktif oyuncu ve yedi oyunun hızlı eşleşme özetlerinin önbellek/hata durumlarını ayırır. Sayımın oyun veya yetki kararı olarak kullanılması değişmez: eşleşme ve oyun verisini sunucu doğrular. Yeni Firebase kuralı, IAM, ortam ayarı, anahtar, ücret veya zamanlanmış iş yok.

## Bulgular ve düzeltme

- **Kritik:** İncelenen bölümde yeni kritik erişim açığı doğrulanmadı; önceki açık denetim sınırları sürer.
- **Orta:** Firestore dinleyicisinin ilk önbellek sonucu güncel sunucu verisi sayılıyordu; seçici yeniden açıldığında önceki bekleyen oyuncu veya önbellekte eksik olan sıfır gösterilebiliyordu. Özet ancak `fromCache=false` ve bekleyen yerel yazım yoksa kullanılır; salt metadata onayı için `includeMetadataChanges` açıktır.
- **Orta:** Okuma hatası boş kuyruk gibi gösteriliyordu. Onay bekleyen veri `Kontrol ediliyor…`, okunamayan/bozuk özet `Bilgi alınamadı`, yalnız sunucunun doğruladığı boş sonuç `Bekleyen yok` gösterir. Sayaç bilinmiyorsa mevcut `…`/`—` ve gri durum noktası kullanılır.
- **Düşük:** Yedi kopya kuyruk filtresi ortak doğrulanmış okuyucuya taşındı; kendi UID'sini dışlama, 60 saniyelik eşleşme tazeliği ve Okey kişi sayısı korunur. Bozuk/null kayıtlar hesaplamayı çökertmez.

Seçici açılırken eski yerel durum temizlenir; dinleyiciler yine yalnız seçici açıkken yaşar ve kapanırken temizlenir. Aktif oyuncu sorgusu yine yalnız lobide dinlenir. Yeni polling veya belge yolu eklenmez; metadata değişiminde ek yerel callback olabilir. Oyun/tahta ölçüleri ve oyun eylemleri değişmez. CSS çıktısının hash'i, gri durum noktası sınıfının statik biçimde bulunması nedeniyle değişir; stil kaynak dosyası değiştirilmedi.

## Her dosyanın gerekçesi

- `src/hooks/serverSummary.js`: Sunucu onayı, gerçek boş sonuç ve kullanılamayan veriyi ortak biçimde ayırır; kuyruk sayımındaki giriş sınırlarını korur.
- `src/hooks/serverSummary.test.js`: Eski önbellek davranışını yakalayan üç regresyonu ve boş/hatalı veri, tazelik, Okey sayımı ve dinleyici temizliğini beş testte sınar.
- `src/hooks/presenceStore.js`: Aynı onay koşulunu mevcut aktif oyuncu sorgusuna uygular.
- `src/components/Lobby.jsx`: Özet durumlarını doğru yazılarla gösterir ve yeniden açılışta eski sonucu temizler.
- `server/firebase-client.integration.test.js`: Gerçek SDK'da önbellek, değişmeyen verinin metadata onayı ve çevrimdışı değişen kuyruğun yeniden bağlantısını sınar; test sonunda ağ bağlantısını kapatıp SDK'yı temizler.
- Bu dosya, `server/README.md`, `SECURITY-MIGRATION.md`: Kabul kanıtını, her değişikliğin nedenini ve kalan sınırları kaydeder.

## Doğrulama

Eski dinleme davranışıyla üç yeni regresyon başarısız oldu; düzeltmeden sonra beş özet testi ve toplam 175 otomatik test geçti. Normal test komutunda 13 emülatör üst testi bilerek atlanır. Lint sıfır hata/36 mevcut uyarı, mevcut TypeScript kontrolü ve bütün istemci oyun/sayaç bayrakları açık üretim derlemesi başarılı. Mevcut TypeScript kapsamı JavaScript uygulamasının tümüne statik tür garantisi vermez.

Gerçek SDK testinde yalnız yerel demo Auth/Firestore kullanıldı: önbellekteki rakip çevrimdışıyken bilinmeyen durumdur; veri değişmeden ağa dönünce salt metadata olayı onay sağlar; yeniden çevrimdışı olup sunucuda kuyruk boşaltıldıktan sonra bağlantı boş listeyi doğrular. İzole test yolu diğer oyun fixtures'larına karışmaz. İlk denemede senaryolar geçmesine rağmen tekrar açılan SDK bağlantısı test sürecini açık tuttu; sonunda ağı kapatma ile temiz kapanış düzeltildi ve ayrı çalıştırma dört sonuçla normal kapandı. Bu ürünün canlı ağ kesintisi hatası olarak sunulmaz.

Tek temiz birleşik demo Auth/Firestore çalıştırmasında 101 senaryo + 13 üst test = 114 sonuç geçti; hata/atlama yok, test süresi yaklaşık 39,8 saniye. SDK dahil tüm süreç normal kapandı. Önceki askıda kalan deneme başarılı birleşik sonuç sayılmaz.

Gerçek `Lobby` bileşeni ayrı bir yerel demo giriş sayfasında çalıştırıldı: Admin yalnız emülatöre tek taze rakip yazdı; seçicide bir kişi görüldü; seçici kapatılıp gerçek SDK `disableNetwork` çağrıldı; istemci çevrimdışıyken demo kuyruğu boşaltıldı; seçici yeniden açılınca eski bir kişi yerine yedi oyunda `Kontrol ediliyor…`, sayaçta `…` görüldü. Ağ açılıp seçici yeniden açılınca yedi oyun `Bekleyen yok`, sayaç sıfır gösterdi. Normal bölümde konsol temizdi. Sabit test UID'siyle demo auth çıkışı yapılarak izin hatası zorlandı; yedi oyun `Bilgi alınamadı`, sayaç `—` gösterdi; beklenen permission-denied sayaç logu görüldü. Bu sabit UID'li fixture gerçek uygulamanın oturum yenileme testi değildir. 320×740 görünümde bekleme yazıları kart içinde satıra bölündü, yatay belge/kart taşması yoktu; uzun seçici mevcut kaydırmasıyla kullanıldı. Geçici fixture kodu ve demo verisi canlıya gönderilmedi.

Üretilen CSS'nin önceki canlı dosyayla kural farkı yalnız `.bg-slate-500` eklenmesidir; silinen/değişen mevcut kural yoktur. Canlı kabul henüz tamamlanmadı; kaynak yayımlandıktan sonra aşağıya kaydedilir.

## Tahmini etki ve sınırlar

1. **Orta doğruluk:** Eski önbellek ve okuma hatası gerçek bekleyen oyuncu/sıfır diye gösterilmez; sunucuya erişilemediğinde kullanıcıya belirsizlik görünür.
2. **Düşük bakım/işlem etkisi:** Yedi aynı filtre tek yerde tutulur; aynı sorgular/dinleyici ömürleri kullanılır. Sorgu maliyeti, pil, bellek veya gecikme için ölçülmüş tasarruf iddiası yoktur.
3. **Düşük paket etkisi:** Ana JS gzip 172,27 → 172,40 kB; CSS 11,61 kB gzip, Okey 39,97 kB gzip. Bu bir indirme hızlandırması değildir; mevcut büyük ana parça uyarısı sürer.

Sunucudan onay almak fiziksel bağlantıyı veya insan sayısını anlık bilmek değildir. Kopuşun SDK tarafından fark edilmesi zaman alabilir; kuyruk 60 saniye, presence 75 saniye tazelik ve lobinin beş saniyelik tekrar hesabı aynıdır. Yeni sunucu snapshot'ı olmasa bile yerel süre hesabı eski üyeleri eler. Metadata olayları tüm gerçek telefon/tarayıcı/uyku durumlarında denenmedi. Sekiz orta bağımlılık kaydı (son tarama), doğrudan Firestore token iptali, anonim UID/IP dolaşımı, gerçek cihaz/uzun arka plan/yük/bellek ve saklama/izleme sınırları nedeniyle **genel site denetimi tamamlanmış değildir**.

Kaynaklar (28 Ekim 2026): [Firebase çevrimdışı veri ve metadata onayı](https://firebase.google.com/docs/firestore/manage-data/enable-offline), [SnapshotMetadata](https://firebase.google.com/docs/reference/js/firestore.snapshotmetadata), [SnapshotListenOptions](https://firebase.google.com/docs/reference/js/firestore.snapshotlistenoptions). Bunlar SDK semantiğini destekler; ürün kabulü yukarıdaki kanıtlarla sınırlıdır.
