import React, { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import { gameErrorMessage } from '../../utils/gameApi.js';
import Okey101Game from './Okey101Game.jsx';
import { okeyAutoAction } from './okeyTiming.js';
import { gamePerformance } from '../../utils/gamePerformance.js';
import { useGamePerformance } from '../../hooks/useGamePerformance.js';

export default function ServerOkey101Game({ roomData, roomCode, user, db, appId, leaveRoom, sendAction }) {
  const [own, setOwn] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const latest = useRef({ roomData, own, sendAction }); latest.current = { roomData, own, sendAction };
  const chain = useRef(Promise.resolve()), inFlight = useRef(false), stopped = useRef(false), waiters = useRef(new Set());
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
    const trace = suppliedTrace ?? gamePerformance.start(type, roomCode);
    const roundId = latest.current.roomData.roundId, turnNumber = latest.current.roomData.turnNumber;
    const job = async () => {
      if (stopped.current) { gamePerformance.cancel(trace); return { success: false }; }
      gamePerformance.execute(trace);
      const interactive = !['okey.layout', 'okey.tick', 'okey.start'].includes(type);
      if (interactive) setBusy(true);
      if (!quiet) setError('');
      try {
        const current = latest.current, payload = { ...fields };
        const oldTileIds = new Set((current.own?.rack ?? []).filter(Boolean).map(tile => tile.id));
        if (['okey.layout', 'okey.draw', 'okey.discard', 'okey.cancel', 'okey.open', 'okey.tack', 'okey.tick', 'okey.newRound'].includes(type)) payload.roundId = roundId;
        if (['okey.draw', 'okey.discard', 'okey.cancel', 'okey.open', 'okey.tack'].includes(type)) {
          payload.turnNumber = turnNumber; payload.expectedPlayVersion = current.roomData.playVersion;
        }
        if (['okey.rules', 'okey.team', 'okey.distribute', 'okey.bots', 'okey.start', 'okey.tick', 'okey.seat.resolve'].includes(type)) payload.expectedVersion = current.roomData.version;
        if (type === 'okey.open') {
          payload.melds = fields.groupIds.map(id => current.own?.groups?.[id] ?? []); delete payload.groupIds;
        }
        const result = await current.sendAction(type, payload, { trace });
        const waitAt = trace ? performance.now() : 0;
        await waitForSnapshot(result.version);
        if (trace) gamePerformance.add(trace, 'command_snapshot_barrier_ms', performance.now() - waitAt);
        if (!stopped.current && result.penalized) setError('Açılış barajına ulaşamadın. +101 ceza yazıldı.');
        const drawnTileId = type === 'okey.draw' ? latest.current.own?.rack?.find(tile => tile && !oldTileIds.has(tile.id))?.id : null;
        return { success: true, ...result, drawnTileId };
      } catch (issue) {
        gamePerformance.fail(trace);
        if (!stopped.current && (!quiet || !['too_early', 'stale_version', 'stale_round', 'round_finished', 'game_not_playing'].includes(issue.code))) setError(gameErrorMessage(issue));
        return { success: false };
      } finally { if (interactive && !stopped.current) setBusy(false); }
    };
    const result = chain.current.then(job); chain.current = result.catch(() => {}); return result;
    // Ref-backed state binds the displayed round/turn at click time, while
    // serialized layout/open commands wait for their confirmed own hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!isPlayer) return undefined;
    const advance = () => {
      const data = latest.current.roomData;
      if (stopped.current || inFlight.current || document.visibilityState === 'hidden') return;
      const type = okeyAutoAction(data, user.uid);
      if (type) { inFlight.current = true; send(type, {}, true).finally(() => { inFlight.current = false; }); }
    };
    advance(); const timer = setInterval(advance, 1000);
    return () => clearInterval(timer);
  }, [isPlayer, user.uid, send]);
  const merged = { ...roomData,
    // Placeholder deck slots carry counts only; no tile identities are known.
    drawPile: Array(roomData.drawPileCount ?? 0).fill(null),
    racks: roomData.hasDealt ? (isPlayer && coherent ? { [user.uid]: own.rack } : {}) : undefined,
    groups: isPlayer && coherent && own ? { [user.uid]: own.groups } : {},
  };
  if (coherent) confirmedView.current = merged;
  const display = coherent ? merged : confirmedView.current?.roundId === roomData.roundId ? confirmedView.current : null;
  return <>
    {error && <div role="alert" className="w-full max-w-3xl border border-amber-500/50 bg-amber-950/90 text-amber-100 rounded-xl p-3 text-sm">{error}</div>}
    {!display
      ? <div className="flex items-center gap-2 p-8 text-slate-300"><Loader2 className="w-5 h-5 animate-spin" /> Elin güncelleniyor…</div>
      : <Okey101Game roomData={display} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} sendAction={send} serverBusy={busy || !coherent} />}
  </>;
}
