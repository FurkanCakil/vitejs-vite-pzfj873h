// Madde 9 — HASSAS BIRAKMA (drop) HEDEFİ
// ============================================================
// KÖK NEDEN: Hedef slot eskiden SADECE `document.elementFromPoint` ile
// bulunuyordu. O fonksiyon imlecin TAM ALTINDAKİ elemanı döndürür — yani
// parmak/fare iki slotun ARASINDAKİ boşluğa (gap) ya da bir slotun 1-2 piksel
// dışına denk gelirse `null` döner. Bu durumda:
//   - taş çekerken (useDrawDrag) hedef "yok" sayılıp taş ıstakanın İLK boş
//     slotuna fırlıyordu (kullanıcının bıraktığı yerle ilgisiz),
//   - ıstaka içinde taş taşırken hiçbir şey olmuyordu ("bıraktım, tutmadı").
//
// ÇÖZÜM: Bırakma anında ıstakadaki slotların GERÇEK ekran koordinatlarını
// (getBoundingClientRect) okuyup, bırakma noktasına Öklid uzaklığı (Math.hypot)
// en küçük olan slotu seçmek. Böylece imlecin nereye denk geldiği değil, NEYE
// EN YAKIN olduğu belirleyicidir — arada bırakılan taş da doğru slota oturur.

// `emptyOnly`: sadece BOŞ slotlar aday olsun mu (taş çekerken evet — dolu bir
//   slota çekilen taş konamaz; ıstaka içinde taşırken hayır — dolu slota
//   bırakmak iki taşı yer değiştirmek demektir).
// `maxDistanceFactor`: kabul edilen en büyük uzaklık, slot GENİŞLİĞİNİN katı
//   olarak. `null` verilirse uzaklık sınırı yoktur (en yakın slot her koşulda
//   seçilir). Sınır vermek, ıstakanın TAMAMEN dışına (ör. masaya) bırakılan
//   taşın ıstakaya "ışınlanmasını" engeller.
export function findNearestSlotIndex(clientX, clientY, { emptyOnly = false, maxDistanceFactor = null } = {}) {
  if (typeof document === 'undefined') return null;
  const selector = emptyOnly ? '[data-slot-index][data-slot-empty]' : '[data-slot-index]';
  const slots = document.querySelectorAll(selector);

  let bestIndex = null;
  let bestDistance = Infinity;
  let bestWidth = 0;

  slots.forEach((el) => {
    const r = el.getBoundingClientRect();
    // Görünmeyen (ör. kompakt modda gizlenmiş) slotlar aday olmamalı.
    if (r.width === 0 || r.height === 0) return;
    const distance = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = Number(el.dataset.slotIndex);
      bestWidth = r.width;
    }
  });

  if (bestIndex === null) return null;
  if (maxDistanceFactor !== null && bestDistance > bestWidth * maxDistanceFactor) return null;
  return bestIndex;
}
