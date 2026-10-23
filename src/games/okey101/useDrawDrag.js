import { useCallback, useRef, useState, useEffect } from 'react';
import { findNearestSlotIndex } from './nearestSlot.js';

// Hem ortadaki KAPALI DESTEDEN hem de solumdaki oyuncunun BANA ATTIĞI taştan
// aynı şekilde (sürükleyerek) taş çekebilmek için ortak etkileşim mantığı.
//
// Davranış:
//   - Hareket etmeden bırakılırsa (klasik tık) ıstakadaki İLK boş slota çeker.
//   - Sürüklenip bırakılırsa, bırakma noktasına EN YAKIN BOŞ slota çeker
//     (bkz. nearestSlot.js — Madde 9). Eskiden burada `elementFromPoint`
//     kullanılıyordu; taş iki slotun ARASINA bırakıldığında hedef `null`
//     dönüyor ve taş ilgisiz bir yere, ıstakanın İLK boş slotuna fırlıyordu.
// Sürüklerken imleci takip eden bir "ghost" gösterilir.
//
// PERFORMANS: Ghost'un POZİSYONU React state'i ile DEĞİL, `ghostElRef`
// üzerinden doğrudan DOM yazımıyla (style.transform) güncellenir. Eskiden her
// piksel hareketinde `setPos({x,y})` çağrılıp TÜM ağacın yeniden render
// edilmesine yol açıyordu — bu da (özellikle taş çekerken) hissedilen
// donma/takılmaların bir kaynağıydı. `active`/`grown` sadece MOUNT/UNMOUNT ve
// büyüme animasyonu için birer state'tir, sürüklenirken sürekli değişmezler.
export default function useDrawDrag({ enabled, onDraw }) {
  const dragRef = useRef(null);
  const growTimerRef = useRef(null);
  const ghostElRef = useRef(null);
  const latest = useRef({ enabled, onDraw }); latest.current = { enabled, onDraw };
  const [active, setActive] = useState(false);
  const [grown, setGrown] = useState(false);

  const applyPos = (el, x, y) => {
    if (el) el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const ghostRef = useCallback((el) => {
    ghostElRef.current = el;
    const d = dragRef.current;
    // Node YENİ mount olduysa son bilinen imleç konumunu HEMEN uygula —
    // aksi halde bir kare boyunca (0,0)'da yanıp sönme görülür.
    if (el && d && d.x !== undefined) applyPos(el, d.x, d.y);
  }, []);

  const reset = useCallback(() => {
    dragRef.current = null;
    if (growTimerRef.current) { clearTimeout(growTimerRef.current); growTimerRef.current = null; }
    setActive(false);
    setGrown(false);
  }, []);

  const onPointerDown = useCallback((e) => {
    if (!latest.current.enabled || dragRef.current || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault();
    dragRef.current = { pointerId: e.pointerId, moved: false, x: e.clientX, y: e.clientY };
    setActive(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved) {
      d.moved = true;
      growTimerRef.current = setTimeout(() => setGrown(true), 80);
    }
    d.x = e.clientX; d.y = e.clientY;
    applyPos(ghostElRef.current, e.clientX, e.clientY);
  }, []);

  const onPointerUp = useCallback((e) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    reset();
    if (!latest.current.enabled) return;
    // Hiç hareket etmeden bırakıldıysa (klasik tık) hedef YOKTUR: çağıran
    // taraf ıstakanın ilk boş slotuna çeker — imlecin o an bulunduğu
    // (destenin üstündeki) noktaya "en yakın" slota çekmek anlamsız olurdu.
    if (!d.moved) { latest.current.onDraw(null); return; }
    // Hedef, bırakma ANINDAKİ konuma göre hesaplanır (pointermove'da değil):
    // parmak son karede hâlâ kayıyor olabilir, asıl belirleyici bırakma noktasıdır.
    const x = e?.clientX ?? d.x;
    const y = e?.clientY ?? d.y;
    latest.current.onDraw(findNearestSlotIndex(x, y, { emptyOnly: true }));
  }, [reset]);

  const onPointerCancel = useCallback((e) => {
    if (dragRef.current?.pointerId === e.pointerId) reset();
  }, [reset]);

  useEffect(() => { if (!enabled) reset(); }, [enabled, reset]);
  useEffect(() => {
    const hidden = () => { if (document.visibilityState !== 'visible') reset(); };
    // A turn update may remove the source handlers before pointerup arrives.
    // Window listeners also finish drops outside the source/capture target.
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', hidden);
      dragRef.current = null;
      clearTimeout(growTimerRef.current);
    };
  }, [onPointerUp, onPointerCancel, reset]);

  const handlers = enabled
    ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture: onPointerCancel }
    : {};

  return { active, grown, ghostRef, handlers };
}
