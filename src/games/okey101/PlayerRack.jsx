import React, { useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import Tile from './Tile.jsx';
import { RACK_ROW_LENGTH, RACK_SLOTS, reorderRow, moveGroupBlock, isContiguousSelection } from './tiles.js';

const DRAG_THRESHOLD_PX = 6;

// Oyuncunun kendi ıstakası: taş seçimi (per onaylamak için), sürükle-bırak ile
// yeniden sıralama, ve gruplanmış (per) taşların bir blok halinde birlikte
// hareket etmesi burada yönetilir. Sadece sahibi (isOwner) etkileşime girebilir.
export default function PlayerRack({ rack, groups, isOwner, onUpdateRack }) {
  const safeRack = rack && rack.length === RACK_SLOTS ? rack : Array(RACK_SLOTS).fill(null);
  const safeGroups = groups || {};

  const [selected, setSelected] = useState(() => new Set());
  const [hoverIndex, setHoverIndex] = useState(null);
  const [ghost, setGhost] = useState(null); // { x, y, tile, count }
  const dragRef = useRef(null);
  const slotRefs = useRef([]);

  const groupOf = useMemo(() => {
    const map = {};
    Object.entries(safeGroups).forEach(([gid, tileIds]) => tileIds.forEach((tid) => { map[tid] = gid; }));
    return map;
  }, [safeGroups]);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const allUngrouped = selectedIds.length > 0 && selectedIds.every((id) => !groupOf[id]);
  const allSameExistingGroup = selectedIds.length > 0 && selectedIds.every((id) => groupOf[id] && groupOf[id] === groupOf[selectedIds[0]]);
  const contiguous = allUngrouped && isContiguousSelection(selectedIds, safeRack);
  const canConfirmGroup = allUngrouped && contiguous && selectedIds.length >= 2;
  const canRemoveGroup = allSameExistingGroup;

  const commit = (newRack, newGroups) => {
    setSelected(new Set());
    onUpdateRack(newRack, newGroups ?? safeGroups);
  };

  const handleTileTap = (tile) => {
    if (!isOwner) return;
    const gid = groupOf[tile.id];
    if (gid) {
      const groupTileIds = safeGroups[gid] || [];
      const alreadyFullySelected = groupTileIds.length > 0 && groupTileIds.every((id) => selected.has(id)) && selected.size === groupTileIds.length;
      setSelected(alreadyFullySelected ? new Set() : new Set(groupTileIds));
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
    setHoverIndex(slotEl ? Number(slotEl.dataset.slotIndex) : null);
  };

  const finishDrag = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    setGhost(null);
    const dropIndex = hoverIndex;
    setHoverIndex(null);
    if (!d) return;

    if (!d.moved) {
      handleTileTap(d.tile);
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
              ref={(el) => { slotRefs.current[index] = el; }}
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
        <div className="h-9 flex items-center justify-center gap-2">
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
        </div>
      )}

      <div className="w-full max-w-2xl flex flex-col gap-1.5 sm:gap-2 overflow-x-auto pb-1">
        {renderRow(0)}
        {renderRow(1)}
      </div>

      {ghost && (
        <div
          className="fixed z-[4000] pointer-events-none"
          style={{ left: ghost.x - 20, top: ghost.y - 28 }}
        >
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
