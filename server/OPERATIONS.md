# Oyun Portalı işletim ve kalan riskler

30 Ekim ek kontrol: Yerel süreli XOX/sayaç yük denemesi 602,25 saniyede 160 maç / 2.420 işlemle geçti; sonuç ve tekrar komutu aşağıdadır. Bu kısmi yük kabulü gerçek Vercel kapasitesi, bütün oyunların yükü veya çok saatli/telefon belleği kontrolü değildir. Çalışan oyun kodu değişmedi.

29 Ekim 2026. Mevcut Firebase Spark / Vercel Hobby mimarisine göre kapanış notudur. Yeni ücret, IAM, veritabanı kuralı, veri silme veya zamanlanmış iş açmaz. Canlı kullanım miktarı bu kayıtta ölçülmedi; planın kotası ile mevcut tüketim birbirinden ayrılır.

## Kota ve bağlantı maliyeti

Firebase'in güncel ücretsiz Firestore sınırları: günlük 50.000 belge okuma, 20.000 yazma, 20.000 silme; 1 GiB saklama ve ayda 10 GiB dışa aktarım. Günlük kota Pacific gece yarısına yakın yenilenir. TTL ile otomatik silme, yedekleme/geri yükleme gibi özellikler ücretsiz kota kapsamında değildir ve faturalandırma gerektirir. [Resmî Firestore sınırları](https://firebase.google.com/docs/firestore/quotas)

Vercel Hobby dokümanında aylık 1 milyon function çağrısı, 4 aktif CPU saati, 360 GB-saat ayrılmış bellek ve 100 GB veri aktarımı listelenir. Limit aşımı hizmetin durmasına yol açabilir; “ücretsiz” sınırsız kullanım değildir. Runtime logları Hobby'de bir saat tutulur. Gerçek takım tüketimi için paneldeki Usage esas alınmalı; burada hesaba ait kalan kota veya fatura sonucu uydurulmaz. [Güncel Hobby kapsamı](https://vercel.com/docs/plans/hobby)

Koddan çıkan **normal, tek sekme, kesintisiz bağlantı modeli**:

| Durum | Saatlik periyodik API çağrısı | Kapsam |
| --- | ---: | --- |
| Lobi veya yerel bot | Yaklaşık 180 | 20 saniyelik aktiflik bildirimi |
| Çevrimiçi oda | Yaklaşık 420 | Yukarıdakine ek 15 saniyelik oda bildirimi, yaklaşık 240 |

Bu hesaba giriş/çıkış, görünürlük/ağ dönüşü, normal hamleler, Okey'in yalnız zamanı gelince gönderdiği otomatik eylemler ve tekrar denemeler dahil değildir. Gizli/çevrimdışı sayfanın işletim sistemi tarafından askıya alınması sayıyı düşürebilir; bu garanti edilen kota tasarrufu değildir.

Oyun durumu değişmeyen, kuyrukta beklemeyen bir XOX odasında normal oda bildirimi bağlantı/işlem makbuzu/hız sınırı olmak üzere **3 yazma** yapar. Aktiflik bildirimi özel parçaya 1, özet değişince ayrıca 1 yazma yapar. Böylece tek sekmede yaklaşık **900–1080 belge yazma/saat** temel trafik oluşur; bu diğer oyunların, çoklu sekmenin veya gerçek bir maçın ölçümü değildir. Okumalar, transaction tekrarları, dinleyici güncellemeleri ve hamleler ayrıca tüketir. Çok oyunculu kapasite bu aralığı günlük kotaya bölerek güvenilir biçimde bulunamaz. Sunucu doğrulaması kaldırılarak kota kazanımı yapılmamalıdır.

## İzleme ve arıza sırası

29 Ekim güncellemesi: Uygulamanın yakaladığı sunucu hataları artık `game_api_failure` sabit etiketiyle, yalnız güvenli aşama/kategori içererek sınırlı kaydedilir. Bir süreçte aynı aşama/kategori dakikada bir, toplam en fazla sekiz kayıt; dağıtım geneli sınır değildir. Normal yanıt, 4xx ve kapalı Preview kaydı oluşturmaz. Önceki hatanın kök nedeni bulunmuş sayılmaz; platformun uygulamaya ulaşmayan hatalarını garanti etmez. [Kapsam ve canlı kabul](DIAGNOSTICS.md).

1. Firebase Console → Firestore → Usage üzerinden günlük okuma/yazma/silme ve saklama miktarını kontrol et. Eşiklere yaklaşınca o günkü oyuncu/süre bilgisiyle karşılaştır; tek başına aktif sayaç günlük kullanım değildir.
2. Vercel takım Usage ve proje Runtime Logs/Observability üzerinden function çağrısı, hata ve süreyi incele. Özellikle normal oyuncuda yinelenen 429/503, artan yanıt süresi ve yayın sonrası 401/403 değişimi araştırılmalı; tek bir beklenen yetkisiz istek hata patlaması sayılmaz.
3. Sorunu kaydederken oyun, yerel saat, yayın sürümü ve kullanıcıya görünen hata kodu yeterlidir. Ham token, gizli el/filo, IAM anahtarı veya tam istek gövdesini loglama. Kısa log saklama süresi nedeniyle olay incelenirken gizli bilgilerden arındırılmış bulgu kaydı tutulmalı.
4. Yalnız dar bir yayın gerilemesinde doğrulanmış önceki dağıtımı geri al; oyun geçişlerini/üyelik kurallarını gevşetme. Kural veya veri modeli değişikliği varsa eski istemcinin uyumunu ayrıca değerlendir. Kullanıcılara yenileme/yeni oda gereksinimini açıkça söyle.

Panelden yeni alarm, haricî telemetri, Analytics SDK veya zamanlanmış kontrol açılmadı. Bunlar ihtiyaç halinde veri kapsamı ve plan sınırı görülerek ayrıca seçilir.

## Saklama ve temizleme sınırı

Kapalı oda belgesi otomatik olarak silinmez. Sayaç parçalarındaki eski üyeler ve oda bağlantıları normal işlem sırasında budanır; bu bütün eski odaların/veri tabanının saklama politikası değildir. Kullanıcı başına işlem kayıtları son 32 makbuzla sınırlıdır; toplam farklı UID/oda sayısı bununla sınırlanmaz. Eski rooms/serverStatus erişimi kapalıdır, eski veriler silinmemiştir.

**Öneri, henüz onaylanmış silme politikası değil:** Önce salt okunur bir envanterle kapalı/uzun süredir bağlantısız odaların ve ilişkili özel belgelerin sayısını/boyutunu çıkar; saklama süresini kullanıcı belirlesin. Temizleme yapılacaksa önceden kuru çalışma listesi, kesin proje/ortam filtresi, oda hâlâ kapalı ve bağlantısız mı kontrolü, sınırlı grup boyutu ve işlem özeti gerekir. Etkin oda/oyuncu verisi hedeflenmemeli.

Bir oda ailesinde `roomsV2/{roomId}/playerData`, `serverRoomPresence`, `serverBattleFleets`, `serverOkeyRooms` ve `serverChessHistory/{roomId}/matches` gibi ilişkiler bulunabilir. Ana belgeyi SDK ile silmek alt koleksiyonları kendiliğinden silmez; yalnız ana belgeyi hedefleyen temizlik eksiktir. Kullanıcı başına makbuz/hız kayıtları oda ailesinden farklı değerlendirilmelidir; tekrar gönderme güvenliği bozulmamalıdır. Mevcut Spark korunurken TTL/ücretli yedek varsayılmadı. [Firestore silme davranışı](https://firebase.google.com/docs/firestore/manage-data/delete-data)

## Açık güvenlik ve doğrulama maddeleri

| Önem | Açık madde | Mevcut koruma / sonraki koşul |
| --- | --- | --- |
| Orta | 8 orta bağımlılık kaydı | 29 Ekim taramasında yüksek/kritik yok; kayıtlar Admin/Google Cloud zincirindeki UUID sorununa bağlı. Admin 14.5 ayrı önceki denemede başlamadı; zorla ana sürüm/UUID override'ı uygulanmadı. Uyumlu düzeltme ve API başlangıç testiyle tekrar ele alınmalı. |
| Orta | Doğrudan Firestore okumalarında anlık token iptali yok | Üyelik ve özel belge kuralları var; API ek hesap kontrolü ve sınırlı önbellek kullanıyor. Bütün kanalları anında kesmek ayrı iptal metadatası/kural tasarımı gerektirir. |
| Orta | Anonim UID/IP değiştirme ve dağıtık trafik | Sunucuda UID sınırları ve Production API önünde IP sınırı var; tekil kişi veya botnet engeli değildir. Gerçek kötüye kullanım ölçümü olmadan NAT arkasındaki normal oyuncuları kesecek eşik düşürülmez. |
| Orta | Spark kota ve biriken eski veri | Temel trafik modeli yukarıda; yeni saklama/temizleme görevi çalışmıyor. Ücretsiz plan kapasitesi yük testinden geçmiş sayılmaz. |
| Açık gözlem | Tek 500 / INTERNAL_FUNCTION_INVOCATION_FAILED | 29 Ekim 19:30:05 GMT+3 isteği Vercel Request Logs'da görüldü; sonraki çağrılar 200. Ek Runtime hata ayrıntısı yok; kod/ortam/kota kök nedeni kesinleştirilmedi. Tekrarında aynı zaman/istek tanısıyla incele; yeni kurtarma düzeltmesiyle kapatılmış sayma. |
| Doğrulama eksiği | Gerçek Safari/Firefox/iOS, fiziksel dokunmatik, çok saatli arka plan ve yük/heap profili | Masaüstü Chromium'daki dar ekran ve kısa oturum kabulü bu ortamların yerine geçmez. Test edilmemiştir; “sızıntı yok” veya kapasite sayısı verilmez. |
| Düşük | 36 lint uyarısı, App tür kontrolü sınırı ve ana parça boyutu | 0 lint hatası ve derleme mevcut kapsamda geçer; `@ts-nocheck` tam tür güvenliği sağlamaz. Efekt bağımlılıklarını körlemesine değiştirmek oyun davranışını bozabilir. |

Firebase ID token'ları kısa ömürlüdür; iptal durumunu ek kontrol olmadan her kanalda anında yansıtmaz. UID üyeliği bilinmeyen odaya erişim vermez. [Firebase oturum modeli](https://firebase.google.com/docs/auth/admin/manage-sessions), [UUID bildirimi](https://github.com/advisories/GHSA-w5hq-g745-h8pq)

## Öncelikli hızlandırma seçenekleri

1. **Yüksek potansiyel — ölçüm/tasarım gerekiyor:** Bağlantı ve aktiflik işlemlerinin veritabanı maliyetini azaltmak. Önce gerçek günlük kullanım; sonra lease/makbuz/hız sınırı ve yeniden bağlantı garantileri korunarak emülatör yük testi. Şu an uygulanmadı; garanti edilen tasarruf yok.
2. **Orta — uygulandı:** Sürümlü dosyaları tarayıcıda immutable saklamak, eski/gereksiz motor ve sürükleme işlerini iptal etmek. Tekrar ziyaret ve boşa çalışan iş azalır; toplam hız/pil yüzdesi ölçülmedi.
3. **Orta potansiyel — uygulanmadı:** Stockfish'in yaklaşık 7,30 MB WASM dosyasını JS ile birlikte içerik hash'li yollara taşımak; önce eş sürüm ve yeni yayına geçiş testi gerekir.
4. **Düşük/orta potansiyel — uygulanmadı:** Ana parçayı ölçümle daha fazla bölmek. Oyun ekranları zaten ayrı yüklenir; tahta/CSS veya rastgele bağımlılık yükseltmesi yapılmamalı.

Bu notlar işletim incelemesini tamamlar; açık maddeleri çözülmüş göstermez. Mevcut site denetiminin kabul kapsamı ve yeni kurtarma düzeltmesi [AUDIT-CLOSEOUT.md](AUDIT-CLOSEOUT.md) içindedir.

## Yerel süreli yük kontrolünü tekrar çalıştırma

`scripts/server-soak.mjs`, sunucu işlemlerini canlıya trafik göndermeden süreli olarak sınar. Normal `npm test` veya derleme tarafından çalıştırılmaz. Önce demo emülatörlerini başlatan aşağıdaki komutu kullan:

```sh
npx --yes --package firebase-tools@15.34.0 firebase emulators:exec --only firestore,auth --project demo-oyun-portali --config firebase.emulator.json "node --expose-gc scripts/server-soak.mjs --seconds=600 --rooms=4 --output=soak-result.local"
```

Araç yalnız `demo-oyun-portali` ve 127.0.0.1:8180/9199'u kabul eder; Production ortamı veya hizmet hesabı dosyasıyla başlatılırsa veritabanı istemcisini oluşturmadan durur. Süre 30–1800 saniye, oda sayısı 1–8 ile sınırlıdır. Açık emülatör zaten varsa önce onu normal biçimde kapat; portları kullanan başka süreci körlemesine sonlandırma. Test her seferinde ayrı bir demo belge alanı kullanır, saat ileri sarmaz ve hız sınırlarını kapatmaz.

- Aynı oyuncular dört özel XOX odasında maç/rövanş yapar; eşzamanlı farklı hamlelerden yalnız biri işlenir ve üç kez gönderilen kazandıran hamle yalnız bir puan getirir.
- Oda ve sayaç bildirimleri birlikte sürer; üye olmayan hamle reddi, oyuncu başına en çok 32 işlem makbuzu ve 8 sayaç makbuzu, tek etkin sekme kontrol edilir.
- Normal çıkış sonunda odaların kapanması, tekrar katılımın reddi ve aktiflik özetinin boşalması doğrulanır; yöneticiyle belge silinmez.
- Sonuç JSON'u çağrı sürelerini, beklenen ret sayılarını ve her turdan sonra açıkça çöp toplama çalıştırılmış Node heap/RSS örneklerini içerir. Aracın ve Firestore SDK'sının belleği birlikte ölçülür; emülatör JVM'i ve tarayıcı ölçüme dahil değildir.

Bu test API HTTP katmanı, gerçek Firebase kimliği, WAF, Vercel/Google ağ gecikmesi veya yedi oyunun tamamının yük testi değildir. Sonuçları canlı oyuncu kapasitesi, telefon belleği ya da saatlerce sızıntısız çalışma garantisi olarak kullanma. Yeni araç denetimi tekrarlanabilir kılar; canlı oyun kodunu veya performansını değiştirmez.

### 30 Ekim 2026 sonucu

- **Kritik / Orta:** Bu sınanan senaryoda yeni oyun doğruluğu hatası bulunmadı. Önceki açık güvenlik maddeleri kapanmış sayılmaz. **Düşük:** Tekrarlanabilir süreli yerel ölçüm aracı yoktu; `scripts/server-soak.mjs` bu boşluğu kısmen kapatır. Bu belge yöntemi ve sınırları açıklar.
- Önce 30 saniyelik deneme, ardından tek 602,25 saniyelik gerçek zamanlı çalışma: 4 oda, aynı 8 oyuncu, 40 tur / **160 tamamlanmış maç**, **2.420 sunucu işlem çağrısı**, tepe 12 eşzamanlı çağrı. 160 beklenen stale_version, 160 not_a_player ve 4 room_closed reddi geçti; beklenmeyen başarısızlık yok. Her kazandıran hamle üç kez eşzamanlı gönderildi; skor yalnız bir arttı. Dört oda normal çıkışlarla kapandı ve sayaç özeti boşaldı; emülatörler normal kapandı.
- Açık çöp toplama sonrası Node heap başlangıçta 30,38 MiB, 10. turda 37,08 MiB, son 10 oyun turunda **37,49–37,91 MiB**, kapanışta 37,66 MiB. Bu örneklerde ısınma sonrası sürekli heap büyümesi görülmedi. Toplam süreç RSS tepe değeri **237,94 MiB**; heap toplam süreç belleği değildir. Sızıntı olmadığı veya tarayıcı/Vercel belleğinin bu kadar olduğu iddia edilmez.
- Yerel çağrı süreleri p50 41,86 ms, p95 3.465,04 ms, en yüksek 7.773,37 ms. Bilerek çakıştırılan transaction'ların SDK tekrar/beklemeleri ve beklenen retler dahil; bunlar canlı gecikme ya da oyuncu kapasitesi sayısı değildir. Yeni araç bir hızlandırma uygulamaz, ölçülmüş hız kazancı yoktur.
- Ham ölçüm `sunucu-yuk-sonucu-2026-10-30.json` teslim dosyasında; geçici yerel günlükler kaldırılır. Taze standart paket 183 başarılı / 13 emülatör üst testi atlanmış, 0 başarısız; yeni aracın sözdizimi ve kendi lint kontrolü temiz. Önceki 114 birleşik emülatör sonucu bu tur yeniden çalıştırılmış gibi sayılmaz. Yalnız test aracı ve bu işletim README'si değiştiğinden istemci derlemesi veya oyun kodu değişikliği yoktur.
- Bağımlılık taraması tekrar 8 orta / 0 yüksek / 0 kritik. Kayıt sürümleri hâlâ Admin 14.5.0 ve jwks-rsa 4.1.0; önceki uyumsuz yükseltme zorlanmadı. [Admin ESM hata kaydı](https://github.com/firebase/firebase-admin-node/issues/3181) hâlâ açık. Kota panelleri salt okunur kontrol edildi; tarihli kullanım bulgusu kanonik Notion denetim kaydında, anlık değerler `kullanim-kontrolu-2026-10-30.json` tesliminde tutulur. Veri silme, kural/IAM değişikliği veya zamanlanmış iş yoktur.
