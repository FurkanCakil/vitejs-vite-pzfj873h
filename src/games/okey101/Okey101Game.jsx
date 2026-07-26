import React, { useEffect, useRef, useState } from 'react';
import { doc, getDocFromServer, updateDoc, runTransaction } from 'firebase/firestore';
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
  SIDE_TAKE_SERIES_MULTIPLIER, SIDE_TAKE_PAIRS_MULTIPLIER,
} from './gameLogic.js';
import {
  randomTurnDelay, pickBotMelds, pickBotPairs, shouldTakeDiscard, findTackOpportunities, pickDiscardTile,
} from './botAI.js';

const OPENED_TYPE_LABELS = { seri: 'Seri', set: 'Set', cift: 'Çift' };
const TURN_DURATION_MS = 30000;

// Yandan çekilen taşın "değeri": Sahte Okey/Okey ise en yüksek (13) sayılır,
// aksi halde kendi yüz değeri.
function sideTakeTileValue(tile, okeyInfo) {
  if (!tile) return 0;
  if (tile.isJoker) return 13;
  if (isOkeyTile(tile, okeyInfo)) return 13;
  return tile.number ?? 0;
}

// Eşli (2v2) modda takım arkadaşları masada KARŞILIKLI otursun (ve tur sırası
// ile oturma düzeni geometrisi tutarlı kalsın) diye oyuncu dizisini A1,B1,A2,B2
// şeklinde alterne sıraya sokar (A1'in solu/sağı her zaman B2/B1 -> rakip,
// karşısı A2 -> eş olur). Diğer modlarda veya takımlar tam değilse dokunulmaz.
function seatOrderedPlayers(players, rules, teams) {
  if (rules?.gameType !== '2v2' || !teams) return players;
  const a = teams.A || []; const b = teams.B || [];
  if (a.length !== 2 || b.length !== 2) return players;
  const ordered = [a[0], b[0], a[1], b[1]];
  const sameSet = ordered.length === players.length && ordered.every((uid) => players.includes(uid));
  return sameSet ? ordered : players;
}

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

  // Nadiren bir Firestore transaction'ı (ağ/ortam kaynaklı) hiç sonuçlanmadan
  // asılı kalabiliyor — bu, bot turunun tamamlanmasını sonsuza dek engeller.
  // Bu "watchdog" her 20sn'de bir tetiklenerek bot-turu efektini (aşağıda)
  // yeniden tetikler; efekt zaten çalışıyorsa ve gerçekten ilerliyorsa bunun
  // hiçbir etkisi yoktur, ama asılı kalmış bir deneme varsa temiz bir yeniden
  // başlangıç sağlar (bkz. `cancelled`/`botTurnLockRef` sıfırlama, cleanup'ta).
  const [botWatchdogTick, setBotWatchdogTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setBotWatchdogTick((n) => n + 1), 20000);
    return () => clearInterval(interval);
  }, []);

  // Sıradaki oyuncu için görünen 30sn'lik hamle geri sayımı (tüm istemcilerde
  // ortak `turnDeadline`'dan türetilir).
  const [turnCountdown, setTurnCountdown] = useState(null);
  useEffect(() => {
    if (roomData.setupPhase || !roomData.turnDeadline) { setTurnCountdown(null); return; }
    const tick = () => setTurnCountdown(Math.max(0, Math.ceil((roomData.turnDeadline - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [roomData.setupPhase, roomData.turnDeadline]);

  // Ortadaki kapalı desteden SÜRÜKLEYEREK de çekilebilsin diye (sadece
  // tıklama değil) hafif bir pointer-sürükleme: hareket olmadan bırakılırsa
  // (klasik tık) ya da sürüklenip herhangi bir yerde bırakılırsa aynı
  // sonucu (çekme) verir.
  const pileDragRef = useRef(null);
  const [pileGhost, setPileGhost] = useState(null);
  const handlePileDrawPointerDown = (e) => {
    if (!mustDraw) return;
    pileDragRef.current = { moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const handlePileDrawPointerMove = (e) => {
    if (!pileDragRef.current) return;
    pileDragRef.current.moved = true;
    setPileGhost({ x: e.clientX, y: e.clientY });
  };
  const handlePileDrawPointerUp = () => {
    if (!pileDragRef.current) return;
    pileDragRef.current = null;
    setPileGhost(null);
    handleDrawPile();
  };

  // Oyun 'playing' fazına yeni geçtiyse (henüz taş dağıtılmamışsa) host taşları dağıtır,
  // Göstergeyi belirler (ve ondan Okey'i türetir), 15sn hazırlık fazını başlatır ve
  // turu ilk oyuncuya (22 taşlı) verir. İlk oyuncu zaten fazladan taşla başladığı için
  // ilk turunda tekrar çekmesi GEREKMEZ — hasDrawnThisTurn baştan true (gerçek kural).
  useEffect(() => {
    if (roomData.status !== 'playing' || roomData.racks || !isHost) return;
    const players = seatOrderedPlayers(roomData.players || [], roomData.rules, roomData.teams);
    const { racks, drawPile, indicator } = dealTiles(players);
    const okey = computeOkeyInfo(indicator);
    const groups = {}; const discardPiles = {}; const openedHands = {}; const hasOpened = {};
    players.forEach((uid) => { groups[uid] = {}; discardPiles[uid] = []; openedHands[uid] = []; hasOpened[uid] = false; });
    updateDoc(roomRef, {
      players, racks, drawPile, indicator, okey, groups, discardPiles, openedHands, hasOpened,
      setupPhase: true, setupEndsAt: Date.now() + SETUP_DURATION_MS,
      turn: players[0] || null, turnDeadline: Date.now() + SETUP_DURATION_MS + TURN_DURATION_MS, hasDrawnThisTurn: true, sideTake: null, forcedPileDraw: false,
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
  // işleme (tacking) denemeleri → atma. Her adım arasında taze `getDocFromServer`
  // okuması yapılır (stale roomData prop'una veya `onSnapshot`'ın yerel watch
  // cache'ine değil, doğrudan sunucudaki gerçek duruma göre hareket eder — bu
  // olmadan bir transaction'ın hemen ardından gelen düz `getDoc` bazen eski
  // veri döndürüp botu "sıkışmış" gibi gösterebiliyordu). `botTurnLockRef` aynı
  // tur için yeniden tetiklenmeyi engeller;
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

        let snap = await getDocFromServer(roomRef);
        if (!snap.exists()) return;
        let data = snap.data();
        if (cancelled || data.setupPhase || data.roundEnded || data.turn !== turnUid) return;

        // 1) Çekme kararı: yerden almak bir peri tamamlıyorsa/çok değerliyse
        // yerden al, aksi halde her zaman kapalı desteden çek. `forcedPileDraw`
        // aktifse (bu turda daha önce bir yandan-taşı iptal edildiyse) sadece
        // desteden çekilebilir.
        if (!data.hasDrawnThisTurn) {
          const rack = (data.racks?.[turnUid] || []).filter(Boolean);
          const prevUidForBot = getPrevTurnUid(data.players || [], turnUid);
          const discardPile = prevUidForBot ? (data.discardPiles?.[prevUidForBot] || []) : [];
          const topDiscard = discardPile.length > 0 ? discardPile[discardPile.length - 1] : null;
          const canTakeSide = !data.forcedPileDraw && topDiscard && shouldTakeDiscard(rack, topDiscard, data.okey || null);
          if (canTakeSide) {
            await handleDrawDiscard(turnUid);
          } else {
            await handleDrawPile(turnUid);
          }
          if (cancelled) return;
          snap = await getDocFromServer(roomRef);
          if (!snap.exists()) return;
          data = snap.data();
          if (data.setupPhase || data.roundEnded || data.turn !== turnUid) return;
        }

        // 2) El açma: tam 5 çift bulunduysa onu, yoksa toplamı >=101 olan greedy
        // per kombinasyonunu (varsa) masaya aç. Zaten açıksa yeni bulunan
        // perleri (eşik aranmaksızın) işleyip masaya ekler. Yandan taş alıp
        // henüz açmamışsa (pendingSideTake), açma BAŞARISIZ olursa taşı geri
        // koyup desteden çekmeye zorlanır (2. Faz'da eklenen "yandan taş alma"
        // kuralı — bkz. handleDrawDiscard/handleCancelSideTake).
        const attemptOpen = async () => {
          const okeyNow = data.okey || null;
          const rackNow = (data.racks?.[turnUid] || []).filter(Boolean);
          const alreadyOpened = !!data.hasOpened?.[turnUid];
          if (!alreadyOpened) {
            const pairs = pickBotPairs(rackNow, okeyNow);
            if (pairs.length === 5) { await handleBotOpenMelds(turnUid, pairs, true); return; }
            const melds = pickBotMelds(rackNow, okeyNow);
            const total = melds.reduce((s, m) => s + m.value, 0);
            if (melds.length > 0 && total >= OPEN_THRESHOLD) { await handleBotOpenMelds(turnUid, melds, false); return; }
          } else {
            const melds = pickBotMelds(rackNow, okeyNow);
            if (melds.length > 0) await handleBotOpenMelds(turnUid, melds, false);
          }
        };

        const pendingSideTake = data.sideTake?.uid === turnUid && !data.hasOpened?.[turnUid];

        await randomTurnDelay();
        if (cancelled) return;
        snap = await getDocFromServer(roomRef);
        if (!snap.exists()) return;
        data = snap.data();
        if (data.setupPhase || data.roundEnded || data.turn !== turnUid || !data.hasDrawnThisTurn) return;

        await attemptOpen();
        if (cancelled) return;
        snap = await getDocFromServer(roomRef);
        if (!snap.exists()) return;
        data = snap.data();
        if (data.setupPhase || data.roundEnded || data.turn !== turnUid) return;

        if (pendingSideTake && !data.hasOpened?.[turnUid]) {
          await handleCancelSideTake(turnUid);
          if (cancelled) return;
          snap = await getDocFromServer(roomRef);
          if (!snap.exists()) return;
          data = snap.data();
          if (data.setupPhase || data.roundEnded || data.turn !== turnUid) return;

          await randomTurnDelay();
          if (cancelled) return;
          await handleDrawPile(turnUid);
          if (cancelled) return;
          snap = await getDocFromServer(roomRef);
          if (!snap.exists()) return;
          data = snap.data();
          if (data.setupPhase || data.roundEnded || data.turn !== turnUid || !data.hasDrawnThisTurn) return;

          await randomTurnDelay();
          if (cancelled) return;
          await attemptOpen();
          if (cancelled) return;
          snap = await getDocFromServer(roomRef);
          if (!snap.exists()) return;
          data = snap.data();
          if (data.setupPhase || data.roundEnded || data.turn !== turnUid) return;
        }

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
            snap = await getDocFromServer(roomRef);
            if (!snap.exists()) return;
            data = snap.data();
            if (data.setupPhase || data.roundEnded || data.turn !== turnUid) return;
          }
        }

        // 4) Atma: hiçbir pere uymayan en gereksiz taşı at; Okey'i sadece
        // başka çaresi kalmadığında at (pickDiscardTile bu kuralı zaten uygular).
        await randomTurnDelay();
        if (cancelled) return;
        snap = await getDocFromServer(roomRef);
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
  }, [isHost, roomData.status, roomData.turn, roomData.setupPhase, roomData.roundEnded, botWatchdogTick]);

  // Hamle süresi (30sn) dolan bir İNSAN oyuncu için host otomatik olarak
  // devreye girer: bekleyen bir yandan-taş varsa geri koyar, çekmemişse
  // desteden çeker, sonunda ıstakasındaki en küçük (Okey olmayan) taşı atar.
  // Botlar zaten kendi mantıklarıyla (yukarıdaki efekt) süresinde hareket eder.
  const humanTimeoutLockRef = useRef(false);
  useEffect(() => {
    if (!isHost) return;
    if (roomData.status !== 'playing' || !roomData.racks) return;
    if (roomData.setupPhase || roomData.roundEnded) return;
    const turnUid = roomData.turn;
    if (!turnUid || isBotUid(turnUid) || !roomData.turnDeadline) return;

    const remaining = roomData.turnDeadline - Date.now();
    if (remaining > 0) {
      const timer = setTimeout(() => setBotWatchdogTick((n) => n + 1), remaining + 300);
      return () => clearTimeout(timer);
    }
    if (humanTimeoutLockRef.current) return;
    humanTimeoutLockRef.current = true;

    (async () => {
      try {
        let snap = await getDocFromServer(roomRef);
        if (!snap.exists()) return;
        let data = snap.data();
        if (data.turn !== turnUid || data.setupPhase || data.roundEnded) return;
        if (!data.turnDeadline || Date.now() < data.turnDeadline) return;

        if (data.sideTake?.uid === turnUid && !data.hasOpened?.[turnUid]) {
          await handleCancelSideTake(turnUid);
          snap = await getDocFromServer(roomRef);
          if (!snap.exists()) return;
          data = snap.data();
          if (data.turn !== turnUid || data.setupPhase || data.roundEnded) return;
        }

        if (!data.hasDrawnThisTurn) {
          await handleDrawPile(turnUid);
          snap = await getDocFromServer(roomRef);
          if (!snap.exists()) return;
          data = snap.data();
          if (data.turn !== turnUid || data.setupPhase || data.roundEnded) return;
        }

        if (data.hasDrawnThisTurn) {
          const rack = (data.racks?.[turnUid] || []).filter(Boolean);
          const tile = pickDiscardTile(rack, data.okey || null);
          if (tile) await handleDiscardTile(tile, turnUid);
        }
      } catch (err) {
        console.error('Okey101 süre aşımı hatası:', err);
      } finally {
        humanTimeoutLockRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, roomData.status, roomData.turn, roomData.setupPhase, roomData.roundEnded, roomData.turnDeadline, botWatchdogTick]);

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
  const nextUid = getNextTurnUid(roomData.players || [], user.uid);
  const topUid = (roomData.players || []).find((uid) => uid !== user.uid && uid !== prevUid && uid !== nextUid) || null;

  const turnPlayerName = players.find((p) => p.uid === roomData.turn)?.name || '...';

  // Kare masa düzeni: ben her zaman altta (ıstaka), SOLUMDAKİ (prevUid) taşımı
  // alabileceğim/onun taşını çekebileceğim kişi, SAĞIMDAKİ (nextUid) taşımı
  // atacağım kişi, ÜSTTEKİ kalan 4. oyuncu (Eşli modda -> eşim, bkz.
  // seatOrderedPlayers). Rakiplerin ıstakadaki taşları asla gösterilmez.
  const buildSeat = (uid) => {
    const p = players.find((pl) => pl.uid === uid);
    if (!p) return null;
    const pile = roomData.discardPiles?.[uid] || [];
    return {
      player: p,
      rackCount: roomData.racks?.[uid]?.filter(Boolean).length ?? 0,
      topDiscard: pile.length > 0 ? pile[pile.length - 1] : null,
      score: roomData.scores?.[uid] ?? 0,
    };
  };
  const topSeat = buildSeat(topUid);
  const leftSeat = buildSeat(prevUid);
  const rightSeat = buildSeat(nextUid);

  const mySideTakePending = roomData.sideTake?.uid === user.uid && !myHasOpened;

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

  // Yandan (soldan) taş alma: Ceza Kuralı açıksa VE oyuncu henüz elini
  // açmamışsa, ceza HEMEN yazılmaz — bunun yerine oyuncu "sideTake" ile
  // işaretlenir ve bu turu ya BAŞARILI bir açma (Seri/Çift Aç) ile ya da
  // taşı geri koyup (handleCancelSideTake) desteden çekerek sürdürmek
  // ZORUNDADIR. Ceza, ancak açma başarılı olduğunda (bkz. handleOpenSeries/
  // handleOpenPairs/handleBotOpenMelds) taşı atan kişiye yazılır.
  const handleDrawDiscard = async (actingUid = user.uid) => {
    const fromUid = actingUid === user.uid ? prevUid : getPrevTurnUid(roomData.players || [], actingUid);
    if (actingUid === user.uid && (!mustDraw || roomData.forcedPileDraw)) return;
    if (!fromUid) return;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== actingUid || data.hasDrawnThisTurn) return;
      if (data.forcedPileDraw) return;
      const pile = [...(data.discardPiles?.[fromUid] || [])];
      if (pile.length === 0) return;
      const drawn = pile.pop();
      const rack = [...(data.racks?.[actingUid] || [])];
      const emptyIdx = rack.findIndex((s) => s === null);
      if (emptyIdx === -1) return;
      rack[emptyIdx] = drawn;
      const update = { [`discardPiles.${fromUid}`]: pile, [`racks.${actingUid}`]: rack, hasDrawnThisTurn: true };
      if (data.rules?.penaltyToDiscarder && !data.hasOpened?.[actingUid]) {
        update.sideTake = { uid: actingUid, fromUid, tileId: drawn.id, tileValue: sideTakeTileValue(drawn, data.okey || null) };
      }
      t.update(roomRef, update);
    }).catch((err) => console.error('Okey101 yerden çekme hatası:', err));
  };

  // "Taşı Geri Koy / İptal": yandan aldığı taşla elini açamayan oyuncu, taşı
  // sahibinin atış yığınına geri koyar ve bu tur artık SADECE ortadaki kapalı
  // desteden çekebilir (forcedPileDraw).
  const handleCancelSideTake = async (actingUid = user.uid) => {
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const st = data.sideTake;
      if (!st || st.uid !== actingUid || data.turn !== actingUid || !data.hasDrawnThisTurn || data.hasOpened?.[actingUid]) return;
      const rack = [...(data.racks?.[actingUid] || [])];
      const idx = rack.findIndex((s) => s && s.id === st.tileId);
      if (idx === -1) return;
      const tile = rack[idx];
      rack[idx] = null;
      const pile = [...(data.discardPiles?.[st.fromUid] || []), tile];
      t.update(roomRef, {
        [`racks.${actingUid}`]: rack,
        [`discardPiles.${st.fromUid}`]: pile,
        hasDrawnThisTurn: false,
        sideTake: null,
        forcedPileDraw: true,
      });
    }).catch((err) => console.error('Okey101 taş geri koyma hatası:', err));
  };

  const handleDiscardTile = async (tile, actingUid = user.uid) => {
    if (actingUid === user.uid && !mustDiscard) return;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== actingUid || !data.hasDrawnThisTurn) return;
      if (data.sideTake?.uid === actingUid && !data.hasOpened?.[actingUid]) return; // önce açmalı ya da geri koymalı
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
          turnDeadline: null,
          hasDrawnThisTurn: false,
          sideTake: null,
          forcedPileDraw: false,
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
        turnDeadline: Date.now() + TURN_DURATION_MS,
        hasDrawnThisTurn: false,
        sideTake: null,
        forcedPileDraw: false,
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
      const update = {
        [`racks.${user.uid}`]: newRack,
        [`groups.${user.uid}`]: myGroupsNow,
        [`openedHands.${user.uid}`]: [...existingOpened, ...openedNow],
        [`hasOpened.${user.uid}`]: true,
      };
      // Yandan taş alıp bu açılışla elini açan oyuncu varsa, ceza ŞİMDİ o taşı
      // atan kişiye yazılır: çekilen taşın değerinin 10 katı (Seri/Set ile açma).
      const st = data.sideTake;
      let penalizedName = null; let penaltyAmount = 0;
      if (st && st.uid === user.uid) {
        penaltyAmount = (st.tileValue || 0) * SIDE_TAKE_SERIES_MULTIPLIER;
        update[`scores.${st.fromUid}`] = (data.scores?.[st.fromUid] || 0) - penaltyAmount;
        update.sideTake = null;
        penalizedName = players.find((p) => p.uid === st.fromUid)?.name || 'Rakip';
      }

      outcome = { success: true, penalizedName, penaltyAmount };
      t.update(roomRef, update);
    }).catch((err) => { console.error('Okey101 seri açma hatası:', err); outcome = null; });

    if (outcome?.reason === 'invalid') showToast('Geçersiz Per Dizilimi!', 'red');
    else if (outcome?.reason === 'below101') showToast('101\'e Ulaşamadınız! Ceza Yediniz.', 'red');
    else if (outcome?.success === true) {
      showToast(outcome.penalizedName ? `Per başarıyla açıldı! ${outcome.penalizedName} taşı yandan alındığı için -${outcome.penaltyAmount} ceza aldı.` : 'Per başarıyla açıldı!', outcome.penalizedName ? 'amber' : 'emerald');
    }
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
      const update = {
        [`racks.${user.uid}`]: newRack,
        [`groups.${user.uid}`]: myGroupsNow,
        [`openedHands.${user.uid}`]: [...existingOpened, ...openedNow],
        [`hasOpened.${user.uid}`]: true,
      };
      // Çift ile açma: çekilen taşın değerinin 20 katı ceza.
      const st = data.sideTake;
      let penalizedName = null; let penaltyAmount = 0;
      if (st && st.uid === user.uid) {
        penaltyAmount = (st.tileValue || 0) * SIDE_TAKE_PAIRS_MULTIPLIER;
        update[`scores.${st.fromUid}`] = (data.scores?.[st.fromUid] || 0) - penaltyAmount;
        update.sideTake = null;
        penalizedName = players.find((p) => p.uid === st.fromUid)?.name || 'Rakip';
      }

      outcome = { success: true, penalizedName, penaltyAmount };
      t.update(roomRef, update);
    }).catch((err) => { console.error('Okey101 çift açma hatası:', err); outcome = null; });

    if (outcome?.reason === 'already-opened') showToast('Zaten elini açtın.', 'red');
    else if (outcome?.reason === 'invalid') showToast('Geçersiz Çift Seçimi! Tam olarak 5 çift gerekli.', 'red');
    else if (outcome?.success === true) {
      showToast(outcome.penalizedName ? `5 çift başarıyla açıldı! ${outcome.penalizedName} taşı yandan alındığı için -${outcome.penaltyAmount} ceza aldı.` : '5 çift başarıyla açıldı!', outcome.penalizedName ? 'amber' : 'emerald');
    }
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
      const update = {
        [`racks.${actingUid}`]: actorRackNow,
        [`openedHands.${actingUid}`]: [...existingOpened, ...openedNow],
        [`hasOpened.${actingUid}`]: true,
      };
      const st = data.sideTake;
      let penalizedName = null;
      if (st && st.uid === actingUid) {
        const multiplier = isPairs ? SIDE_TAKE_PAIRS_MULTIPLIER : SIDE_TAKE_SERIES_MULTIPLIER;
        update[`scores.${st.fromUid}`] = (data.scores?.[st.fromUid] || 0) - (st.tileValue || 0) * multiplier;
        update.sideTake = null;
        penalizedName = players.find((p) => p.uid === st.fromUid)?.name || 'Rakip';
      }

      outcome = { success: true, penalizedName };
      t.update(roomRef, update);
    }).catch((err) => { console.error('Okey101 bot açma hatası:', err); outcome = null; });
    if (outcome?.penalizedName) showToast(`${outcome.penalizedName} taşı yandan alındığı için -101 ceza aldı.`, 'amber');
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
      const roundPlayers = seatOrderedPlayers(data.players || [], data.rules, data.teams);
      const { racks, drawPile, indicator } = dealTiles(roundPlayers);
      const okey = computeOkeyInfo(indicator);
      const groups = {}; const discardPiles = {}; const openedHands = {}; const hasOpened = {};
      roundPlayers.forEach((uid) => { groups[uid] = {}; discardPiles[uid] = []; openedHands[uid] = []; hasOpened[uid] = false; });
      t.update(roomRef, {
        players: roundPlayers, racks, drawPile, indicator, okey, groups, discardPiles, openedHands, hasOpened,
        setupPhase: true, setupEndsAt: Date.now() + SETUP_DURATION_MS,
        turn: roundPlayers[0] || null, turnDeadline: Date.now() + SETUP_DURATION_MS + TURN_DURATION_MS, hasDrawnThisTurn: true, sideTake: null, forcedPileDraw: false,
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
        topSeat={topSeat}
        leftSeat={leftSeat}
        rightSeat={rightSeat}
        hostUid={roomData.host}
        turnUid={roomData.turn}
        takeableUid={mustDraw && !roomData.forcedPileDraw ? prevUid : null}
        onTakeDiscard={() => handleDrawDiscard(user.uid)}
      >
        <div className="flex flex-col items-center gap-2">
          <div
            onPointerDown={mustDraw ? handlePileDrawPointerDown : undefined}
            onPointerMove={mustDraw ? handlePileDrawPointerMove : undefined}
            onPointerUp={mustDraw ? handlePileDrawPointerUp : undefined}
            onPointerCancel={mustDraw ? handlePileDrawPointerUp : undefined}
            title={mustDraw ? 'Desteden çek (tıkla ya da sürükle)' : undefined}
            className={`flex items-center gap-2 bg-slate-900/70 border rounded-lg px-4 py-2 transition-colors touch-none select-none ${mustDraw ? 'cursor-pointer border-amber-400 ring-2 ring-amber-400/50 animate-pulse' : 'border-slate-700 opacity-80'}`}
          >
            <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Çekilecek Taşlar</span>
            <TileBack size="small" />
            <span className="text-sm font-mono font-bold text-slate-200">{roomData.drawPile?.length ?? 0}</span>
          </div>

          {roomData.indicator && (
            <div className="flex items-center gap-2 bg-slate-900/70 border border-fuchsia-500/40 rounded-lg px-3 py-1.5">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Gösterge</span>
              <Tile tile={roomData.indicator} size="small" />
            </div>
          )}
        </div>
      </OpponentStrip>

      {pileGhost && (
        <div className="fixed z-[4000] pointer-events-none" style={{ left: pileGhost.x - 20, top: pileGhost.y - 28 }}>
          <TileBack />
        </div>
      )}

      {!setupPhase && (
        <div className={`flex items-center justify-center gap-2 text-center font-bold text-sm sm:text-base px-4 py-2 rounded-lg ${isMyTurn ? 'text-amber-300 bg-amber-500/10' : 'text-slate-400'}`}>
          <span>{isMyTurn ? (mustDraw ? 'Sıra Sende! Önce bir taş çek.' : 'Şimdi ıstakandan bir taş at.') : `${turnPlayerName} oynuyor...`}</span>
          {turnCountdown !== null && (
            <span className={`font-mono text-xs px-2 py-0.5 rounded-full border ${turnCountdown <= 10 ? 'text-red-300 border-red-500/50 bg-red-500/10' : 'text-slate-400 border-slate-600 bg-slate-900/50'}`}>{turnCountdown}s</span>
          )}
        </div>
      )}

      {mySideTakePending && (
        <div className="w-full max-w-md flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/50 rounded-xl px-4 py-3">
          <span className="text-xs sm:text-sm font-bold text-amber-300">Yandan taş aldın! Şimdi elini açmalısın (Seri/Çift Aç) ya da taşı geri koymalısın.</span>
          <button
            type="button"
            onClick={() => handleCancelSideTake()}
            className="shrink-0 text-xs font-bold bg-slate-900/70 hover:bg-slate-700 text-slate-200 border border-slate-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            Taşı Geri Koy
          </button>
        </div>
      )}

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
            canDiscard={mustDiscard && !mySideTakePending}
            lastDiscardTile={myTopDiscard}
            hasOpenedAlready={myHasOpened}
            onDiscardTile={handleDiscardTile}
            onOpenSeries={handleOpenSeries}
            onOpenPairs={handleOpenPairs}
            onTackTile={handleTackTile}
            showToast={showToast}
          />
        ) : (
          <div className="text-center text-slate-400 text-sm py-6">Bu odada oyuncu değilsin, ıstaka görüntülenemiyor.</div>
        )}
      </div>

      <button onClick={leaveRoom} className="text-xs text-red-400 hover:text-red-300 border border-red-500/40 hover:bg-red-500/10 px-4 py-2 rounded-lg font-medium transition-colors">Odadan Çık</button>
    </div>
  );
}
