import React, { useEffect, useRef, useState } from 'react';
import { doc, getDocFromServer, updateDoc, runTransaction } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import Okey101Lobby from './Okey101Lobby.jsx';
import PlayerRack from './PlayerRack.jsx';
import OpponentStrip from './OpponentStrip.jsx';
import SetupCountdown from './SetupCountdown.jsx';
import RoundResultBoard from './RoundResultBoard.jsx';
import Tile, { TileBack } from './Tile.jsx';
import useDrawDrag from './useDrawDrag.js';
import { dealTiles, SETUP_DURATION_MS, computeOkeyInfo, isOkeyTile, effectiveTile } from './tiles.js';
import { isBotUid } from './botPlayers.js';
import {
  getNextTurnUid, getPrevTurnUid, validateGroup, validateGroups, computeSelectedGroupsValue,
  validatePairs, canTackTile, isTileTackable, computeRoundEnd, getGroupOpenEnds,
  anyPairsOnTable, canPlayerLayPairs, canPlayerLayMelds,
  OPEN_THRESHOLD, PENALTY_POINTS, SIDE_TAKE_SERIES_MULTIPLIER, SIDE_TAKE_PAIRS_MULTIPLIER,
} from './gameLogic.js';
import {
  randomTurnDelay, pickBotMelds, pickBotPairs, shouldTakeDiscard, findTackOpportunities, pickDiscardTile, pickSmallestSafeDiscard,
} from './botAI.js';

const TURN_DURATION_MS = 30000;
// Bir bot turu bu süreyi aşarsa (ağ/transaction asılması) yeni bir deneme
// kilidi devralabilir. Normal bir tur artık ~3-6sn sürüyor.
const BOT_TURN_STUCK_MS = 15000;

// Yandan çekilen taşın "değeri": gerçek Okey (joker) ise en yüksek (13)
// sayılır, aksi halde kendi (Sahte Okey için: temsil ettiği) yüz değeri.
function sideTakeTileValue(tile, okeyInfo) {
  if (!tile) return 0;
  if (isOkeyTile(tile, okeyInfo)) return 13;
  return effectiveTile(tile, okeyInfo).number ?? 0;
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
  // { turnUid, startedAt } — zaman damgalı kilit; bkz. bot tur efekti.
  const botTurnLockRef = useRef(null);
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

  // Tam ekran modunda ıstaka ve taşlar belirgin şekilde büyür (sadece etrafı
  // izole etmek yetmiyor; asıl fayda daha rahat dokunulabilir taşlar).
  const [isFullscreenView, setIsFullscreenView] = useState(false);
  useEffect(() => {
    const sync = () => setIsFullscreenView(!!document.fullscreenElement);
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
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

  // Çekilen taş, Firestore turu tamamlanmadan ÖNCE bırakıldığı slotta gösterilir.
  // Hangi taşın geleceğini istemci zaten bilir (deste ve atılan taşlar herkese
  // açık veridir), bu yüzden sunucu gidiş-dönüşünü beklemek gereksiz bir gecikme
  // (ve oyuncunun 30sn'lik süresinden yeme) yaratıyordu. Taş slotta kısa bir
  // "flip" ile açılır; imleçte ayrıca yüzen bir kopya GÖSTERİLMEZ (eskiden
  // slottaki taşla üst üste biniyordu).
  const [pendingDraw, setPendingDraw] = useState(null); // { tile, index }
  const [drawFlipId, setDrawFlipId] = useState(null);
  const drawFlipTimerRef = useRef(null);
  const pendingDrawTimerRef = useRef(null);
  useEffect(() => () => {
    if (drawFlipTimerRef.current) clearTimeout(drawFlipTimerRef.current);
    if (pendingDrawTimerRef.current) clearTimeout(pendingDrawTimerRef.current);
  }, []);

  // Sunucu gerçek ıstakayı yazınca iyimser gösterim kendiliğinden düşer.
  useEffect(() => {
    if (!pendingDraw) return;
    const myRackNow = roomData.racks?.[user.uid] || [];
    if (myRackNow.some((t) => t && t.id === pendingDraw.tile.id)) setPendingDraw(null);
  }, [roomData.racks, pendingDraw, user.uid]);

  // ---- Çekme etkileşimi (deste + soldan gelen taş, ikisi de sürüklenebilir) ----
  // NOT: Hook'lar aşağıdaki erken return'lerden ÖNCE çağrılmak zorunda olduğu
  // için gereken durumlar burada ham `roomData`'dan türetiliyor.
  const amPlayer = (roomData.players || []).includes(user.uid);
  const canDrawNow = roomData.status === 'playing' && !!roomData.racks && !roomData.setupPhase
    && !roomData.roundEnded && roomData.turn === user.uid && !roomData.hasDrawnThisTurn && amPlayer;
  const prevSeatUid = getPrevTurnUid(roomData.players || [], user.uid);
  const incomingTile = prevSeatUid
    ? ((roomData.discardPiles?.[prevSeatUid] || []).slice(-1)[0] || null)
    : null;
  const canTakeIncomingNow = canDrawNow && !roomData.forcedPileDraw && !!incomingTile;

  const performDrawRef = useRef(null);
  const pileDrag = useDrawDrag({ enabled: canDrawNow, onDraw: (idx) => performDrawRef.current?.('pile', idx) });
  const incomingDrag = useDrawDrag({ enabled: canTakeIncomingNow, onDraw: (idx) => performDrawRef.current?.('discard', idx) });

  // Oyun 'playing' fazına yeni geçtiyse (henüz taş dağıtılmamışsa) host taşları dağıtır,
  // Göstergeyi belirler (ve ondan Okey'i türetir), 15sn hazırlık fazını başlatır ve
  // turu ilk oyuncuya (22 taşlı) verir. İlk oyuncu zaten fazladan taşla başladığı için
  // ilk turunda tekrar çekmesi GEREKMEZ — hasDrawnThisTurn baştan true (gerçek kural).
  useEffect(() => {
    if (roomData.status !== 'playing' || roomData.racks || !isHost) return;
    const players = seatOrderedPlayers(roomData.players || [], roomData.rules, roomData.teams);
    const { racks, drawPile, indicator } = dealTiles(players);
    const okey = computeOkeyInfo(indicator);
    const groups = {}; const discardPiles = {}; const openedHands = {}; const hasOpened = {}; const openedWithPairs = {};
    players.forEach((uid) => { groups[uid] = {}; discardPiles[uid] = []; openedHands[uid] = []; hasOpened[uid] = false; openedWithPairs[uid] = false; });
    updateDoc(roomRef, {
      players, racks, drawPile, indicator, okey, groups, discardPiles, openedHands, hasOpened, openedWithPairs,
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
  // sürer). `roomData.turn` bir bota geçtiğinde: kısa bir gecikme → çekme
  // kararı (yerden mi destede mi) → el açma denemesi (çift/per) → işleme
  // (tacking) denemeleri → atma.
  //
  // PERFORMANS: Adımlar arasında ARTIK sunucudan tekrar okuma (getDocFromServer)
  // YAPILMAZ. Her mutasyon fonksiyonu, transaction içinde yazdığı durumun tam
  // bir kopyasını (`outcome.next`) geri döndürür ve orkestrasyon bu yerel
  // görüntüyü zincirleyerek ilerler. Eskiden her adımda bir sunucu gidiş-dönüşü
  // yapılıyordu; bu, tek bir bot turunu 20 saniyenin üzerine çıkarıp aşağıdaki
  // watchdog tarafından sürekli iptal edilip baştan başlatılmasına (yani botun
  // hiç oynayamamasına) yol açıyordu.
  //
  // `botTurnLockRef` aynı tur için yeniden tetiklenmeyi engeller; kilit
  // zaman damgalı olduğu için gerçekten ASILI KALMIŞ bir deneme
  // (BOT_TURN_STUCK_MS sonrası) yenisi tarafından devralınabilir — ama sağlıklı
  // ilerleyen bir tur ASLA yarıda kesilmez.
  useEffect(() => {
    if (!isHost) return;
    if (roomData.status !== 'playing' || !roomData.racks) return;
    if (roomData.setupPhase || roomData.roundEnded) return;
    const turnUid = roomData.turn;
    if (!turnUid || !isBotUid(turnUid)) return;

    const lock = botTurnLockRef.current;
    if (lock && lock.turnUid === turnUid && Date.now() - lock.startedAt < BOT_TURN_STUCK_MS) return;

    const myLock = { turnUid, startedAt: Date.now() };
    botTurnLockRef.current = myLock;
    const isStale = () => botTurnLockRef.current !== myLock;

    (async () => {
      try {
        await randomTurnDelay();
        if (isStale()) return;

        const snap = await getDocFromServer(roomRef);
        if (!snap.exists()) return;
        let data = snap.data();
        if (data.setupPhase || data.roundEnded || data.turn !== turnUid) return;

        // Her mutasyondan sonra yerel görüntüyü ilerletir; işlem başarısızsa
        // (ya da tur artık bu botta değilse) turu sonlandırır.
        const apply = (result) => {
          if (!result?.success || !result.next) return false;
          data = result.next;
          return !(data.setupPhase || data.roundEnded || data.turn !== turnUid);
        };

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
          const drawResult = canTakeSide ? await handleDrawDiscard(turnUid) : await handleDrawPile(turnUid);
          if (isStale()) return;
          if (!apply(drawResult)) return;
        }

        // 2) El açma: tam 5 çift bulunduysa onu, yoksa toplamı >=101 olan greedy
        // per kombinasyonunu (varsa) masaya aç. Zaten açıksa yeni bulunan
        // perleri (eşik aranmaksızın) işleyip masaya ekler. Yandan taş alıp
        // henüz açmamışsa (pendingSideTake), açma BAŞARISIZ olursa taşı geri
        // koyup desteden çekmeye zorlanır (bkz. handleDrawDiscard/handleCancelSideTake).
        const attemptOpen = async () => {
          const okeyNow = data.okey || null;
          const rackNow = (data.racks?.[turnUid] || []).filter(Boolean);
          const alreadyOpened = !!data.hasOpened?.[turnUid];
          const apply2 = (r) => { if (r?.success && r.next) data = r.next; };

          if (!alreadyOpened) {
            const pairs = pickBotPairs(rackNow, okeyNow);
            if (pairs.length === 5) { apply2(await handleBotOpenMelds(turnUid, pairs, true)); return; }
            const melds = pickBotMelds(rackNow, okeyNow);
            const total = melds.reduce((s, m) => s + m.value, 0);
            if (melds.length > 0 && total >= OPEN_THRESHOLD) apply2(await handleBotOpenMelds(turnUid, melds, false));
            return;
          }

          // Çift ile açan bot artık per (seri/set) süremez; sadece elinde kalan
          // çiftleri masaya sürer (5. madde).
          if (data.openedWithPairs?.[turnUid]) {
            const pairs = pickBotPairs(rackNow, okeyNow);
            if (pairs.length > 0) apply2(await handleBotOpenMelds(turnUid, pairs, true));
            return;
          }

          // Seri/Set ile açan bot: perlerini sürer; ayrıca masada çift açan
          // biri varsa elindeki çiftleri de işleyebilir.
          const melds = pickBotMelds(rackNow, okeyNow);
          if (melds.length > 0) apply2(await handleBotOpenMelds(turnUid, melds, false));
          if (anyPairsOnTable(data.openedWithPairs)) {
            const rackAfter = (data.racks?.[turnUid] || []).filter(Boolean);
            const pairs = pickBotPairs(rackAfter, okeyNow);
            // Atacak taş kalsın diye tüm eli çift olarak masaya sürmez.
            if (pairs.length > 0 && rackAfter.length - pairs.length * 2 >= 1) {
              apply2(await handleBotOpenMelds(turnUid, pairs, true));
            }
          }
        };

        const pendingSideTake = data.sideTake?.uid === turnUid && !data.hasOpened?.[turnUid];

        await randomTurnDelay();
        if (isStale()) return;
        await attemptOpen();
        if (isStale() || data.setupPhase || data.roundEnded || data.turn !== turnUid) return;

        if (pendingSideTake && !data.hasOpened?.[turnUid]) {
          if (!apply(await handleCancelSideTake(turnUid))) return;
          if (isStale()) return;
          await randomTurnDelay();
          if (isStale()) return;
          if (!apply(await handleDrawPile(turnUid))) return;
          await randomTurnDelay();
          if (isStale()) return;
          await attemptOpen();
          if (isStale() || data.setupPhase || data.roundEnded || data.turn !== turnUid) return;
        }

        // 3) İşleme: elini açtıysa, ıstakada en az 1 taş (zorunlu atma için)
        // kalacak şekilde, masadaki (kendi/rakip) perlere uyan taşları işler.
        if (data.hasOpened?.[turnUid]) {
          for (let i = 0; i < 22; i++) {
            if (isStale()) return;
            const rackNow = (data.racks?.[turnUid] || []).filter(Boolean);
            if (rackNow.length <= 1) break;
            const opportunities = findTackOpportunities(rackNow, data.openedHands || {}, data.okey || null);
            if (opportunities.length === 0) break;
            const opp = opportunities[0];
            await randomTurnDelay();
            if (isStale()) return;
            const tackResult = await handleTackTile(opp.tile, { uid: opp.targetUid, groupIndex: opp.groupIndex, side: opp.side }, turnUid);
            if (!apply(tackResult)) return;
          }
        }

        // 4) Atma: hiçbir pere uymayan/en düşük değerli taşı at; Okey'i ve
        // (mümkünse) işlek taşları atmaz — pickDiscardTile bunu zaten uygular.
        await randomTurnDelay();
        if (isStale()) return;
        if (data.setupPhase || data.roundEnded || data.turn !== turnUid || !data.hasDrawnThisTurn) return;

        const finalRack = (data.racks?.[turnUid] || []).filter(Boolean);
        const discardTile = pickDiscardTile(finalRack, data.okey || null, data.openedHands || {});
        if (discardTile) await handleDiscardTile(discardTile, turnUid);
      } catch (err) {
        console.error('Okey101 bot tur hatası:', err);
      } finally {
        if (botTurnLockRef.current === myLock) botTurnLockRef.current = null;
      }
    })();

    // NOT: Cleanup BİLEREK kilidi sıfırlamaz / çalışan turu iptal etmez —
    // aksi halde botun kendi yazdığı her güncelleme (turn/racks değişimi)
    // efekti yeniden çalıştırıp turu yarıda kesiyordu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, roomData.status, roomData.turn, roomData.setupPhase, roomData.roundEnded, botWatchdogTick]);

  // Hamle süresi (30sn) dolan HER oyuncu (insan VE bot) için host otomatik
  // devreye girer: bekleyen bir yandan-taş varsa geri koyar, çekmemişse
  // desteden çeker, sonunda ıstakasındaki en küçük/en zararsız (Okey ve
  // mümkünse işlek olmayan) taşı atar. Botlar normalde kendi mantıklarıyla
  // çok daha erken oynar; bu yol yalnızca bir bot turu beklenmedik şekilde
  // takılırsa oyunun tıkanmasını önleyen son emniyet supabıdır.
  const humanTimeoutLockRef = useRef(false);
  useEffect(() => {
    if (!isHost) return;
    if (roomData.status !== 'playing' || !roomData.racks) return;
    if (roomData.setupPhase || roomData.roundEnded) return;
    const turnUid = roomData.turn;
    if (!turnUid || !roomData.turnDeadline) return;

    const remaining = roomData.turnDeadline - Date.now();
    if (remaining > 0) {
      const timer = setTimeout(() => setBotWatchdogTick((n) => n + 1), remaining + 300);
      return () => clearTimeout(timer);
    }
    if (humanTimeoutLockRef.current) return;
    humanTimeoutLockRef.current = true;

    (async () => {
      try {
        const snap = await getDocFromServer(roomRef);
        if (!snap.exists()) return;
        let data = snap.data();
        if (data.turn !== turnUid || data.setupPhase || data.roundEnded) return;
        if (!data.turnDeadline || Date.now() < data.turnDeadline) return;

        const apply = (result) => {
          if (!result?.success || !result.next) return false;
          data = result.next;
          return !(data.setupPhase || data.roundEnded || data.turn !== turnUid);
        };

        if (data.sideTake?.uid === turnUid && !data.hasOpened?.[turnUid]) {
          if (!apply(await handleCancelSideTake(turnUid))) return;
        }
        if (!data.hasDrawnThisTurn) {
          if (!apply(await handleDrawPile(turnUid))) return;
        }
        if (data.hasDrawnThisTurn) {
          const rack = (data.racks?.[turnUid] || []).filter(Boolean);
          const tile = pickSmallestSafeDiscard(rack, data.okey || null, data.openedHands || {});
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

  // NOT: `explicitUid` verilmemişse (insan kendi arayüzünden tıklayıp/sürükleyip
  // çağırıyorsa) `mustDraw` gibi o ANKİ render'a ait (potansiyel olarak birazdan
  // değişecek) istemci durumlarına göre önceden engellenir. `explicitUid`
  // VERİLMİŞSE (bot ya da süre-aşımı orkestrasyonu, actingUid===user.uid olsa
  // bile) bu istemci taraflı ön-kontrol ATLANIR ve doğrudan transaction'ın
  // taze sunucu-taraflı kontrolüne güvenilir — aksi halde (örn. host'un KENDİ
  // turu süre aşımına uğrayıp önce "taşı geri koy" sonra "çek" adımlarını art
  // arda tetiklediğinde) bu fonksiyonların bağlı olduğu `mustDraw`/`mustDiscard`
  // gibi değerler o ara adımların ürettiği YENİ sunucu durumunu henüz
  // yansıtmayan BAYAT bir closure'dan okunup hatalı şekilde işlemi durdurabilir.
  const handleDrawPile = async (explicitUid, targetIndex = null) => {
    const actingUid = explicitUid || user.uid;
    if (!explicitUid && !mustDraw) return { success: false };
    let outcome = { success: false };
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== actingUid || data.hasDrawnThisTurn) return;
      const pile = [...(data.drawPile || [])];
      if (pile.length === 0) return;
      const drawn = pile.pop();
      const rack = [...(data.racks?.[actingUid] || [])];
      const hasTarget = targetIndex !== null && targetIndex !== undefined && rack[targetIndex] === null;
      const emptyIdx = hasTarget ? targetIndex : rack.findIndex((s) => s === null);
      if (emptyIdx === -1) return;
      rack[emptyIdx] = drawn;
      t.update(roomRef, { drawPile: pile, [`racks.${actingUid}`]: rack, hasDrawnThisTurn: true });
      outcome = {
        success: true,
        tile: drawn,
        next: { ...data, drawPile: pile, racks: { ...(data.racks || {}), [actingUid]: rack }, hasDrawnThisTurn: true },
      };
    }).catch((err) => { console.error('Okey101 çekme hatası:', err); outcome = { success: false }; });
    return outcome;
  };

  // Yandan (soldan) taş alma: oyuncu henüz elini açmamışsa, ceza HEMEN
  // yazılmaz — bunun yerine oyuncu "sideTake" ile işaretlenir ve bu turu ya
  // BAŞARILI bir açma (Seri/Çift Aç) ile ya da taşı geri koyup
  // (handleCancelSideTake) desteden çekerek sürdürmek ZORUNDADIR (koşulsuz
  // kural — bir "Ceza Kuralı" ayarına bağlı DEĞİLDİR). Ceza, ancak açma
  // başarılı olduğunda (bkz. handleOpenSeries/handleOpenPairs/
  // handleBotOpenMelds) taşı atan kişiye yazılır.
  const handleDrawDiscard = async (explicitUid, targetIndex = null) => {
    const actingUid = explicitUid || user.uid;
    const fromUid = actingUid === user.uid ? prevUid : getPrevTurnUid(roomData.players || [], actingUid);
    if (!explicitUid && (!mustDraw || roomData.forcedPileDraw)) return { success: false };
    if (!fromUid) return { success: false };
    let outcome = { success: false };
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
      const hasTarget = targetIndex !== null && targetIndex !== undefined && rack[targetIndex] === null;
      const emptyIdx = hasTarget ? targetIndex : rack.findIndex((s) => s === null);
      if (emptyIdx === -1) return;
      rack[emptyIdx] = drawn;
      const update = { [`discardPiles.${fromUid}`]: pile, [`racks.${actingUid}`]: rack, hasDrawnThisTurn: true };
      const sideTake = data.hasOpened?.[actingUid]
        ? (data.sideTake ?? null)
        : { uid: actingUid, fromUid, tileId: drawn.id, tileValue: sideTakeTileValue(drawn, data.okey || null) };
      if (!data.hasOpened?.[actingUid]) update.sideTake = sideTake;
      t.update(roomRef, update);
      outcome = {
        success: true,
        tile: drawn,
        next: {
          ...data,
          discardPiles: { ...(data.discardPiles || {}), [fromUid]: pile },
          racks: { ...(data.racks || {}), [actingUid]: rack },
          hasDrawnThisTurn: true,
          sideTake,
        },
      };
    }).catch((err) => { console.error('Okey101 yerden çekme hatası:', err); outcome = { success: false }; });
    return outcome;
  };

  // Insan oyuncunun çekme akışı (hem kapalı deste hem soldan gelen taş için).
  // Taş, sunucu cevabı BEKLENMEDEN hedef slotta gösterilir; hangi taşın
  // geleceğini istemci zaten bilir. Işlem başarısız olursa iyimser gösterim
  // hemen geri alınır.
  const performDraw = async (source, targetIndex) => {
    if (!mustDraw) return;
    const rackNow = roomData.racks?.[user.uid] || [];
    const known = source === 'pile'
      ? ((roomData.drawPile || []).slice(-1)[0] || null)
      : incomingTile;
    const wantedIdx = (targetIndex !== null && targetIndex !== undefined && rackNow[targetIndex] === null)
      ? targetIndex
      : rackNow.findIndex((s) => s === null);

    if (known && wantedIdx !== -1) {
      setPendingDraw({ tile: known, index: wantedIdx });
      setDrawFlipId(known.id);
      if (drawFlipTimerRef.current) clearTimeout(drawFlipTimerRef.current);
      drawFlipTimerRef.current = setTimeout(() => setDrawFlipId(null), 220);
      // Emniyet: sunucu beklenenden farklı bir taş yazarsa iyimser gösterim
      // sonsuza dek asılı kalmasın.
      if (pendingDrawTimerRef.current) clearTimeout(pendingDrawTimerRef.current);
      pendingDrawTimerRef.current = setTimeout(() => setPendingDraw(null), 2500);
    }

    const result = source === 'pile'
      ? await handleDrawPile(undefined, targetIndex)
      : await handleDrawDiscard(undefined, targetIndex);
    if (!result?.success) { setPendingDraw(null); setDrawFlipId(null); }
    return result;
  };
  performDrawRef.current = performDraw;

  // "Taşı Geri Koy / İptal": yandan aldığı taşla elini açamayan oyuncu, taşı
  // sahibinin atış yığınına geri koyar ve bu tur artık SADECE ortadaki kapalı
  // desteden çekebilir (forcedPileDraw).
  const handleCancelSideTake = async (actingUid = user.uid) => {
    let outcome = { success: false };
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
      outcome = {
        success: true,
        next: {
          ...data,
          racks: { ...(data.racks || {}), [actingUid]: rack },
          discardPiles: { ...(data.discardPiles || {}), [st.fromUid]: pile },
          hasDrawnThisTurn: false,
          sideTake: null,
          forcedPileDraw: true,
        },
      };
    }).catch((err) => { console.error('Okey101 taş geri koyma hatası:', err); outcome = { success: false }; });
    return outcome;
  };

  const handleDiscardTile = async (tile, explicitUid) => {
    const actingUid = explicitUid || user.uid;
    if (!explicitUid && !mustDiscard) return;
    let outcome = null;
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
      const okeyNow = data.okey || null;

      // Eli bitirme: son taşı atınca ıstaka tamamen boşaldıysa el (round) biter.
      const rackEmptied = rack.every((s) => s === null);
      if (rackEmptied) {
        const wonByOkeyDiscard = isOkeyTile(tile, okeyNow);
        const { newScores, roundResult } = computeRoundEnd({
          players: data.players || [],
          scores: data.scores || {},
          roundStartScores: data.roundStartScores || {},
          hasOpened: data.hasOpened || {},
          openedWithPairs: data.openedWithPairs || {},
          racks: { ...(data.racks || {}), [actingUid]: rack },
          rules: data.rules || {},
          teams: data.teams || null,
          okeyInfo: okeyNow,
          foldMultiplier: data.foldMultiplier || 1,
        }, actingUid, wonByOkeyDiscard);

        outcome = { success: true, roundEnded: true };
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

      // İşlek (masadaki -kendisinin ya da rakibinin- bir seri/set'e tam
      // oturan) ya da Okey bir taş atılırsa, atan oyuncuya -101 ceza yazılır
      // (tur/eli bitiren atışlar hariç — o puanlama computeRoundEnd'de ayrı
      // ele alınıyor, üstüne ayrıca bu ceza eklenmez). İkisi AYRI durumlardır
      // ve oyuncuya da ayrı ayrı bildirilir.
      const discardedOkey = isOkeyTile(tile, okeyNow);
      const discardedTackable = !discardedOkey && isTileTackable(tile, data.openedHands || {}, okeyNow);
      const carelessDiscard = discardedOkey || discardedTackable;
      const update = {
        [`racks.${actingUid}`]: rack,
        [`groups.${actingUid}`]: actorGroupsNext,
        [`discardPiles.${actingUid}`]: discardPile,
        turn: getNextTurnUid(data.players || [], actingUid),
        turnDeadline: Date.now() + TURN_DURATION_MS,
        hasDrawnThisTurn: false,
        sideTake: null,
        forcedPileDraw: false,
      };
      if (carelessDiscard) {
        update[`scores.${actingUid}`] = (data.scores?.[actingUid] || 0) - PENALTY_POINTS;
      }
      outcome = { success: true, carelessDiscard, discardedOkey, discardedTackable };
      t.update(roomRef, update);
    }).catch((err) => { console.error('Okey101 atma hatası:', err); outcome = null; });

    if (outcome?.discardedOkey) showToast('Okey attın! -101 ceza aldın.', 'red');
    else if (outcome?.discardedTackable) showToast('İşlek taş attın! -101 ceza aldın.', 'red');
    return outcome;
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

      // ÇİFT ile açan oyuncu artık masaya seri/set (per) süremez — sadece
      // kalan çiftlerini sürebilir ve tek tek taş işleyebilir (5. madde).
      if (!canPlayerLayMelds(user.uid, data.openedWithPairs)) {
        outcome = { success: false, reason: 'pairs-opener' };
        return;
      }

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

    if (outcome?.reason === 'pairs-opener') showToast('Çift açtığın için per (seri/set) açamazsın. Sadece çift sürebilir ve tek tek taş işleyebilirsin.', 'red');
    else if (outcome?.reason === 'invalid') showToast('Geçersiz Per Dizilimi!', 'red');
    else if (outcome?.reason === 'below101') showToast('101\'e Ulaşamadınız! Ceza Yediniz.', 'red');
    else if (outcome?.success === true) {
      showToast(outcome.penalizedName ? `Per başarıyla açıldı! ${outcome.penalizedName} taşı yandan alındığı için -${outcome.penaltyAmount} ceza aldı.` : 'Per başarıyla açıldı!', outcome.penalizedName ? 'amber' : 'emerald');
    }
    return outcome;
  };

  // "Çift Aç" / "Çift İşle" (5. madde):
  //   - Henüz açmamış oyuncu: TAM 5 çift ile açar (101 toplamı ARANMAZ) ve
  //     `openedWithPairs` olarak işaretlenir (tur sonunda 2 kat ceza yer).
  //   - ÇİFT ile açmış oyuncu: kalan çiftlerini (1+) masaya sürebilir.
  //   - SERİ/SET ile açmış oyuncu: elindeki çiftleri ANCAK masada çift açmış
  //     bir oyuncu varsa sürebilir; bu onu "çift açan" yapmaz (cezası değişmez).
  const handleOpenPairs = async (selectedGroupIds) => {
    if (!mustDiscard || selectedGroupIds.length === 0) return;
    let outcome = null;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== user.uid || !data.hasDrawnThisTurn) return;

      const alreadyOpened = !!data.hasOpened?.[user.uid];
      if (!canPlayerLayPairs(user.uid, data.hasOpened, data.openedWithPairs)) {
        outcome = { success: false, reason: 'no-pairs-on-table' };
        return;
      }

      const myRackNow = data.racks?.[user.uid] || [];
      const myGroupsNow = { ...(data.groups?.[user.uid] || {}) };
      const tilesById = {}; myRackNow.forEach((tl) => { if (tl) tilesById[tl.id] = tl; });
      const validGroupIds = selectedGroupIds.filter((gid) => myGroupsNow[gid]);

      const okeyNow = data.okey || null;
      // İlk açılışta TAM 5 çift şart; sonraki turlarda 1+ çift yeterlidir.
      const { valid } = validatePairs(myGroupsNow, tilesById, validGroupIds, okeyNow, !alreadyOpened);
      if (!valid) { outcome = { success: false, reason: alreadyOpened ? 'invalid-pair' : 'invalid' }; return; }

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
      // Sadece İLK açılışını çiftle yapan oyuncu "çift açan" sayılır.
      if (!alreadyOpened) update[`openedWithPairs.${user.uid}`] = true;

      // Çift ile açma: çekilen taşın değerinin 20 katı ceza.
      const st = data.sideTake;
      let penalizedName = null; let penaltyAmount = 0;
      if (st && st.uid === user.uid) {
        penaltyAmount = (st.tileValue || 0) * SIDE_TAKE_PAIRS_MULTIPLIER;
        update[`scores.${st.fromUid}`] = (data.scores?.[st.fromUid] || 0) - penaltyAmount;
        update.sideTake = null;
        penalizedName = players.find((p) => p.uid === st.fromUid)?.name || 'Rakip';
      }

      outcome = { success: true, alreadyOpened, count: validGroupIds.length, penalizedName, penaltyAmount };
      t.update(roomRef, update);
    }).catch((err) => { console.error('Okey101 çift açma hatası:', err); outcome = null; });

    if (outcome?.reason === 'no-pairs-on-table') showToast('Elindeki çiftleri ancak masada çift açan bir oyuncu varsa işleyebilirsin.', 'red');
    else if (outcome?.reason === 'invalid') showToast('Geçersiz Çift Seçimi! Açılış için tam olarak 5 çift gerekli.', 'red');
    else if (outcome?.reason === 'invalid-pair') showToast('Geçersiz çift! Her per tam 2 taş ve aynı renk+sayı olmalı.', 'red');
    else if (outcome?.success === true) {
      const base = outcome.alreadyOpened ? `${outcome.count} çift masaya sürüldü!` : '5 çift başarıyla açıldı!';
      showToast(outcome.penalizedName ? `${base} ${outcome.penalizedName} taşı yandan alındığı için -${outcome.penaltyAmount} ceza aldı.` : base, outcome.penalizedName ? 'amber' : 'emerald');
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
      // Botlar da insanla AYNI çift kurallarına tabidir (5. madde).
      if (isPairs && !canPlayerLayPairs(actingUid, data.hasOpened, data.openedWithPairs)) { outcome = { success: false }; return; }
      if (!isPairs && !canPlayerLayMelds(actingUid, data.openedWithPairs)) { outcome = { success: false }; return; }

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
      if (isPairs && !alreadyOpened && melds.length !== 5) { outcome = { success: false }; return; }
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
      const nextOpenedWithPairs = { ...(data.openedWithPairs || {}) };
      const update = {
        [`racks.${actingUid}`]: actorRackNow,
        [`openedHands.${actingUid}`]: [...existingOpened, ...openedNow],
        [`hasOpened.${actingUid}`]: true,
      };
      if (isPairs && !alreadyOpened) {
        nextOpenedWithPairs[actingUid] = true;
        update[`openedWithPairs.${actingUid}`] = true;
      }
      const st = data.sideTake;
      let penalizedName = null; let penaltyAmount = 0;
      const nextScores = { ...(data.scores || {}) };
      if (st && st.uid === actingUid) {
        const multiplier = isPairs ? SIDE_TAKE_PAIRS_MULTIPLIER : SIDE_TAKE_SERIES_MULTIPLIER;
        penaltyAmount = (st.tileValue || 0) * multiplier;
        nextScores[st.fromUid] = (data.scores?.[st.fromUid] || 0) - penaltyAmount;
        update[`scores.${st.fromUid}`] = nextScores[st.fromUid];
        update.sideTake = null;
        penalizedName = players.find((p) => p.uid === st.fromUid)?.name || 'Rakip';
      }

      outcome = {
        success: true,
        penalizedName,
        penaltyAmount,
        next: {
          ...data,
          racks: { ...(data.racks || {}), [actingUid]: actorRackNow },
          openedHands: { ...(data.openedHands || {}), [actingUid]: [...existingOpened, ...openedNow] },
          hasOpened: { ...(data.hasOpened || {}), [actingUid]: true },
          openedWithPairs: nextOpenedWithPairs,
          scores: nextScores,
          sideTake: penalizedName ? null : (data.sideTake ?? null),
        },
      };
      t.update(roomRef, update);
    }).catch((err) => { console.error('Okey101 bot açma hatası:', err); outcome = null; });
    if (outcome?.penalizedName) showToast(`${outcome.penalizedName} taşı yandan alındığı için -${outcome.penaltyAmount} ceza aldı.`, 'amber');
    return outcome;
  };

  // İşleme (tacking): elini açmış (hasOpened) bir oyuncu, sırası gelip taş
  // çektikten sonra, ıstakasındaki TEK bir taşı masadaki (kendisinin ya da
  // rakibinin) açık bir seri/set'in sağına/soluna ekleyebilir. Bozuyorsa
  // hiçbir şey değişmez (taş ıstakada kalır).
  const handleTackTile = async (tile, target, explicitUid) => {
    const actingUid = explicitUid || user.uid;
    if (!explicitUid && (!mustDiscard || !myHasOpened)) return;
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
      const newRack = [...actorRackNow];
      const update = {};
      const nextScores = { ...(data.scores || {}) };

      if (target.replaceTileId) {
        // Okey işleği: gruptaki Okey/Sahte Okey'i, temsil ettiği GERÇEK taşla
        // değiştirir; çıkan Okey işleyen oyuncunun ıstakasına gelir (kazanılır).
        if (isOkeyTile(tile, okeyNow)) { outcome = { success: false }; return; } // Okey'i Okey ile değiştiremezsin
        const jokerIdx = group.tiles.findIndex((tl) => tl.id === target.replaceTileId);
        if (jokerIdx === -1 || !isOkeyTile(group.tiles[jokerIdx], okeyNow)) { outcome = { success: false }; return; }
        const jokerTile = group.tiles[jokerIdx];
        const newGroupTiles = [...group.tiles]; newGroupTiles[jokerIdx] = tile;
        const result = validateGroup(newGroupTiles, okeyNow);
        if (!result.valid) { outcome = { success: false }; return; }

        targetOpened[target.groupIndex] = { ...group, tiles: newGroupTiles };
        newRack[idx] = jokerTile; // atılan taş çıkar, Okey onun yerine ıstakaya gelir

        // Ceza: SADECE başkasının (rakip) perinden Okey alınırsa, VE Eşli
        // modda aynı takımdan değillerse (eşinin okeyini almanın cezası yok).
        let penalizedName = null;
        if (target.uid !== actingUid) {
          const teamsA = data.teams?.A || []; const teamsB = data.teams?.B || [];
          const sameTeam = data.rules?.gameType === '2v2'
            && ((teamsA.includes(actingUid) && teamsA.includes(target.uid)) || (teamsB.includes(actingUid) && teamsB.includes(target.uid)));
          if (!sameTeam) {
            nextScores[target.uid] = (data.scores?.[target.uid] || 0) - PENALTY_POINTS;
            update[`scores.${target.uid}`] = nextScores[target.uid];
            penalizedName = players.find((p) => p.uid === target.uid)?.name || 'Rakip';
          }
        }
        outcome = { success: true, wonOkey: true, penalizedName };
      } else {
        const { valid, newTiles } = canTackTile(group.tiles, group.type, tile, target.side, okeyNow);
        if (!valid) { outcome = { success: false }; return; }
        targetOpened[target.groupIndex] = { ...group, tiles: newTiles };
        newRack[idx] = null;
        outcome = { success: true };
      }

      // Eli bitirme: TAŞ ATMADAN, elindeki son taşı da işleyerek (tacking)
      // ıstakayı tamamen boşaltmak da GEÇERLİ bir bitiriştir (gerçek 101 Okey
      // kuralı). Bu kontrol eskiden SADECE handleDiscardTile'da vardı; bu
      // yüzden bir oyuncu son taşını atmak yerine işlediğinde tur hiç bitmiyor,
      // `hasDrawnThisTurn` true'da asılı kalıp oyun tıkanıyordu (özellikle
      // botlar TAM bu şekilde takılıyordu).
      const rackEmptiedByTack = !target.replaceTileId && newRack.every((s) => s === null);
      if (rackEmptiedByTack) {
        const { newScores, roundResult } = computeRoundEnd({
          players: data.players || [],
          scores: { ...(data.scores || {}), ...nextScores },
          roundStartScores: data.roundStartScores || {},
          hasOpened: data.hasOpened || {},
          openedWithPairs: data.openedWithPairs || {},
          racks: { ...(data.racks || {}), [actingUid]: newRack },
          rules: data.rules || {},
          teams: data.teams || null,
          okeyInfo: okeyNow,
          foldMultiplier: data.foldMultiplier || 1,
        }, actingUid, false);

        outcome.roundEnded = true;
        t.update(roomRef, {
          ...update,
          [`racks.${actingUid}`]: newRack,
          [`openedHands.${target.uid}`]: targetOpened,
          turn: null,
          turnDeadline: null,
          hasDrawnThisTurn: false,
          sideTake: null,
          forcedPileDraw: false,
          roundEnded: true,
          roundResult,
          scores: newScores,
        });
        outcome.next = { ...data, roundEnded: true, roundResult, scores: newScores };
        return;
      }

      update[`racks.${actingUid}`] = newRack;
      update[`openedHands.${target.uid}`] = targetOpened;
      t.update(roomRef, update);
      outcome.next = {
        ...data,
        racks: { ...(data.racks || {}), [actingUid]: newRack },
        openedHands: { ...(data.openedHands || {}), [target.uid]: targetOpened },
        scores: nextScores,
      };
    }).catch((err) => { console.error('Okey101 işleme hatası:', err); outcome = null; });

    if (outcome?.success === false) showToast('Bu taş buraya uymuyor, ıstakana geri döndü.', 'red');
    else if (outcome?.roundEnded) showToast('Elini taş atmadan işleyerek bitirdin!', 'emerald');
    else if (outcome?.success === true && outcome.wonOkey) {
      showToast(outcome.penalizedName ? `Okey'i kazandın! ${outcome.penalizedName} -101 ceza aldı.` : 'Okey\'i kazandın!', 'emerald');
    }
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
      const groups = {}; const discardPiles = {}; const openedHands = {}; const hasOpened = {}; const openedWithPairs = {};
      roundPlayers.forEach((uid) => { groups[uid] = {}; discardPiles[uid] = []; openedHands[uid] = []; hasOpened[uid] = false; openedWithPairs[uid] = false; });
      t.update(roomRef, {
        players: roundPlayers, racks, drawPile, indicator, okey, groups, discardPiles, openedHands, hasOpened, openedWithPairs,
        setupPhase: true, setupEndsAt: Date.now() + SETUP_DURATION_MS,
        turn: roundPlayers[0] || null, turnDeadline: Date.now() + SETUP_DURATION_MS + TURN_DURATION_MS, hasDrawnThisTurn: true, sideTake: null, forcedPileDraw: false,
        roundEnded: false, roundResult: null, roundStartScores: { ...(data.scores || {}) },
      });
    }).catch((err) => console.error('Okey101 yeni tur hatası:', err));
  };


  const toastColors = { red: 'bg-red-500/95 border-red-400', amber: 'bg-amber-500/95 border-amber-400', emerald: 'bg-emerald-500/95 border-emerald-400' };
  const canTackNow = isPlayer && mustDiscard && myHasOpened;

  // 5. madde kuralları — arayüz butonlarının açık/kapalı olmasını belirler.
  const iOpenedWithPairs = !!roomData.openedWithPairs?.[user.uid];
  const pairsExistOnTable = anyPairsOnTable(roomData.openedWithPairs);
  const myCanLayPairs = canPlayerLayPairs(user.uid, roomData.hasOpened, roomData.openedWithPairs);
  const myCanLayMelds = canPlayerLayMelds(user.uid, roomData.openedWithPairs);
  const pairsButtonLabel = myHasOpened ? 'Çift İşle' : 'Çift Aç';

  const hasAnyOpenedHand = Object.values(roomData.openedHands || {}).some((groups) => groups.length > 0);

  return (
    <div className={`w-full flex flex-col items-center gap-2 sm:gap-3 relative ${isFullscreenView ? 'max-w-[1500px]' : 'max-w-4xl'}`}>
      {toast && (
        <div className={`fixed top-16 left-1/2 -translate-x-1/2 z-[5000] text-white px-4 py-2.5 sm:px-6 sm:py-3 rounded-xl shadow-2xl font-bold border text-center text-xs sm:text-sm w-[92%] max-w-sm ${toastColors[toast.tone] || toastColors.red}`}>
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
          openedWithPairs={roomData.openedWithPairs}
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
        okeyInfo={okeyInfo}
      >
        <div className="flex items-center gap-2">
          <div
            {...pileDrag.handlers}
            title={mustDraw ? 'Desteden çek (tıkla ya da ıstakaya sürükle)' : undefined}
            className={`flex items-center gap-1.5 sm:gap-2 bg-slate-900/70 border rounded-lg px-2 py-1.5 sm:px-4 sm:py-2 transition-colors touch-none select-none ${mustDraw ? 'cursor-pointer border-amber-400 ring-2 ring-amber-400/50 animate-pulse' : 'border-slate-700 opacity-80'}`}
          >
            <span className="text-[9px] sm:text-xs text-slate-400 font-bold uppercase tracking-widest">Deste</span>
            <TileBack size="small" />
            <span className="text-xs sm:text-sm font-mono font-bold text-slate-200">{roomData.drawPile?.length ?? 0}</span>
          </div>

          {roomData.indicator && (
            <div className="flex items-center gap-1.5 sm:gap-2 bg-slate-900/70 border border-fuchsia-500/40 rounded-lg px-2 py-1.5 sm:px-3">
              <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold uppercase tracking-widest">Gösterge</span>
              <Tile tile={roomData.indicator} size="small" okeyInfo={okeyInfo} />
            </div>
          )}
        </div>
      </OpponentStrip>

      <style>{`
        @keyframes okey101TileFlip {
          0% { transform: rotateY(85deg) scaleX(0.72); opacity: 0.35; }
          100% { transform: rotateY(0deg) scaleX(1); opacity: 1; }
        }
        .okey101-tile-reveal { animation: okey101TileFlip 180ms ease-out; }
      `}</style>

      {/* Sürükleme hayaleti: destede kapalı (?) yüz, soldan gelen taşta gerçek
          yüz gösterilir. Konum hiçbir geçişe tabi değildir (birebir hareket);
          sadece ilk anda hafifçe büyür. */}
      {pileDrag.pos && (
        <div className="fixed z-[4000] pointer-events-none" style={{ left: pileDrag.pos.x - 22, top: pileDrag.pos.y - 30 }}>
          <div className="transition-transform duration-150 ease-out" style={{ transform: pileDrag.grown ? 'scale(1)' : 'scale(0.55)' }}>
            <div className="w-9 h-12 sm:w-11 sm:h-16 rounded-md bg-gradient-to-b from-amber-50 to-amber-100 border border-slate-400 shadow-xl flex items-center justify-center">
              <span className="text-slate-400 font-black text-lg">?</span>
            </div>
          </div>
        </div>
      )}

      {incomingDrag.pos && incomingTile && (
        <div className="fixed z-[4000] pointer-events-none" style={{ left: incomingDrag.pos.x - 22, top: incomingDrag.pos.y - 30 }}>
          <div className="transition-transform duration-150 ease-out" style={{ transform: incomingDrag.grown ? 'scale(1)' : 'scale(0.55)' }}>
            <Tile tile={incomingTile} okeyInfo={okeyInfo} isOkey={isOkeyTile(incomingTile, okeyInfo)} />
          </div>
        </div>
      )}

      {!setupPhase && (
        <div className={`flex items-center justify-center gap-2 text-center font-bold text-xs sm:text-base px-3 py-1.5 rounded-lg ${isMyTurn ? 'text-amber-300 bg-amber-500/10' : 'text-slate-400'}`}>
          <span>{isMyTurn ? (mustDraw ? 'Sıra Sende! Önce bir taş çek.' : 'Şimdi ıstakandan bir taş at.') : `${turnPlayerName} oynuyor...`}</span>
          {turnCountdown !== null && (
            <span className={`font-mono text-[10px] sm:text-xs px-2 py-0.5 rounded-full border ${turnCountdown <= 10 ? 'text-red-300 border-red-500/50 bg-red-500/10' : 'text-slate-400 border-slate-600 bg-slate-900/50'}`}>{turnCountdown}s</span>
          )}
        </div>
      )}

      {mySideTakePending && (
        <div className="w-full max-w-md flex items-center justify-between gap-2 bg-amber-500/10 border border-amber-500/50 rounded-xl px-3 py-2">
          <span className="text-[11px] sm:text-sm font-bold text-amber-300">Yandan taş aldın! Şimdi elini açmalısın (Seri/Çift Aç) ya da taşı geri koymalısın.</span>
          <button
            type="button"
            onClick={() => handleCancelSideTake()}
            className="shrink-0 text-[11px] font-bold bg-slate-900/70 hover:bg-slate-700 text-slate-200 border border-slate-600 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            Taşı Geri Koy
          </button>
        </div>
      )}

      {hasAnyOpenedHand && (
        <div className="w-full bg-slate-900/60 border border-slate-700 rounded-xl p-2 sm:p-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest">Açılan Eller</span>
            {canTackNow && <span className="text-[9px] sm:text-[10px] text-amber-300/90 font-bold">Taşı kesik çizgili boşluğa sürükle</span>}
          </div>
          <div className="flex flex-col gap-2">
            {players.map((p) => {
              const openedGroups = roomData.openedHands?.[p.uid] || [];
              if (openedGroups.length === 0) return null;
              return (
                <div key={p.uid} className="flex items-start gap-2 flex-wrap">
                  <span className="text-[10px] sm:text-[11px] text-slate-500 font-bold shrink-0 mt-2">
                    {p.name}
                    {roomData.openedWithPairs?.[p.uid] && <span className="ml-1 text-fuchsia-400">(çift)</span>}:
                  </span>
                  {openedGroups.map((g, gi) => {
                    // İşleme (tacking) yerleri: SADECE gerçekten taş kabul eden
                    // uçlarda, bir TAŞ BOYUNDA kesik çizgili boşluk olarak
                    // gösterilir. Çiftlerde (cift) hiç gösterilmez; seri 1'de
                    // başlıyorsa solda, 13'te bitiyorsa sağda gösterilmez.
                    const ends = canTackNow ? getGroupOpenEnds(g.tiles, g.type, okeyInfo) : { left: false, right: false };
                    return (
                      <div key={gi} className="flex items-center gap-1">
                        {ends.left && (
                          <div
                            data-tack-uid={p.uid}
                            data-tack-index={gi}
                            data-tack-side="left"
                            title="Buraya taş sürükleyerek işle"
                            className="w-6 h-8 sm:w-7 sm:h-9 shrink-0 rounded-md border-2 border-dashed border-amber-400/70 bg-amber-400/5 transition-colors"
                          />
                        )}
                        <div className={`flex items-center gap-0.5 bg-black/20 rounded-md p-1 ring-1 ${g.type === 'cift' ? 'ring-fuchsia-500/40' : 'ring-emerald-500/40'}`}>
                          {g.tiles.map((tl) => {
                            const tileIsOkey = isOkeyTile(tl, okeyInfo);
                            // Okey işleği: gruptaki bir Okey taşının ÜZERİNE, o taşın
                            // temsil ettiği gerçek taş sürüklenip bırakılırsa Okey
                            // işleyen oyuncunun ıstakasına geçer (bkz. handleTackTile).
                            const canReplace = canTackNow && tileIsOkey && g.type !== 'cift';
                            const replaceProps = canReplace
                              ? { 'data-tack-uid': p.uid, 'data-tack-index': gi, 'data-tack-replace-tile-id': tl.id }
                              : {};
                            return (
                              <div key={tl.id} title={canReplace ? 'Okey\'i almak için gerçek taşı buraya sürükle' : undefined} {...replaceProps}>
                                <Tile tile={tl} size="small" okeyInfo={okeyInfo} isOkey={tileIsOkey} className={canReplace ? 'animate-pulse cursor-pointer' : ''} />
                              </div>
                            );
                          })}
                        </div>
                        {ends.right && (
                          <div
                            data-tack-uid={p.uid}
                            data-tack-index={gi}
                            data-tack-side="right"
                            title="Buraya taş sürükleyerek işle"
                            className="w-6 h-8 sm:w-7 sm:h-9 shrink-0 rounded-md border-2 border-dashed border-amber-400/70 bg-amber-400/5 transition-colors"
                          />
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

      <div className="w-full bg-gradient-to-b from-emerald-900/40 to-emerald-950/60 border border-emerald-800/50 rounded-2xl p-2 sm:p-4">
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
            incomingDiscard={incomingTile}
            canTakeIncoming={canTakeIncomingNow}
            incomingDragHandlers={incomingDrag.handlers}
            canOpenPairsRule={myCanLayPairs}
            canOpenMeldsRule={myCanLayMelds}
            pairsButtonLabel={pairsButtonLabel}
            pendingDraw={pendingDraw}
            flipTileId={drawFlipId}
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

      {myHasOpened && (iOpenedWithPairs || pairsExistOnTable) && (
        <div className="text-[10px] sm:text-[11px] text-slate-500 text-center px-2">
          {iOpenedWithPairs
            ? 'Çift açtın: per (seri/set) açamazsın, sadece kalan çiftlerini sürebilir ve tek tek taş işleyebilirsin. Tur sonunda elinde kalan taşların 2 KATI ceza yazılır.'
            : 'Masada çift açan bir oyuncu var: elindeki çiftleri de masaya sürebilirsin.'}
        </div>
      )}

      <button onClick={leaveRoom} className="text-xs text-red-400 hover:text-red-300 border border-red-500/40 hover:bg-red-500/10 px-4 py-2 rounded-lg font-medium transition-colors">Odadan Çık</button>
    </div>
  );
}
