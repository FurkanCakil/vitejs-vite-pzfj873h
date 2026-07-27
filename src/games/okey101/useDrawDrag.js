import { useCallback, useRef, useState } from 'react';

// Hem ortadaki KAPALI DESTEDEN hem de solumdaki oyuncunun BANA ATTIĞI taştan
// aynı şekilde (sürükleyerek) taş çekebilmek için ortak etkileşim mantığı.
//
// Davranış:
//   - Hareket etmeden bırakılırsa (klasik tık) ıstakadaki İLK boş slota çeker.
//   - Sürüklenip ıstakadaki belirli bir slotun üzerinde bırakılırsa TAM O
//     SLOTA çeker.
// Sürüklerken imleci takip eden bir "ghost" gösterilir; ghost'un konumu hiçbir
// CSS geçişine tabi değildir (birebir/gecikmesiz hareket), sadece ilk anda
// hafifçe büyür.
export default function useDrawDrag({ enabled, onDraw }) {
  const dragRef = useRef(null);
  const growTimerRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [grown, setGrown] = useState(false);

  const reset = useCallback(() => {
    if (growTimerRef.current) { clearTimeout(growTimerRef.current); growTimerRef.current = null; }
    setPos(null);
    setGrown(false);
  }, []);

  const onPointerDown = useCallback((e) => {
    if (!enabled) return;
    e.preventDefault();
    dragRef.current = { targetIndex: null, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [enabled]);

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved) {
      d.moved = true;
      growTimerRef.current = setTimeout(() => setGrown(true), 80);
    }
    setPos({ x: e.clientX, y: e.clientY });
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const slotEl = el?.closest('[data-slot-index]');
    d.targetIndex = slotEl ? Number(slotEl.dataset.slotIndex) : null;
  }, []);

  const onPointerUp = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    reset();
    if (!d) return;
    onDraw(d.targetIndex);
  }, [onDraw, reset]);

  const handlers = enabled
    ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }
    : {};

  return { pos, grown, handlers };
}
