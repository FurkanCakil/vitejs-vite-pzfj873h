import React, { useEffect, useRef, useState } from 'react';
import { doc, getDoc, updateDoc, runTransaction } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import Okey101Lobby from './Okey101Lobby.jsx';
import PlayerRack from './PlayerRack.jsx';
import OpponentStrip from './OpponentStrip.jsx';
import SetupCountdown from './SetupCountdown.jsx';
import RoundResultBoard from './RoundResultBoard.jsx';
import Tile, { TileBack } from './Tile.jsx';
import { dealTiles, SETUP_DURATION_MS, computeOkeyInfo, isOkeyTile } from './tiles.js';
import { isBotUid } from './botPlayers.js';
import {
  getNextTurnUid, getPrevTurnUid, validateGroup, validateGroups, computeSelectedGroupsValue,
  validatePairs, canTackTile, computeRoundEnd, OPEN_THRESHOLD, PENALTY_POINTS,
} from './gameLogic.js';
import {
  randomTurnDelay, pickBotMelds, pickBotPairs, shouldTakeDiscard, findTackOpportunities, pickDiscardTile,
} from './botAI.js';

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
  const botTurnLockRef = useRef(false);
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
      roundEnded: false, roundResult: null, roundStartScores: { ...(roomData.scores || {}) }, foldMultiplier: 1,
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

  // 6. Faz: Bot tur otomasyonu. Sadece host tetikler (tek bir tarayıcı botu
  // sürer). `roomData.turn` bir bota geçtiğinde: rastgele 1.5-2.5sn gecikme →
  // çekme kararı (yerden mi destede mi) → el açma denemesi (çift/per) →
  // işleme (tacking) denemeleri → atma. Her adım arasında taze `getDoc` okuması
  // yapılır (stale roomData prop'una göre değil, gerçek Firestore durumuna göre
  // hareket eder). `botTurnLockRef` aynı tur için yeniden tetiklenmeyi engeller;
  // bağımlılık dizisi bilinçli olarak dar tutuldu (racks/hasDrawnThisTurn HARİÇ)
  // çünkü botun kendi hamleleri sırasında oluşan roomData güncellemeleri
  // efekti erken iptal edip yarıda kesmemeli.
  useEffect(() => {
    if (!isHost) return;
    if (roomData.status !== 'playing' || !roomData.racks) return;
    if (roomData.setupPhase || roomData.roundEnded) return;
    const turnUid = roomData.turn;
    if (!turnUid || !isBotUid(turnUid)) return;
    if (botTurnLockRef.current) return;

    botTurnLockRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        await randomTurnDelay();
        if (cancelled) return;

        let snap = await getDoc(roomRef);
        if (!snap.exists()) return;
        let data = snap.data();
        if (cancelled || data.setupPhase || data.roundEnded || data.turn !== turnUid) return;

        // 1) Çekme kararı: yerden almak bir peri tamamlıyorsa/çok değerliyse
        // yerden al, aksi halde her zaman kapalı desteden çek.
        if (!data.hasDrawnThisTurn) {
          const rack = (data.racks?.[turnUid] || []).filter(Boolean);
          const prevUidForBot = getPrevTurnUid(data.players || [], turnUid);
          const discardPile = prevUidForBot ? (data.discardPiles?.[prevUidForBot] || []) : [];
          const topDiscard = discardPile.length > 0 ? discardPile[discardPile.length - 1] : null;
          if (topDiscard && shouldTakeDiscard(rack, topDiscard, data.okey || null)) {
            await handleDrawDiscard(turnUid);
          } else {
            await handleDrawPile(turnUid);
          }
          if (cancelled) return;
          snap = await getDoc(roomRef);
          if (!snap.exists()) return;
          data = snap.data();
          if (data.setupPhase || data.roundEnded || data.turn !== turnUid) return;
        }

        // 2) El açma: tam 5 çift bulunduysa onu, yoksa toplamı >=101 olan greedy
        // per kombinasyonunu (varsa) masaya aç. Zaten açıksa yeni bulunan
        // perleri (eşik aranmaksızın) işleyip masaya ekler.
        await randomTurnDelay();
        if (cancelled) return;
        snap = await getDoc(roomRef);
        if (!snap.exists()) return;
        data = snap.data();
        if (data.setupPhase || data.roundEnded || data.turn !== turnUid || !data.hasDrawnThisTurn) return;

        const okeyForOpen = data.okey || null;
        const rackForOpen = (data.racks?.[turnUid] || []).filter(Boolean);
        const alreadyOpened = !!data.hasOpened?.[turnUid];
        if (!alreadyOpened) {
          const pairs = pickBotPairs(rackForOpen, okeyForOpen);
          if (pairs.length === 5) {
            await handleBotOpenMelds(turnUid, pairs, true);
          } else {
            const melds = pickBotMelds(rackForOpen, okeyForOpen);
            const total = melds.reduce((s, m) => s + m.value, 0);
            if (melds.length > 0 && total >= OPEN_THRESHOLD) {
              await handleBotOpenMelds(turnUid, melds, false);
            }
          }
        } else {
          const melds = pickBotMelds(rackForOpen, okeyForOpen);
          if (melds.length > 0) await handleBotOpenMelds(turnUid, melds, false);
        }
        if (cancelled) return;
        snap = await getDoc(roomRef);
        if (!snap.exists()) return;
        data = snap.data();
        if (data.setupPhase || data.roundEnded || data.turn !== turnUid) return;

        // 3) İşleme: elini açtıysa, ıstakada en az 1 taş (zorunlu atma için)
        // kalacak şekilde, masadaki (kendi/rakip) perlere uyan taşları işler.
        if (data.hasOpened?.[turnUid]) {
          for (let i = 0; i < 22; i++) {
            if (cancelled) return;
            const rackNow = (data.racks?.[turnUid] || []).filter(Boolean);
            if (rackNow.length <= 1) break;
            const opportunities = findTackOpportunities(rackNow, data.openedHands || {}, data.okey || null);
            if (opportunities.length === 0) break;
            const opp = opportunities[0];
            await randomTurnDelay();
            if (cancelled) return;
            await handleTackTile(opp.tile, { uid: opp.targetUid, groupIndex: opp.groupIndex, side: opp.side }, turnUid);
            snap = await getDoc(roomRef);
            if (!snap.exists()) return;
            data = snap.data();
            if (data.setupPhase || data.roundEnded || data.turn !== turnUid) return;
          }
        }

        // 4) Atma: hiçbir pere uymayan en gereksiz taşı at; Okey'i sadece
        // başka çaresi kalmadığında at (pickDiscardTile bu kuralı zaten uygular).
        await randomTurnDelay();
        if (cancelled) return;
        snap = await getDoc(roomRef);
        if (!snap.exists()) return;
        data = snap.data();
        if (data.setupPhase || data.roundEnded || data.turn !== turnUid || !data.hasDrawnThisTurn) return;

        const finalRack = (data.racks?.[turnUid] || []).filter(Boolean);
        const discardTile = pickDiscardTile(finalRack, data.okey || null);
        if (discardTile) await handleDiscardTile(discardTile, turnUid);
      } catch (err) {
        console.error('Okey101 bot tur hatası:', err);
      } finally {
        botTurnLockRef.current = false;
      }
    })();

    return () => { cancelled = true; botTurnLockRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, roomData.status, roomData.turn, roomData.setupPhase, roomData.roundEnded]);

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

  const handleDrawPile = async (actingUid = user.uid) => {
    if (actingUid === user.uid && !mustDraw) return;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== actingUid || data.hasDrawnThisTurn) return;
      const pile = [...(data.drawPile || [])];
      if (pile.length === 0) return;
      const drawn = pile.pop();
      const rack = [...(data.racks?.[actingUid] || [])];
      const emptyIdx = rack.findIndex((s) => s === null);
      if (emptyIdx === -1) return;
      rack[emptyIdx] = drawn;
      t.update(roomRef, { drawPile: pile, [`racks.${actingUid}`]: rack, hasDrawnThisTurn: true });
    }).catch((err) => console.error('Okey101 çekme hatası:', err));
  };

  const handleDrawDiscard = async (actingUid = user.uid) => {
    const fromUid = actingUid === user.uid ? prevUid : getPrevTurnUid(roomData.players || [], actingUid);
    if (actingUid === user.uid && !mustDraw) return;
    if (!fromUid) return;
    let penaltyApplied = false;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== actingUid || data.hasDrawnThisTurn) return;
      const pile = [...(data.discardPiles?.[fromUid] || [])];
      if (pile.length === 0) return;
      const drawn = pile.pop();
      const rack = [...(data.racks?.[actingUid] || [])];
      const emptyIdx = rack.findIndex((s) => s === null);
      if (emptyIdx === -1) return;
      rack[emptyIdx] = drawn;
      const update = { [`discardPiles.${fromUid}`]: pile, [`racks.${actingUid}`]: rack, hasDrawnThisTurn: true };
      if (data.rules?.penaltyToDiscarder) {
        update[`scores.${fromUid}`] = (data.scores?.[fromUid] || 0) - PENALTY_POINTS;
        penaltyApplied = true;
      }
      t.update(roomRef, update);
    }).catch((err) => console.error('Okey101 yerden çekme hatası:', err));
    if (penaltyApplied) {
      showToast(`${players.find((p) => p.uid === fromUid)?.name || 'Rakip'} taşı yandan alındığı için -101 ceza aldı.`, 'amber');
    }
  };

  const handleDiscardTile = async (tile, actingUid = user.uid) => {
    if (actingUid === user.uid && !mustDiscard) return;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== actingUid || !data.hasDrawnThisTurn) return;
      const rack = [...(data.racks?.[actingUid] || [])];
      const idx = rack.findIndex((s) => s && s.id === tile.id);
      if (idx === -1) return;
      rack[idx] = null;

      const actorGroupsNext = { ...(data.groups?.[actingUid] || {}) };
      for (const [gid, tileIds] of Object.entries(actorGroupsNext)) {
        if (tileIds.includes(tile.id)) {
          const remaining = tileIds.filter((id) => id !== tile.id);
          if (remaining.length < 2) delete actorGroupsNext[gid]; else actorGroupsNext[gid] = remaining;
          break;
        }
      }

      const discardPile = [...(data.discardPiles?.[actingUid] || []), tile];

      // Eli bitirme: son taşı atınca ıstaka tamamen boşaldıysa el (round) biter.
      const rackEmptied = rack.every((s) => s === null);
      if (rackEmptied) {
        const okeyNow = data.okey || null;
        const wonByOkeyDiscard = isOkeyTile(tile, okeyNow);
        const { newScores, roundResult } = computeRoundEnd({
          players: data.players || [],
          scores: data.scores || {},
          roundStartScores: data.roundStartScores || {},
          hasOpened: data.hasOpened || {},
          racks: { ...(data.racks || {}), [actingUid]: rack },
          rules: data.rules || {},
          teams: data.teams || null,
          okeyInfo: okeyNow,
          foldMultiplier: data.foldMultiplier || 1,
        }, actingUid, wonByOkeyDiscard);

        t.update(roomRef, {
          [`racks.${actingUid}`]: rack,
          [`groups.${actingUid}`]: actorGroupsNext,
          [`discardPiles.${actingUid}`]: discardPile,
          turn: null,
          hasDrawnThisTurn: false,
          roundEnded: true,
          roundResult,
          scores: newScores,
        });
        return;
      }

      const nextUid = getNextTurnUid(data.players || [], actingUid);
      t.update(roomRef, {
        [`racks.${actingUid}`]: rack,
        [`groups.${actingUid}`]: actorGroupsNext,
        [`discardPiles.${actingUid}`]: discardPile,
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

  // Bot açma: insan "Per Onayla" akışının aksine, bot pickBotMelds/pickBotPairs
  // tarafından üretilen ham taş dizilerini doğrudan transaction'a verir — per
  // seçim/onay UI state'i (groups) botlar için kullanılmaz. Her per yine de
  // validateGroup ile insanla aynı katı kuralla tekrar doğrulanır.
  const handleBotOpenMelds = async (actingUid, melds, isPairs = false) => {
    if (!melds || melds.length === 0) return { success: false };
    let outcome = null;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== actingUid || !data.hasDrawnThisTurn) return;

      const alreadyOpened = !!data.hasOpened?.[actingUid];
      if (isPairs && alreadyOpened) { outcome = { success: false, reason: 'already-opened' }; return; }

      const actorRackNow = [...(data.racks?.[actingUid] || [])];
      const okeyNow = data.okey || null;

      let total = 0;
      for (const m of melds) {
        if (isPairs) {
          if (m.tiles.length !== 2) { outcome = { success: false }; return; }
        } else {
          const result = validateGroup(m.tiles, okeyNow);
          if (!result.valid) { outcome = { success: false }; return; }
          total += result.value;
        }
      }
      if (isPairs && melds.length !== 5) { outcome = { success: false }; return; }
      if (!isPairs && !alreadyOpened && total < OPEN_THRESHOLD) { outcome = { success: false }; return; }

      const openedNow = [];
      for (const m of melds) {
        openedNow.push({ tiles: m.tiles, type: isPairs ? 'cift' : m.type });
        m.tiles.forEach((tl) => {
          const idx = actorRackNow.findIndex((s) => s && s.id === tl.id);
          if (idx !== -1) actorRackNow[idx] = null;
        });
      }
      const existingOpened = data.openedHands?.[actingUid] || [];

      outcome = { success: true };
      t.update(roomRef, {
        [`racks.${actingUid}`]: actorRackNow,
        [`openedHands.${actingUid}`]: [...existingOpened, ...openedNow],
        [`hasOpened.${actingUid}`]: true,
      });
    }).catch((err) => { console.error('Okey101 bot açma hatası:', err); outcome = null; });
    return outcome;
  };

  // İşleme (tacking): elini açmış (hasOpened) bir oyuncu, sırası gelip taş
  // çektikten sonra, ıstakasındaki TEK bir taşı masadaki (kendisinin ya da
  // rakibinin) açık bir seri/set'in sağına/soluna ekleyebilir. Bozuyorsa
  // hiçbir şey değişmez (taş ıstakada kalır).
  const handleTackTile = async (tile, target, actingUid = user.uid) => {
    if (actingUid === user.uid && (!mustDiscard || !myHasOpened)) return;
    if (!target?.uid) return;
    let outcome = null;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== actingUid || !data.hasDrawnThisTurn || !data.hasOpened?.[actingUid]) return;

      const actorRackNow = data.racks?.[actingUid] || [];
      const idx = actorRackNow.findIndex((s) => s && s.id === tile.id);
      if (idx === -1) return;

      const targetOpened = [...(data.openedHands?.[target.uid] || [])];
      const group = targetOpened[target.groupIndex];
      if (!group) return;

      const okeyNow = data.okey || null;
      const { valid, newTiles } = canTackTile(group.tiles, group.type, tile, target.side, okeyNow);
      if (!valid) { outcome = { success: false }; return; }

      targetOpened[target.groupIndex] = { ...group, tiles: newTiles };
      const newRack = [...actorRackNow]; newRack[idx] = null;

      outcome = { success: true };
      t.update(roomRef, {
        [`racks.${actingUid}`]: newRack,
        [`openedHands.${target.uid}`]: targetOpened,
      });
    }).catch((err) => { console.error('Okey101 işleme hatası:', err); outcome = null; });

    if (outcome?.success === false) showToast('Bu taş buraya uymuyor, ıstakana geri döndü.', 'red');
    return outcome;
  };

  // "Yeni Tura Başla" (sadece host): masayı tamamen sıfırlar, taşları yeniden
  // dağıtır (yeni Gösterge/Okey dahil) ve 15sn hazırlık fazıyla yeni el başlatır.
  // `scores` zaten tur sonunda güncellendiği için buradan dokunulmuyor, sadece
  // yeni turun anlık-ceza karşılaştırması için roundStartScores tazelenir.
  const handleStartNewRound = async () => {
    if (!isHost) return;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (!data.roundEnded) return;
      const roundPlayers = data.players || [];
      const { racks, drawPile, indicator } = dealTiles(roundPlayers);
      const okey = computeOkeyInfo(indicator);
      const groups = {}; const discardPiles = {}; const openedHands = {}; const hasOpened = {};
      roundPlayers.forEach((uid) => { groups[uid] = {}; discardPiles[uid] = []; openedHands[uid] = []; hasOpened[uid] = false; });
      t.update(roomRef, {
        racks, drawPile, indicator, okey, groups, discardPiles, openedHands, hasOpened,
        setupPhase: true, setupEndsAt: Date.now() + SETUP_DURATION_MS,
        turn: roundPlayers[0] || null, hasDrawnThisTurn: true,
        roundEnded: false, roundResult: null, roundStartScores: { ...(data.scores || {}) },
      });
    }).catch((err) => console.error('Okey101 yeni tur hatası:', err));
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

      {roomData.roundEnded && (
        <RoundResultBoard
          players={players}
          roundResult={roomData.roundResult}
          scores={roomData.scores}
          rules={roomData.rules}
          teams={roomData.teams}
          isHost={isHost}
          onStartNewRound={handleStartNewRound}
        />
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
        onTakeDiscard={() => handleDrawDiscard(user.uid)}
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
