import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, X, Layers, Rows3 } from 'lucide-react';
import Tile, { TILE_ASPECT } from './Tile.jsx';
import { RACK_ROW_LENGTH, RACK_SLOTS, normalizeRack, moveTileToSlot, moveGroupBlockToSlot, isContiguousSelection } from './tiles.js';
import { validateGroup, isProperlyOrderedGroup } from './gameLogic.js';
import useViewport from '../../hooks/useViewport.js';

const DRAG_THRESHOLD_PX = 6;
const TACK_HOVER_COLOR = 'rgba(251,191,36,0.55)';

// 3. madde: Okey artık hiçbir çerçeve/rozetle belli edilmediği için oyuncu onu
// kendisi fark etmek zorunda. Fark ettiği taşı unutmamak adına (gerçek hayatta
// okeyi ters çevirip masaya koymak gibi) bir taşa 1sn basılı tutarak taşı TERS
// ÇEVİREBİLİR; 1sn daha basılı tutunca taş normale döner. Tamamen yerel/kişisel
// bir işarettir, sunucuya yazılmaz ve kimse göremez.
const LONG_PRESS_MS = 1000;

// Istaka, 15 sütunu HER ZAMAN kullanılabilir genişliğe sığdırır: taş genişliği
// konteynerden ölçülerek hesaplanır (bkz. useRackMetrics). Böylece ne telefonda
// (dikey/yatay) ne de tam ekranda alta yatay kaydırma çubuğu çıkar.
const GAP_RATIO = 0.13;      // taş genişliğine oranla slotlar arası boşluk
const ROW_PADDING_PX = 4;    // satır kutusunun kendi iç boşluğu (tek yan)
const MIN_TILE_W = 14;       // çok dar telefonlarda bile okunur alt sınır
const MAX_TILE_W = 60;       // çok geniş ekranlarda absürt büyümeyi engeller

// "Soldan Çek" / "Sağa At" bölmesinin taş genişliğine oranı (kompakt modda bu
// bölmeler ıstakanın ÜSTÜNDE değil YANINDA durduğu için genişlik hesabına girer).
const SIDE_SLOT_RATIO = 1.25;
const SIDE_COL_RATIO = SIDE_SLOT_RATIO + 0.22; // + aradaki boşluk payı

// Istakanın kaplayabileceği en fazla dikey oran. Kalan yükseklik masaya
// (rakipler + açılan eller) kalır.
//
// ÖNEMLİ: Bu pay, ıstakanın EKRANDAKİ KONUMU ölçülerek bulunamaz — ıstaka esnek
// bir sütunun altına yaslandığı için kendi yüksekliği kendi konumunu belirler ve
// ölçüm sonsuz bir geri beslemeye girip taşları en küçük boyuta çökertir. Bu
// yüzden pay doğrudan görüntü alanı YÜKSEKLİĞİNDEN türetilir.
const RACK_HEIGHT_RATIO = 0.5;

// DAR ekranlarda (telefon DİKEY) 15 sütunluk tek satır, taşları 19px gibi
// okunamayacak bir boyuta düşürüyordu — oysa dikeyde bol bol boş yer vardı.
// Bu yüzden aynı 30 slot, 15x2 yerine 10x3 olarak dizilir: slot SIRASI (ve
// dolayısıyla per bitişikliği/sürükleme mantığı) hiç değişmez, sadece satır
// kırılma noktası değişir — taşlar ~%45 büyür.
const NARROW_SCREEN_PX = 520;
const NARROW_ROW_LENGTH = 10;

const rackColumns = (compact, viewportWidth) => (
  (!compact && viewportWidth > 0 && viewportWidth < NARROW_SCREEN_PX) ? NARROW_ROW_LENGTH : RACK_ROW_LENGTH
);

function useRackMetrics({ compact, viewportHeight, cols, rows }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth((prev) => (Math.abs(prev - el.clientWidth) < 2 ? prev : el.clientWidth));
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [compact]);

  const metrics = useMemo(() => {
    // usable = N*w + (N-1)*(w*GAP_RATIO) [+ kompakt modda iki yan bölme]
    const columns = cols + (cols - 1) * GAP_RATIO + (compact ? SIDE_COL_RATIO * 2 : 0);
    const usable = Math.max(0, width - ROW_PADDING_PX * 2 - 4);
    let tileW = Math.floor(usable / columns) || MIN_TILE_W;

    if (viewportHeight > 0) {
      // Tüm satırlar + satır araları + satırların iç boşlukları bu paya sığmalı.
      const budget = viewportHeight * RACK_HEIGHT_RATIO - (ROW_PADDING_PX * 2 * rows + 10);
      tileW = Math.min(tileW, Math.floor(budget / (rows * TILE_ASPECT + GAP_RATIO * 1.4 * (rows - 1))));
    }

    tileW = Math.max(MIN_TILE_W, Math.min(MAX_TILE_W, tileW));
    return { tileW, tileH: Math.round(tileW * TILE_ASPECT), gap: Math.max(2, Math.floor(tileW * GAP_RATIO)) };
  }, [width, compact, viewportHeight, cols, rows]);

  return { ref, ready: width > 0, ...metrics };
}

// Oyuncunun kendi ıstakası: taş seçimi (per onaylamak / seri-çift açmak için),
// SABİT SLOTLU sürükle-bırak (bir taş boş bir slota bırakılırsa SADECE o taş
// oraya gider, doluysa iki taş yer değiştirir — diğer taşlar ASLA kaymaz),
// gruplanmış (per) taşların bir blok halinde birlikte hareket etmesi, (canAct
// açıkken) taşı ıstaka dışına sürükleyip atma (discard), ve (hasOpened + canAct
// iken) masadaki açık perlere tek taş işleme (tacking) burada yönetilir.
// Sadece sahibi (isOwner) etkileşime girebilir.
export default function PlayerRack({
  rack, groups, isOwner, onUpdateRack, okeyInfo,
  canAct = false, canDiscard = false, hasOpenedAlready = false, lastDiscardTile = null,
  incomingDiscard = null, canTakeIncoming = false, incomingDragHandlers = null,
  canOpenPairsRule = true, pairsButtonLabel = 'Çift Aç', canOpenMeldsRule = true,
  pendingDraw = null, flipTileId = null, compact = false,
  onDiscardTile, onOpenSeries, onOpenPairs, onTackTile, showToast,
}) {
  const safeRack = useMemo(() => normalizeRack(rack), [rack]);
  const safeGroups = groups || {};
  const { height: viewportHeight, width: viewportWidth } = useViewport();
  const cols = rackColumns(compact, viewportWidth);
  const rows = Math.ceil(RACK_SLOTS / cols);
  const { ref: rackWrapRef, ready, tileW, tileH, gap } = useRackMetrics({ compact, viewportHeight, cols, rows });

  const [selected, setSelected] = useState(() => new Set());
  const [hoverIndex, setHoverIndex] = useState(null);
  const [hoverDiscard, setHoverDiscard] = useState(false);
  const [ghost, setGhost] = useState(null); // { x, y, tiles }
  // Uzun basılarak ters çevrilmiş taşların id'leri (sadece bu tarayıcıda).
  const [flippedIds, setFlippedIds] = useState(() => new Set());
  const longPressTimerRef = useRef(null);
  // Atma anında Firestore turu tamamlanana kadar taşı ıstakadan İYİMSER
  // (optimistic) olarak gizler — algılanan gecikmeyi azaltır. `rack` propu
  // gerçek veriyle güncellenince (taş gerçekten gitmiş olur) otomatik temizlenir.
  const [optimisticDiscardId, setOptimisticDiscardId] = useState(null);
  useEffect(() => { setOptimisticDiscardId(null); }, [rack]);
  const dragRef = useRef(null);
  const tackHoverElRef = useRef(null);

  // Istaka düzenlemesi artık sunucuda transaction ile birleştirilerek yazılıyor
  // (taş kaybını önlemek için — bkz. tiles.js#mergeRackLayout). Bu fazladan bir
  // sunucu gidiş-dönüşü demek; sürükle-bırak'ın anlık hissettirmesi için taşın
  // yeni yeri ekranda HEMEN gösterilir, sunucu onayı gelince iyimser kopya düşer.
  const [optimisticRack, setOptimisticRack] = useState(null);
  const optimisticTimerRef = useRef(null);
  useEffect(() => () => { if (optimisticTimerRef.current) clearTimeout(optimisticTimerRef.current); }, []);

  const baseRack = optimisticRack || safeRack;

  // KRİTİK: `baseRack` bir React state DEĞİŞKENİDİR — `setOptimisticRack`
  // çağrısı bir sonraki render'a kadar (React state güncellemeleri asenkron
  // olduğu için) YANSIMAZ. Telefonda (özellikle dar dikey 3 satırlı düzende,
  // taşlar küçük olduğu için çok daha sık sürükleme yapılıyor) oyuncu bir
  // taşı bırakır bırakmaz HEMEN bir sonrakini sürüklemeye başlarsa, ikinci
  // sürüklemenin `handlePointerDown`'ı henüz BAYAT olan `baseRack` state'ini
  // görüyor (ilk sürüklemenin sonucunu yansıtmıyor) — bu da taşların rastgele
  // yer değiştirmiş/geri sıçramış gibi görünmesine yol açıyordu. `baseRackRef`
  // her sürüklemenin BAŞINDA ve applyRack'te SENKRON güncellenir, böylece her
  // yeni sürükleme render beklemeden her zaman en güncel yerleşimi görür.
  const baseRackRef = useRef(baseRack);
  useEffect(() => { baseRackRef.current = baseRack; }, [baseRack]);

  // Sunucu aynı yerleşime ulaştıysa iyimser kopya kendiliğinden düşer.
  useEffect(() => {
    if (!optimisticRack) return;
    const same = safeRack.every((t, i) => (t?.id ?? null) === (optimisticRack[i]?.id ?? null));
    if (same) setOptimisticRack(null);
  }, [safeRack, optimisticRack]);

  // Taşları yeni düzene taşırken sunucuya yaz + ekranda hemen göster.
  const applyRack = (newRack, newGroups) => {
    baseRackRef.current = newRack; // bir sonraki sürükleme render'ı BEKLEMEDEN bunu görsün
    setOptimisticRack(newRack);
    if (optimisticTimerRef.current) clearTimeout(optimisticTimerRef.current);
    // Emniyet: sunucu beklenenden farklı bir yerleşim yazarsa iyimser kopya
    // sonsuza dek asılı kalmasın (gerçek veri her hâlükârda kazanır).
    optimisticTimerRef.current = setTimeout(() => setOptimisticRack(null), 2500);
    onUpdateRack(newRack, newGroups);
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  };
  useEffect(() => clearLongPress, []);

  // Istakadan çıkan (atılan/işlenen/açılan) taşların ters-çevrilme işareti
  // birikmesin diye temizlenir.
  useEffect(() => {
    setFlippedIds((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(safeRack.filter(Boolean).map((t) => t.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [safeRack]);

  // Çekilen taş, sunucu cevabı beklenmeden bırakıldığı slotta gösterilir
  // (bkz. Okey101Game#performDraw). Gerçek veri gelince prop kendiliğinden
  // düşer ve aşağıdaki birleştirme etkisiz kalır.
  // Taş gerçek ıstakada (hangi slotta olursa olsun) göründüğü an iyimser
  // kopya devre dışı kalır — aksi halde sunucu taşı farklı bir slota yazarsa
  // bir kare boyunca çift görünürdü.
  const pendingVisible = !!pendingDraw
    && !baseRack[pendingDraw.index]
    && !baseRack.some((t) => t && t.id === pendingDraw.tile.id);
  const displayRack = useMemo(() => {
    if (!pendingVisible) return baseRack;
    const next = [...baseRack];
    next[pendingDraw.index] = pendingDraw.tile;
    return next;
  }, [baseRack, pendingDraw, pendingVisible]);
  const pendingTileId = pendingVisible ? pendingDraw.tile.id : null;

  const groupOf = useMemo(() => {
    const map = {};
    Object.entries(safeGroups).forEach(([gid, tileIds]) => tileIds.forEach((tid) => { map[tid] = gid; }));
    return map;
  }, [safeGroups]);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const allUngrouped = selectedIds.length > 0 && selectedIds.every((id) => !groupOf[id]);
  const contiguous = allUngrouped && isContiguousSelection(selectedIds, baseRack);
  const canAttemptConfirm = allUngrouped && selectedIds.length >= 2;

  // Seçimdeki her taş bir gruba ait VE o grupların TÜM taşları seçili mi?
  const selectedGroupIds = useMemo(() => {
    const gids = new Set();
    selectedIds.forEach((id) => { const g = groupOf[id]; if (g) gids.add(g); });
    return [...gids];
  }, [selectedIds, groupOf]);
  const allSelectedAreCompleteGroups = selectedIds.length > 0
    && selectedIds.every((id) => groupOf[id])
    && selectedGroupIds.every((gid) => (safeGroups[gid] || []).every((id) => selected.has(id)));
  const canRemoveGroup = allSelectedAreCompleteGroups && selectedGroupIds.length === 1;
  const canOpenSeries = allSelectedAreCompleteGroups && selectedGroupIds.length >= 1 && canAct && canOpenMeldsRule;
  // İlk açılışta TAM 5 çift şart; zaten açmış (ve kural gereği çift sürebilen)
  // bir oyuncu için 1+ çift yeterlidir (bkz. gameLogic#canPlayerLayPairs).
  const pairCountOk = hasOpenedAlready ? selectedGroupIds.length >= 1 : selectedGroupIds.length === 5;
  const canOpenPairs = allSelectedAreCompleteGroups && pairCountOk && canAct && canOpenPairsRule;

  const commit = (newRack, newGroups) => {
    setSelected(new Set());
    applyRack(newRack, newGroups ?? safeGroups);
  };

  // Gruplu bir taşa tıklamak artık o grubu seçimden EKLER/ÇIKARIR (diğer seçili
  // gruplar korunur) — böylece "Seri Aç"/"Çift Aç" için birden fazla per aynı anda seçilebilir.
  const handleTileTap = (tile) => {
    if (!isOwner) return;
    const gid = groupOf[tile.id];
    if (gid) {
      const groupTileIds = safeGroups[gid] || [];
      const fullyIncluded = groupTileIds.length > 0 && groupTileIds.every((id) => selected.has(id));
      setSelected((prev) => {
        const next = new Set(prev);
        groupTileIds.forEach((id) => { if (fullyIncluded) next.delete(id); else next.add(id); });
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(tile.id)) next.delete(tile.id); else next.add(tile.id);
        return next;
      });
    }
  };

  // "Per Onayla": 1) seçili taşlar ıstakada yan yana mı? 2) (3+ taş seçiliyse)
  // seçim gerçekten geçerli bir per (set/seri) mi VE seri ise doğru sırada mı?
  // Sağlanmıyorsa toast ile net bir hata gösterilir ve hiçbir şey gruplanmaz.
  // Tam 2 taşlık seçimler ("Çift Aç" ön-hazırlığı) per doğrulamasından muaftır.
  const confirmGroup = () => {
    if (!contiguous) { showToast?.('Taşlar yan yana olmalı!', 'red'); return; }
    if (selectedIds.length >= 3) {
      const orderedTiles = baseRack.filter((t) => t && selected.has(t.id));
      const result = validateGroup(orderedTiles, okeyInfo);
      if (!result.valid) { showToast?.('Geçersiz Per Dizilimi!', 'red'); return; }
      if (!isProperlyOrderedGroup(orderedTiles, result.type, okeyInfo)) {
        showToast?.('Perinizi düzgün diziniz!', 'red');
        return;
      }
    }
    const gid = `G${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const ordered = baseRack.filter((t) => t && selected.has(t.id)).map((t) => t.id);
    commit(baseRack, { ...safeGroups, [gid]: ordered });
  };

  const removeGroup = () => {
    const gid = groupOf[selectedIds[0]];
    const nextGroups = { ...safeGroups };
    delete nextGroups[gid];
    commit(baseRack, nextGroups);
  };

  const openSeries = async () => {
    if (!canOpenSeries || !onOpenSeries) return;
    setSelected(new Set());
    await onOpenSeries(selectedGroupIds);
  };

  const openPairs = async () => {
    if (!canOpenPairs || !onOpenPairs) return;
    setSelected(new Set());
    await onOpenPairs(selectedGroupIds);
  };

  const clearTackHover = () => {
    if (tackHoverElRef.current) { tackHoverElRef.current.style.backgroundColor = ''; tackHoverElRef.current = null; }
  };

  // ---- Pointer tabanlı sürükle-bırak (mouse + dokunmatik ortak) ----
  const handlePointerDown = (e, index, tile) => {
    if (!isOwner || !tile) return;
    if (tile.id === pendingTileId) return; // sunucu onayı beklenen taş henüz taşınamaz
    // Tarayıcının kendi metin-seçimi + HTML5 sürüklemesi devreye girerse imleç
    // "yasak" (kırmızı çarpı) olur ve seçili DOM parçaları hayalet resim olarak
    // birlikte sürüklenir; bunu baştan engelliyoruz.
    e.preventDefault();
    window.getSelection?.()?.removeAllRanges?.();

    // `index` (render closure'undan gelen prop) BAYAT olabilir — bkz. baseRackRef
    // yorumu yukarıda. Taşın GERÇEK/GÜNCEL slotu her zaman ref'ten yeniden
    // bulunur; render henüz yetişmediyse bile bu doğru sonucu verir.
    const rackNow = baseRackRef.current;
    const freshIndex = rackNow.findIndex((t) => t && t.id === tile.id);
    const fromIndex = freshIndex !== -1 ? freshIndex : index;

    const gid = groupOf[tile.id];
    const tileIds = gid ? (safeGroups[gid] || [tile.id]) : [tile.id];
    // Grup içinde TUTULAN taşın kaçıncı sırada olduğu: bırakırken blok, imlecin
    // altındaki slot bu taşa denk gelecek şekilde konumlanır. Böylece per'i
    // ortasından tutup boş alanın ortasına bırakmak da doğru çalışır.
    const grabOffset = Math.max(0, tileIds.indexOf(tile.id));
    const tiles = tileIds.map((id) => rackNow.find((t) => t && t.id === id)).filter(Boolean);
    dragRef.current = { fromIndex, tileIds, grabOffset, startX: e.clientX, startY: e.clientY, moved: false, longPressed: false, tile, tiles };
    e.currentTarget.setPointerCapture?.(e.pointerId);

    // 2sn basılı tutma -> taşı ters çevir / düzelt (bkz. LONG_PRESS_MS).
    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      const d = dragRef.current;
      if (!d || d.moved || d.tile.id !== tile.id) return;
      d.longPressed = true;
      setFlippedIds((prev) => {
        const next = new Set(prev);
        if (next.has(tile.id)) next.delete(tile.id); else next.add(tile.id);
        return next;
      });
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX; const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) { d.moved = true; clearLongPress(); }
    if (!d.moved) return;

    setGhost({ x: e.clientX, y: e.clientY, tiles: d.tiles, grabOffset: d.grabOffset });

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const slotEl = el?.closest('[data-slot-index]');
    const discardEl = el?.closest('[data-discard-zone]');
    const tackEl = (canAct && hasOpenedAlready && d.tileIds.length === 1) ? el?.closest('[data-tack-uid]') : null;

    if (tackEl !== tackHoverElRef.current) { clearTackHover(); if (tackEl) { tackEl.style.backgroundColor = TACK_HOVER_COLOR; tackHoverElRef.current = tackEl; } }

    if (tackEl) { setHoverIndex(null); setHoverDiscard(false); }
    else if (slotEl) { setHoverIndex(Number(slotEl.dataset.slotIndex)); setHoverDiscard(false); }
    else if (discardEl) { setHoverIndex(null); setHoverDiscard(true); }
    else { setHoverIndex(null); setHoverDiscard(false); }
  };

  const finishDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    clearLongPress();
    setGhost(null);
    const dropIndex = hoverIndex;
    const droppedOnDiscard = hoverDiscard;
    const tackEl = tackHoverElRef.current;
    clearTackHover();
    setHoverIndex(null);
    setHoverDiscard(false);
    if (!d) return;

    if (!d.moved) {
      // Uzun basma zaten taşı ters çevirdi; ayrıca seçim yapılmaz.
      if (!d.longPressed) handleTileTap(d.tile);
      return;
    }

    if (tackEl) {
      if (onTackTile) {
        const target = { uid: tackEl.dataset.tackUid, groupIndex: Number(tackEl.dataset.tackIndex) };
        if (tackEl.dataset.tackReplaceTileId) target.replaceTileId = tackEl.dataset.tackReplaceTileId;
        else target.side = tackEl.dataset.tackSide;
        onTackTile(d.tile, target);
      }
      return;
    }

    if (droppedOnDiscard) {
      // Bir per'e ait olsa bile atarken sadece TEK taş atılır (grup bölünür).
      if (canDiscard && onDiscardTile) { setOptimisticDiscardId(d.tile.id); onDiscardTile(d.tile); }
      return;
    }

    if (dropIndex === null) return;

    // Yine BAYAT `baseRack` closure'u yerine ref'teki en güncel yerleşim
    // kullanılır (bkz. handlePointerDown'daki aynı gerekçe).
    const rackNow = baseRackRef.current;

    if (d.tileIds.length > 1) {
      // Blok, TUTULAN taş imlecin altındaki slota gelecek şekilde hizalanır.
      const start = Math.max(0, Math.min(dropIndex - d.grabOffset, RACK_SLOTS - d.tileIds.length));
      const newRack = moveGroupBlockToSlot(rackNow, d.tileIds, start);
      if (newRack !== rackNow) applyRack(newRack, safeGroups);
      return;
    }

    if (dropIndex === d.fromIndex) return;
    // Hedef, taşınmayan BAŞKA bir grubun taşıysa reddet (grup bölünmesin).
    const targetTile = rackNow[dropIndex];
    if (targetTile && groupOf[targetTile.id]) return;

    // Sabit slot fiziği: sadece hedef slot etkilenir, diğer taşlar ASLA kaymaz
    // (boşsa taş oraya gider, doluysa yer değiştirir).
    applyRack(moveTileToSlot(rackNow, d.fromIndex, dropIndex), safeGroups);
  };

  const renderRow = (rowIndex) => {
    const start = rowIndex * cols;
    const slots = displayRack.slice(start, start + cols);
    return (
      <div
        key={rowIndex}
        style={{ gap: `${gap}px`, padding: `${ROW_PADDING_PX}px` }}
        className="flex justify-center bg-emerald-950/40 rounded-lg border border-emerald-900/60"
      >
        {slots.map((tile, i) => {
          const index = start + i;
          const isHover = hoverIndex === index && dragRef.current?.moved;
          const hidden = tile && tile.id === optimisticDiscardId;
          const isPending = tile && tile.id === pendingTileId;
          return (
            <div
              key={index}
              data-slot-index={index}
              style={{ width: `${tileW}px`, height: `${tileH}px` }}
              className={`rounded-md flex items-center justify-center shrink-0 transition-colors ${isHover ? 'bg-yellow-400/30 ring-2 ring-yellow-400' : 'bg-black/10'}`}
              onPointerMove={handlePointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
            >
              {tile && !hidden && (
                <Tile
                  tile={tile}
                  width={tileW}
                  okeyInfo={okeyInfo}
                  selected={selected.has(tile.id)}
                  grouped={!!groupOf[tile.id]}
                  faceDown={flippedIds.has(tile.id)}
                  dragging={dragRef.current?.moved && dragRef.current?.tileIds.includes(tile.id)}
                  className={flipTileId === tile.id ? 'okey101-tile-reveal' : ''}
                  onPointerDown={isPending ? undefined : (e) => handlePointerDown(e, index, tile)}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // SOL/AT bölmeleri: geniş ekranda ıstakanın ÜSTÜNDE ayrı bir satırda durur.
  // KOMPAKT (telefon yatay) modda ise dikey alan çok kıymetli olduğu ve yatayda
  // bol yer bulunduğu için ıstakanın SOLUNA ve SAĞINA alınır — böylece taşlar
  // belirgin şekilde büyüyebilir.
  const sideSlotW = Math.round(tileW * SIDE_SLOT_RATIO);
  const sideSlotH = Math.round(sideSlotW * TILE_ASPECT);
  const sideTileW = Math.round(tileW * 1.05);

  const incomingSlot = (
    <div className="flex flex-col items-center gap-1">
      <div
        {...(canTakeIncoming && incomingDragHandlers ? incomingDragHandlers : {})}
        title={canTakeIncoming ? 'Solundaki oyuncunun attığı taşı çek (tıkla ya da ıstakaya sürükle)' : 'Solundaki oyuncunun son attığı taş'}
        style={{ width: `${sideSlotW}px`, height: `${sideSlotH}px` }}
        className={`rounded-lg border-2 border-dashed flex items-center justify-center transition-colors touch-none
          ${canTakeIncoming ? 'border-amber-400 bg-amber-400/10 animate-pulse cursor-grab active:cursor-grabbing' : 'border-slate-600/70 bg-slate-900/40'}`}
      >
        {incomingDiscard
          ? <Tile tile={incomingDiscard} width={sideTileW} okeyInfo={okeyInfo} dimmed={!canTakeIncoming} />
          : <span className="text-[8px] font-bold text-slate-500 text-center leading-tight px-0.5">BOŞ</span>}
      </div>
      <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">Soldan Çek</span>
    </div>
  );

  const discardSlot = (
    <div className="flex flex-col items-center gap-1">
      <div
        data-discard-zone={canDiscard ? 'true' : undefined}
        onPointerMove={canDiscard ? handlePointerMove : undefined}
        onPointerUp={canDiscard ? finishDrag : undefined}
        onPointerCancel={canDiscard ? finishDrag : undefined}
        title={canDiscard ? 'Turu bitirmek için bir taşı buraya sürükle' : 'Son attığın taş'}
        style={{ width: `${sideSlotW}px`, height: `${sideSlotH}px` }}
        className={`rounded-lg border-2 border-dashed flex items-center justify-center transition-colors touch-none
          ${canDiscard ? (hoverDiscard ? 'border-red-400 bg-red-500/30 scale-110' : 'border-amber-400 bg-amber-400/10 animate-pulse') : 'border-slate-600/70 bg-slate-900/40'}`}
      >
        {lastDiscardTile
          ? <Tile tile={lastDiscardTile} width={sideTileW} okeyInfo={okeyInfo} dimmed={!canDiscard} />
          : canDiscard
            ? <span className="text-[8px] font-bold text-amber-300/90 text-center leading-tight px-0.5">AT</span>
            : null}
      </div>
      <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">Sağa At</span>
    </div>
  );

  const rackRows = (
    <div className="flex flex-col w-full" style={{ gap: `${Math.max(3, Math.round(gap * 1.4))}px` }}>
      {Array.from({ length: rows }, (_, i) => renderRow(i))}
    </div>
  );

  return (
    <div
      className={`w-full flex flex-col items-center select-none ${compact ? 'gap-1' : 'gap-2'}`}
      onDragStart={(e) => e.preventDefault()}
    >
      {isOwner && (
        <div className={`w-full flex items-center justify-between gap-2 flex-wrap ${compact ? 'min-h-0' : 'min-h-8'}`}>
          <div className="flex items-center gap-2 flex-wrap">
            {canAttemptConfirm && (
              <button type="button" onClick={confirmGroup} className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/50 px-2.5 py-1 rounded-lg transition-colors">
                <Check className="w-3.5 h-3.5" /> Per Onayla
              </button>
            )}
            {canRemoveGroup && (
              <button type="button" onClick={removeGroup} className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/50 px-2.5 py-1 rounded-lg transition-colors">
                <X className="w-3.5 h-3.5" /> Onayı Kaldır
              </button>
            )}
          </div>

          {allSelectedAreCompleteGroups && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={openSeries}
                disabled={!canOpenSeries}
                title={!canOpenMeldsRule ? 'Çift açtığın için per (seri/set) açamazsın' : (!canAct ? 'Sadece kendi sıranda, taş çektikten sonra' : undefined)}
                className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-500/50 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Rows3 className="w-3.5 h-3.5" /> Seri Aç
              </button>
              <button
                type="button"
                onClick={openPairs}
                disabled={!canOpenPairs}
                title={!canOpenPairsRule ? 'Masada çift açan biri olmadan çift işleyemezsin' : (!canAct ? 'Sadece kendi sıranda, taş çektikten sonra' : (hasOpenedAlready ? 'Seçili çiftleri masaya sür' : 'Tam 5 çift seçmelisin'))}
                className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-fuchsia-600/20 hover:bg-fuchsia-600/40 text-fuchsia-300 border border-fuchsia-500/50 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Layers className="w-3.5 h-3.5" /> {pairsButtonLabel}
              </button>
            </div>
          )}
        </div>
      )}

      {/* SOL: solumdaki oyuncunun bana attığı taş (buradan çekerim) — SAĞ: sağımdaki
          oyuncuya atacağım taş (buraya sürüklerim). */}
      {isOwner && ready && !compact && (
        <div className="w-full flex items-end justify-between gap-2">
          {incomingSlot}
          {discardSlot}
        </div>
      )}

      {compact && isOwner ? (
        <div ref={rackWrapRef} className="w-full flex items-center justify-center gap-1.5">
          {ready && incomingSlot}
          <div className="flex-1 min-w-0">{ready && rackRows}</div>
          {ready && discardSlot}
        </div>
      ) : (
        <div ref={rackWrapRef} className="w-full">
          {ready && rackRows}
        </div>
      )}

      {/* Sürükleme hayaleti: bir per taşınıyorsa TÜM per soluk şekilde imleci takip
          eder, tutulan taş tam imlecin altında kalacak biçimde hizalanır. */}
      {ghost && (
        <div
          className="fixed z-[4000] pointer-events-none opacity-80"
          style={{ left: ghost.x, top: ghost.y, transform: `translate(calc(-50% - ${ghost.grabOffset * (tileW + gap)}px), -50%)` }}
        >
          <div className="flex items-center" style={{ gap: `${gap}px` }}>
            {ghost.tiles.map((tl) => (
              <Tile key={tl.id} tile={tl} okeyInfo={okeyInfo} width={tileW} faceDown={flippedIds.has(tl.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
