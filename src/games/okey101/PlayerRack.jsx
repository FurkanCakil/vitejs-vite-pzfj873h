import React, { useMemo, useRef, useState } from 'react';
import { Check, X, Layers, Rows3 } from 'lucide-react';
import Tile from './Tile.jsx';
import { RACK_ROW_LENGTH, RACK_SLOTS, reorderRow, moveGroupBlock, isContiguousSelection, isOkeyTile } from './tiles.js';

const DRAG_THRESHOLD_PX = 6;
const TACK_HOVER_STYLE = { backgroundColor: 'rgba(251,191,36,0.55)' };

// Oyuncunun kendi ıstakası: taş seçimi (per onaylamak / seri-çift açmak için),
// sürükle-bırak ile yeniden sıralama, gruplanmış (per) taşların bir blok
// halinde birlikte hareket etmesi, (canAct açıkken) taşı ıstaka dışına
// sürükleyip atma (discard), ve (hasOpened + canAct iken) masadaki açık
// perlere tek taş işleme (tacking) burada yönetilir. Sadece sahibi (isOwner)
// etkileşime girebilir.
export default function PlayerRack({ rack, groups, isOwner, onUpdateRack, okeyInfo, canAct = false, hasOpenedAlready = false, onDiscardTile, onOpenSeries, onOpenPairs, onTackTile }) {
  const safeRack = rack && rack.length === RACK_SLOTS ? rack : Array(RACK_SLOTS).fill(null);
  const safeGroups = groups || {};

  const [selected, setSelected] = useState(() => new Set());
  const [hoverIndex, setHoverIndex] = useState(null);
  const [hoverDiscard, setHoverDiscard] = useState(false);
  const [ghost, setGhost] = useState(null); // { x, y, tile, count }
  const dragRef = useRef(null);
  const tackHoverElRef = useRef(null);

  const groupOf = useMemo(() => {
    const map = {};
    Object.entries(safeGroups).forEach(([gid, tileIds]) => tileIds.forEach((tid) => { map[tid] = gid; }));
    return map;
  }, [safeGroups]);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const allUngrouped = selectedIds.length > 0 && selectedIds.every((id) => !groupOf[id]);
  const contiguous = allUngrouped && isContiguousSelection(selectedIds, safeRack);
  const canConfirmGroup = allUngrouped && contiguous && selectedIds.length >= 2;

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
  const canOpenSeries = allSelectedAreCompleteGroups && selectedGroupIds.length >= 1 && canAct;
  const canOpenPairs = allSelectedAreCompleteGroups && selectedGroupIds.length === 5 && canAct && !hasOpenedAlready;

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

  const confirmGroup = () => {
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
    const gid = groupOf[tile.id];
    const tileIds = gid ? (safeGroups[gid] || [tile.id]) : [tile.id];
    dragRef.current = { fromIndex: index, tileIds, startX: e.clientX, startY: e.clientY, moved: false, tile };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX; const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) d.moved = true;
    if (!d.moved) return;

    setGhost({ x: e.clientX, y: e.clientY, tile: d.tile, count: d.tileIds.length });

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const slotEl = el?.closest('[data-slot-index]');
    const discardEl = el?.closest('[data-discard-zone]');
    const tackEl = (canAct && hasOpenedAlready && d.tileIds.length === 1) ? el?.closest('[data-tack-uid]') : null;

    if (tackEl !== tackHoverElRef.current) { clearTackHover(); if (tackEl) { tackEl.style.backgroundColor = TACK_HOVER_STYLE.backgroundColor; tackHoverElRef.current = tackEl; } }

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
        onTackTile(d.tile, { uid: tackEl.dataset.tackUid, groupIndex: Number(tackEl.dataset.tackIndex), side: tackEl.dataset.tackSide });
      }
      return;
    }

    if (droppedOnDiscard) {
      // Bir per'e ait olsa bile atarken sadece TEK taş atılır (grup bölünür).
      if (canAct && onDiscardTile) onDiscardTile(d.tile);
      return;
    }

    if (dropIndex === null || dropIndex === d.fromIndex) return;

    // Hedef, taşınmayan BAŞKA bir grubun taşıysa reddet (grup bölünmesin).
    const targetTile = safeRack[dropIndex];
    if (targetTile) {
      const targetGid = groupOf[targetTile.id];
      if (targetGid && !d.tileIds.includes(targetTile.id)) return;
    }

    const newRack = d.tileIds.length > 1
      ? moveGroupBlock(safeRack, d.tileIds, dropIndex)
      : reorderRow(safeRack, d.fromIndex, dropIndex);
    onUpdateRack(newRack, safeGroups);
  };

  const renderRow = (rowIndex) => {
    const start = rowIndex * RACK_ROW_LENGTH;
    const slots = safeRack.slice(start, start + RACK_ROW_LENGTH);
    return (
      <div key={rowIndex} className="flex gap-1 sm:gap-1.5 justify-center bg-emerald-950/40 rounded-lg p-1.5 sm:p-2 border border-emerald-900/60">
        {slots.map((tile, i) => {
          const index = start + i;
          const isHover = hoverIndex === index && dragRef.current?.moved;
          return (
            <div
              key={index}
              data-slot-index={index}
              className={`w-9 h-12 sm:w-11 sm:h-16 rounded-md flex items-center justify-center shrink-0 transition-colors ${isHover ? 'bg-yellow-400/30 ring-2 ring-yellow-400' : 'bg-black/10'}`}
              onPointerMove={handlePointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
            >
              {tile && (
                <Tile
                  tile={tile}
                  selected={selected.has(tile.id)}
                  grouped={!!groupOf[tile.id]}
                  isOkey={isOkeyTile(tile, okeyInfo)}
                  dragging={dragRef.current?.moved && dragRef.current?.tileIds.includes(tile.id)}
                  onPointerDown={(e) => handlePointerDown(e, index, tile)}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="w-full flex flex-col items-center gap-3">
      {isOwner && (
        <div className="min-h-9 flex items-center justify-center gap-2 flex-wrap">
          {canConfirmGroup && (
            <button type="button" onClick={confirmGroup} className="flex items-center gap-1.5 text-xs font-bold bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/50 px-3 py-1.5 rounded-lg transition-colors">
              <Check className="w-3.5 h-3.5" /> Per Onayla
            </button>
          )}
          {canRemoveGroup && (
            <button type="button" onClick={removeGroup} className="flex items-center gap-1.5 text-xs font-bold bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/50 px-3 py-1.5 rounded-lg transition-colors">
              <X className="w-3.5 h-3.5" /> Onayı Kaldır
            </button>
          )}
          {allSelectedAreCompleteGroups && (
            <>
              <button
                type="button"
                onClick={openSeries}
                disabled={!canOpenSeries}
                title={!canAct ? 'Sadece kendi sıranda, taş çektikten sonra' : undefined}
                className="flex items-center gap-1.5 text-xs font-bold bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-500/50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Rows3 className="w-3.5 h-3.5" /> Seri Aç
              </button>
              <button
                type="button"
                onClick={openPairs}
                disabled={!canOpenPairs}
                title={hasOpenedAlready ? 'Zaten elini açtın' : (!canAct ? 'Sadece kendi sıranda, taş çektikten sonra' : 'Tam 5 çift seçmelisin')}
                className="flex items-center gap-1.5 text-xs font-bold bg-fuchsia-600/20 hover:bg-fuchsia-600/40 text-fuchsia-300 border border-fuchsia-500/50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Layers className="w-3.5 h-3.5" /> Çift Aç
              </button>
            </>
          )}
        </div>
      )}

      <div className="w-full max-w-2xl flex flex-col gap-1.5 sm:gap-2 overflow-x-auto pb-1">
        {renderRow(0)}
        {renderRow(1)}
      </div>

      {isOwner && canAct && (
        <div
          data-discard-zone="true"
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          className={`w-full max-w-xs rounded-xl border-2 border-dashed px-4 py-3 text-center text-xs font-bold uppercase tracking-widest transition-colors ${hoverDiscard ? 'border-red-400 bg-red-500/20 text-red-200' : 'border-slate-600 text-slate-400'}`}
        >
          Turu bitirmek için bir taşı buraya sürükle
        </div>
      )}

      {ghost && (
        <div className="fixed z-[4000] pointer-events-none" style={{ left: ghost.x - 20, top: ghost.y - 28 }}>
          <div className="relative">
            <Tile tile={ghost.tile} />
            {ghost.count > 1 && (
              <span className="absolute -top-2 -right-2 bg-indigo-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{ghost.count}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
