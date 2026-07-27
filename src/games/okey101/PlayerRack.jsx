import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, X, Layers, Rows3 } from 'lucide-react';
import Tile, { TILE_ASPECT } from './Tile.jsx';
import { RACK_ROW_LENGTH, RACK_SLOTS, normalizeRack, moveTileToSlot, moveGroupBlockToSlot, isContiguousSelection, isOkeyTile } from './tiles.js';
import { validateGroup, isProperlyOrderedGroup } from './gameLogic.js';

const DRAG_THRESHOLD_PX = 6;
const TACK_HOVER_COLOR = 'rgba(251,191,36,0.55)';

// Istaka, 15 sütunu HER ZAMAN kullanılabilir genişliğe sığdırır: taş genişliği
// konteynerden ölçülerek hesaplanır (bkz. useRackMetrics). Böylece ne telefonda
// (dikey/yatay) ne de tam ekranda alta yatay kaydırma çubuğu çıkar.
const GAP_RATIO = 0.13;      // taş genişliğine oranla slotlar arası boşluk
const ROW_PADDING_PX = 6;    // satır kutusunun kendi iç boşluğu (tek yan)
const MIN_TILE_W = 13;       // çok dar telefonlarda bile okunur alt sınır
const MAX_TILE_W = 60;       // çok geniş ekranlarda absürt büyümeyi engeller

function useRackMetrics() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  const metrics = useMemo(() => {
    // usable = N*w + (N-1)*(w*GAP_RATIO)  ->  w = usable / (N + (N-1)*GAP_RATIO)
    // (satırın 1px kenarlığı + yuvarlama payı için 4px emniyet düşülür)
    const usable = Math.max(0, width - ROW_PADDING_PX * 2 - 4);
    const raw = usable / (RACK_ROW_LENGTH + (RACK_ROW_LENGTH - 1) * GAP_RATIO);
    const tileW = Math.max(MIN_TILE_W, Math.min(MAX_TILE_W, Math.floor(raw) || MIN_TILE_W));
    return { tileW, tileH: Math.round(tileW * TILE_ASPECT), gap: Math.max(2, Math.floor(tileW * GAP_RATIO)) };
  }, [width]);

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
  pendingDraw = null, flipTileId = null,
  onDiscardTile, onOpenSeries, onOpenPairs, onTackTile, showToast,
}) {
  const safeRack = useMemo(() => normalizeRack(rack), [rack]);
  const safeGroups = groups || {};
  const { ref: rackWrapRef, ready, tileW, tileH, gap } = useRackMetrics();

  const [selected, setSelected] = useState(() => new Set());
  const [hoverIndex, setHoverIndex] = useState(null);
  const [hoverDiscard, setHoverDiscard] = useState(false);
  const [ghost, setGhost] = useState(null); // { x, y, tiles }
  // Atma anında Firestore turu tamamlanana kadar taşı ıstakadan İYİMSER
  // (optimistic) olarak gizler — algılanan gecikmeyi azaltır. `rack` propu
  // gerçek veriyle güncellenince (taş gerçekten gitmiş olur) otomatik temizlenir.
  const [optimisticDiscardId, setOptimisticDiscardId] = useState(null);
  useEffect(() => { setOptimisticDiscardId(null); }, [rack]);
  const dragRef = useRef(null);
  const tackHoverElRef = useRef(null);

  // Çekilen taş, sunucu cevabı beklenmeden bırakıldığı slotta gösterilir
  // (bkz. Okey101Game#performDraw). Gerçek veri gelince prop kendiliğinden
  // düşer ve aşağıdaki birleştirme etkisiz kalır.
  // Taş gerçek ıstakada (hangi slotta olursa olsun) göründüğü an iyimser
  // kopya devre dışı kalır — aksi halde sunucu taşı farklı bir slota yazarsa
  // bir kare boyunca çift görünürdü.
  const pendingVisible = !!pendingDraw
    && !safeRack[pendingDraw.index]
    && !safeRack.some((t) => t && t.id === pendingDraw.tile.id);
  const displayRack = useMemo(() => {
    if (!pendingVisible) return safeRack;
    const next = [...safeRack];
    next[pendingDraw.index] = pendingDraw.tile;
    return next;
  }, [safeRack, pendingDraw, pendingVisible]);
  const pendingTileId = pendingVisible ? pendingDraw.tile.id : null;

  const groupOf = useMemo(() => {
    const map = {};
    Object.entries(safeGroups).forEach(([gid, tileIds]) => tileIds.forEach((tid) => { map[tid] = gid; }));
    return map;
  }, [safeGroups]);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const allUngrouped = selectedIds.length > 0 && selectedIds.every((id) => !groupOf[id]);
  const contiguous = allUngrouped && isContiguousSelection(selectedIds, safeRack);
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
    onUpdateRack(newRack, newGroups ?? safeGroups);
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
      const orderedTiles = safeRack.filter((t) => t && selected.has(t.id));
      const result = validateGroup(orderedTiles, okeyInfo);
      if (!result.valid) { showToast?.('Geçersiz Per Dizilimi!', 'red'); return; }
      if (!isProperlyOrderedGroup(orderedTiles, result.type, okeyInfo)) {
        showToast?.('Perinizi düzgün diziniz!', 'red');
        return;
      }
    }
    const gid = `G${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const ordered = safeRack.filter((t) => t && selected.has(t.id)).map((t) => t.id);
    commit(safeRack, { ...safeGroups, [gid]: ordered });
  };

  const removeGroup = () => {
    const gid = groupOf[selectedIds[0]];
    const nextGroups = { ...safeGroups };
    delete nextGroups[gid];
    commit(safeRack, nextGroups);
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

    const gid = groupOf[tile.id];
    const tileIds = gid ? (safeGroups[gid] || [tile.id]) : [tile.id];
    // Grup içinde TUTULAN taşın kaçıncı sırada olduğu: bırakırken blok, imlecin
    // altındaki slot bu taşa denk gelecek şekilde konumlanır. Böylece per'i
    // ortasından tutup boş alanın ortasına bırakmak da doğru çalışır.
    const grabOffset = Math.max(0, tileIds.indexOf(tile.id));
    const tiles = tileIds.map((id) => safeRack.find((t) => t && t.id === id)).filter(Boolean);
    dragRef.current = { fromIndex: index, tileIds, grabOffset, startX: e.clientX, startY: e.clientY, moved: false, tile, tiles };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX; const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) d.moved = true;
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
    setGhost(null);
    const dropIndex = hoverIndex;
    const droppedOnDiscard = hoverDiscard;
    const tackEl = tackHoverElRef.current;
    clearTackHover();
    setHoverIndex(null);
    setHoverDiscard(false);
    if (!d) return;

    if (!d.moved) {
      handleTileTap(d.tile);
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

    if (d.tileIds.length > 1) {
      // Blok, TUTULAN taş imlecin altındaki slota gelecek şekilde hizalanır.
      const start = Math.max(0, Math.min(dropIndex - d.grabOffset, RACK_SLOTS - d.tileIds.length));
      const newRack = moveGroupBlockToSlot(safeRack, d.tileIds, start);
      if (newRack !== safeRack) onUpdateRack(newRack, safeGroups);
      return;
    }

    if (dropIndex === d.fromIndex) return;
    // Hedef, taşınmayan BAŞKA bir grubun taşıysa reddet (grup bölünmesin).
    const targetTile = safeRack[dropIndex];
    if (targetTile && groupOf[targetTile.id]) return;

    // Sabit slot fiziği: sadece hedef slot etkilenir, diğer taşlar ASLA kaymaz
    // (boşsa taş oraya gider, doluysa yer değiştirir).
    onUpdateRack(moveTileToSlot(safeRack, d.fromIndex, dropIndex), safeGroups);
  };

  const renderRow = (rowIndex) => {
    const start = rowIndex * RACK_ROW_LENGTH;
    const slots = displayRack.slice(start, start + RACK_ROW_LENGTH);
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
                  isOkey={isOkeyTile(tile, okeyInfo)}
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

  // SOL/AT bölmeleri artık ıstakanın ÜSTÜNDE ayrı bir satırda (üst üste binmeden)
  // durur — taş seçilince hafifçe yukarı kalktığı için eskiden bu bölmelerle
  // çakışıyordu. Bir taş boyundan biraz büyük tutulur ki hedef alan rahat olsun.
  const sideSlotW = Math.round(tileW * 1.25);
  const sideSlotH = Math.round(sideSlotW * TILE_ASPECT);
  const sideTileW = Math.round(tileW * 1.05);

  return (
    <div
      className="w-full flex flex-col items-center gap-2 select-none"
      onDragStart={(e) => e.preventDefault()}
    >
      {isOwner && (
        <div className="w-full min-h-8 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {canAttemptConfirm && (
              <button type="button" onClick={confirmGroup} className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/50 px-2.5 py-1.5 rounded-lg transition-colors">
                <Check className="w-3.5 h-3.5" /> Per Onayla
              </button>
            )}
            {canRemoveGroup && (
              <button type="button" onClick={removeGroup} className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/50 px-2.5 py-1.5 rounded-lg transition-colors">
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
                className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-500/50 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Rows3 className="w-3.5 h-3.5" /> Seri Aç
              </button>
              <button
                type="button"
                onClick={openPairs}
                disabled={!canOpenPairs}
                title={!canOpenPairsRule ? 'Masada çift açan biri olmadan çift işleyemezsin' : (!canAct ? 'Sadece kendi sıranda, taş çektikten sonra' : (hasOpenedAlready ? 'Seçili çiftleri masaya sür' : 'Tam 5 çift seçmelisin'))}
                className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-fuchsia-600/20 hover:bg-fuchsia-600/40 text-fuchsia-300 border border-fuchsia-500/50 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Layers className="w-3.5 h-3.5" /> {pairsButtonLabel}
              </button>
            </div>
          )}
        </div>
      )}

      {/* SOL: solumdaki oyuncunun bana attığı taş (buradan çekerim) — SAĞ: sağımdaki
          oyuncuya atacağım taş (buraya sürüklerim). Istakanın üstünde, taşlarla
          çakışmayacak kadar uzakta duran ayrı bir şerit. */}
      {isOwner && ready && (
        <div className="w-full flex items-end justify-between gap-2">
          <div className="flex flex-col items-center gap-1">
            <div
              {...(canTakeIncoming && incomingDragHandlers ? incomingDragHandlers : {})}
              title={canTakeIncoming ? 'Solundaki oyuncunun attığı taşı çek (tıkla ya da ıstakaya sürükle)' : 'Solundaki oyuncunun son attığı taş'}
              style={{ width: `${sideSlotW}px`, height: `${sideSlotH}px` }}
              className={`rounded-lg border-2 border-dashed flex items-center justify-center transition-colors touch-none
                ${canTakeIncoming ? 'border-amber-400 bg-amber-400/10 animate-pulse cursor-grab active:cursor-grabbing' : 'border-slate-600/70 bg-slate-900/40'}`}
            >
              {incomingDiscard
                ? <Tile tile={incomingDiscard} width={sideTileW} okeyInfo={okeyInfo} isOkey={isOkeyTile(incomingDiscard, okeyInfo)} dimmed={!canTakeIncoming} />
                : <span className="text-[8px] font-bold text-slate-500 text-center leading-tight px-0.5">BOŞ</span>}
            </div>
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500">Soldan Çek</span>
          </div>

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
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500">Sağa At</span>
          </div>
        </div>
      )}

      <div ref={rackWrapRef} className="w-full">
        {ready && (
          <div className="flex flex-col" style={{ gap: `${Math.max(4, Math.round(gap * 1.4))}px` }}>
            {renderRow(0)}
            {renderRow(1)}
          </div>
        )}
      </div>

      {/* Sürükleme hayaleti: bir per taşınıyorsa TÜM per soluk şekilde imleci takip
          eder, tutulan taş tam imlecin altında kalacak biçimde hizalanır. */}
      {ghost && (
        <div
          className="fixed z-[4000] pointer-events-none opacity-80"
          style={{ left: ghost.x, top: ghost.y, transform: `translate(calc(-50% - ${ghost.grabOffset * (tileW + gap)}px), -50%)` }}
        >
          <div className="flex items-center" style={{ gap: `${gap}px` }}>
            {ghost.tiles.map((tl) => (
              <Tile key={tl.id} tile={tl} okeyInfo={okeyInfo} width={tileW} isOkey={isOkeyTile(tl, okeyInfo)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
