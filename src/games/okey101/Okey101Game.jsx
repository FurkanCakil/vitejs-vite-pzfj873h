import React, { useEffect, useRef, useState } from 'react';
import { doc, updateDoc, runTransaction } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import Okey101Lobby from './Okey101Lobby.jsx';
import PlayerRack from './PlayerRack.jsx';
import OpponentStrip from './OpponentStrip.jsx';
import SetupCountdown from './SetupCountdown.jsx';
import Tile, { TileBack } from './Tile.jsx';
import { dealTiles, SETUP_DURATION_MS, computeOkeyInfo, isOkeyTile } from './tiles.js';
import { isBotUid } from './botPlayers.js';
import {
  getNextTurnUid, getPrevTurnUid, validateGroups, computeSelectedGroupsValue,
  validatePairs, canTackTile, OPEN_THRESHOLD, PENALTY_POINTS,
} from './gameLogic.js';

const OPENED_TYPE_LABELS = { seri: 'Seri', set: 'Set', cift: 'Çift' };

// 4. Faz: Gösterge/Okey belirleme, katı per doğrulaması (sadece toplam yetmez —
// dizilim de doğru olmalı), Çift Açma (5 çift, 101 aranmaksızın), ve İşleme
// (açık perlere tek taş ekleme/tacking). 3. Faz'ın tur/atma/ceza mimarisi
// bozulmadan üzerine inşa edildi.
export default function Okey101Game({ roomData, roomCode, user, db, appId, leaveRoom }) {
  const isHost = roomData.host === user.uid;
  const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = (msg, tone = 'red') => {
    setToast({ msg, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Oyun 'playing' fazına yeni geçtiyse (henüz taş dağıtılmamışsa) host taşları dağıtır,
  // Göstergeyi belirler (ve ondan Okey'i türetir), 15sn hazırlık fazını başlatır ve
  // turu ilk oyuncuya (22 taşlı) verir. İlk oyuncu zaten fazladan taşla başladığı için
  // ilk turunda tekrar çekmesi GEREKMEZ — hasDrawnThisTurn baştan true (gerçek kural).
  useEffect(() => {
    if (roomData.status !== 'playing' || roomData.racks || !isHost) return;
    const players = roomData.players || [];
    const { racks, drawPile, indicator } = dealTiles(players);
    const okey = computeOkeyInfo(indicator);
    const groups = {}; const discardPiles = {}; const openedHands = {}; const hasOpened = {};
    players.forEach((uid) => { groups[uid] = {}; discardPiles[uid] = []; openedHands[uid] = []; hasOpened[uid] = false; });
    updateDoc(roomRef, {
      racks, drawPile, indicator, okey, groups, discardPiles, openedHands, hasOpened,
      setupPhase: true, setupEndsAt: Date.now() + SETUP_DURATION_MS,
      turn: players[0] || null, hasDrawnThisTurn: true,
    }).catch((err) => console.error('Okey101 taş dağıtım hatası:', err));
  }, [roomData.status, roomData.racks, isHost]);

  // Hazırlık süresi dolunca host normal faza geçirir.
  useEffect(() => {
    if (!isHost || !roomData.setupPhase || !roomData.setupEndsAt) return;
    const remaining = roomData.setupEndsAt - Date.now();
    const timer = setTimeout(() => {
      updateDoc(roomRef, { setupPhase: false }).catch((err) => console.error('Okey101 faz geçiş hatası:', err));
    }, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [isHost, roomData.setupPhase, roomData.setupEndsAt]);

  if (roomData.status !== 'playing') {
    return <Okey101Lobby roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} />;
  }

  if (!roomData.racks) {
    return (
      <div className="w-full max-w-3xl flex flex-col items-center gap-4 bg-slate-800 rounded-2xl border border-slate-700 p-8 text-center">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-400" />
        <h2 className="text-xl font-bold text-white">Taşlar Dağıtılıyor...</h2>
      </div>
    );
  }

  const players = (roomData.players || []).map((uid) => ({
    uid,
    name: roomData.playerNames?.[uid] || (isBotUid(uid) ? 'Bot' : 'Oyuncu'),
    isBot: !!roomData.isBotPlayer?.[uid] || isBotUid(uid),
  }));
  const okeyInfo = roomData.okey || null;
  const myRack = roomData.racks?.[user.uid] || null;
  const myGroups = roomData.groups?.[user.uid] || {};
  const myDiscardPile = roomData.discardPiles?.[user.uid] || [];
  const myTopDiscard = myDiscardPile.length > 0 ? myDiscardPile[myDiscardPile.length - 1] : null;
  const isPlayer = (roomData.players || []).includes(user.uid);
  const myHasOpened = !!roomData.hasOpened?.[user.uid];

  const setupPhase = !!roomData.setupPhase;
  const isMyTurn = !setupPhase && roomData.turn === user.uid;
  const hasDrawn = !!roomData.hasDrawnThisTurn;
  const mustDraw = isPlayer && isMyTurn && !hasDrawn;
  const mustDiscard = isPlayer && isMyTurn && hasDrawn;
  const prevUid = getPrevTurnUid(roomData.players || [], user.uid);

  const turnPlayerName = players.find((p) => p.uid === roomData.turn)?.name || '...';

  const handleUpdateRack = (newRack, newGroups) => {
    updateDoc(roomRef, { [`racks.${user.uid}`]: newRack, [`groups.${user.uid}`]: newGroups })
      .catch((err) => console.error('Okey101 ıstaka güncelleme hatası:', err));
  };

  const handleDrawPile = async () => {
    if (!mustDraw) return;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== user.uid || data.hasDrawnThisTurn) return;
      const pile = [...(data.drawPile || [])];
      if (pile.length === 0) return;
      const drawn = pile.pop();
      const rack = [...(data.racks?.[user.uid] || [])];
      const emptyIdx = rack.findIndex((s) => s === null);
      if (emptyIdx === -1) return;
      rack[emptyIdx] = drawn;
      t.update(roomRef, { drawPile: pile, [`racks.${user.uid}`]: rack, hasDrawnThisTurn: true });
    }).catch((err) => console.error('Okey101 çekme hatası:', err));
  };

  const handleDrawDiscard = async () => {
    if (!mustDraw || !prevUid) return;
    let penaltyApplied = false;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== user.uid || data.hasDrawnThisTurn) return;
      const pile = [...(data.discardPiles?.[prevUid] || [])];
      if (pile.length === 0) return;
      const drawn = pile.pop();
      const rack = [...(data.racks?.[user.uid] || [])];
      const emptyIdx = rack.findIndex((s) => s === null);
      if (emptyIdx === -1) return;
      rack[emptyIdx] = drawn;
      const update = { [`discardPiles.${prevUid}`]: pile, [`racks.${user.uid}`]: rack, hasDrawnThisTurn: true };
      if (data.rules?.penaltyToDiscarder) {
        update[`scores.${prevUid}`] = (data.scores?.[prevUid] || 0) - PENALTY_POINTS;
        penaltyApplied = true;
      }
      t.update(roomRef, update);
    }).catch((err) => console.error('Okey101 yerden çekme hatası:', err));
    if (penaltyApplied) {
      showToast(`${players.find((p) => p.uid === prevUid)?.name || 'Rakip'} taşı yandan alındığı için -101 ceza aldı.`, 'amber');
    }
  };

  const handleDiscardTile = async (tile) => {
    if (!mustDiscard) return;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== user.uid || !data.hasDrawnThisTurn) return;
      const rack = [...(data.racks?.[user.uid] || [])];
      const idx = rack.findIndex((s) => s && s.id === tile.id);
      if (idx === -1) return;
      rack[idx] = null;

      const myGroupsNext = { ...(data.groups?.[user.uid] || {}) };
      for (const [gid, tileIds] of Object.entries(myGroupsNext)) {
        if (tileIds.includes(tile.id)) {
          const remaining = tileIds.filter((id) => id !== tile.id);
          if (remaining.length < 2) delete myGroupsNext[gid]; else myGroupsNext[gid] = remaining;
          break;
        }
      }

      const discardPile = [...(data.discardPiles?.[user.uid] || []), tile];
      const nextUid = getNextTurnUid(data.players || [], user.uid);

      t.update(roomRef, {
        [`racks.${user.uid}`]: rack,
        [`groups.${user.uid}`]: myGroupsNext,
        [`discardPiles.${user.uid}`]: discardPile,
        turn: nextUid,
        hasDrawnThisTurn: false,
      });
    }).catch((err) => console.error('Okey101 atma hatası:', err));
  };

  // "Seri Aç": seçili her per KATI şekilde geçerli bir SET/SERİ olmalı (sadece
  // toplam yetmez). Herhangi biri geçersizse toplam ne olursa olsun reddedilir.
  const handleOpenSeries = async (selectedGroupIds) => {
    if (!mustDiscard || selectedGroupIds.length === 0) return;
    let outcome = null;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== user.uid || !data.hasDrawnThisTurn) return;

      const myRackNow = data.racks?.[user.uid] || [];
      const myGroupsNow = { ...(data.groups?.[user.uid] || {}) };
      const tilesById = {}; myRackNow.forEach((tl) => { if (tl) tilesById[tl.id] = tl; });
      const validGroupIds = selectedGroupIds.filter((gid) => myGroupsNow[gid]);
      if (validGroupIds.length === 0) return;

      const okeyNow = data.okey || null;
      const { allValid, results } = validateGroups(myGroupsNow, tilesById, validGroupIds, okeyNow);
      if (!allValid) { outcome = { success: false, reason: 'invalid' }; return; }

      const alreadyOpened = !!data.hasOpened?.[user.uid];
      const total = computeSelectedGroupsValue(results);

      if (!alreadyOpened && total < OPEN_THRESHOLD) {
        outcome = { success: false, reason: 'below101' };
        t.update(roomRef, { [`scores.${user.uid}`]: (data.scores?.[user.uid] || 0) - PENALTY_POINTS });
        return;
      }

      const newRack = [...myRackNow];
      const openedNow = [];
      for (const r of results) {
        const tileIds = myGroupsNow[r.gid];
        openedNow.push({ tiles: r.tiles, type: r.type });
        tileIds.forEach((tid) => {
          const idx = newRack.findIndex((tl) => tl && tl.id === tid);
          if (idx !== -1) newRack[idx] = null;
        });
        delete myGroupsNow[r.gid];
      }
      const existingOpened = data.openedHands?.[user.uid] || [];

      outcome = { success: true };
      t.update(roomRef, {
        [`racks.${user.uid}`]: newRack,
        [`groups.${user.uid}`]: myGroupsNow,
        [`openedHands.${user.uid}`]: [...existingOpened, ...openedNow],
        [`hasOpened.${user.uid}`]: true,
      });
    }).catch((err) => { console.error('Okey101 seri açma hatası:', err); outcome = null; });

    if (outcome?.reason === 'invalid') showToast('Geçersiz Per Dizilimi!', 'red');
    else if (outcome?.reason === 'below101') showToast('101\'e Ulaşamadınız! Ceza Yediniz.', 'red');
    else if (outcome?.success === true) showToast('Per başarıyla açıldı!', 'emerald');
    return outcome;
  };

  // "Çift Aç": tam 5 çift gerekir (Okey/Sahte Okey herhangi bir taşın eşi olabilir),
  // 101 toplamı ARANMAZ. Sadece ilk açılış hamlesi olarak kullanılabilir.
  const handleOpenPairs = async (selectedGroupIds) => {
    if (!mustDiscard || selectedGroupIds.length === 0) return;
    let outcome = null;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== user.uid || !data.hasDrawnThisTurn) return;
      if (data.hasOpened?.[user.uid]) { outcome = { success: false, reason: 'already-opened' }; return; }

      const myRackNow = data.racks?.[user.uid] || [];
      const myGroupsNow = { ...(data.groups?.[user.uid] || {}) };
      const tilesById = {}; myRackNow.forEach((tl) => { if (tl) tilesById[tl.id] = tl; });
      const validGroupIds = selectedGroupIds.filter((gid) => myGroupsNow[gid]);

      const okeyNow = data.okey || null;
      const { valid } = validatePairs(myGroupsNow, tilesById, validGroupIds, okeyNow);
      if (!valid) { outcome = { success: false, reason: 'invalid' }; return; }

      const newRack = [...myRackNow];
      const openedNow = [];
      for (const gid of validGroupIds) {
        const tileIds = myGroupsNow[gid];
        const tiles = tileIds.map((id) => tilesById[id]).filter(Boolean);
        openedNow.push({ tiles, type: 'cift' });
        tileIds.forEach((tid) => {
          const idx = newRack.findIndex((tl) => tl && tl.id === tid);
          if (idx !== -1) newRack[idx] = null;
        });
        delete myGroupsNow[gid];
      }
      const existingOpened = data.openedHands?.[user.uid] || [];

      outcome = { success: true };
      t.update(roomRef, {
        [`racks.${user.uid}`]: newRack,
        [`groups.${user.uid}`]: myGroupsNow,
        [`openedHands.${user.uid}`]: [...existingOpened, ...openedNow],
        [`hasOpened.${user.uid}`]: true,
      });
    }).catch((err) => { console.error('Okey101 çift açma hatası:', err); outcome = null; });

    if (outcome?.reason === 'already-opened') showToast('Zaten elini açtın.', 'red');
    else if (outcome?.reason === 'invalid') showToast('Geçersiz Çift Seçimi! Tam olarak 5 çift gerekli.', 'red');
    else if (outcome?.success === true) showToast('5 çift başarıyla açıldı!', 'emerald');
    return outcome;
  };

  // İşleme (tacking): elini açmış (hasOpened) bir oyuncu, sırası gelip taş
  // çektikten sonra, ıstakasındaki TEK bir taşı masadaki (kendisinin ya da
  // rakibinin) açık bir seri/set'in sağına/soluna ekleyebilir. Bozuyorsa
  // hiçbir şey değişmez (taş ıstakada kalır).
  const handleTackTile = async (tile, target) => {
    if (!mustDiscard || !myHasOpened || !target?.uid) return;
    let outcome = null;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== user.uid || !data.hasDrawnThisTurn || !data.hasOpened?.[user.uid]) return;

      const myRackNow = data.racks?.[user.uid] || [];
      const idx = myRackNow.findIndex((s) => s && s.id === tile.id);
      if (idx === -1) return;

      const targetOpened = [...(data.openedHands?.[target.uid] || [])];
      const group = targetOpened[target.groupIndex];
      if (!group) return;

      const okeyNow = data.okey || null;
      const { valid, newTiles } = canTackTile(group.tiles, group.type, tile, target.side, okeyNow);
      if (!valid) { outcome = { success: false }; return; }

      targetOpened[target.groupIndex] = { ...group, tiles: newTiles };
      const newRack = [...myRackNow]; newRack[idx] = null;

      outcome = { success: true };
      t.update(roomRef, {
        [`racks.${user.uid}`]: newRack,
        [`openedHands.${target.uid}`]: targetOpened,
      });
    }).catch((err) => { console.error('Okey101 işleme hatası:', err); outcome = null; });

    if (outcome?.success === false) showToast('Bu taş buraya uymuyor, ıstakana geri döndü.', 'red');
    return outcome;
  };

  const toastColors = { red: 'bg-red-500/95 border-red-400', amber: 'bg-amber-500/95 border-amber-400', emerald: 'bg-emerald-500/95 border-emerald-400' };
  const canTackNow = isPlayer && mustDiscard && myHasOpened;

  return (
    <div className="w-full max-w-4xl flex flex-col items-center gap-3 relative">
      {toast && (
        <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-[5000] text-white px-6 py-3 rounded-xl shadow-2xl font-bold border text-center max-w-sm ${toastColors[toast.tone] || toastColors.red}`}>
          {toast.msg}
        </div>
      )}

      <SetupCountdown setupEndsAt={setupPhase ? roomData.setupEndsAt : null} />

      <OpponentStrip
        players={players}
        racks={roomData.racks}
        discardPiles={roomData.discardPiles}
        scores={roomData.scores}
        hostUid={roomData.host}
        myUid={user.uid}
        takeableUid={mustDraw ? prevUid : null}
        onTakeDiscard={handleDrawDiscard}
      />

      {!setupPhase && (
        <div className={`text-center font-bold text-sm sm:text-base px-4 py-2 rounded-lg ${isMyTurn ? 'text-amber-300 bg-amber-500/10' : 'text-slate-400'}`}>
          {isMyTurn ? (mustDraw ? 'Sıra Sende! Önce bir taş çek.' : 'Şimdi ıstakandan bir taş at.') : `${turnPlayerName} oynuyor...`}
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap justify-center">
        <div
          onClick={mustDraw ? handleDrawPile : undefined}
          title={mustDraw ? 'Desteden çek' : undefined}
          className={`flex items-center gap-2 bg-slate-900/70 border rounded-lg px-4 py-2 transition-colors ${mustDraw ? 'cursor-pointer border-amber-400 ring-2 ring-amber-400/50 animate-pulse' : 'border-slate-700 opacity-80'}`}
        >
          <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Çekilecek Taşlar</span>
          <TileBack size="small" />
          <span className="text-sm font-mono font-bold text-slate-200">{roomData.drawPile?.length ?? 0}</span>
        </div>

        {roomData.indicator && (
          <div className="flex items-center gap-2 bg-slate-900/70 border border-fuchsia-500/40 rounded-lg px-4 py-2">
            <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Gösterge</span>
            <Tile tile={roomData.indicator} size="small" />
          </div>
        )}

        <div className="flex items-center gap-2 bg-slate-900/70 border border-slate-700 rounded-lg px-4 py-2">
          <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Senin Attıkların</span>
          {myTopDiscard ? <Tile tile={myTopDiscard} size="small" /> : <div className="w-4 h-6" />}
        </div>
      </div>

      {Object.values(roomData.openedHands || {}).some((groups) => groups.length > 0) && (
        <div className="w-full bg-slate-900/60 border border-slate-700 rounded-xl p-3">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Açılan Eller</div>
          <div className="flex flex-col gap-2">
            {players.map((p) => {
              const openedGroups = roomData.openedHands?.[p.uid] || [];
              if (openedGroups.length === 0) return null;
              return (
                <div key={p.uid} className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-slate-500 font-bold shrink-0">{p.name}:</span>
                  {openedGroups.map((g, gi) => {
                    const tackable = canTackNow && g.type !== 'cift';
                    return (
                      <div key={gi} className="flex items-center gap-0.5">
                        {tackable && (
                          <div data-tack-uid={p.uid} data-tack-index={gi} data-tack-side="left" className="w-2.5 h-9 rounded transition-colors" />
                        )}
                        <div className="flex items-center gap-0.5 bg-black/20 rounded-md p-1 ring-1 ring-emerald-500/40">
                          <span className="text-[9px] text-emerald-300 font-bold px-0.5 shrink-0">{OPENED_TYPE_LABELS[g.type] || ''}</span>
                          {g.tiles.map((tl) => <Tile key={tl.id} tile={tl} size="small" isOkey={isOkeyTile(tl, okeyInfo)} />)}
                        </div>
                        {tackable && (
                          <div data-tack-uid={p.uid} data-tack-index={gi} data-tack-side="right" className="w-2.5 h-9 rounded transition-colors" />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="w-full bg-gradient-to-b from-emerald-900/40 to-emerald-950/60 border border-emerald-800/50 rounded-2xl p-3 sm:p-4">
        {isPlayer ? (
          <PlayerRack
            rack={myRack}
            groups={myGroups}
            isOwner={true}
            onUpdateRack={handleUpdateRack}
            okeyInfo={okeyInfo}
            canAct={mustDiscard}
            hasOpenedAlready={myHasOpened}
            onDiscardTile={handleDiscardTile}
            onOpenSeries={handleOpenSeries}
            onOpenPairs={handleOpenPairs}
            onTackTile={handleTackTile}
          />
        ) : (
          <div className="text-center text-slate-400 text-sm py-6">Bu odada oyuncu değilsin, ıstaka görüntülenemiyor.</div>
        )}
      </div>

      <button onClick={leaveRoom} className="text-xs text-red-400 hover:text-red-300 border border-red-500/40 hover:bg-red-500/10 px-4 py-2 rounded-lg font-medium transition-colors">Odadan Çık</button>
    </div>
  );
}
