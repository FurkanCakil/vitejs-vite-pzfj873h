# Bağımlılık güvenlik denetimi

27 Ekim 2026 — Yerel düzeltme ve kabul testleri tamamlandı; bu kayıt anında yeni kilit dosyası henüz Production'a yayımlanmadı. Önceki canlı oyun/sayaç kuralları ve ortam ayarları değiştirilmez. Firebase istemcisi 10.14.1, Admin 13.10.0, Vercel OIDC 4.0.2 ve Tailwind 3 ana sürümleri korunur.

## Bulgu özeti

- **Kritik:** Güncel npm taramasında kritik seviyede kayıt yok. Bu, uygulamanın bütün güvenlik denetiminin tamamlandığı anlamına gelmez.
- **Yüksek / proje etkisi orta:** Firebase'in Node istemci yollarında eski `undici` ve `@grpc/grpc-js`, Vercel CLI ayar yardımcısında eski `zod` bulundu. Paket ağacı uyarıları bağımsız canlı açık sayısı değildir. Tarayıcı çıktısına bu Node taşıma yolları girmez; değişiklik sonrası bütün 20 istemci çıktısı önceki sürümle bayt düzeyinde aynıdır. Oyun API'si Zod ile dış veri ayrıştırmıyor; kendi 2 kB/izinli alan doğrulamasını kullanır.
- **Orta:** Tailwind zincirindeki `postcss-selector-parser` karmaşık seçicilerde işlemci tüketimi sorunundan etkileniyordu. Uygulama kullanıcıdan CSS almıyor; bu paket güvenilen depo kaynaklarını derlerken kullanılıyor.
- **Orta — açık:** Admin SDK'nın kullanılmayan isteğe bağlı Firestore 7/Storage zincirindeki `uuid` ve ona yayılan kayıtlar. Sunucu yalnız Admin App/Auth ve ayrı Firestore 9 istemcisini kullanır. Bildirilen sorun dış çıktı tamponu verilen v3/v5/v6 API'leriyle ilgilidir; her UUID üretiminin etkilendiği veya canlı hileye izin verdiği iddia edilmez.

## Uygulanan küçük değişiklikler ve nedenleri

| Dosya / paket | Değişiklik ve nedeni |
| --- | --- |
| `package.json` — `undici` | 6.19.7 → 6.29.1; aynı ana sürümdeki güvenlik düzeltmelerini, Firebase 10'un sabit alt sürümüne uygular. |
| `package.json` — Firestore 4.7.3 altındaki gRPC | 1.9.16 → 1.14.6; aynı ana sürümde güvenli taşıma sürümünü seçer ve mevcut Google istemcisiyle çoğaltmayı azaltır. Bu, upstream `~1.9.0` aralığını aşan dar kapsamlı override'dır; gerçek Node SDK transport testiyle doğrulanır. |
| `package.json` — Vercel CLI ayar yardımcısı altındaki Zod | 4.1.11 → 4.6.6; aynı ana sürümde bellek tüketimi düzeltmesini uygular. Diğer paketlerin Zod seçimi küresel olarak değiştirilmez. |
| `package-lock.json` — seçici ayrıştırıcısı | 6.1.4 → 6.1.5; Tailwind'in mevcut izinli aralığındaki güvenlik yamasıdır. |
| `package-lock.json` | Sürümleri ve bütünlük özetlerini sabitler; temiz `npm ci` ile aynı kurulum doğrulanır. `npm audit fix --force` veya npm'in eski Firebase 9/OIDC 3 önerileri kullanılmaz. |
| `server/firebase-client.integration.test.js` ve integration komutu | Firebase Node SDK'sında anonim giriş/token yenileme, gerçek gRPC okuma/dinleme ve erişim reddini sınar; dar override'ların normal SDK davranışını bozmasını yakalar. Yalnız demo emülatörü kullanılabilir. |
| `server/README.md`, `SECURITY-MIGRATION.md`, bu kayıt | Güncel sayıyı, açık kalan sınırı ve sürüm seçiminin gerekçesini korur. |

Override'lar kalıcı bakım gerektirir: üst Firebase/Vercel paketi güvenli aralıkları sağladığında kaldırılmalı ve aynı testler tekrarlanmalıdır. İleride Firebase istemcisi farklı sürüme geçirilirse Firestore 4.7.3'e özel override otomatik olarak o yeni sürüme uygulanmaz; tekrar tarama gerekir.

## Tarama ve doğrulama

- 22 Ekim'deki eski kayıt 26 uyarıydı. **27 Ekim'de değişiklik öncesi güncel tarama 23** verdi: 8 yüksek, 15 orta. Veri tabanı zamanla değiştiğinden 26→23 farkı bu kod değişikliğine mal edilmez.
- Düzeltme sonrası güncel tarama **8 orta, 0 yüksek, 0 kritik**; sekiz kayıt aynı `uuid` sorununun üst paketlere yayılmasıdır. Gizlenmedi, audit kapsamı daraltılmadı. Eski paketlerin deprecation mesajları ayrıca devam edebilir.
- Temiz `npm ci --ignore-scripts --no-audit --no-fund` başarılı. 128 otomatik test geçti; 11 emülatör üst testi normal komutta atlandı. Yeni Node istemci testi eklenince atlanan üst test sayısı 12 olur. API'nin `--no-experimental-require-module` başlatma kontrolü de geçti.
- Yedi oyunun mevcut emülatör paketi 91 senaryo / 102 sonuçla geçti. Yeni Firebase Node SDK testi ayrı temiz demo çalıştırmada iki senaryo / üç sonuçla geçti. Toplam kapsam 93 senaryo ve 12 üst test / 105 sonuçtur; tek birleşik çalıştırma sonucu olarak sunulmaz.
- Yeni testte anonim giriş ve zorunlu token yenilemede aynı UID; oda okuma ve canlı snapshot; üye olsa bile doğrudan yazma, eski oda ve üye olmayan okuma reddi doğrulandı. Bilerek yapılan reddedilen yazma SDK'da PERMISSION_DENIED günlüğü üretir; başarısız test değildir.
- TypeScript ve diff kontrolü temiz; lint sıfır hata / mevcut 36 uyarı. Tüm Production istemci ayarları açık derleme geçti. Ana JS `index-YYy92vMJ.js` 171,66 kB gzip, CSS `index-Tlx8d9Qx.css` 11,60 kB gzip; bütün 20 çıktı dosyası eski derlemeyle aynı.

## Neden Admin 14'e geçirilmedi?

Güncel 14.5.0, ana kurulumdan ayrı ve yalnız yerelde oluşturulan geçici klasörde denendi. CommonJS → ESM otomatik köprüsü kapalı yükleyicide `firebase-admin/auth` içe aktarımı, `jwks-rsa` → `jose` zincirinde **ERR_REQUIRE_ESM** ile hâlâ duruyor. Bu, önceki Vercel başlatma sorununu tekrar üretti. Deneme klasörü doğrulanıp kaldırıldı; 14.5.0 ana kilit dosyasına veya canlıya alınmadı. Çalışan 13.10.0 korundu. Sekiz orta kaydı sıfırlamak için başka ana sürümlere zorunlu UUID override'ı veya yeni kimlik doğrulama kodu yazılmadı.

## Hız etkisi ve kalan iş

- **Düşük:** gRPC kopyaları azaldı; npm ağacındaki toplam kayıt 448→445. Bu, gerçek sunucu açılış süresi/kota ölçümü değildir.
- **Düşük:** Seçici ayrıştırıcısının kötü durum karmaşıklığı düzeldi; güvenilen mevcut CSS derlemesinde ölçülebilir hız kazancı iddia edilmez.
- İstemci dosyaları aynı olduğu için bu aşamaya ait sayfa indirme boyutu veya tahta performansı kazancı yoktur.

Genel denetim sürer: sekiz orta bağımlılık kaydı, anonim UID yenileyerek hız sınırını aşma, ek token iptal kontrolü, gerçek cihaz/uzun arka plan/yük ve operasyonel saklama/izleme sınırları kapanmış sayılmaz. Bu aşama IAM, anahtar, veri silme, ücretli hizmet veya zamanlanmış iş içermez.

Kaynaklar (27 Ekim 2026'da kontrol edildi): [gRPC sertifika bağlamı](https://github.com/advisories/GHSA-m9gg-hp2v-232j), [Undici EventSource sınırı](https://github.com/advisories/GHSA-4qv8-2p9j-2685), [Zod bellek tüketimi](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [seçici ayrıştırıcısı](https://github.com/advisories/GHSA-rj75-hqrm-r3gf), [UUID tampon sınırı](https://github.com/advisories/GHSA-w5hq-g745-h8pq), [Admin ESM hata kaydı](https://github.com/firebase/firebase-admin-node/issues/3181), [jwks-rsa 4.1.0 kaynak](https://github.com/auth0/node-jwks-rsa/blob/v4.1.0/src/utils.js).
