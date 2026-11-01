import React, { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import { gameErrorMessage } from '../../utils/gameApi.js';
import Okey101Game from './Okey101Game.jsx';
import { startOkeyAutoAdvance } from './okeyAutoAdvance.js';
import { gamePerformance } from '../../utils/gamePerformance.js';
import { useGamePerformance } from '../../hooks/useGamePerformance.js';
import { personalHand, previewDiscard } from './personalLayout.js';
import { pruneGroups } from './tiles.js';

export default function ServerOkey101Game({ roomData, roomCode, user, db, appId, leaveRoom, sendAction }) {
  const [own, setOwn] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [arrangement, setArrangement] = useState(null), [pendingMove, setPendingMove] = useState(null);
  const moveLock = useRef(false);
  const latest = useRef({ roomData, own, sendAction }); latest.current = { roomData, own, sendAction };
  const chain = useRef(Promise.resolve()), stopped = useRef(false), waiters = useRef(new Set()), autoAdvance = useRef(null);
  const confirmedView = useRef(null);
  const isPlayer = roomData.players.includes(user.uid);
  const coherent = !roomData.hasDealt || !isPlayer || (own?.roundId === roomData.roundId
    && own.handVersion === roomData.handVersions?.[user.uid]);
  useGamePerformance(roomCode, 'okey101', roomData.version, coherent);
  useEffect(() => {
    stopped.current = false;
    const pending = waiters.current;
    return () => { stopped.current = true; for (const resolve of pending) resolve(); pending.clear(); };
  }, []);
  useEffect(() => {
    setOwn(null);
    if (!isPlayer) return undefined;
    return onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'roomsV2', roomCode, 'playerData', user.uid),
      snapshot => {
        const data = snapshot.exists() ? snapshot.data() : null;
        gamePerformance.privateSnapshot(roomCode, data, snapshot.metadata.fromCache);
        setOwn(data);
      },
      issue => { if (!stopped.current) setError(gameErrorMessage(issue)); });
  }, [db, appId, roomCode, user.uid, isPlayer]);
  useEffect(() => {
    setArrangement(null);
    if (!isPlayer) return undefined;
    return onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'roomsV2', roomCode, 'playerLayouts', user.uid),
      snap => setArrangement(snap.exists() ? snap.data() : null),
      issue => { if (!stopped.current) setError(gameErrorMessage(issue)); });
  }, [db, appId, roomCode, user.uid, isPlayer]);
  useEffect(() => {
    if (coherent) for (const resolve of waiters.current) resolve();
  }, [roomData.version, coherent]);
  const waitForSnapshot = version => {
    const current = latest.current;
    const ready = () => current.roomData.version >= version && (!current.roomData.hasDealt || !current.roomData.players.includes(user.uid)
      || (current.own?.roundId === current.roomData.roundId && current.own.handVersion === current.roomData.handVersions?.[user.uid]));
    if (ready() || stopped.current) return Promise.resolve();
    return new Promise(resolve => {
      const check = () => {
        if (stopped.current) { finish(); return; }
        const next = latest.current;
        if (next.roomData.version >= version && (!next.roomData.hasDealt || !next.roomData.players.includes(user.uid)
          || (next.own?.roundId === next.roomData.roundId && next.own.handVersion === next.roomData.handVersions?.[user.uid]))) finish();
      };
      const finish = () => { clearTimeout(timer); waiters.current.delete(check); resolve(); };
      const timer = setTimeout(finish, 6000); waiters.current.add(check);
    });
  };
  const send = useCallback((type, fields = {}, quiet = false, suppliedTrace = null) => {
    const moving = type === 'okey.draw' || type === 'okey.discard';
    if (moving) {
      if (moveLock.current) return Promise.resolve({ success: false });
      moveLock.current = true;
      setBusy(true);
      const data = latest.current.roomData;
      setPendingMove({ type, tileId: fields.tileId, roundId: data.roundId, playVersion: data.playVersion });
    }
    const trace = suppliedTrace ?? gamePerformance.start(type, roomCode);
    const roundId = latest.current.roomData.roundId, turnNumber = latest.current.roomData.turnNumber;
    const job = async () => {
      if (stopped.current) { if (moving) moveLock.current = false; gamePerformance.cancel(trace); return { success: false }; }
      gamePerformance.execute(trace);
      const interactive = !['okey.layout', 'okey.tick', 'okey.start'].includes(type);
      if (interactive) setBusy(true);
      if (!quiet) setError('');
      try {
        const current = latest.current, payload = { ...fields };
        const oldTileIds = new Set((current.own?.rack ?? []).filter(Boolean).map(tile => tile.id));
        if (type === 'okey.layout' && current.own) {
          payload.rack = payload.rack.map(id => oldTileIds.has(id) ? id : null);
          payload.groups = pruneGroups(payload.groups, current.own.rack);
        }
        if (['okey.layout', 'okey.draw', 'okey.discard', 'okey.cancel', 'okey.open', 'okey.tack', 'okey.tick', 'okey.newRound'].includes(type)) payload.roundId = roundId;
        if (['okey.draw', 'okey.discard', 'okey.cancel', 'okey.open', 'okey.tack'].includes(type)) {
          payload.turnNumber = turnNumber; payload.expectedPlayVersion = current.roomData.playVersion;
        }
        if (['okey.rules', 'okey.team', 'okey.distribute', 'okey.bots', 'okey.start', 'okey.tick', 'okey.seat.resolve'].includes(type)) payload.expectedVersion = current.roomData.version;
        if (type === 'okey.open' && fields.groupIds) {
          payload.melds = fields.groupIds.map(id => current.own?.groups?.[id] ?? []); delete payload.groupIds;
        }
        const result = await current.sendAction(type === 'okey.layout' ? 'okey.arrange' : type, payload, { trace });
        const waitAt = trace ? performance.now() : 0;
        await waitForSnapshot(result.version);
        if (trace) gamePerformance.add(trace, 'command_snapshot_barrier_ms', performance.now() - waitAt);
        if (!stopped.current && result.penalized) setError('Açılış barajına ulaşamadın. +101 ceza yazıldı.');
        const drawnTileId = type === 'okey.draw' ? latest.current.own?.rack?.find(tile => tile && !oldTileIds.has(tile.id))?.id : null;
        return { success: true, ...result, drawnTileId };
      } catch (issue) {
        gamePerformance.fail(trace, issue.code);
        const obsoleteLayout = type === 'okey.layout' && ['tile_not_owned', 'stale_round', 'round_finished', 'game_not_playing'].includes(issue.code);
        if (!stopped.current && !obsoleteLayout && (!quiet || !['too_early', 'stale_version', 'stale_round', 'round_finished', 'game_not_playing'].includes(issue.code))) setError(gameErrorMessage(issue));
        return { success: false };
      } finally {
        if (moving) { moveLock.current = false; if (!stopped.current) setPendingMove(null); }
        if (interactive && !stopped.current) setBusy(false);
      }
    };
    // PlayerRack already serializes visual writes. They must not hold up a move.
    const result = type === 'okey.layout' ? job() : chain.current.then(job);
    if (type !== 'okey.layout') chain.current = result.catch(() => {});
    return result;
    // Ref-backed state binds the displayed round/turn at click time, while
    // serialized layout/open commands wait for their confirmed own hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!isPlayer) return undefined;
    const scheduler = startOkeyAutoAdvance({ read: () => latest.current.roomData, uid: user.uid, send: type => send(type, {}, true) });
    autoAdvance.current = scheduler;
    return () => { scheduler.stop(); autoAdvance.current = null; };
  }, [isPlayer, user.uid, send]);
  useEffect(() => { autoAdvance.current?.notify(); }, [roomData.version]);
  const arranged = personalHand(own, arrangement);
  const merged = { ...roomData,
    // Placeholder deck slots carry counts only; no tile identities are known.
    drawPile: Array(roomData.drawPileCount ?? 0).fill(null),
    racks: roomData.hasDealt ? (isPlayer && coherent ? { [user.uid]: arranged.rack } : {}) : undefined,
    groups: isPlayer && coherent && arranged ? { [user.uid]: arranged.groups } : {},
  };
  if (coherent) confirmedView.current = merged;
  const confirmed = coherent ? merged : confirmedView.current?.roundId === roomData.roundId ? confirmedView.current : null;
  const display = previewDiscard(confirmed, user.uid, pendingMove?.type === 'okey.discard' ? pendingMove : null);
  return <>
    {pendingMove && <div role="status" className="flex items-center gap-2 text-sm text-amber-200"><Loader2 className="w-4 h-4 animate-spin" />{pendingMove.type === 'okey.draw' ? 'Taş çekiliyor…' : 'Taş gönderiliyor…'}</div>}
    {error && <div role="alert" className="w-full max-w-3xl border border-amber-500/50 bg-amber-950/90 text-amber-100 rounded-xl p-3 text-sm">{error}</div>}
    {!display
      ? <div className="flex items-center gap-2 p-8 text-slate-300"><Loader2 className="w-5 h-5 animate-spin" /> Elin güncelleniyor…</div>
      : <Okey101Game roomData={display} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} sendAction={send} serverBusy={busy || !coherent} />}
  </>;
}
