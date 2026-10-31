import { mergeRackLayout, pruneGroups } from './tiles.js';

// Layout IDs never create tiles. Membership and tile values always come from
// the authoritative private hand, including after reconnect or a new draw.
export function personalHand(hand, layout) {
  if (!hand || !layout || hand.roundId !== layout.roundId || !Array.isArray(layout.rack) || layout.rack.length !== 30) return hand;
  const byId = new Map(hand.rack.filter(Boolean).map(tile => [tile.id, tile]));
  const rack = mergeRackLayout(hand.rack, layout.rack.map(id => byId.get(id) ?? null));
  return { ...hand, rack, groups: pruneGroups(layout.groups, rack) };
}

export function previewDiscard(room, uid, pending) {
  if (!room || !pending || room.roundId !== pending.roundId || room.playVersion !== pending.playVersion) return room;
  const rack = room.racks?.[uid];
  const tile = rack?.find(tile => tile?.id === pending.tileId);
  if (!tile) return room;
  const nextRack = rack.map(item => item?.id === tile.id ? null : item);
  return { ...room, racks: { ...room.racks, [uid]: nextRack },
    groups: { ...room.groups, [uid]: pruneGroups(room.groups?.[uid], nextRack) },
    discardPiles: { ...room.discardPiles, [uid]: [...(room.discardPiles?.[uid] ?? []), tile] } };
}
