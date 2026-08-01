import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDocFromServer, updateDoc, runTransaction, deleteField } from 'firebase/firestore';
import { Loader2, Volume2, VolumeX, UserPlus } from 'lucide-react';
import Okey101Lobby from './Okey101Lobby.jsx';
import PlayerRack, { maxRackContentWidth } from './PlayerRack.jsx';
import OpponentStrip from './OpponentStrip.jsx';
import SetupCountdown from './SetupCountdown.jsx';
import TurnCountdown from './TurnCountdown.jsx';
import RoundResultBoard from './RoundResultBoard.jsx';
import Tile, { TileBack, TILE_ASPECT } from './Tile.jsx';
import useDrawDrag from './useDrawDrag.js';
import useViewport from '../../hooks/useViewport.js';
import { playOkeySound, isOkeySoundMuted, setOkeySoundMuted, subscribeOkeySoundMuted } from '../../utils/okeySound.js';
import { dealTiles, SETUP_DURATION_MS, TURN_DURATION_MS, computeOkeyInfo, isOkeyTile, effectiveTile, mergeRackLayout, pruneGroups, COLOR_LABELS } from './tiles.js';
import { isBotUid } from './botPlayers.js';
import { buildSeriesArrangement, findOkeyTileIds } from './assist.js';
import {
  getNextTurnUid, getPrevTurnUid, validateGroup, validateGroups, computeSelectedGroupsValue,
  validatePairs, isValidPairTiles, canTackTile, findTackableSpotsForTile, findJokerReplacements, computeRoundEnd, getGroupOpenEnds, orderGroupTiles, isTileTackable,
  formatFoldBarrier, isExemptFromFoldBarrier, requiredPairsToOpen,
  anyPairsOnTable, canPlayerLayPairs, canPlayerLayMelds, pickPairsHostUid,
  addScoreDelta, pairsOpenBonus, seriesOpenBonus, buildSeatSwapUpdate,
  OPEN_THRESHOLD, PENALTY_POINTS, SIDE_TAKE_SERIES_MULTIPLIER, SIDE_TAKE_PAIRS_MULTIPLIER,
} from './gameLogic.js';
import {
  randomTurnDelay, pickBotMelds, pickBotPairs, canOpenedBotUseTile, shouldTakeDiscardToOpen, findTackOpportunities, pickDiscardTile, pickSmallestSafeDiscard,
} from './botAI.js';

// Istaka panelinin (yeşil çerçeve) kendi iç boşluğu — `sm:p-4`. Panel genişliği
// üst sınırı hesaplanırken taş alanının üstüne bu pay eklenir.
const RACK_PANEL_PADDING_PX = 16;
// 4. madde: Elini AÇAN oyuncuya, açtığı andan itibaren ek süre verilir —
// hem masaya çıkan perlere taş işlemesi (tacking) hem de elinde kalanları
// gözden geçirip hangisini atacağına karar vermesi için. Açma anı zaten
// turun en yoğun/en çok düşünülen anı; normal hamle süresi buna yetmiyordu.
const OPEN_EXTRA_TIME_MS = 15000;

// Elini açan oyuncunun turuna eklenecek yeni son tarih: kalan süresi NE OLURSA
// OLSUN 15sn EKLENİR (ör. 22sn kalmışsa 37sn'ye çıkar).
//
// ÖNCEKİ (hatalı) davranış `Math.max(currentDeadline, now + 15sn)` idi: bu,
// süresi 15sn'den ÇOK kalan oyuncuya hiçbir ek süre vermiyor, sadece 15sn'nin
// altına düşmüşse 15sn'ye TAMAMLIYORDU. Yani "açana +15sn" kuralı pratikte
// sadece son saniyelerde açanlar için işliyordu.
const extendedDeadlineAfterOpen = (currentDeadline) => Math.max(currentDeadline || 0, Date.now()) + OPEN_EXTRA_TIME_MS;
// Bir bot turu bu süreyi aşarsa (ağ/transaction asılması) yeni bir deneme
// kilidi devralabilir. Normal bir tur artık ~3-6sn sürüyor.
const BOT_TURN_STUCK_MS = 15000;

// Kullanıcı isteği: ıstakada HER ZAMAN atılacak en az 1 taş kalmalı — bot
// zaten açmışken elindeki TÜM per/çiftleri sürmek isterse ve bu ıstakayı
// tamamen boşaltacaksa, en DÜŞÜK değerli olan(lar)ı masada bırakıp (bir
// sonraki turda sürer) geri kalanını sürer. Böylece bot, "hepsi sığmıyor"
// diye o turda TEK bir per bile sürmeden pes etmez.
function trimMeldsToLeaveOneTile(melds, rackTileCount) {
  if (!melds || melds.length === 0) return melds;
  const sorted = [...melds].sort((a, b) => b.value - a.value);
  const kept = [];
  let used = 0;
  for (const m of sorted) {
    if (used + m.tiles.length > rackTileCount - 1) continue;
    kept.push(m);
    used += m.tiles.length;
  }
  return kept;
}

// Madde 10 (kullanıcı isteği): `pruneGroups` (tiles.js) sadece "bu taş hâlâ
// ıstakada mı / grup 2'nin altına mı düştü" bakar — grubun taş DİZİLİMİNİN
// hâlâ GEÇERLİ bir per (bitişik seri/set) ya da çift olup olmadığını KONTROL
// ETMEZ. Bir taş (ör. yandan alınıp geri konulan) ıstakadan çıktığında, geri
// kalan taşlar sayıca 2+ kalsa bile ARTIK kurallara uymayabilir (ör. 3'lü bir
// serinin ortasındaki taş gidince kalan 2 uç taş bitişik bir çift OLUŞTURMAZ).
// Böyle bir grup burada tamamen ELENIR — onayı otomatik kaldırılmış olur.
function pruneAndValidateGroups(groups, rack, okeyInfo) {
  const base = pruneGroups(groups, rack);
  const tilesById = {};
  (rack || []).forEach((t) => { if (t) tilesById[t.id] = t; });
  const next = {};
  Object.entries(base).forEach(([gid, tileIds]) => {
    const tiles = tileIds.map((id) => tilesById[id]).filter(Boolean);
    if (tiles.length !== tileIds.length) return;
    const valid = tiles.length === 2
      ? isValidPairTiles(tiles[0], tiles[1], okeyInfo)
      : validateGroup(tiles, okeyInfo).valid;
    if (valid) next[gid] = tileIds;
  });
  return next;
}

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

// El dağıtıldıktan sonraki "hazırlık" alanlarını üretir — VE yardımlı modda
// (rules.assistedEnabled) her İNSAN oyuncunun ıstakasını yerinde otomatik
// olarak seri/set dizilmiş hâle getirir.
//
// KULLANICI İSTEĞİ: "el ilk dağıtıldığında da otomatik olarak seri dizilmiş
// şekilde gelsin ve dolayısıyla ... oyun başında ekstra per dizmek için
// verilecek süre olmasın." Yani yardımlı modda `setupPhase` HİÇ açılmaz; ilk
// oyuncu doğrudan oynamaya başlar.
//
// `racks` ve `groups` YERİNDE (in-place) güncellenir — ikisi de çağıranın az
// önce oluşturduğu YEREL nesnelerdir, paylaşılan bir state değil.
// Bot ıstakaları BİLEREK dizilmez: kimse görmez ve botlar kararlarını her
// turda kendi aramasıyla (botAI#pickBotMelds) yeniden üretir; ayrıca süre
// aşımı atışı onaylı perleri korumaya çalıştığı için (bkz.
// botAI#pickSmallestSafeDiscard) gereksiz bir yan etki doğardı.
function buildDealSetup(racks, groups, okey, rules, isBotSeat) {
  const now = Date.now();
  if (!rules?.assistedEnabled) {
    return {
      setupPhase: true,
      setupEndsAt: now + SETUP_DURATION_MS,
      turnDeadline: now + SETUP_DURATION_MS + TURN_DURATION_MS,
    };
  }
  // NOT (satır uzunluğu): Dağıtımı HOST yapar ve her oyuncunun EKRAN
  // genişliğini bilemez — bu yüzden yerleşim, Firestore'daki kanonik düzene
  // (RACK_ROW_LENGTH = 15 sütun; buildSeriesArrangement'ın varsayılanı) göre
  // hesaplanır. Dar telefonlarda ıstaka 10 sütun olarak çizildiği için (bkz.
  // PlayerRack#rackColumns) bir per satır sonunda GÖRSEL olarak bölünmüş
  // görünebilir; oyuncu "Seri Diz"e basarsa o hesap istemcide GERÇEK sütun
  // sayısıyla yapılır ve yerleşim kusursuz olur. Bölünme sadece görseldir —
  // perin bitişikliği/geçerliliği slot SIRASINA bağlıdır, satıra değil.
  Object.keys(racks).forEach((uid) => {
    if (isBotSeat?.(uid)) return;
    const arranged = buildSeriesArrangement(racks[uid], okey);
    if (!arranged) return;
    racks[uid] = arranged.rack;
    groups[uid] = arranged.groups;
  });
  return { setupPhase: false, setupEndsAt: null, turnDeadline: now + TURN_DURATION_MS };
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
  // PERFORMANS: Bu tik SADECE host'un çalıştırdığı otomasyon efektlerini
  // (bot turu + süre aşımı kurtarma) yeniden tetiklemek içindir; host olmayan
  // istemcilerde hiçbir işe yaramadığı hâlde 20 saniyede bir tüm masayı
  // yeniden render ediyordu. Artık sadece host'ta çalışır.
  const [botWatchdogTick, setBotWatchdogTick] = useState(0);
  useEffect(() => {
    if (!isHost) return;
    const interval = setInterval(() => setBotWatchdogTick((n) => n + 1), 20000);
    return () => clearInterval(interval);
  }, [isHost]);

  // ============================================================
  // İYİMSER TUR DURUMU ("Write-Ahead Buffer")
  // ============================================================
  // KÖK NEDEN: Bu oyundaki tüm kritik hamleler `runTransaction` ile yazılır.
  // Firestore'da transaction'lar -düz `updateDoc`'un AKSİNE- yerel ön belleği
  // güncellemez, yani "latency compensation" YOKTUR: `onSnapshot` ancak sunucu
  // yazımı onayladıktan SONRA tetiklenir. Bu yüzden taş atıldığında taş
  // ıstakadan anında kalksa bile (PlayerRack#optimisticGoneId) SIRA, ATIŞ
  // YIĞINI ve açılan perler ~300ms boyunca ESKİ hâlinde kalıyordu.
  //
  // Çözüm: hamleyi sunucuya göndermeden ÖNCE sonucun TUR DURUMU kısmını buraya
  // yazıp ekranı anında güncelliyoruz; gerçek veri gelince katman düşüyor.
  //
  // Bu blok BİLEREK "MASA ÇAPINDA SESLER" bölümünden ÖNCE (yani sesler bu
  // katmanı kullanabilsin diye) ve erken-return'lerden ÖNCE (efektler her
  // zaman ham `roomData`yı görsün diye, bkz. `view` birleştirmesi çok daha
  // aşağıda) tanımlanır.
  //
  // KAPSAM BİLEREK DARDIR — `racks`/`groups` bu katmana DAHİL DEĞİLDİR:
  // bunların çok daha ince ayarlı kendi iyimser katmanı PlayerRack içinde
  // zaten var (optimisticRack/optimisticGoneId); ikinci bir katman onunla
  // çakışıp taşı iki kez gizler/geri getirirdi.
  const [turnPatch, setTurnPatch] = useState(null); // { patch, baseSig }
  const turnPatchTimerRef = useRef(null);
  useEffect(() => () => { if (turnPatchTimerRef.current) clearTimeout(turnPatchTimerRef.current); }, []);

  // İyimser katmanın NE ZAMAN düşeceğini belirleyen imza: sunucudaki tur
  // durumu HERHANGİ bir yönde değiştiği an (bizim yazımımız düştüğü için ya da
  // araya başka bir oyuncunun hamlesi girdiği için) tahminimiz artık
  // bayattır ve gerçek veriye bırakılır. Bu, "transaction bitince temizle"
  // yaklaşımından daha güvenlidir: orada, yazım onaylandığı AN ile snapshot'ın
  // GELDİĞİ an arasındaki boşlukta ekran bir kare eski duruma geri sekerdi.
  const turnStateSignature = (data) => [
    data.turn ?? '',
    data.hasDrawnThisTurn ? 1 : 0,
    data.sideTake?.tileId ?? '',
    data.forcedPileDraw ? 1 : 0,
    data.roundEnded ? 1 : 0,
    data.drawPile?.length ?? '',
    Object.entries(data.discardPiles || {}).map(([uid, p]) => `${uid}:${(p || []).length}`).sort().join(','),
    Object.entries(data.openedHands || {}).map(([uid, g]) => `${uid}:${(g || []).reduce((n, x) => n + (x?.tiles?.length || 0), 0)}`).sort().join(','),
  ].join('|');

  const clearTurnPatch = () => {
    if (turnPatchTimerRef.current) { clearTimeout(turnPatchTimerRef.current); turnPatchTimerRef.current = null; }
    setTurnPatch(null);
  };

  // `buildPatch(data)` ham sunucu durumundan iyimser tur durumunu üretir.
  const applyTurnPatch = (buildPatch) => {
    const patch = buildPatch(roomData);
    if (!patch) return;
    setTurnPatch({ patch, baseSig: turnStateSignature(roomData) });
    // EMNİYET AĞI (normalde HİÇ tetiklenmez): yazım kalıcı olarak başarısız
    // olur ve sunucu durumu HİÇ değişmezse ekran sonsuza dek onaylanmamış bir
    // tahmini göstermesin.
    if (turnPatchTimerRef.current) clearTimeout(turnPatchTimerRef.current);
    turnPatchTimerRef.current = setTimeout(() => setTurnPatch(null), 5000);
  };

  useEffect(() => {
    if (!turnPatch) return;
    if (turnStateSignature(roomData) !== turnPatch.baseSig) clearTurnPatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomData, turnPatch]);

  // Sesler (aşağıda) ve tur durumu türetilen değerleri BU birleştirilmiş
  // görünümü okur — `view` (çok daha aşağıda, erken-return'lerden SONRA)
  // ile AYNI mantık, sadece efektlerin erişebileceği kadar erken tanımlanır.
  const soundView = turnPatch ? { ...roomData, ...turnPatch.patch } : roomData;

  // ============================================================
  // MASA ÇAPINDA SESLER
  // ============================================================
  // Oyunu ilgilendiren hamlelerin sesi, hamleyi KİM yaparsa yapsın MASADAKİ
  // HERKESTE çalmalıdır. Bu yüzden sesler yerel tıklamaya değil, Firestore'dan
  // gelen VERİ DEĞİŞİMİNE bağlanır: her istemci kendi `roomData`'sındaki
  // ilgili alanın değiştiğini görüp sesi kendisi çalar.
  //
  // KULLANICI RAPORU (Ses Senkronizasyonu / "Audio Desync"): Optimistic UI
  // ("Write-Ahead Buffer", yukarıda) görseli anında güncellerken sesler HÂLÂ
  // ham `roomData`ya (yani sunucu cevabına, ~300ms) bağlıysa, GÖRSEL ile SES
  // birbirinden kopar (taş anında masaya düşer ama "atış" sesi bir çeyrek
  // saniye sonra gelir). Çözüm burada da AYNI `soundView` (roomData +
  // turnPatch): kendi hamlemi yaptığımda `soundView` ANINDA değişir, ses de
  // anında çalar. BAŞKA bir oyuncunun hamlesinde `soundView` onun için
  // `turnPatch` olmadığından yine `roomData`ya eşittir — o oyuncunun ekranında
  // (ve masadaki HERKESTE) davranış eskisiyle birebir aynı kalır.
  //
  // YANKI (echo) RİSKİ YOKTUR: iyimser tahmin ile ~300ms sonra gelen GERÇEK
  // veri (hamle başarılıysa) TAMAMEN AYNI değeri üretir (aynı taş, aynı
  // pile/openedHands hesaplaması — bkz. applyTurnPatch çağrıları), yani
  // `totalDiscards`/`openedTilesSignature` gibi bağımlılıklar iki durum
  // arasında geçişte DEĞİŞMEZ; React efekti ikinci kez tetiklenmez. Bu yüzden
  // (Gemini'nin önerdiği) bir "throttle/debounce" gerekmez — üstelik böyle bir
  // throttle, iki farklı oyuncu 300ms içinde art arda taş atarsa İKİNCİ
  // oyuncunun sesini MASADAKİ HERKESTEN yanlışlıkla bastırırdı (yankı-önleme
  // bir aksiyonu değil bir OYUNCUYU susturmuş olurdu). Tek gerçek (ve kabul
  // edilebilir ölçüde nadir) istisna: sunucu hamleyi REDDEDERSE, iyimser
  // tahmin `clearTurnPatch` ile geri alınırken sayaç bir an için geriye
  // sıçrayabilir — bu durumda (ör. atış sayısı azalınca "çekme" sesi gibi)
  // yersiz TEK bir ses çalabilir; hamleler zaten istemcide önceden
  // doğrulandığı için sunucu reddi son derece nadirdir ve bu kozmetik
  // sapma bir throttle'ın çok-oyunculu doğruluğu bozma riskine değmez.
  //
  // İlk snapshot'ta (ref henüz null) ses ÇALINMAZ — odaya sonradan katılan ya
  // da sayfayı yenileyen biri, çoktan olup bitmiş hamlelerin seslerini
  // topluca duymasın diye.
  const soundRefs = useRef({ discardCount: null, openedCount: null, roundEnded: null, roundKey: undefined, drawPileLen: null, tackCount: null, tackSignature: null });

  // Ses aç/kapa tercihi (tarayıcıda kalıcı — bkz. okeySound#setOkeySoundMuted).
  const [soundMuted, setSoundMuted] = useState(() => isOkeySoundMuted());
  useEffect(() => subscribeOkeySoundMuted(setSoundMuted), []);

  // Atış sesi: masadaki TÜM atış yığınlarının toplam uzunluğu her arttığında
  // (yani biri taş attığında) bir kez çalar. Tek tek oyuncu takip etmek yerine
  // toplam saymak, aynı anda birden fazla alanın değiştiği snapshot'larda da
  // güvenilir çalışır.
  // KULLANICI İSTEĞİ: taş ÇEKME sesi artık SADECE çekeni kendisi duyar —
  // dört kişilik bir masada her rakibin (ortadan ya da soldan) çekişini de
  // duymak fazla ses karmaşası yaratıyordu. Çekme boyunca `roomData.turn`
  // hep ÇEKEN oyuncuda sabit kalır (sıra ancak ATIŞ sonrası ilerler — bkz.
  // handleDrawPile/handleDrawDiscard'ın `turn` alanına DOKUNMAMASI), yani bu
  // veri değişimi anında `roomData.turn === user.uid` ise çeken kişi BİZİZ
  // demektir.
  const totalDiscards = Object.values(soundView?.discardPiles || {}).reduce((n, pile) => n + (pile?.length || 0), 0);
  useEffect(() => {
    const prev = soundRefs.current.discardCount;
    soundRefs.current.discardCount = totalDiscards;
    if (prev === null) return;
    if (totalDiscards > prev) playOkeySound('discard');
    // Toplam AZALDIYSA biri yandan taş ÇEKMİŞTİR (soldaki oyuncunun atış
    // yığınının tepesindeki taş alındı) — çekme sesi, SADECE biz çektiysek.
    else if (totalDiscards < prev && roomData?.turn === user.uid) playOkeySound('draw');
  }, [totalDiscards]);

  // Ortadaki KAPALI DESTEDEN çekiş: deste uzunluğu her azaldığında — SADECE
  // biz çektiysek (yukarıdaki NOT ile aynı gerekçe).
  const drawPileLen = soundView?.drawPile?.length ?? null;
  useEffect(() => {
    const prev = soundRefs.current.drawPileLen;
    soundRefs.current.drawPileLen = drawPileLen;
    if (prev !== null && drawPileLen !== null && drawPileLen < prev && roomData?.turn === user.uid) playOkeySound('draw');
  }, [drawPileLen]);

  // Açma sesi: masadaki toplam açık per sayısı arttığında (biri elini açtı ya
  // da yeni per/çift sürdü) kısa rüzgar sesi.
  const totalOpenedGroups = Object.values(soundView?.openedHands || {}).reduce((n, groups) => n + (groups?.length || 0), 0);
  useEffect(() => {
    const prev = soundRefs.current.openedCount;
    soundRefs.current.openedCount = totalOpenedGroups;
    if (prev !== null && totalOpenedGroups > prev) playOkeySound('open');
  }, [totalOpenedGroups]);

  // Taş İŞLEME (tacking) sesi: masadaki AÇIK bir pere tek taş eklenmesi ya da
  // bir Okey'in çalınması — per SAYISI bu durumda DEĞİŞMEZ (yeni per açılması
  // ayrı bir olaydır, yukarıdaki 'open' sesi ona aittir); sadece VAR OLAN bir
  // per'in taş İÇERİĞİ değişir. Bu yüzden hem grup sayısını HEM DE tüm
  // perlerin taş kimliklerinden çıkarılan bir "imza"yı izleriz: sayı AYNI
  // kalıp imza DEĞİŞTİYSE bu bir işleme hamlesidir. Masa çapında (herkes
  // duyar) — diğer masa sesleriyle aynı felsefe.
  const openedTilesSignature = Object.entries(soundView?.openedHands || {})
    .flatMap(([uid, groups]) => (groups || []).map((g, i) => `${uid}:${i}:${(g?.tiles || []).map((t) => t.id).join(',')}`))
    .sort()
    .join('|');
  useEffect(() => {
    const prevCount = soundRefs.current.tackCount;
    const prevSig = soundRefs.current.tackSignature;
    soundRefs.current.tackCount = totalOpenedGroups;
    soundRefs.current.tackSignature = openedTilesSignature;
    if (prevCount === null || prevSig === null) return;
    if (totalOpenedGroups === prevCount && openedTilesSignature !== prevSig) playOkeySound('tack');
  }, [openedTilesSignature, totalOpenedGroups]);

  // El bitti -> taşların devrilme sesi.
  const roundEndedNow = !!roomData?.roundEnded;
  useEffect(() => {
    const prev = soundRefs.current.roundEnded;
    soundRefs.current.roundEnded = roundEndedNow;
    if (prev === false && roundEndedNow) playOkeySound('roundEnd');
  }, [roundEndedNow]);

  // Yeni el başladı -> taşların dağıtılma sesi.
  //
  // Tetikleyici GÖSTERGE'nin kimliğidir (her el yeni bir Gösterge belirlenir),
  // `setupPhase` DEĞİL: "Yardımlı" modda el otomatik dizili geldiği için
  // hazırlık fazı HİÇ açılmaz (bkz. buildDealSetup) ve setupPhase'e bağlı eski
  // tetikleyici o modda dağıtım sesini asla çalmıyordu.
  const roundKey = roomData?.indicator?.id ?? null;
  useEffect(() => {
    const prev = soundRefs.current.roundKey;
    soundRefs.current.roundKey = roundKey;
    if (!roundKey) return;
    // İlk girişte de çalar (prev === undefined): oyuna girdiğinde taşlar zaten
    // dağıtılıyor olur, bu ses o anın parçasıdır.
    if (prev !== roundKey) playOkeySound('deal');
  }, [roundKey]);

  // Tam ekran modunda ıstaka ve taşlar belirgin şekilde büyür (sadece etrafı
  // izole etmek yetmiyor; asıl fayda daha rahat dokunulabilir taşlar).
  const [isFullscreenView, setIsFullscreenView] = useState(false);
  useEffect(() => {
    const sync = () => setIsFullscreenView(!!document.fullscreenElement);
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  // Telefon YATAY tutulduğunda (dikey alan çok kısıtlı) oyun tek ekrana
  // sığdırılır: masa/açılan eller bölümü kendi içinde kaydırılır, ıstaka ise
  // her zaman ekranın altında sabit kalır ve taşlar belirgin şekilde büyür.
  const { isCompact } = useViewport();

  // 3. madde: işlek bir taş atıldığında, oturduğu per(ler) `roomData.tackHint`
  // (sunucu tarafında yazılan `expiresAt`'e sahip) üzerinden 2-3sn yanıp
  // söner. Bu süre dolunca render'ı tazelemek için (yeni bir Firestore
  // yazımı GEREKMEDEN, tamamen yerel) bir "tick" sayaç kullanılır.
  const [, bumpTackHintTick] = useState(0);
  useEffect(() => {
    const hint = roomData.tackHint;
    if (!hint?.expiresAt) return;
    const remaining = hint.expiresAt - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => bumpTackHintTick((n) => n + 1), remaining + 50);
    return () => clearTimeout(timer);
  }, [roomData.tackHint]);

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
  // turu BAŞLAYAN oyuncuya (22 taşlı) verir. Başlayan oyuncu zaten fazladan taşla
  // başladığı için ilk turunda tekrar çekmesi GEREKMEZ — hasDrawnThisTurn baştan true.
  //
  // 5. madde: Oturma düzeni (players sırası, dolayısıyla sol/sağ komşuluklar)
  // odanın ömrü boyunca SABİT kalır — sadece kimin BAŞLAYACAĞI (22 taş alacağı)
  // her el değişir. Odanın İLK eli tamamen RASTGELE bir oyuncuyla başlar
  // (eskiden hep players[0] -yani host- başlıyordu). Sonraki eller
  // handleStartNewRound'da bu sıralamanın "bir sonraki"siyle (saat yönünün
  // tersine, oyunun normal tur akışıyla AYNI yönde) döner.
  useEffect(() => {
    if (roomData.status !== 'playing' || roomData.racks || !isHost) return;
    const players = seatOrderedPlayers(roomData.players || [], roomData.rules, roomData.teams);
    const starterUid = players[Math.floor(Math.random() * players.length)];
    const { racks, drawPile, indicator } = dealTiles(players, starterUid);
    const okey = computeOkeyInfo(indicator);
    const groups = {}; const discardPiles = {}; const openedHands = {}; const hasOpened = {}; const openedWithPairs = {};
    players.forEach((uid) => { groups[uid] = {}; discardPiles[uid] = []; openedHands[uid] = []; hasOpened[uid] = false; openedWithPairs[uid] = false; });
    const isBotSeat = (uid) => !!roomData.isBotPlayer?.[uid] || isBotUid(uid);
    const setup = buildDealSetup(racks, groups, okey, roomData.rules, isBotSeat);
    updateDoc(roomRef, {
      players, racks, drawPile, indicator, okey, groups, discardPiles, openedHands, hasOpened, openedWithPairs,
      ...setup,
      turn: starterUid, starterUid, hasDrawnThisTurn: true, sideTake: null, forcedPileDraw: false,
      roundEnded: false, roundResult: null, roundStartScores: { ...(roomData.scores || {}) }, foldMultiplier: 1,
      centerDiscard: null, openedBeforeCurrentTurn: false, tackHint: null, foldBarrier: null, foldPairsBarrier: null,
      takenOkeys: {},
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
          // 2. madde: elini HENÜZ açmamış bir bot, yerden taş almadan ÖNCE bu
          // taşla GERÇEKTEN açıp açamayacağını hesaplar — açamayacaksa hiç
          // almaz, doğrudan (kapalı) desteden çeker. Eskiden "işine yarar
          // gibi görünen" (shouldTakeDiscard) her taşı alıp, açamayınca geri
          // koyuyordu; bu görsel olarak "alıp hemen bırakma" tuhaflığına yol
          // açıyordu. Elini ZATEN açmış bir bot için obligasyon riski
          // olmadığından eski (genel değerlilik) sezgisi kullanılmaya devam eder.
          let canTakeSide = false;
          if (!data.forcedPileDraw && topDiscard) {
            if (data.hasOpened?.[turnUid]) {
              // KULLANICI İSTEĞİ: açmış bot da taşı ancak BU TURDA
              // kullanabilecekse alır — aksi halde "aldı, hemen geri koydu"
              // görüntüsü oluşuyordu (bkz. botAI#canOpenedBotUseTile).
              canTakeSide = canOpenedBotUseTile(rack, topDiscard, data.okey || null, data.openedHands || {}, {
                pairsAllowed: !!data.openedWithPairs?.[turnUid] || anyPairsOnTable(data.openedWithPairs),
              });
            } else {
              const barrierForBot = data.rules?.foldingEnabled ? (data.foldBarrier || null) : null;
              const exemptBot = !barrierForBot || isExemptFromFoldBarrier(turnUid, barrierForBot, data.rules, data.teams);
              const requiredTotalForBot = (barrierForBot && !exemptBot) ? barrierForBot.total + 1 : OPEN_THRESHOLD;
              const pairsBarrierForBot = data.rules?.foldingEnabled ? (data.foldPairsBarrier || null) : null;
              const requiredPairsForBot = requiredPairsToOpen(
                pairsBarrierForBot,
                isExemptFromFoldBarrier(turnUid, pairsBarrierForBot, data.rules, data.teams),
              );
              canTakeSide = shouldTakeDiscardToOpen(rack, topDiscard, data.okey || null, requiredTotalForBot, requiredPairsForBot);
            }
          }
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
            // Çift açılışının alt sınırı katlamalı modda barajla yükselir
            // (bkz. requiredPairsToOpen). Bot da insan gibi ELİNDEKİ TÜM
            // çiftlerle açar (6-7 çift dahil) — pickBotPairs artık kırpmıyor.
            const pairsBarrierNow = data.rules?.foldingEnabled ? (data.foldPairsBarrier || null) : null;
            const minPairsForBot = requiredPairsToOpen(
              pairsBarrierNow,
              isExemptFromFoldBarrier(turnUid, pairsBarrierNow, data.rules, data.teams),
            );
            const pairs = pickBotPairs(rackNow, okeyNow, minPairsForBot);
            // Atacak taş kalması şart: tüm eli çift olarak masaya sürerse
            // turu kapatacak taşı kalmaz.
            if (pairs.length >= minPairsForBot && rackNow.length - pairs.length * 2 >= 1) {
              apply2(await handleBotOpenMelds(turnUid, pairs, true));
              return;
            }
            const melds = pickBotMelds(rackNow, okeyNow);
            const total = melds.reduce((s, m) => s + m.value, 0);
            const meldsTiles = melds.reduce((n, m) => n + m.tiles.length, 0);
            const tilesLeftAfterOpen = rackNow.length - meldsTiles;

            // KULLANICI RAPORU ("botlar durup dururken -101 yiyor"): burada
            // eşik SABİT 101 (OPEN_THRESHOLD) idi ve KATLAMALI moddaki barajı
            // hiç hesaba katmıyordu. Masada ör. 150'lik bir baraj varken 110
            // toplayan bot açmayı deniyor, `handleBotOpenMelds` bunu
            // "barajı geçemedin" diye reddederken +101 ceza yazıyordu — yani
            // bot kendi kendine ceza yiyordu. Artık bot da insan oyuncuyla
            // AYNI hedefi (barajın bir fazlası) gözetir.
            //
            // "Elden bitirme" istisnası korunur: tüm elini tek hamlede serip
            // son taşı atacak oyuncu barajdan MUAFtır (bkz.
            // handleBotOpenMelds#botGoesOutFromHand) — o durumda yine sadece
            // 101 alt sınırı aranır.
            const barrierNow = data.rules?.foldingEnabled ? (data.foldBarrier || null) : null;
            const exemptNow = !barrierNow || isExemptFromFoldBarrier(turnUid, barrierNow, data.rules, data.teams);
            const goesOutFromHand = tilesLeftAfterOpen <= 1;
            const requiredTotal = (barrierNow && !exemptNow && !goesOutFromHand)
              ? barrierNow.total + 1
              : OPEN_THRESHOLD;

            // Atacak taş kalması şart (bkz. yukarıdaki çift dalı).
            if (melds.length > 0 && total >= requiredTotal && tilesLeftAfterOpen >= 1) {
              apply2(await handleBotOpenMelds(turnUid, melds, false));
            }
            return;
          }

          // Çift ile açan bot artık per (seri/set) süremez; sadece elinde kalan
          // çiftleri masaya sürer (5. madde).
          if (data.openedWithPairs?.[turnUid]) {
            let pairs = pickBotPairs(rackNow, okeyNow);
            // Atacak taş kalsın diye tüm eli çift olarak masaya sürmez — hepsi
            // sığmıyorsa en düşük değerlisini/lerini bir sonraki tura bırakır.
            if (rackNow.length - pairs.length * 2 < 1) {
              pairs = trimMeldsToLeaveOneTile(pairs, rackNow.length);
            }
            if (pairs.length > 0) apply2(await handleBotOpenMelds(turnUid, pairs, true));
            return;
          }

          // Seri/Set ile açan bot: perlerini sürer; ayrıca masada çift açan
          // biri varsa elindeki çiftleri de işleyebilir.
          let melds = pickBotMelds(rackNow, okeyNow);
          const meldsTiles = melds.reduce((n, m) => n + m.tiles.length, 0);
          if (rackNow.length - meldsTiles < 1) melds = trimMeldsToLeaveOneTile(melds, rackNow.length);
          if (melds.length > 0) apply2(await handleBotOpenMelds(turnUid, melds, false));
          if (anyPairsOnTable(data.openedWithPairs)) {
            const rackAfter = (data.racks?.[turnUid] || []).filter(Boolean);
            let pairs = pickBotPairs(rackAfter, okeyNow);
            // Atacak taş kalsın diye tüm eli çift olarak masaya sürmez.
            if (rackAfter.length - pairs.length * 2 < 1) {
              pairs = trimMeldsToLeaveOneTile(pairs, rackAfter.length);
            }
            if (pairs.length > 0) {
              apply2(await handleBotOpenMelds(turnUid, pairs, true));
            }
          }
        };

        // 3) İşleme: elini açtıysa, ıstakada en az 1 taş (zorunlu atma için)
        // kalacak şekilde, masadaki (kendi/rakip) perlere uyan taşları işler.
        // YANDAN ALDIĞI (bekleyen bir sideTake varsa) taş ÖNCELİKLİDİR — bu
        // taşı işlemek, "kullan ya da geri koy" zorunluluğunu (bkz. aşağıdaki
        // kurtarma bloğu) doğrudan çözebilir, gereksiz bir iptal+yeniden
        // çekmeden kaçınılmış olur.
        const attemptTacking = async () => {
          for (let i = 0; i < 22; i++) {
            if (isStale()) return;
            const rackNow = (data.racks?.[turnUid] || []).filter(Boolean);
            if (rackNow.length <= 1) break;
            const opportunities = findTackOpportunities(rackNow, data.openedHands || {}, data.okey || null);
            if (opportunities.length === 0) break;
            const pendingTileId = data.sideTake?.uid === turnUid ? data.sideTake.tileId : null;
            const opp = (pendingTileId && opportunities.find((o) => o.tile.id === pendingTileId)) || opportunities[0];
            await randomTurnDelay();
            if (isStale()) return;
            const tackResult = await handleTackTile(opp.tile, { uid: opp.targetUid, groupIndex: opp.groupIndex, side: opp.side }, turnUid);
            if (!apply(tackResult)) return;
          }
        };

        // KULLANICI İSTEĞİ: elini ÖNCEDEN AÇMIŞ bir bot da yandan aldığı
        // taşı bu turda kullanmak (bir açılışa dahil etmek YA DA işlemek)
        // ZORUNDADIR — kullanamazsa (insanla aynı kural) taşı geri koyup
        // SADECE desteden çekmeye zorlanır. Bu yüzden kurtarma kontrolü artık
        // `!hasOpened` ile SINIRLI değil; hem açma HEM DE işleme denendikten
        // SONRA `data.sideTake` hâlâ botta duruyorsa devreye girer.
        await randomTurnDelay();
        if (isStale()) return;
        await attemptOpen();
        if (isStale() || data.setupPhase || data.roundEnded || data.turn !== turnUid) return;

        if (data.hasOpened?.[turnUid]) {
          await attemptTacking();
          if (isStale() || data.setupPhase || data.roundEnded || data.turn !== turnUid) return;
        }

        if (data.sideTake?.uid === turnUid) {
          if (!apply(await handleCancelSideTake(turnUid))) return;
          if (isStale()) return;
          await randomTurnDelay();
          if (isStale()) return;
          if (!apply(await handleDrawPile(turnUid))) return;
          await randomTurnDelay();
          if (isStale()) return;
          await attemptOpen();
          if (isStale() || data.setupPhase || data.roundEnded || data.turn !== turnUid) return;
          if (data.hasOpened?.[turnUid]) {
            await attemptTacking();
            if (isStale() || data.setupPhase || data.roundEnded || data.turn !== turnUid) return;
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

        // NOT: Adımlar bir başarısızlıkta ARTIK erkenden `return` ETMEZ. Eskiden
        // ediyordu ve tam da bu yüzden, taşı geri koyma ya da çekme adımı
        // (ör. yandan alınan taş ıstakada bulunamadığı veya deste bittiği için)
        // sonuçsuz kaldığında oyun sonsuza dek o oyuncuda asılı kalıyordu.
        // Artık her adım denenir ve en sonda tur her hâlükârda ilerletilir.
        const stillMine = () => !(data.setupPhase || data.roundEnded || data.turn !== turnUid);

        if (data.sideTake?.uid === turnUid && !data.hasOpened?.[turnUid]) {
          apply(await handleCancelSideTake(turnUid));
        }
        if (stillMine() && !data.hasDrawnThisTurn) {
          apply(await handleDrawPile(turnUid));
        }
        if (stillMine() && data.hasDrawnThisTurn) {
          const rack = (data.racks?.[turnUid] || []).filter(Boolean);
          // Oyuncunun onayladığı perlerdeki taşlar korunur (bkz. 1. madde).
          const tile = pickSmallestSafeDiscard(rack, data.okey || null, data.openedHands || {}, data.groups?.[turnUid] || null);
          if (tile) await handleDiscardTile(tile, turnUid);
        }

        // SON EMNİYET SUPABI: Yukarıdaki adımların hepsi (beklenmedik bir durum
        // yüzünden) sonuçsuz kalsa bile masa ASLA kilitli kalmamalı. Tur hâlâ
        // aynı oyuncudaysa ve süresi ÇOKTAN dolmuşsa (transaction içinde tekrar
        // doğrulanır) zorla ilerletilir; normal akışta hiçbir etkisi yoktur.
        await handleForceTurnAdvance(turnUid);
      } catch (err) {
        console.error('Okey101 süre aşımı hatası:', err);
        await handleForceTurnAdvance(turnUid).catch(() => {});
      } finally {
        humanTimeoutLockRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, roomData.status, roomData.turn, roomData.setupPhase, roomData.roundEnded, roomData.turnDeadline, botWatchdogTick]);

  // PERFORMANS: "Açılan Eller" bölümündeki her per için `getGroupOpenEnds`
  // (per uçlarını bulmak üzere 1..13 arası olası taşı iki yönde deneyen,
  // nispeten pahalı bir tarama) eskiden HER RENDER'DA yeniden hesaplanıyordu —
  // 30sn geri sayımın her 250ms'de bir tetiklediği render dahil. Bu, per
  // yaparken/taş sürüklerken hissedilen donmaların bir kaynağıydı. Erken
  // return'lerden SONRA `useMemo` çağrılamayacağı için (Hooks kuralları) bu
  // ref, `roomData.openedHands`/`okeyInfo` REFERANSI değişmediği sürece
  // (yani gerçekten yeni bir Firestore verisi gelmediği sürece) sonucu
  // önbellekte tutan elle yazılmış bir memoizasyondur.
  const openEndsCacheRef = useRef({ opened: null, okeyInfoRef: null, map: {} });

  // 6. madde: uzun basılarak ters çevrilen (bkz. PlayerRack) Okey taşının
  // durumu BURADA (PlayerRack'in İÇİNDE değil) tutulur. Sebep: alt-tab
  // yapılıp geri dönüldüğünde, App.tsx'teki visibilitychange mantığı odayı
  // KISA bir süreliğine "abandoned" yapıp kendiliğinden "playing"e geri
  // döndürüyor (bkz. App.tsx#handleVisibility); bu ANLIK geçiş sırasında
  // `roomData.status !== 'playing'` koşulu aşağıda bu bileşeni <Okey101Lobby>
  // döndürmeye, sonra tekrar oyun ekranına döndürmeye zorluyor — bu da
  // PlayerRack'i (ve onun İÇİNDEKİ tüm local state'i) UNMOUNT edip yeniden
  // MOUNT ediyordu. Sonuç: ters çevrilen taş, alt-tab sonrası sessizce
  // normale dönüyordu. Bu STATE ise Okey101Game'in KENDİSİNE ait olduğu için
  // (aynı anlık geçişte Okey101Game unmount OLMAZ, sadece hangi dalı
  // döndürdüğü değişir) o kısa kesintiyi sorunsuz atlatır.
  const [flippedTileIds, setFlippedTileIds] = useState(() => new Set());
  // Taş id'leri HER EL yeniden (T0'dan) üretildiği için (bkz. tiles.js#createTileSet),
  // bir önceki elden kalma bir işaret, YENİ elde TESADÜFEN aynı id'yi taşıyan
  // bambaşka bir taşa yapışıp kalmasın diye Gösterge değişince (yani yeni el
  // başlayınca) sıfırlanır.
  const roundKeyRef = useRef(roomData.indicator?.id);
  useEffect(() => {
    if (roomData.indicator?.id !== roundKeyRef.current) {
      roundKeyRef.current = roomData.indicator?.id;
      setFlippedTileIds(new Set());
    }
  }, [roomData.indicator?.id]);
  const toggleFlippedTile = (tileId) => {
    setFlippedTileIds((prev) => {
      const next = new Set(prev);
      if (next.has(tileId)) next.delete(tileId); else next.add(tileId);
      return next;
    });
  };

  // ============================================================
  // YARDIMLI MOD (rules.assistedEnabled)
  // ============================================================
  const assisted = !!roomData.rules?.assistedEnabled;

  // KULLANICI İSTEĞİ: Yardımlı modda elime GERÇEK Okey geldiğinde (dağıtımda ya
  // da sonradan çekerek) taş KENDİLİĞİNDEN ters çevrilmiş gösterilir — gerçek
  // masada okeyi fark edip ters koymak gibi. Klasik modda oyuncu bunu 1sn
  // basılı tutarak KENDİSİ yapar (bkz. PlayerRack#LONG_PRESS_MS).
  //
  // `autoFlippedRef`: bir taş SADECE BİR KEZ otomatik çevrilir. Aksi halde
  // oyuncu okeyi bilerek düz çevirmek istediğinde (toggleFlippedTile) bu efekt
  // her render'da onu geri çevirip kullanıcıyla savaşırdı.
  const autoFlippedRef = useRef(new Set());
  useEffect(() => {
    if (!assisted) return;
    const okeyIds = findOkeyTileIds(roomData.racks?.[user.uid], roomData.okey || null);
    const fresh = okeyIds.filter((id) => !autoFlippedRef.current.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => autoFlippedRef.current.add(id));
    setFlippedTileIds((prev) => {
      const next = new Set(prev);
      fresh.forEach((id) => next.add(id));
      return next;
    });
  }, [assisted, roomData.racks, roomData.okey, user.uid]);
  // Yeni el (yeni Gösterge) -> "bu taşı zaten çevirdim" hafızası da sıfırlanır;
  // taş id'leri her el yeniden üretildiği için (bkz. tiles.js#createTileSet)
  // eski kayıtlar yeni elde yanlış taşa yapışırdı.
  useEffect(() => { autoFlippedRef.current = new Set(); }, [roomData.indicator?.id]);

  // Yardımlı modda "işlek" (masadaki açık bir pere oturan) taşlarımın id'leri —
  // Tile bunları alt-orta sembolün yerine ★ ile işaretler (bkz.
  // Tile#TackableMark). Oyuncu hem hangi taşı işleyebileceğini hem de hangisini
  // atarsa +101 ceza yiyeceğini görür.
  //
  // PERFORMANS: `isTileTackable` her taş için masadaki TÜM açık perleri tarar.
  // Bu yüzden hesap SADECE sunucu verisi (racks/openedHands/okey) değiştiğinde
  // yenilenir — hamle geri sayımının 250ms'lik YEREL tik'lerinde tekrar
  // çalışmaz. Hook olduğu için aşağıdaki erken return'lerden ÖNCE durmak
  // zorundadır (bkz. dosyadaki diğer aynı gerekçeli hook'lar).
  const tackableTileIds = useMemo(() => {
    if (!assisted) return null;
    const okeyNow = roomData.okey || null;
    const opened = roomData.openedHands || {};
    const ids = new Set();
    (roomData.racks?.[user.uid] || []).forEach((t) => {
      if (t && isTileTackable(t, opened, okeyNow)) ids.add(t.id);
    });
    return ids;
  }, [assisted, roomData.racks, roomData.openedHands, roomData.okey, user.uid]);

  // MASA ASLA LOBİYE "DÜŞMEZ": taşlar bir kez dağıtıldıysa (racks var) oda
  // durumu ne olursa olsun (ör. biri sekme değiştirdiğinde eskiden yazılan
  // `abandoned`) oyun ekranı çizilmeye devam eder. Eskiden bu anlık durum
  // değişimi tüm masayı bir kare boyunca LOBİYE çevirip geri getiriyordu —
  // kullanıcının şikâyet ettiği "ekrana bir şey gelip gidiyor" komasının
  // ana kaynağıydı (bkz. App.tsx#handleVisibility'deki 101 Okey istisnası).
  if (roomData.status !== 'playing' && !roomData.racks) {
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

  // İYİMSER TUR DURUMU: buradan AŞAĞISI (yani SADECE render'a giden türetilmiş
  // değerler) ham `roomData` yerine `view`i okur. Yukarıdaki efektler —
  // özellikle bot orkestrasyonu ve süre-aşımı watchdog'u — bilerek ham
  // `roomData`da bırakılmıştır (bkz. turnPatch yorumu).
  const view = turnPatch ? { ...roomData, ...turnPatch.patch } : roomData;

  // HAYALET GÖRÜNTÜ DÜZELTMESİ (kullanıcı raporu): `incomingTile` (soldaki
  // oyuncunun bana attığı, "SOLDAN ÇEK" bölmesinde gösterilen taş) YUKARIDA,
  // erken-return'lerden ÖNCE ham `roomData`dan türetilir — çünkü `useDrawDrag`
  // hook'u ona erken-return'lerden önce ihtiyaç duyar. Ama RENDER'a da o ham
  // değer gidiyordu: taşı soldan çektiğimde taş anında ıstakama geliyor,
  // buna rağmen kopyası sunucu cevabı gelene kadar (~300ms) hâlâ soldaki
  // bölmede duruyordu (taş iki yerde birden görünüyordu).
  //
  // Çekme yaması `discardPiles`i zaten iyimser olarak eksiltiyor (bkz.
  // performDraw), bu yüzden render için değeri `view`den YENİDEN türetmek
  // hayaleti tamamen ortadan kaldırır.
  const incomingTileView = prevSeatUid
    ? ((view.discardPiles?.[prevSeatUid] || []).slice(-1)[0] || null)
    : null;

  const players = (roomData.players || []).map((uid) => ({
    uid,
    name: roomData.playerNames?.[uid] || (isBotUid(uid) ? 'Bot' : 'Oyuncu'),
    isBot: !!roomData.isBotPlayer?.[uid] || isBotUid(uid),
  }));
  const okeyInfo = roomData.okey || null;
  const myRack = roomData.racks?.[user.uid] || null;
  const myGroups = roomData.groups?.[user.uid] || {};
  const myDiscardPile = view.discardPiles?.[user.uid] || [];
  const myTopDiscard = myDiscardPile.length > 0 ? myDiscardPile[myDiscardPile.length - 1] : null;
  const isPlayer = (roomData.players || []).includes(user.uid);
  const myHasOpened = !!roomData.hasOpened?.[user.uid];

  const setupPhase = !!roomData.setupPhase;
  const isMyTurn = !setupPhase && view.turn === user.uid;
  const hasDrawn = !!view.hasDrawnThisTurn;
  const mustDraw = isPlayer && isMyTurn && !hasDrawn;
  const mustDiscard = isPlayer && isMyTurn && hasDrawn;
  // 2. madde: elde tam 1 taş kaldıysa, atılacak HANGİ taş olursa olsun bu
  // atış eli bitirir — bu yüzden "Sağa At" bölmesi bu durumda "Ortaya At"a
  // dönüşür (bkz. PlayerRack#discardSlot, Okey101Game'deki centerDiscard).
  const isFinishingDiscard = mustDiscard && (myRack || []).filter(Boolean).length === 1;
  // SEYİRCİ DÜZELTMESİ: Masa geometrisi (kim solda/sağda/karşıda oturuyor)
  // "altta oturan" bir çıpaya göre kurulur. Oyuncu için bu çıpa kendisidir;
  // SEYİRCİ için ise oyuncu listesinin ilki seçilir. Eskiden seyircide çıpa
  // yine `user.uid` idi ve o listede olmadığı için `getPrevTurnUid` null
  // dönüyordu: soldaki koltuk hiç çizilmiyor, bir oyuncu tamamen görünmez
  // kalıyordu. Artık seyirci de dört oyuncuyu ve dört atış yığınını görür.
  const seatAnchorUid = isPlayer ? user.uid : ((roomData.players || [])[0] || null);
  const prevUid = getPrevTurnUid(roomData.players || [], seatAnchorUid);
  const nextUid = getNextTurnUid(roomData.players || [], seatAnchorUid);
  const topUid = (roomData.players || []).find((uid) => uid !== seatAnchorUid && uid !== prevUid && uid !== nextUid) || null;

  const turnPlayerName = players.find((p) => p.uid === view.turn)?.name || '...';

  // Kare masa düzeni: ben her zaman altta (ıstaka), SOLUMDAKİ (prevUid) taşımı
  // alabileceğim/onun taşını çekebileceğim kişi, SAĞIMDAKİ (nextUid) taşımı
  // atacağım kişi, ÜSTTEKİ kalan 4. oyuncu (Eşli modda -> eşim, bkz.
  // seatOrderedPlayers). Rakiplerin ıstakadaki taşları asla gösterilmez.
  // Eşli modda puan BİREYSEL DEĞİL TAKIMSALDIR (bkz. gameLogic#addScoreDelta):
  // takım üyelerinin `scores` değeri her zaman takımın toplamıdır, bu yüzden
  // koltukta gösterilen sayı doğrudan takım puanıdır — sadece hangi takım
  // olduğu ayrıca etiketlenir.
  const teamKeyOf = (uid) => {
    if (roomData.rules?.gameType !== '2v2' || !roomData.teams) return null;
    if ((roomData.teams.A || []).includes(uid)) return 'A';
    if ((roomData.teams.B || []).includes(uid)) return 'B';
    return null;
  };
  const buildSeat = (uid) => {
    const p = players.find((pl) => pl.uid === uid);
    if (!p) return null;
    const pile = view.discardPiles?.[uid] || [];
    return {
      player: p,
      rackCount: roomData.racks?.[uid]?.filter(Boolean).length ?? 0,
      topDiscard: pile.length > 0 ? pile[pile.length - 1] : null,
      score: roomData.scores?.[uid] ?? 0,
      teamKey: teamKeyOf(uid),
    };
  };
  const topSeat = buildSeat(topUid);
  const leftSeat = buildSeat(prevUid);
  const rightSeat = buildSeat(nextUid);
  // Sadece SEYİRCİ için: masanın altında oturan (çıpa) oyuncunun koltuğu.
  // Oyuncunun kendisi için burası kendi ıstakasıdır, koltuk çizilmez.
  const bottomSeat = isPlayer ? null : buildSeat(seatAnchorUid);

  // KULLANICI İSTEĞİ: elini önceden AÇMIŞ bir oyuncu da yandan aldığı taşı bu
  // turda kullanmak zorundadır (bkz. handleDrawDiscard/handleCancelSideTake
  // yorumları) — bu yüzden artık `!myHasOpened` ile SINIRLI değildir.
  const mySideTakePending = view.sideTake?.uid === user.uid;
  const mySideTakeTileId = mySideTakePending ? view.sideTake.tileId : null;

  // Istaka düzenlemesi artık transaction içinde ve SUNUCUDAKİ taş kümesiyle
  // birleştirilerek yazılır (bkz. mergeRackLayout). Böylece bir düzenleme,
  // aynı anda sunucuya yazılmış bir çekme/işleme sonucunu asla ezip taş
  // kaybettiremez.
  const handleUpdateRack = async (newRack, newGroups) => {
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (!data.racks?.[user.uid]) return;
      const merged = mergeRackLayout(data.racks[user.uid], newRack);
      t.update(roomRef, {
        [`racks.${user.uid}`]: merged,
        [`groups.${user.uid}`]: pruneGroups(newGroups, merged),
      });
    }).catch((err) => console.error('Okey101 ıstaka güncelleme hatası:', err));
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
      // Kapalı deste bittiyse el KİMSE bitirmeden sona erer (berabere). Eskiden
      // burada sessizce çıkılıyordu: sırası gelen oyuncu çekemiyor, dolayısıyla
      // atamıyor ve masa sonsuza dek kilitli kalıyordu (30sn'lik otomatik hamle
      // de aynı yola girdiği için oyunu kurtaramıyordu).
      if (pile.length === 0) {
        const { newScores, roundResult } = computeRoundEnd({
          players: data.players || [],
          scores: data.scores || {},
          roundStartScores: data.roundStartScores || {},
          hasOpened: data.hasOpened || {},
          openedWithPairs: data.openedWithPairs || {},
          racks: data.racks || {},
          rules: data.rules || {},
          teams: data.teams || null,
          okeyInfo: data.okey || null,
          foldMultiplier: data.foldMultiplier || 1,
          takenOkeys: data.takenOkeys || {},
        }, null, false);
        const ended = {
          turn: null, turnDeadline: null, hasDrawnThisTurn: false, sideTake: null, forcedPileDraw: false,
          roundEnded: true, roundResult, scores: newScores,
        };
        t.update(roomRef, ended);
        outcome = { success: true, roundEnded: true, pileEmpty: true, next: { ...data, ...ended } };
        return;
      }
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

  // Yandan (soldan) taş alma: alan oyuncu bu taşı BU TURDA bir per olarak
  // masaya koymak (yeni bir Seri/Çift Aç İÇİNDE ya da doğrudan işleyerek —
  // bkz. handleTackTile) ZORUNDADIR, aksi halde elinde TUTAMAZ — ya kullanır
  // ya taşı geri koyar (handleCancelSideTake). Bu KOŞULSUZ kuraldır (bir
  // "Ceza Kuralı" ayarına bağlı DEĞİLDİR) ve elini önceden AÇMIŞ oyunculara
  // da uygulanır (kullanıcı isteği).
  //
  // TEK FARK: CEZA (çekilen taşın 10/20 katı, taşı atan kişiye) sadece
  // oyuncu bu taşla İLK KEZ açılış yaparsa yazılır — zaten açmış bir oyuncu
  // aynı zorunluluğa tabidir ama üzerine ceza binmez. `penalized` bayrağı bu
  // ayrımı taşıyarak handleOpenSeries/handleOpenPairs/handleTackTile/
  // handleBotOpenMelds'e kadar gider.
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
      const sideTake = {
        uid: actingUid, fromUid, tileId: drawn.id,
        tileValue: sideTakeTileValue(drawn, data.okey || null),
        penalized: !data.hasOpened?.[actingUid],
      };
      const update = { [`discardPiles.${fromUid}`]: pile, [`racks.${actingUid}`]: rack, hasDrawnThisTurn: true, sideTake };
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

    // İYİMSER TUR DURUMU (bkz. turnPatch): `pendingDraw` taşı slotta anında
    // GÖSTERİYORDU ama `hasDrawnThisTurn` sunucudan gelene kadar false
    // kaldığı için "AT" bölmesi (mustDiscard) ~300ms geç beliriyordu — yani
    // taşı çeker çekmez atamıyordunuz. Artık çekme de anında yansır.
    applyTurnPatch((data) => {
      // `drawPile` de (sadece SAYI olarak) buraya dahildir: hem "DESTE"
      // sayacı hem de çekme sesi (bkz. soundView#drawPileLen) bu değeri
      // izler — aksi halde ikisi de gerçek yazım gelene kadar (~300ms) eski
      // sayıyı göstermeye/duymaya devam ederdi.
      if (source === 'pile') return { hasDrawnThisTurn: true, drawPile: (data.drawPile || []).slice(0, -1) };
      // Yandan (soldan) çekme: taş komşunun yığınından ANINDA kalkar ve
      // "kullan ya da geri koy" durumu (sideTake) hemen devreye girer.
      const fromUid = getPrevTurnUid(data.players || [], user.uid);
      const pile = data.discardPiles?.[fromUid] || [];
      const drawn = pile[pile.length - 1];
      if (!fromUid || !drawn) return null;
      return {
        hasDrawnThisTurn: true,
        discardPiles: { ...(data.discardPiles || {}), [fromUid]: pile.slice(0, -1) },
        sideTake: {
          uid: user.uid,
          fromUid,
          tileId: drawn.id,
          tileValue: sideTakeTileValue(drawn, data.okey || null),
          penalized: !data.hasOpened?.[user.uid],
        },
      };
    });

    const result = source === 'pile'
      ? await handleDrawPile(undefined, targetIndex)
      : await handleDrawDiscard(undefined, targetIndex);
    if (!result?.success) { setPendingDraw(null); setDrawFlipId(null); clearTurnPatch(); }
    return result;
  };
  performDrawRef.current = performDraw;

  // "Taşı Geri Koy / İptal": yandan aldığı taşı BU TURDA kullanamayan (ya da
  // kullanmak istemeyen) oyuncu taşı sahibinin atış yığınına geri koyar ve bu
  // tur artık SADECE ortadaki kapalı desteden çekebilir (forcedPileDraw). Bu
  // artık hem henüz açmamış HEM DE zaten açmış oyuncular için geçerlidir
  // (kullanıcı isteği) — `sideTake.penalized` ayrımı zaten CEZA tarafında
  // (bkz. handleOpenSeries/handleOpenPairs/handleTackTile), burada değil.
  // `explicitUid` SADECE bot/süre-aşımı orkestrasyonu tarafından verilir;
  // oyuncunun kendi arayüzünden (buton ya da taşı SOLDAN ÇEK bölmesine
  // sürükleyerek) tetiklediği çağrılar argümansızdır — iyimser tur durumu da
  // (bkz. turnPatch) yalnızca o yolda uygulanır.
  const handleCancelSideTake = async (explicitUid) => {
    const actingUid = explicitUid || user.uid;

    // İYİMSER: taş, sahibinin atış yığınına ANINDA geri döner ve bu tur artık
    // sadece desteden çekilebilir (forcedPileDraw) — ekran sunucuyu beklemez.
    if (!explicitUid) {
      applyTurnPatch((data) => {
        const st = data.sideTake;
        if (!st || st.uid !== user.uid) return null;
        const tile = (data.racks?.[user.uid] || []).find((s) => s && s.id === st.tileId);
        if (!tile) return null;
        return {
          hasDrawnThisTurn: false,
          sideTake: null,
          forcedPileDraw: true,
          discardPiles: {
            ...(data.discardPiles || {}),
            [st.fromUid]: [...(data.discardPiles?.[st.fromUid] || []), tile],
          },
        };
      });
    }
    let outcome = { success: false };
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const st = data.sideTake;
      if (!st || st.uid !== actingUid || data.turn !== actingUid || !data.hasDrawnThisTurn) return;
      const rack = [...(data.racks?.[actingUid] || [])];
      const idx = rack.findIndex((s) => s && s.id === st.tileId);
      if (idx === -1) {
        // EMNİYET SUPABI: yandan alınan taş ıstakada bulunamıyor. Buradan
        // sessizce çıkmak oyuncuyu tamamen kilitliyordu — ne açabilir, ne taşı
        // geri koyabilir, ne atabilirdi (30sn'lik otomatik hamle de aynı
        // adımda takılıyordu). Taş geri konamıyorsa bile en azından
        // yandan-alma kaydı temizlenir ve oyun akmaya devam eder.
        t.update(roomRef, { sideTake: null, forcedPileDraw: false });
        outcome = { success: true, recovered: true, next: { ...data, sideTake: null, forcedPileDraw: false } };
        return;
      }
      const tile = rack[idx];
      rack[idx] = null;
      const pile = [...(data.discardPiles?.[st.fromUid] || []), tile];
      // Madde 10 (kullanıcı isteği): bu taş, oyuncunun ELLE "Per Onayla" ile
      // onayladığı (ama henüz masaya AÇILMAMIŞ) bir taslak per'in İÇİNDE
      // olabilir — taş rack'ten çıkınca o per artık kurallara UYMAYABİLİR
      // (2'nin altına düşer ya da bitişiklik/joker dengesi bozulur). Onayı
      // burada HEMEN budamazsak per, bir sonraki `handleUpdateRack` çağrısına
      // (oyuncu ıstakada başka bir taş sürene) kadar "hayalet" bir taş id'si
      // taşıyan geçersiz bir per olarak asılı kalırdı (bkz. pruneGroups).
      const prunedGroups = pruneAndValidateGroups(data.groups?.[actingUid] || {}, rack, data.okey || null);
      t.update(roomRef, {
        [`racks.${actingUid}`]: rack,
        [`groups.${actingUid}`]: prunedGroups,
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
          groups: { ...(data.groups || {}), [actingUid]: prunedGroups },
          discardPiles: { ...(data.discardPiles || {}), [st.fromUid]: pile },
          hasDrawnThisTurn: false,
          sideTake: null,
          forcedPileDraw: true,
        },
      };
    }).catch((err) => { console.error('Okey101 taş geri koyma hatası:', err); outcome = { success: false }; });
    if (!explicitUid && !outcome?.success) clearTurnPatch(); // reddedildiyse tahmini geri al
    return outcome;
  };

  // Masayı kilitlenmekten kurtaran son çare (sadece süre aşımı yolundan
  // çağrılır): süresi dolmuş bir tur hâlâ ilerlememişse turu zorla bir sonraki
  // oyuncuya geçirir. Istaka boşsa (yani oyuncu aslında elini bitirmişse) el
  // normal şekilde sonlandırılır.
  const handleForceTurnAdvance = async (actingUid) => {
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.roundEnded || data.turn !== actingUid) return;
      if (!data.turnDeadline || Date.now() < data.turnDeadline) return;

      const rack = (data.racks?.[actingUid] || []).filter(Boolean);
      // Istaka boşsa oyuncu aslında elini bitirmiştir (kazanan odur);
      // deste bittiyse el kazanansız (berabere) kapanır. Her iki durumda da
      // tur İLERLETİLMEZ, el burada sonlanır.
      const pileEmpty = (data.drawPile || []).length === 0;
      if (rack.length === 0 || pileEmpty) {
        const { newScores, roundResult } = computeRoundEnd({
          players: data.players || [],
          scores: data.scores || {},
          roundStartScores: data.roundStartScores || {},
          hasOpened: data.hasOpened || {},
          openedWithPairs: data.openedWithPairs || {},
          racks: data.racks || {},
          rules: data.rules || {},
          teams: data.teams || null,
          okeyInfo: data.okey || null,
          foldMultiplier: data.foldMultiplier || 1,
          takenOkeys: data.takenOkeys || {},
        }, rack.length === 0 ? actingUid : null, false);
        t.update(roomRef, {
          turn: null, turnDeadline: null, hasDrawnThisTurn: false, sideTake: null, forcedPileDraw: false,
          roundEnded: true, roundResult, scores: newScores,
        });
        return;
      }

      console.warn('Okey101: tur zorla ilerletildi (süre aşımı kurtarma).', actingUid);
      const forcedNextUid = getNextTurnUid(data.players || [], actingUid);
      t.update(roomRef, {
        turn: forcedNextUid,
        turnDeadline: Date.now() + TURN_DURATION_MS,
        hasDrawnThisTurn: false,
        sideTake: null,
        forcedPileDraw: false,
        // bkz. "elden bitirme" bonusu (computeRoundEnd) — bu, YENİ sıradaki
        // oyuncunun turu BAŞLARKEN eli açık mıydı bilgisini taşır.
        openedBeforeCurrentTurn: !!data.hasOpened?.[forcedNextUid],
      });
    }).catch((err) => console.error('Okey101 tur kurtarma hatası:', err));
  };

  const handleDiscardTile = async (tile, explicitUid) => {
    const actingUid = explicitUid || user.uid;
    if (!explicitUid && !mustDiscard) return;

    // İYİMSER TUR DURUMU (bkz. turnPatch): taş masaya ve sıra rakibe ANINDA
    // geçer, transaction arkada döner. SADECE kendi elimle yaptığım atışta
    // uygulanır — `explicitUid` verilmişse hamleyi bot/süre-aşımı
    // orkestrasyonu yapıyordur, o zaten benim ekranımın "şu an" durumu değildir.
    // ELİ BİTİREN atış da HARİÇ tutulur: orada tur sonu (skorlar, centerDiscard,
    // roundResult) tamamen sunucunun hesabıdır; tahmin etmeye çalışmak yanlış
    // bir ara ekran gösterirdi.
    if (!explicitUid && !isFinishingDiscard) {
      applyTurnPatch((data) => {
        const nextUid = getNextTurnUid(data.players || [], user.uid);
        if (!nextUid) return null;
        return {
          turn: nextUid,
          hasDrawnThisTurn: false,
          sideTake: null,
          forcedPileDraw: false,
          discardPiles: {
            ...(data.discardPiles || {}),
            [user.uid]: [...(data.discardPiles?.[user.uid] || []), tile],
          },
        };
      });
    }
    let outcome = null;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.setupPhase || data.turn !== actingUid || !data.hasDrawnThisTurn) return;
      if (data.sideTake?.uid === actingUid) return; // önce o taşı kullanmalı (per/işleme) ya da geri koymalı
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

      const okeyNow = data.okey || null;

      // Eli bitirme: son taşı atınca ıstaka tamamen boşaldıysa el (round) biter.
      const rackEmptied = rack.every((s) => s === null);
      if (rackEmptied) {
        const wonByOkeyDiscard = isOkeyTile(tile, okeyNow);
        // "Elden bitirme": bu tur BAŞLARKEN (data.openedBeforeCurrentTurn)
        // elini hiç açmamışken, AYNI turda tüm elini açıp son taşla bitirdi.
        // bkz. computeRoundEnd — hem bu hem wonByOkeyDiscard, diğer
        // oyuncuların bu turdaki cezasını katlar (bkz. 4. madde).
        const wentOutFromHand = !data.openedBeforeCurrentTurn && !!data.hasOpened?.[actingUid];
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
          takenOkeys: data.takenOkeys || {},
        }, actingUid, wonByOkeyDiscard, wentOutFromHand);

        outcome = { success: true, roundEnded: true };
        t.update(roomRef, {
          [`racks.${actingUid}`]: rack,
          [`groups.${actingUid}`]: actorGroupsNext,
          // 2. madde: eli bitiren atış artık atanın kendi yığınına (görsel
          // olarak "sağdaki/sıradaki oyuncuya gidiyor" izlenimi verir) değil,
          // MASANIN ORTASINA (Göstergenin yanına) gider — kimse onu almayacağı
          // için mantıken oraya ait değildir; oyun "ortaya atarak" biter.
          centerDiscard: tile,
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

      const discardPile = [...(data.discardPiles?.[actingUid] || []), tile];

      // İşlek (masadaki -kendisinin ya da rakibinin- bir seri/set'e tam
      // oturan) ya da Okey bir taş atılırsa, atan oyuncuya +101 ceza yazılır
      // (tur/eli bitiren atışlar hariç — o puanlama computeRoundEnd'de ayrı
      // ele alınıyor, üstüne ayrıca bu ceza eklenmez). İkisi AYRI durumlardır
      // ve oyuncuya da ayrı ayrı bildirilir.
      const discardedOkey = isOkeyTile(tile, okeyNow);
      const tackSpots = discardedOkey ? [] : findTackableSpotsForTile(tile, data.openedHands || {}, okeyNow);
      const discardedTackable = !discardedOkey && tackSpots.length > 0;
      const carelessDiscard = discardedOkey || discardedTackable;
      const nextTurnUid = getNextTurnUid(data.players || [], actingUid);
      const update = {
        [`racks.${actingUid}`]: rack,
        [`groups.${actingUid}`]: actorGroupsNext,
        [`discardPiles.${actingUid}`]: discardPile,
        turn: nextTurnUid,
        turnDeadline: Date.now() + TURN_DURATION_MS,
        hasDrawnThisTurn: false,
        sideTake: null,
        forcedPileDraw: false,
        // bkz. "elden bitirme" bonusu (computeRoundEnd) — sıradaki oyuncunun
        // turu BAŞLARKEN eli açık mıydı bilgisini taşır.
        openedBeforeCurrentTurn: !!data.hasOpened?.[nextTurnUid],
        // 3. madde: işlek bir taş atıldığında NEREYE oturduğu, masadaki
        // HERKESE 2-3sn yanıp sönerek gösterilir (bkz. render'daki tackHint
        // kullanımı). `expiresAt` istemcide (sunucu saatine bağlı kalmadan)
        // yerel olarak kontrol edilir.
        tackHint: discardedTackable ? { tileId: tile.id, spots: tackSpots, expiresAt: Date.now() + 2800 } : null,
      };
      // Eşli modda ceza bireysel DEĞİL takım puanına yazılır (bkz.
      // gameLogic#addScoreDelta) — takım üyelerinin puanı her zaman aynı
      // "takım toplamı"nı gösterir.
      let scoresAfterPenalty = data.scores || {};
      if (carelessDiscard) {
        const { updates, scores } = addScoreDelta(data, actingUid, PENALTY_POINTS);
        Object.assign(update, updates);
        scoresAfterPenalty = scores;
      }

      // Kapalı deste bittiyse el, ATAN oyuncunun turu tamamlandığı anda
      // OTOMATİK biter — tur sıradaki oyuncuya GEÇMEZ.
      //
      // Eskiden el yalnızca `handleDrawPile` içinde, sıradaki oyuncu
      // (çekemeyeceği) BOŞ desteden çekmeye kalkıştığında bitiyordu. Yani
      // deste 0'a düştükten sonra araya en az bir "ölü tur" giriyor, oyun
      // orada bekliyordu (üstelik o oyuncu yandan taş alırsa oyun boş desteyle
      // sürüp gidebiliyordu). Artık deste biter bitmez, o turu oynayan oyuncu
      // hamlesini tamamladığında el kapanır.
      if ((data.drawPile || []).length === 0) {
        const scoresBeforeEnd = { ...scoresAfterPenalty };
        const { newScores, roundResult } = computeRoundEnd({
          players: data.players || [],
          scores: scoresBeforeEnd,
          roundStartScores: data.roundStartScores || {},
          hasOpened: data.hasOpened || {},
          openedWithPairs: data.openedWithPairs || {},
          racks: { ...(data.racks || {}), [actingUid]: rack },
          rules: data.rules || {},
          teams: data.teams || null,
          okeyInfo: okeyNow,
          foldMultiplier: data.foldMultiplier || 1,
          takenOkeys: data.takenOkeys || {},
        }, null, false);

        outcome = { success: true, carelessDiscard, discardedOkey, discardedTackable, roundEnded: true };
        t.update(roomRef, {
          [`racks.${actingUid}`]: rack,
          [`groups.${actingUid}`]: actorGroupsNext,
          [`discardPiles.${actingUid}`]: discardPile,
          turn: null,
          turnDeadline: null,
          hasDrawnThisTurn: false,
          sideTake: null,
          forcedPileDraw: false,
          tackHint: null,
          roundEnded: true,
          roundResult,
          scores: newScores,
        });
        return;
      }

      outcome = { success: true, carelessDiscard, discardedOkey, discardedTackable };
      t.update(roomRef, update);
    }).catch((err) => { console.error('Okey101 atma hatası:', err); outcome = null; });

    // Hamle reddedildiyse/başarısızsa iyimser tahmin HEMEN geri alınır (ekran
    // sunucudaki gerçek duruma döner). Başarılıysa katman kendiliğinden,
    // sunucu durumu değiştiği an düşer (bkz. turnStateSignature).
    if (!explicitUid && !outcome?.success) clearTurnPatch();

    if (outcome?.discardedOkey) showToast('Okey attın! +101 ceza aldın.', 'red');
    else if (outcome?.discardedTackable) showToast('İşlek taş attın! +101 ceza aldın.', 'red');
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

      // Yandan (soldan) taş almanın koşulu: o taş BU açılışta KULLANILMALIDIR.
      // Eskiden oyuncu yandan değerli bir taş (ör. mavi 13) alıp elindeki
      // BAMBAŞKA taşlarla açabiliyor, taşı hiç kullanmadan ıstakasında tutup
      // yine de -130 gibi bir ceza yağdırabiliyordu. Artık seçili perler
      // yandan alınan taşı içermiyorsa açılış BÜTÜNÜYLE reddedilir — oyuncu
      // ya o taşı kullanmak zorundadır ya da taşı geri koyup desteden çekmelidir.
      const st = data.sideTake;
      if (st && st.uid === user.uid) {
        const usedTileIds = new Set(validGroupIds.flatMap((gid) => myGroupsNow[gid] || []));
        if (!usedTileIds.has(st.tileId)) { outcome = { success: false, reason: 'side-tile-unused' }; return; }
      }

      const alreadyOpened = !!data.hasOpened?.[user.uid];
      const total = computeSelectedGroupsValue(results);

      // "ELDEN BİTME" açılışı: bu açılış ıstakada atılacak TEK bir taş
      // bırakıyorsa (yani oyuncu tüm elini bir hamlede masaya serip son taşı
      // ortaya atarak bitirecekse) oyuncu katlamalı moddaki BARAJDAN MUAFTIR
      // — gerçek 101 Okey kuralı: elden biten barajı geçmek zorunda değildir.
      // (101 alt sınırı yine aranır; ama 21 taşlık bir açılış zaten onu
      // fazlasıyla geçer.)
      const rackTileCount = myRackNow.filter(Boolean).length;
      const tilesUsedCount = validGroupIds.reduce((n, gid) => n + (myGroupsNow[gid]?.length || 0), 0);
      const goesOutFromHand = (rackTileCount - tilesUsedCount) <= 1;

      if (!alreadyOpened && total < OPEN_THRESHOLD) {
        // Ceza mesajında oyuncunun KENDİ toplamı da (baraj gösterimiyle aynı
        // "123 (41 yan 2)" biçiminde) yazılır — "kaçta kaldım?" sorusu için
        // masaya bakıp tekrar toplamak gerekmesin.
        outcome = { success: false, reason: 'below101', myTotalLabel: formatFoldBarrier(total) };
        t.update(roomRef, addScoreDelta(data, user.uid, PENALTY_POINTS).updates);
        return;
      }

      // Katlamalı mod: elini per (seri/set) ile İLK açan kişinin toplamı bu
      // TUR boyunca bir baraj oluşturur; ondan sonra per ile açmaya çalışan
      // (ve muaf olmayan) herkes bu barajı KESİN OLARAK GEÇMEK zorundadır,
      // aksi halde normal 101 barajını geçememiş gibi ceza yer (bkz.
      // gameLogic#isExemptFromFoldBarrier — Eşli modda "eşe katlama"
      // kapalıysa barajı kuranın takım arkadaşı muaftır).
      const foldingActive = !!data.rules?.foldingEnabled;
      const barrier = data.foldBarrier || null;
      if (!alreadyOpened && foldingActive && !goesOutFromHand && barrier && !isExemptFromFoldBarrier(user.uid, barrier, data.rules, data.teams) && total <= barrier.total) {
        outcome = { success: false, reason: 'below-fold-barrier', barrierLabel: formatFoldBarrier(barrier.total), myTotalLabel: formatFoldBarrier(total) };
        t.update(roomRef, addScoreDelta(data, user.uid, PENALTY_POINTS).updates);
        return;
      }

      const newRack = [...myRackNow];
      const openedNow = [];
      for (const r of results) {
        const tileIds = myGroupsNow[r.gid];
        // Masaya yazılan per HER ZAMAN doğru sırada olur (bkz. orderGroupTiles).
        openedNow.push({ tiles: orderGroupTiles(r.tiles, r.type, okeyNow), type: r.type });
        tileIds.forEach((tid) => {
          const idx = newRack.findIndex((tl) => tl && tl.id === tid);
          if (idx !== -1) newRack[idx] = null;
        });
        delete myGroupsNow[r.gid];
      }

      // Kullanıcı isteği: bitebilmek için (ya da per açabilmek/işleyebilmek
      // için) ıstakada HER ZAMAN atılacak EN AZ 1 taş kalmalıdır — taş
      // atmadan "elden bitirme" artık GEÇERLİ DEĞİLDİR. Bu açılış ıstakayı
      // TAMAMEN boşaltıyorsa bütünüyle reddedilir (oyuncu daha az per seçip
      // tekrar denemelidir).
      if (newRack.every((s) => s === null)) {
        outcome = { success: false, reason: 'must-keep-tile' };
        return;
      }
      const existingOpened = data.openedHands?.[user.uid] || [];
      const update = {
        [`racks.${user.uid}`]: newRack,
        [`groups.${user.uid}`]: myGroupsNow,
        [`openedHands.${user.uid}`]: [...existingOpened, ...openedNow],
        [`hasOpened.${user.uid}`]: true,
        // 4. madde: elini açana taşlarını işlemesi/düşünmesi için ek süre.
        turnDeadline: extendedDeadlineAfterOpen(data.turnDeadline),
      };
      // Katlamalı mod: baraj SABİT DEĞİLDİR — ilk açan barajı kurar, sonra
      // biri onu DAHA BÜYÜK bir toplamla geçerse (ör. Ali 39 ile açmışken
      // birisi 44 ile açarsa) baraj o andan itibaren YENİ (en yüksek) sayı
      // olur. Bu yüzden hem "baraj hiç yoksa" hem "mevcut barajı geçtiysem"
      // durumunda baraj güncellenir.
      if (!alreadyOpened && foldingActive && (!barrier || total > barrier.total)) {
        update.foldBarrier = { total, uid: user.uid };
      }
      // Yandan taş alıp bu açılışta kullanan oyuncu için taş serbest kalır
      // (bkz. handleDrawDiscard). Ceza ŞİMDİ o taşı atan kişiye (Eşli modda
      // onun TAKIMINA) yazılır — ÇEKİLEN TAŞIN DEĞERİNİN 10 katı — AMA SADECE
      // bu, oyuncunun bu taşla İLK KEZ açılışıysa (`st.penalized`). Zaten
      // açmış bir oyuncu aynı "kullanma zorunluluğuna" tabidir ama üzerine
      // ceza binmez (kullanıcı isteği).
      let runningScores = data.scores || {};
      let penalizedName = null; let penaltyAmount = 0;
      if (st && st.uid === user.uid) {
        update.sideTake = null;
        if (st.penalized) {
          penaltyAmount = (st.tileValue || 0) * SIDE_TAKE_SERIES_MULTIPLIER;
          const { updates, scores } = addScoreDelta(data, st.fromUid, penaltyAmount, runningScores);
          Object.assign(update, updates);
          runningScores = scores;
          penalizedName = players.find((p) => p.uid === st.fromUid)?.name || 'Rakip';
        }
      }

      // BÜYÜK AÇILIŞ ÖDÜLÜ: "tek" (toplam/3) 50'yi geçerse -101, 60'ı geçerse
      // -202 (bkz. gameLogic#seriesOpenBonus). Sadece İLK açılışta verilir.
      let openBonus = 0;
      if (!alreadyOpened) {
        openBonus = seriesOpenBonus(total);
        if (openBonus !== 0) {
          const { updates, scores } = addScoreDelta(data, user.uid, openBonus, runningScores);
          Object.assign(update, updates);
          runningScores = scores;
        }
      }

      outcome = { success: true, penalizedName, penaltyAmount, openBonus, total };
      t.update(roomRef, update);
    }).catch((err) => { console.error('Okey101 seri açma hatası:', err); outcome = null; });

    if (outcome?.reason === 'pairs-opener') showToast('Çift açtığın için per (seri/set) açamazsın. Sadece çift sürebilir ve tek tek taş işleyebilirsin.', 'red');
    else if (outcome?.reason === 'must-keep-tile') showToast('Istakanda atacak en az 1 taş kalmalı! Daha az per seçip tekrar dene.', 'red');
    else if (outcome?.reason === 'invalid') showToast('Geçersiz Per Dizilimi!', 'red');
    else if (outcome?.reason === 'below101') showToast(`101'e ulaşamadın — ${outcome.myTotalLabel} ile kaldın. +101 ceza yedin.`, 'red');
    else if (outcome?.reason === 'side-tile-unused') showToast('Yandan aldığın taşı bu açılışta kullanmalısın! Kullanamıyorsan taşı geri koy.', 'red');
    else if (outcome?.reason === 'below-fold-barrier') showToast(`Barajı (${outcome.barrierLabel}) geçemedin — ${outcome.myTotalLabel} ile kaldın. +101 ceza yedin.`, 'red');
    else if (outcome?.success === true) {
      const bonusMsg = outcome.openBonus ? ` Büyük açılış (${formatFoldBarrier(outcome.total)}): ${outcome.openBonus} puan ödül!` : '';
      showToast(
        (outcome.penalizedName ? `Per başarıyla açıldı! ${outcome.penalizedName} taşı yandan alındığı için +${outcome.penaltyAmount} ceza aldı.` : 'Per başarıyla açıldı!') + bonusMsg,
        outcome.penalizedName ? 'amber' : 'emerald',
      );
    }
    return outcome;
  };

  // "Çift Aç" / "Çift İşle" (5. madde):
  //   - Henüz açmamış oyuncu: EN AZ 5 çift ile açar (101 toplamı ARANMAZ) ve
  //     `openedWithPairs` olarak işaretlenir (tur sonunda 2 kat ceza yer).
  //     ÜST SINIR YOKTUR: elinde 6/7 çift olan hepsini TEK SEFERDE açabilir;
  //     katlamalı modda baraj doğrudan o sayıya kurulur ve 7/9 çift açılışı
  //     ayrıca ödül kazandırır (bkz. gameLogic#pairsOpenBonus).
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

      // 5. madde: Katlamalı modda ÇİFT açılışına da katlama uygulanır — ilk
      // çift açan 5 çiftle açtıysa sonrakinin en az 6 çift açması gerekir.
      // (Zaten açmış bir oyuncunun kalan çiftlerini sürmesi barajdan etkilenmez.)
      const pairsBarrier = data.rules?.foldingEnabled ? (data.foldPairsBarrier || null) : null;
      const exemptFromPairsBarrier = isExemptFromFoldBarrier(user.uid, pairsBarrier, data.rules, data.teams);
      const minPairs = alreadyOpened ? 1 : requiredPairsToOpen(pairsBarrier, exemptFromPairsBarrier);

      // 2. madde: SADECE ilk kez ÇİFT ile açarken Gösterge taşı joker sayılır
      // (eşi masada Gösterge olarak durduğu için asla gelemez). Zaten açmış
      // bir oyuncunun çift sürmesinde ya da seri/set açılışında GEÇERSİZDİR.
      const pairIndicator = alreadyOpened ? null : (data.indicator || null);

      const { valid } = validatePairs(myGroupsNow, tilesById, validGroupIds, okeyNow, minPairs, pairIndicator);
      if (!valid) {
        outcome = alreadyOpened
          ? { success: false, reason: 'invalid-pair' }
          : { success: false, reason: 'invalid', minPairs };
        return;
      }

      // bkz. handleOpenSeries'teki aynı kural: yandan alınan taş bu açılışta
      // kullanılmak ZORUNDADIR, aksi halde açılış tümüyle reddedilir.
      const st = data.sideTake;
      if (st && st.uid === user.uid) {
        const usedTileIds = new Set(validGroupIds.flatMap((gid) => myGroupsNow[gid] || []));
        if (!usedTileIds.has(st.tileId)) { outcome = { success: false, reason: 'side-tile-unused' }; return; }
      }

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

      // Kullanıcı isteği (bkz. handleOpenSeries'teki aynı gerekçe): ıstakada
      // HER ZAMAN atılacak en az 1 taş kalmalı — çiftleri sürerek de elini
      // tamamen boşaltamaz.
      if (newRack.every((s) => s === null)) {
        outcome = { success: false, reason: 'must-keep-tile' };
        return;
      }
      // Çiftler NEREYE konacak? SERİ ile açmış bir oyuncu çift sürüyorsa,
      // çiftleri kendi perlerinin yanına değil masada ÇİFT AÇMIŞ oyuncunun
      // (2v2'de öncelikle EŞİNİN) perlerinin yanına gider — bkz. pickPairsHostUid.
      // İlk açılışını çiftle yapan oyuncu için hedef her zaman kendisidir.
      const pairsHostUid = alreadyOpened
        ? (pickPairsHostUid(user.uid, data.openedWithPairs, data.rules, data.teams) || user.uid)
        : user.uid;
      const existingOpened = data.openedHands?.[pairsHostUid] || [];
      const update = {
        [`racks.${user.uid}`]: newRack,
        [`groups.${user.uid}`]: myGroupsNow,
        [`openedHands.${pairsHostUid}`]: [...existingOpened, ...openedNow],
        [`hasOpened.${user.uid}`]: true,
        // 4. madde: elini açana taşlarını işlemesi/düşünmesi için ek süre.
        turnDeadline: extendedDeadlineAfterOpen(data.turnDeadline),
      };
      // Sadece İLK açılışını çiftle yapan oyuncu "çift açan" sayılır.
      if (!alreadyOpened) update[`openedWithPairs.${user.uid}`] = true;
      // 5. madde: çift barajı — seri barajıyla aynı mantık, sadece birim
      // "çift sayısı". Baraj yoksa kurulur, varsa ancak DAHA FAZLA çiftle
      // açan onu yükseltir.
      if (!alreadyOpened && data.rules?.foldingEnabled
        && (!pairsBarrier || validGroupIds.length > pairsBarrier.count)) {
        update.foldPairsBarrier = { count: validGroupIds.length, uid: user.uid };
      }

      // Çift ile açma: çekilen taşın değerinin 20 katı ceza (Eşli modda takıma)
      // — SADECE bu taşla İLK KEZ açılıyorsa (bkz. handleOpenSeries'teki aynı
      // gerekçe, `st.penalized`).
      let runningScores = data.scores || {};
      let penalizedName = null; let penaltyAmount = 0;
      if (st && st.uid === user.uid) {
        update.sideTake = null;
        if (st.penalized) {
          penaltyAmount = (st.tileValue || 0) * SIDE_TAKE_PAIRS_MULTIPLIER;
          const { updates, scores } = addScoreDelta(data, st.fromUid, penaltyAmount, runningScores);
          Object.assign(update, updates);
          runningScores = scores;
          penalizedName = players.find((p) => p.uid === st.fromUid)?.name || 'Rakip';
        }
      }

      // BÜYÜK AÇILIŞ ÖDÜLÜ: 7 çift -> -101, 9 çift -> -202 (bkz. pairsOpenBonus).
      let openBonus = 0;
      if (!alreadyOpened) {
        openBonus = pairsOpenBonus(validGroupIds.length);
        if (openBonus !== 0) {
          const { updates, scores } = addScoreDelta(data, user.uid, openBonus, runningScores);
          Object.assign(update, updates);
          runningScores = scores;
        }
      }

      outcome = { success: true, alreadyOpened, count: validGroupIds.length, penalizedName, penaltyAmount, openBonus };
      t.update(roomRef, update);
    }).catch((err) => { console.error('Okey101 çift açma hatası:', err); outcome = null; });

    if (outcome?.reason === 'no-pairs-on-table') showToast('Elindeki çiftleri ancak masada çift açan bir oyuncu varsa işleyebilirsin.', 'red');
    else if (outcome?.reason === 'must-keep-tile') showToast('Istakanda atacak en az 1 taş kalmalı! Daha az çift seçip tekrar dene.', 'red');
    else if (outcome?.reason === 'invalid') showToast(`Geçersiz Çift Seçimi! Açılış için EN AZ ${outcome.minPairs ?? 5} geçerli çift gerekli (daha fazlasıyla da açabilirsin).`, 'red');
    else if (outcome?.reason === 'invalid-pair') showToast('Geçersiz çift! Her per tam 2 taş ve aynı renk+sayı olmalı.', 'red');
    else if (outcome?.reason === 'side-tile-unused') showToast('Yandan aldığın taşı bu açılışta kullanmalısın! Kullanamıyorsan taşı geri koy.', 'red');
    else if (outcome?.success === true) {
      const base = outcome.alreadyOpened ? `${outcome.count} çift masaya sürüldü!` : `${outcome.count} çift ile açıldı!`;
      const bonusMsg = outcome.openBonus ? ` ${outcome.count} çift açılışı: ${outcome.openBonus} puan ödül!` : '';
      showToast(
        (outcome.penalizedName ? `${base} ${outcome.penalizedName} taşı yandan alındığı için +${outcome.penaltyAmount} ceza aldı.` : base) + bonusMsg,
        outcome.penalizedName ? 'amber' : 'emerald',
      );
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

      // 2. madde: bot da ilk kez çiftle açarken Gösterge taşını joker
      // sayabilir; sonraki çift sürmelerinde sayamaz.
      const botPairIndicator = (isPairs && !alreadyOpened) ? (data.indicator || null) : null;

      let total = 0;
      for (const m of melds) {
        if (isPairs) {
          if (m.tiles.length !== 2) { outcome = { success: false }; return; }
          if (!isValidPairTiles(m.tiles[0], m.tiles[1], okeyNow, botPairIndicator)) { outcome = { success: false }; return; }
        } else {
          const result = validateGroup(m.tiles, okeyNow);
          if (!result.valid) { outcome = { success: false }; return; }
          total += result.value;
        }
      }
      // 5. madde: bot da çift barajına tabidir.
      const botPairsBarrier = data.rules?.foldingEnabled ? (data.foldPairsBarrier || null) : null;
      const botExemptPairs = isExemptFromFoldBarrier(actingUid, botPairsBarrier, data.rules, data.teams);
      const botMinPairs = requiredPairsToOpen(botPairsBarrier, botExemptPairs);
      if (isPairs && !alreadyOpened && melds.length < botMinPairs) { outcome = { success: false }; return; }
      if (!isPairs && !alreadyOpened && total < OPEN_THRESHOLD) { outcome = { success: false }; return; }

      // bkz. handleOpenSeries'teki katlamalı mod barajı — bot da AYNI kurala
      // tabidir. `pickBotMelds` barajdan habersiz olduğu için (sadece normal
      // 101'i hedefler) bot GERÇEKTEN bu duruma düşebilir; insan oyuncuyla
      // AYNI şekilde +101 ceza yer (bot orkestrasyonundaki geri-dönüş bu
      // turu boş geçmesini sağlar).
      const foldingActiveBot = !isPairs && !!data.rules?.foldingEnabled;
      const barrierBot = data.foldBarrier || null;
      // bkz. handleOpenSeries#goesOutFromHand — elden biten (tüm elini bir
      // hamlede serip son taşı atacak olan) oyuncu barajdan muaftır; bot da.
      const botRackTileCount = actorRackNow.filter(Boolean).length;
      const botTilesUsedCount = melds.reduce((n, m) => n + m.tiles.length, 0);
      const botGoesOutFromHand = (botRackTileCount - botTilesUsedCount) <= 1;
      if (foldingActiveBot && !alreadyOpened && !botGoesOutFromHand && barrierBot && !isExemptFromFoldBarrier(actingUid, barrierBot, data.rules, data.teams) && total <= barrierBot.total) {
        t.update(roomRef, addScoreDelta(data, actingUid, PENALTY_POINTS).updates);
        outcome = { success: false };
        return;
      }

      // bkz. handleOpenSeries/handleOpenPairs'teki aynı kural: bot da yandan
      // aldığı taşı BU açılışta kullanmak zorundadır. Kullanmıyorsa açılış
      // reddedilir; bot orkestrasyonundaki mevcut geri-dönüş (taşı geri koy
      // + desteden çek + tekrar dene) bunu otomatik telafi eder.
      const stCheck = data.sideTake;
      if (stCheck && stCheck.uid === actingUid) {
        const usedTileIds = new Set(melds.flatMap((m) => m.tiles.map((tl) => tl.id)));
        if (!usedTileIds.has(stCheck.tileId)) { outcome = { success: false }; return; }
      }

      const openedNow = [];
      for (const m of melds) {
        // Botun açtığı per de masaya DOĞRU SIRADA yazılır — "12-9-10-11" gibi
        // bozuk dizilimler artık oluşamaz (bkz. orderGroupTiles + canTackTile).
        const type = isPairs ? 'cift' : m.type;
        openedNow.push({ tiles: orderGroupTiles(m.tiles, type, okeyNow), type });
        m.tiles.forEach((tl) => {
          const idx = actorRackNow.findIndex((s) => s && s.id === tl.id);
          if (idx !== -1) actorRackNow[idx] = null;
        });
      }

      // Kullanıcı isteği (bkz. handleOpenSeries): ıstakada her zaman atılacak
      // en az 1 taş kalmalı — bot da elini per/çift sürerek boşaltamaz.
      if (actorRackNow.every((s) => s === null)) { outcome = { success: false }; return; }
      // bkz. handleOpenPairs#pairsHostUid — SERİ ile açmış bir bot çift
      // sürüyorsa, çiftler masadaki ÇİFT AÇANIN (2v2'de öncelikle eşinin)
      // perlerinin yanına gider. Bot da insanla aynı kurala tabidir.
      const botPairsHostUid = (isPairs && alreadyOpened)
        ? (pickPairsHostUid(actingUid, data.openedWithPairs, data.rules, data.teams) || actingUid)
        : actingUid;
      const existingOpened = data.openedHands?.[botPairsHostUid] || [];
      const nextOpenedWithPairs = { ...(data.openedWithPairs || {}) };
      const update = {
        [`racks.${actingUid}`]: actorRackNow,
        [`openedHands.${botPairsHostUid}`]: [...existingOpened, ...openedNow],
        [`hasOpened.${actingUid}`]: true,
        // 4. madde: bot da açtıktan sonra aynı ek süreyi alır (insanla eşit
        // koşullar; süre aşımı kurtarma mekanizması da buna göre kayar).
        turnDeadline: extendedDeadlineAfterOpen(data.turnDeadline),
      };
      if (isPairs && !alreadyOpened) {
        nextOpenedWithPairs[actingUid] = true;
        update[`openedWithPairs.${actingUid}`] = true;
      }
      // bkz. handleOpenSeries — bot da barajı DAHA BÜYÜK bir toplamla geçerse
      // barajı kendi sayısına yükseltir (baraj sabit değildir).
      let nextFoldBarrier = data.foldBarrier || null;
      if (foldingActiveBot && !alreadyOpened && (!barrierBot || total > barrierBot.total)) {
        nextFoldBarrier = { total, uid: actingUid };
        update.foldBarrier = nextFoldBarrier;
      }
      // 5. madde: çift barajı (bkz. handleOpenPairs'teki aynı mantık).
      let nextFoldPairsBarrier = data.foldPairsBarrier || null;
      if (isPairs && !alreadyOpened && data.rules?.foldingEnabled
        && (!botPairsBarrier || melds.length > botPairsBarrier.count)) {
        nextFoldPairsBarrier = { count: melds.length, uid: actingUid };
        update.foldPairsBarrier = nextFoldPairsBarrier;
      }
      // bkz. handleOpenSeries/handleOpenPairs'teki aynı gerekçe: bot da CEZAYI
      // sadece bu taşla İLK KEZ açıyorsa (`st.penalized`) öder; zaten açmış
      // bir bot aynı "kullan ya da geri koy" zorunluluğuna tabidir ama
      // üzerine ceza binmez.
      const st = data.sideTake;
      let penalizedName = null; let penaltyAmount = 0;
      let nextScores = { ...(data.scores || {}) };
      if (st && st.uid === actingUid) {
        update.sideTake = null;
        if (st.penalized) {
          const multiplier = isPairs ? SIDE_TAKE_PAIRS_MULTIPLIER : SIDE_TAKE_SERIES_MULTIPLIER;
          penaltyAmount = (st.tileValue || 0) * multiplier;
          const { updates, scores } = addScoreDelta(data, st.fromUid, penaltyAmount, nextScores);
          Object.assign(update, updates);
          nextScores = scores;
          penalizedName = players.find((p) => p.uid === st.fromUid)?.name || 'Rakip';
        }
      }

      // Bot da insanla AYNI büyük açılış ödülünü alır (bkz. handleOpenSeries/
      // handleOpenPairs'teki aynı kural).
      let botOpenBonus = 0;
      if (!alreadyOpened) {
        botOpenBonus = isPairs ? pairsOpenBonus(melds.length) : seriesOpenBonus(total);
        if (botOpenBonus !== 0) {
          const { updates, scores } = addScoreDelta(data, actingUid, botOpenBonus, nextScores);
          Object.assign(update, updates);
          nextScores = scores;
        }
      }

      outcome = {
        success: true,
        penalizedName,
        penaltyAmount,
        next: {
          ...data,
          racks: { ...(data.racks || {}), [actingUid]: actorRackNow },
          // NOT: açılan perler `botPairsHostUid`'e yazılır (çift sürerken bu
          // BAŞKA bir oyuncu olabilir) — iyimser kopya da aynı yere yazmalı,
          // aksi halde bot orkestrasyonu bir sonraki adımda masayı yanlış görür.
          openedHands: { ...(data.openedHands || {}), [botPairsHostUid]: [...existingOpened, ...openedNow] },
          hasOpened: { ...(data.hasOpened || {}), [actingUid]: true },
          openedWithPairs: nextOpenedWithPairs,
          scores: nextScores,
          // `st` az önceki blokta (varsa) TÜKETİLMİŞ olabilir — ceza yazılıp
          // yazılmadığından (penalizedName) BAĞIMSIZ olarak, o bloğun
          // `update.sideTake = null` yazıp yazmadığıyla birebir aynı karar.
          sideTake: (st && st.uid === actingUid) ? null : (data.sideTake ?? null),
          foldBarrier: nextFoldBarrier,
          foldPairsBarrier: nextFoldPairsBarrier,
        },
      };
      t.update(roomRef, update);
    }).catch((err) => { console.error('Okey101 bot açma hatası:', err); outcome = null; });
    if (outcome?.penalizedName) showToast(`${outcome.penalizedName} taşı yandan alındığı için +${outcome.penaltyAmount} ceza aldı.`, 'amber');
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

    // İYİMSER: işlenen taş masadaki perin ucuna ANINDA oturur (taşın ıstakadan
    // kalkması zaten PlayerRack#optimisticGoneId ile anında oluyordu; eksik
    // olan, taşın masada BELİRMESİydi). Sıra DEĞİŞMEZ — işledikten sonra hâlâ
    // bir taş atmam gerekir. Okey işleği (`replaceTileId`) HARİÇTİR: orada
    // ıstakama Okey GELİR; bu bir ıstaka değişimidir ve bu katmanın kapsamı
    // dışındadır (bkz. turnPatch kapsam notu).
    if (!explicitUid && !target.replaceTileId) {
      applyTurnPatch((data) => {
        const group = (data.openedHands?.[target.uid] || [])[target.groupIndex];
        if (!group) return null;
        const okeyNow = data.okey || null;
        const { valid, newTiles } = canTackTile(group.tiles, group.type, tile, target.side, okeyNow);
        if (!valid) return null;
        const targetOpened = [...(data.openedHands?.[target.uid] || [])];
        targetOpened[target.groupIndex] = { ...group, tiles: orderGroupTiles(newTiles, group.type, okeyNow) };
        const patch = { openedHands: { ...(data.openedHands || {}), [target.uid]: targetOpened } };
        if (data.sideTake?.uid === user.uid && data.sideTake.tileId === tile.id) patch.sideTake = null;
        return patch;
      });
    }
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
      let nextScores = { ...(data.scores || {}) };

      if (target.replaceTileId) {
        // Okey işleği: gruptaki Okey/Sahte Okey'i, temsil ettiği GERÇEK taşla
        // değiştirir; çıkan Okey işleyen oyuncunun ıstakasına gelir (kazanılır).
        // Per türü fark etmez: seri/set (validateGroup) ya da ÇİFT (2 taş,
        // validateGroup'un minimum-3 şartına takılır — bkz. findJokerReplacements'in
        // 'cift' dalı) — kullanıcı isteği: kırmızı 13 + Okey çiftinde DİĞER
        // kırmızı 13 de artık bu şekilde okeyi çalabilir.
        if (isOkeyTile(tile, okeyNow)) { outcome = { success: false }; return; } // Okey'i Okey ile değiştiremezsin
        const jokerIdx = group.tiles.findIndex((tl) => tl.id === target.replaceTileId);
        if (jokerIdx === -1 || !isOkeyTile(group.tiles[jokerIdx], okeyNow)) { outcome = { success: false }; return; }
        const replacements = findJokerReplacements(group.tiles, group.type, tile, okeyNow);
        const match = replacements.find((r) => r.jokerIdx === jokerIdx);
        if (!match) { outcome = { success: false }; return; }
        const jokerTile = group.tiles[jokerIdx];
        const newGroupTiles = match.newTiles;

        targetOpened[target.groupIndex] = { ...group, tiles: newGroupTiles };
        newRack[idx] = jokerTile; // atılan taş çıkar, Okey onun yerine ıstakaya gelir

        // Masadan ALINAN (çalınan) Okey'in kimliği kaydedilir: tur sonunda bu
        // Okey HÂLÂ o oyuncunun ıstakasındaysa (yani çalıp kullanamadıysa)
        // kendisine +101 ceza yazılır — bkz. computeRoundEnd#takenOkeys.
        // Gerçek masadaki "kullanamayacaksan okeyi çalma" kuralı.
        update[`takenOkeys.${actingUid}`] = [...(data.takenOkeys?.[actingUid] || []), jokerTile.id];

        // Ceza: SADECE başkasının (rakip) perinden Okey alınırsa, VE Eşli
        // modda aynı takımdan değillerse (eşinin okeyini almanın cezası yok).
        let penalizedName = null;
        if (target.uid !== actingUid) {
          const teamsA = data.teams?.A || []; const teamsB = data.teams?.B || [];
          const sameTeam = data.rules?.gameType === '2v2'
            && ((teamsA.includes(actingUid) && teamsA.includes(target.uid)) || (teamsB.includes(actingUid) && teamsB.includes(target.uid)));
          if (!sameTeam) {
            const { updates, scores } = addScoreDelta(data, target.uid, PENALTY_POINTS, nextScores);
            Object.assign(update, updates);
            nextScores = scores;
            penalizedName = players.find((p) => p.uid === target.uid)?.name || 'Rakip';
          }
        }
        outcome = { success: true, wonOkey: true, penalizedName };
      } else {
        const { valid, newTiles } = canTackTile(group.tiles, group.type, tile, target.side, okeyNow);
        if (!valid) { outcome = { success: false }; return; }
        targetOpened[target.groupIndex] = { ...group, tiles: orderGroupTiles(newTiles, group.type, okeyNow) };
        newRack[idx] = null;
        outcome = { success: true };
      }

      // KULLANICI İSTEĞİ: yandan alınan taş masaya bir Seri/Çift Aç İÇİNDE
      // açılmadan, doğrudan İŞLENEREK (tacking) de "kullanılmış" sayılır —
      // per açmak ZORUNLU değildir. CEZA burada asla söz konusu değildir:
      // tacking sadece elini ÖNCEDEN açmış oyunculara açıktır (yukarıdaki
      // `hasOpened` şartı), yani bu noktaya ulaşan bir sideTake ASLA
      // `penalized: true` olamaz — aksi olsaydı oyuncu bu taşı bir açılışa
      // dahil etmeden `hasOpened` true olamazdı (bkz. handleOpenSeries/
      // handleOpenPairs'teki "usedTileIds.has(st.tileId)" reddi).
      if (data.sideTake?.uid === actingUid && data.sideTake.tileId === tile.id) {
        update.sideTake = null;
      }

      // Kullanıcı isteği (5. madde): ıstakada HER ZAMAN atılacak en az 1 taş
      // kalmalıdır — taş atmadan, son taşı da işleyerek (tacking) "elden
      // bitirmek" artık GEÇERLİ DEĞİLDİR. Eskiden bu geçerli bir bitiriş
      // sayılıyordu (gerçek 101 Okey kuralı); şimdi bilinçli olarak reddedilir
      // — oyuncu (ya da bot) son taşını bunun yerine ATMALIDIR (bkz.
      // handleDiscardTile). PlayerRack tarafında da bu hedef zaten SUNULMAZ
      // (bkz. updateDropTarget#isLastTile) — bu, sunucu tarafındaki asıl kilit.
      if (!target.replaceTileId && newRack.every((s) => s === null)) {
        outcome = { success: false, reason: 'must-keep-tile' };
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
        sideTake: 'sideTake' in update ? update.sideTake : data.sideTake,
      };
    }).catch((err) => { console.error('Okey101 işleme hatası:', err); outcome = null; });

    if (!explicitUid && !outcome?.success) clearTurnPatch(); // reddedildiyse tahmini geri al

    if (outcome?.reason === 'must-keep-tile') showToast('Istakanda atacak en az 1 taş kalmalı — bu taşı işlemek yerine atmalısın.', 'red');
    else if (outcome?.success === false) showToast('Bu taş buraya uymuyor, ıstakana geri döndü.', 'red');
    else if (outcome?.roundEnded) showToast('Elini taş atmadan işleyerek bitirdin!', 'emerald');
    else if (outcome?.success === true && outcome.wonOkey) {
      showToast(outcome.penalizedName ? `Okey'i kazandın! ${outcome.penalizedName} +101 ceza aldı.` : 'Okey\'i kazandın!', 'emerald');
    }
    return outcome;
  };

  // "Yeni Tura Başla" (sadece host): masayı tamamen sıfırlar, taşları yeniden
  // dağıtır (yeni Gösterge/Okey dahil) ve 15sn hazırlık fazıyla yeni el başlatır.
  // `scores` zaten tur sonunda güncellendiği için buradan dokunulmuyor, sadece
  // yeni turun anlık-ceza karşılaştırması için roundStartScores tazelenir.
  //
  // 5. madde: Başlayan oyuncu, ÖNCEKİ elin başlayanının bir sonrakine
  // (oturma düzenindeki normal tur akışı yönünde, yani saat yönünün tersine)
  // döner — böylece her el farklı biri başlar, hep AYNI kişi (host) değil.
  const handleStartNewRound = async () => {
    if (!isHost) return;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (!data.roundEnded) return;
      const roundPlayers = seatOrderedPlayers(data.players || [], data.rules, data.teams);
      const prevStarter = data.starterUid;
      const starterUid = (prevStarter && roundPlayers.includes(prevStarter))
        ? getNextTurnUid(roundPlayers, prevStarter)
        : (roundPlayers[0] || null);
      const { racks, drawPile, indicator } = dealTiles(roundPlayers, starterUid);
      const okey = computeOkeyInfo(indicator);
      const groups = {}; const discardPiles = {}; const openedHands = {}; const hasOpened = {}; const openedWithPairs = {};
      roundPlayers.forEach((uid) => { groups[uid] = {}; discardPiles[uid] = []; openedHands[uid] = []; hasOpened[uid] = false; openedWithPairs[uid] = false; });
      const isBotSeat = (uid) => !!data.isBotPlayer?.[uid] || isBotUid(uid);
      const setup = buildDealSetup(racks, groups, okey, data.rules, isBotSeat);
      t.update(roomRef, {
        players: roundPlayers, racks, drawPile, indicator, okey, groups, discardPiles, openedHands, hasOpened, openedWithPairs,
        ...setup,
        turn: starterUid, starterUid, hasDrawnThisTurn: true, sideTake: null, forcedPileDraw: false,
        roundEnded: false, roundResult: null, roundStartScores: { ...(data.scores || {}) },
        centerDiscard: null, openedBeforeCurrentTurn: false, tackHint: null, foldBarrier: null, foldPairsBarrier: null,
        takenOkeys: {},
      });
    }).catch((err) => console.error('Okey101 yeni tur hatası:', err));
  };


  // ============================================================
  // SEYİRCİNİN BOT KOLTUĞUNA GEÇMESİ (kullanıcı isteği)
  // ============================================================
  // Masada en az bir BOT varsa, seyirci "onun yerine geçmeyi" teklif edebilir.
  // Teklif `seatRequests` altında birikir; HOST teklifi görüp kabul ya da
  // reddeder. Kabul edilirse botun ıstakası/perleri/puanı/sırası olduğu gibi
  // seyirciye devredilir (bkz. gameLogic#buildSeatSwapUpdate) ve oyun kaldığı
  // yerden sürer.
  const botSeats = players.filter((p) => p.isBot);
  const seatRequests = roomData.seatRequests || {};
  const mySeatRequest = seatRequests[user.uid] || null;
  const pendingSeatRequests = Object.entries(seatRequests);

  const handleRequestBotSeat = async (botUid) => {
    if (isPlayer || !botUid) return;
    let myName = 'Seyirci';
    try { myName = localStorage.getItem('nickname') || myName; } catch { /* depolama kapalı olabilir */ }
    await updateDoc(roomRef, {
      [`seatRequests.${user.uid}`]: { botUid, name: myName, at: Date.now() },
    }).catch((err) => console.error('Okey101 koltuk isteği hatası:', err));
  };

  const handleCancelSeatRequest = async () => {
    await updateDoc(roomRef, { [`seatRequests.${user.uid}`]: deleteField() })
      .catch((err) => console.error('Okey101 koltuk isteği iptal hatası:', err));
  };

  // `accept === false` ise teklif sadece silinir.
  const handleResolveSeatRequest = async (requesterUid, accept) => {
    if (!isHost) return;
    let result = null;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.host !== user.uid) return;
      const req = data.seatRequests?.[requesterUid];
      if (!req) return;

      const rest = { ...(data.seatRequests || {}) };
      delete rest[requesterUid];

      if (!accept) { t.update(roomRef, { seatRequests: rest }); result = { rejected: true }; return; }

      const botUid = req.botUid;
      const stillBot = (data.players || []).includes(botUid) && (isBotUid(botUid) || !!data.isBotPlayer?.[botUid]);
      if (!stillBot || (data.players || []).includes(requesterUid)) {
        t.update(roomRef, { seatRequests: rest });
        result = { stale: true };
        return;
      }
      // Bot kilidini bırak: devralan artık insan, bot otomasyonu bu koltuğa
      // dokunmamalı.
      if (botTurnLockRef.current?.turnUid === botUid) botTurnLockRef.current = null;
      t.update(roomRef, { ...buildSeatSwapUpdate(data, botUid, requesterUid, req.name), seatRequests: rest });
      result = { accepted: true, name: req.name };
    }).catch((err) => { console.error('Okey101 koltuk devri hatası:', err); result = null; });

    if (result?.accepted) showToast(`${result.name} botun yerine masaya oturdu.`, 'emerald');
    else if (result?.stale) showToast('Bu koltuk artık uygun değil, teklif kaldırıldı.', 'amber');
  };

  const toastColors = { red: 'bg-red-500/95 border-red-400', amber: 'bg-amber-500/95 border-amber-400', emerald: 'bg-emerald-500/95 border-emerald-400' };
  const canTackNow = isPlayer && mustDiscard && myHasOpened;

  // bkz. openEndsCacheRef yorumu yukarıda: `roomData.openedHands`/`okeyInfo`
  // referansı (yani gerçek veri) değişmediyse önceki sonucu aynen kullanır.
  //
  // Bu harita artık SIRAYA BAKILMADAN (canTackNow'dan bağımsız) hesaplanır:
  // işleme boşlukları masada KALICI olarak durur, sıra bize geldiğinde
  // belirip gidince kaybolmaz. Sıra bizdeyken sadece VURGULANIR ve
  // sürüklemeye açılır — masanın şekli sabit kaldığı için "nereye ne
  // işlenebilir" bilgisi her zaman okunabilir.
  {
    const cache = openEndsCacheRef.current;
    if (cache.opened !== view.openedHands || cache.okeyInfoRef !== okeyInfo) {
      const map = {};
      Object.entries(view.openedHands || {}).forEach(([uid, groups]) => {
        (groups || []).forEach((g, gi) => { map[`${uid}:${gi}`] = getGroupOpenEnds(g.tiles, g.type, okeyInfo); });
      });
      openEndsCacheRef.current = { opened: view.openedHands, okeyInfoRef: okeyInfo, map };
    }
  }
  const openEndsMap = openEndsCacheRef.current.map;

  // 3. madde: hâlâ süresi dolmamış bir "işlek taş nereye oturuyor" ipucu var mı?
  const activeTackHint = (roomData.tackHint && roomData.tackHint.expiresAt > Date.now()) ? roomData.tackHint : null;
  const isTackFlashing = (uid, groupIndex) => !!activeTackHint?.spots.some((s) => s.uid === uid && s.groupIndex === groupIndex);

  // 5. madde kuralları — arayüz butonlarının açık/kapalı olmasını belirler.
  const myCanLayPairs = canPlayerLayPairs(user.uid, roomData.hasOpened, roomData.openedWithPairs);
  const myCanLayMelds = canPlayerLayMelds(user.uid, roomData.openedWithPairs);
  const pairsButtonLabel = myHasOpened ? 'Çift İşle' : 'Çift Aç';
  // İlk çift açılışı için gereken EN AZ çift sayısı (katlamalı modda masadaki
  // çift barajının bir fazlası, aksi halde 5). Üst sınır yoktur — 6/7 çiftle
  // de açılabilir ve baraj o sayıya kurulur (bkz. handleOpenPairs).
  const myPairsBarrier = roomData.rules?.foldingEnabled ? (roomData.foldPairsBarrier || null) : null;
  const myPairsBarrierExempt = isExemptFromFoldBarrier(user.uid, myPairsBarrier, roomData.rules, roomData.teams);
  const myMinPairsToOpen = requiredPairsToOpen(myPairsBarrier, myPairsBarrierExempt);
  // KULLANICI İSTEĞİ (Yardımlı Mod ilerleme rozeti): seri/set (per) ile
  // açmak için ulaşılması gereken hedef toplam. Katlamasızsa (ya da baraj
  // yoksa/muafsa) sabit 101'dir; katlamalı modda masada bir baraj varsa (ve
  // muaf değilsem) barajı KESİN OLARAK GEÇMEM gerektiği için hedef
  // `barrier.total + 1`'dir (bkz. handleOpenSeries'teki `total <= barrier.total`
  // reddi — eşitlik bile yetmez).
  const mySeriesBarrier = roomData.rules?.foldingEnabled ? (roomData.foldBarrier || null) : null;
  const mySeriesBarrierExempt = isExemptFromFoldBarrier(user.uid, mySeriesBarrier, roomData.rules, roomData.teams);
  const mySeriesTarget = (mySeriesBarrier && !mySeriesBarrierExempt) ? mySeriesBarrier.total + 1 : OPEN_THRESHOLD;
  // Madde 8 (kullanıcı isteği): "Eşe Katlama" KAPALIYSA, eşimin kurduğu baraj
  // beni bağlamaz (yukarıdaki *Exempt zaten bunu doğru hesaplıyor) — ama
  // rozet eskiden bunu hep "Baraj" diye (sanki BENİM sınırımmış gibi)
  // gösteriyordu. Barajı EŞİM kurduysa ve ben ondan muafsam, rozet sadece
  // BİLGİ amaçlı "Eşinin Açtığı" olarak gösterilir; benim açma sınırım
  // (mySeriesTarget/myMinPairsToOpen, yukarıda) zaten DEĞİŞMEDEN 101/5 kalır.
  const seriesBarrierIsInfoOnly = !!mySeriesBarrier && mySeriesBarrierExempt && mySeriesBarrier.uid !== user.uid;
  const pairsBarrierIsInfoOnly = !!myPairsBarrier && myPairsBarrierExempt && myPairsBarrier.uid !== user.uid;

  const hasAnyOpenedHand = Object.values(view.openedHands || {}).some((groups) => groups.length > 0);

  // AÇILAN ELLER paneli: kullanıcı isteğiyle artık masanın ORTA sütununda
  // (deste/gösterge'nin ALTINDA), sol/sağ koltukların YANINDA duruyor —
  // eskiden koltukların ayrı bir satırının ALTINDA, tam genişlikte ayrı bir
  // kutuydu. Genişliği merkez sütuna göre SINIRLI olduğundan içerik burada
  // biraz daha dar bir sarmalayıcıya sığdırılır (bkz. OpponentStrip#center).
  // KOMPAKT (telefon yatay) modda bu yeniden düzenleme uygulanmaz: dar dikey
  // alanda sol/sağ koltukların yanına sıkıştırmak okunmaz olurdu, panel eskisi
  // gibi ayrı ve tam genişlikte kalır (bkz. aşağıdaki `isCompact` dallanması).
  // Masaya açılan taşların boyutu. Eskiden `size="small"` (~26px) idi ve
  // "işlek taş" kontrolü için gözü kısmak gerekiyordu. Masa kabı genişletildiği
  // (bkz. App.tsx#max-w-6xl) için artık belirgin şekilde daha büyük çizilebilir.
  const openedTileW = isCompact ? 26 : 34;
  // İşleme (kesik çizgili) boşlukları taşla AYNI ölçüde olmalı, aksi halde
  // per'ler ve boşluklar farklı yüksekliklerde durup satırı bozuyor.
  const tackSlotStyle = { width: `${Math.round(openedTileW * 0.92)}px`, height: `${Math.round(openedTileW * TILE_ASPECT)}px` };

  const openedHandsPanel = hasAnyOpenedHand ? (
    <div className={`bg-slate-900/60 border border-slate-700 rounded-xl p-2 sm:p-3 ${isCompact ? 'w-full' : 'w-full sm:w-auto sm:max-w-none'}`}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest">Açılan Eller</span>
        {canTackNow && <span className="text-[9px] sm:text-[10px] text-amber-300/90 font-bold">Taşı kesik çizgili boşluğa sürükle</span>}
      </div>
      <div className="flex flex-col gap-2 sm:gap-3">
        {players.map((p) => {
          const openedGroups = view.openedHands?.[p.uid] || [];
          if (openedGroups.length === 0) return null;
          return (
            // Perler arası boşluk BİLEREK geniş tutuldu: yan yana duran iki
            // per birbirine yapışıkken hangi taşın hangi perin ucuna
            // işleneceği karışıyordu.
            <div key={p.uid} className="flex items-start gap-x-4 gap-y-2 sm:gap-x-6 flex-wrap">
              <span className="text-[10px] sm:text-[11px] text-slate-500 font-bold shrink-0 mt-2">
                {p.name}
                {roomData.openedWithPairs?.[p.uid] && <span className="ml-1 text-fuchsia-400">(çift)</span>}:
              </span>
              {openedGroups.map((g, gi) => {
                // İşleme (tacking) yerleri: SADECE gerçekten taş kabul eden
                // uçlarda, bir TAŞ BOYUNDA kesik çizgili boşluk olarak
                // gösterilir. Çiftlerde (cift) hiç gösterilmez; seri 1'de
                // başlıyorsa solda, 13'te bitiyorsa sağda gösterilmez.
                //
                // Bu boşluklar artık SIRADAN BAĞIMSIZ olarak hep durur —
                // eskiden sıra bize gelince belirip gidince kayboluyordu,
                // masa her turda "zıplıyor" gibi görünüyordu. Sıra bizdeyken
                // sadece renklenip sürüklemeye açılırlar (aşağıdaki
                // `tackActive`).
                const ends = openEndsMap[`${p.uid}:${gi}`] || { left: false, right: false };
                const tackActive = canTackNow;
                const tackSlotClass = `shrink-0 rounded-md border-2 border-dashed transition-colors ${tackActive ? 'border-amber-400/70 bg-amber-400/5' : 'border-slate-600/40 bg-slate-800/20'}`;
                // `data-tack-*` sadece sıra bizdeyken yazılır; PlayerRack
                // zaten kendi tarafında da (canAct + hasOpenedAlready)
                // kontrol ediyor, bu ikinci bir emniyet.
                const tackData = (side) => (tackActive
                  ? { 'data-tack-uid': p.uid, 'data-tack-index': gi, 'data-tack-side': side }
                  : {});
                // 3. madde: az önce atılan işlek bir taş TAM OLARAK buraya
                // oturuyorsa, kim atmış/kimin sırası olursa olsun masadaki
                // HERKESE 2-3sn kırmızı yanıp sönerek gösterilir.
                const flashing = isTackFlashing(p.uid, gi);
                return (
                  <div key={gi} className="flex items-center gap-1">
                    {ends.left && (
                      <div
                        {...tackData('left')}
                        title={tackActive ? 'Buraya taş sürükleyerek işle' : 'Bu perin açık ucu — sıra sana geldiğinde buraya taş işleyebilirsin'}
                        style={tackSlotStyle}
                        className={tackSlotClass}
                      />
                    )}
                    <div className={`flex items-center gap-0.5 bg-black/20 rounded-md p-1 transition-shadow ${flashing ? 'ring-2 ring-red-500 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.8)]' : `ring-1 ${g.type === 'cift' ? 'ring-fuchsia-500/40' : 'ring-emerald-500/40'}`}`}>
                      {g.tiles.map((tl) => {
                        const tileIsOkey = isOkeyTile(tl, okeyInfo);
                        // Okey işleği: gruptaki bir Okey taşının ÜZERİNE, o taşın
                        // temsil ettiği gerçek taş sürüklenip bırakılırsa Okey
                        // işleyen oyuncunun ıstakasına geçer (bkz. handleTackTile).
                        // ÇİFT dahil HER per türünde geçerlidir artık (kullanıcı isteği:
                        // kırmızı 13 + Okey çiftinde diğer kırmızı 13 de okeyi çalabilir).
                        // Sürüklenen taşın GERÇEKTEN uyup uymadığı (hangi taş olursa
                        // olsun) yine sunucu tarafında `findJokerReplacements` ile
                        // doğrulanır (bkz. handleTackTile) — buradaki `canReplace` diğer
                        // uçlardaki (`ends.left/right`) gibi sadece "buraya taş
                        // sürüklenebilir" görsel ipucudur.
                        const canReplace = canTackNow && tileIsOkey;
                        const replaceProps = canReplace
                          ? { 'data-tack-uid': p.uid, 'data-tack-index': gi, 'data-tack-replace-tile-id': tl.id }
                          : {};
                        // Masaya (herhangi bir oyuncunun perine) açılan/işlenen
                        // Okey, gerçek Okey masasındaki gelenekte olduğu gibi
                        // TERS çevrilmiş gösterilir — kaç numarayı temsil ettiği
                        // gizli kalır, sadece "burada bir Okey var" görünür.
                        return (
                          <div key={tl.id} title={canReplace ? 'Okey\'i almak için gerçek taşı buraya sürükle' : undefined} {...replaceProps}>
                            <Tile tile={tl} width={openedTileW} okeyInfo={okeyInfo} faceDown={tileIsOkey} className={canReplace ? 'animate-pulse cursor-pointer' : ''} />
                          </div>
                        );
                      })}
                    </div>
                    {ends.right && (
                      <div
                        {...tackData('right')}
                        title={tackActive ? 'Buraya taş sürükleyerek işle' : 'Bu perin açık ucu — sıra sana geldiğinde buraya taş işleyebilirsin'}
                        style={tackSlotStyle}
                        className={tackSlotClass}
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
  ) : null;

  // Tur bandı: masanın ORTASINDAN alınıp en üstteki oyuncunun üstüne taşındı
  // (bkz. OpponentStrip#turnBanner) — böylece ortada açılan perlere yer kalır.
  const turnBanner = setupPhase ? null : (
    <div className={`flex items-center justify-center gap-2 text-center font-bold rounded-lg ${isCompact ? 'text-[11px] px-2 py-0.5' : 'text-xs sm:text-base px-3 py-1.5'} ${isMyTurn ? 'text-amber-300 bg-amber-500/10' : 'text-slate-400'}`}>
      <span>{isMyTurn ? (mustDraw ? 'Sıra Sende! Önce bir taş çek.' : 'Şimdi ıstakandan bir taş at.') : `${turnPlayerName} oynuyor...`}</span>
      {/* bkz. TurnCountdown: sayaç kendi bileşeninde tıklar, masayı yeniden çizmez. */}
      <TurnCountdown deadline={roomData.turnDeadline} active={!setupPhase} />
    </div>
  );

  return (
    <div className={`w-full flex flex-col items-center relative ${isCompact ? 'gap-1 h-[100dvh] max-h-[100dvh] overflow-hidden' : 'gap-2 sm:gap-3'} ${isFullscreenView ? 'max-w-[1500px]' : 'max-w-6xl'}`}>
      {toast && (
        <div className={`fixed top-16 left-1/2 -translate-x-1/2 z-[5000] text-white px-4 py-2.5 sm:px-6 sm:py-3 rounded-xl shadow-2xl font-bold border text-center text-xs sm:text-sm w-[92%] max-w-sm ${toastColors[toast.tone] || toastColors.red}`}>
          {toast.msg}
        </div>
      )}

      {/* 1. madde: oyun başlamadan seçilen oda kuralları (eşli/tekli,
          katlamalı/katlamasız, eşe katlama) tüm oyun boyunca ekranın EN
          SAĞINDA küçük rozetler halinde görünür kalır. */}
      {/* KOMPAKT (telefon yatay) modda sağ üst köşede App.tsx'in SABİT "Çık" ve
          "Tam Ekran Yap" butonları duruyor — rozetler top-0'da kalırsa onların
          ALTINA binip okunmaz oluyordu. Bu yüzden kompakt modda biraz aşağı
          alınır. */}
      <div className={`absolute right-0 z-[10] flex flex-col items-end gap-1 pointer-events-none ${isCompact ? 'top-9' : 'top-0'}`}>
        <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider bg-slate-900/80 border border-slate-700 text-slate-300 px-1.5 py-0.5 rounded-full">
          {roomData.rules?.gameType === '2v2' ? 'Eşli' : 'Tekli'}
        </span>
        <span className={`text-[8px] sm:text-[9px] font-bold uppercase tracking-wider border px-1.5 py-0.5 rounded-full ${roomData.rules?.foldingEnabled ? 'bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-300' : 'bg-slate-900/80 border-slate-700 text-slate-500'}`}>
          {roomData.rules?.foldingEnabled ? 'Katlamalı' : 'Katlamasız'}
        </span>
        {roomData.rules?.gameType === '2v2' && roomData.rules?.foldingEnabled && (
          <span className={`text-[8px] sm:text-[9px] font-bold uppercase tracking-wider border px-1.5 py-0.5 rounded-full ${roomData.rules?.foldToPartnerEnabled ? 'bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-300' : 'bg-slate-900/80 border-slate-700 text-slate-500'}`}>
            {roomData.rules?.foldToPartnerEnabled ? 'Eşe Katlama Var' : 'Eşe Katlama Yok'}
          </span>
        )}
        {/* Yardımlı/Yardımsız durumu diğer kural rozetleriyle aynı yerde
            belirtilir — masadaki herkes bu odanın modunu görür. */}
        <span className={`text-[8px] sm:text-[9px] font-bold uppercase tracking-wider border px-1.5 py-0.5 rounded-full ${assisted ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300' : 'bg-slate-900/80 border-slate-700 text-slate-500'}`}>
          {assisted ? 'Yardımlı' : 'Yardımsız'}
        </span>
        {/* Ses aç/kapa. Sarmalayıcı `pointer-events-none` olduğu için buton
            kendi üzerinde bunu geri açar. Tercih tarayıcıda saklanır. */}
        <button
          type="button"
          onClick={() => setOkeySoundMuted(!soundMuted)}
          title={soundMuted ? 'Sesi aç' : 'Sesi kapat'}
          aria-label={soundMuted ? 'Sesi aç' : 'Sesi kapat'}
          className={`pointer-events-auto flex items-center gap-1 text-[8px] sm:text-[9px] font-bold uppercase tracking-wider border px-1.5 py-0.5 rounded-full transition-colors ${soundMuted ? 'bg-slate-900/80 border-slate-700 text-slate-500 hover:text-slate-300' : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'}`}
        >
          {soundMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
          {soundMuted ? 'Ses Kapalı' : 'Ses Açık'}
        </button>
      </div>

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

      {/* KOMPAKT (telefon yatay): masa üstü bilgiler kendi içinde kaydırılır,
          ıstaka her zaman ekranın altında görünür kalır. Geniş ekranda bu
          sarmalayıcı hiçbir şey değiştirmez (normal akış). */}
      <div className={`w-full flex flex-col items-center ${isCompact ? 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden gap-1' : 'gap-2 sm:gap-3'}`}>
      <SetupCountdown setupEndsAt={setupPhase ? roomData.setupEndsAt : null} />

      <OpponentStrip
        topSeat={topSeat}
        leftSeat={leftSeat}
        rightSeat={rightSeat}
        bottomSeat={bottomSeat}
        hostUid={roomData.host}
        turnUid={view.turn}
        okeyInfo={okeyInfo}
        compact={isCompact}
        turnBanner={turnBanner}
        centerExtra={!isCompact ? openedHandsPanel : null}
      >
        {/* 2. madde: Desteye basmak için hedef alan belirgin şekilde BÜYÜTÜLDÜ
            ve Göstergeden iyice ayrıldı — parmak yanlışlıkla Göstergeye
            gitmesin (Gösterge'nin zaten tıklanacak bir işlevi yoktur). */}
        {/* `flex-wrap`: telefon DİKEY modda Deste + Gösterge + (katlamalı modda)
            baraj rozetleri tek satıra sığmıyor, taşan rozetler ekran dışında
            kalıp GÖRÜNMÜYORDU. Artık alt satıra sarılırlar. */}
        <div className={`flex items-center flex-wrap justify-center ${isCompact ? 'gap-3' : 'gap-3 sm:gap-8'}`}>
          <div
            {...pileDrag.handlers}
            title={mustDraw ? 'Desteden çek (tıkla ya da ıstakaya sürükle)' : undefined}
            className={`flex items-center bg-slate-900/70 border-2 rounded-xl transition-colors touch-none select-none ${isCompact ? 'gap-1.5 px-2 py-1.5' : 'gap-2 sm:gap-3 px-3 py-2.5 sm:px-5 sm:py-3'} ${mustDraw ? 'cursor-pointer border-amber-400 ring-4 ring-amber-400/40 animate-pulse' : 'border-slate-700 opacity-80'}`}
          >
            <span className={`text-slate-400 font-bold uppercase tracking-widest ${isCompact ? 'text-[9px]' : 'text-[10px] sm:text-xs'}`}>Deste</span>
            <TileBack size={isCompact ? 'small' : 'normal'} />
            <span className={`font-mono font-bold text-slate-200 ${isCompact ? 'text-xs' : 'text-sm sm:text-lg'}`}>{view.drawPile?.length ?? 0}</span>
          </div>

          {/* 6. madde: Göstergenin HANGİ taş olduğu, taşın hemen ALTINDA
              okunaklı ama öne çıkmayan bir boyutta yazılır (ör. "Sarı 7") —
              böylece Okey'in ne olduğunu hesaplamak için taşa gözle bakmak
              zorunda kalınmaz. */}
          {roomData.indicator && (
            <div className={`flex flex-col items-center bg-slate-900/70 border border-slate-700 rounded-lg pointer-events-none ${isCompact ? 'gap-0.5 px-1.5 py-1' : 'gap-1 px-2 py-1.5 sm:px-3'}`}>
              <div className={`flex items-center ${isCompact ? 'gap-1' : 'gap-1.5 sm:gap-2'}`}>
                <span className={`text-slate-400 font-bold uppercase tracking-widest ${isCompact ? 'text-[8px]' : 'text-[9px] sm:text-[10px]'}`}>Gösterge</span>
                <Tile tile={roomData.indicator} size="small" okeyInfo={okeyInfo} />
              </div>
              <span className={`font-bold text-slate-300 leading-none whitespace-nowrap ${isCompact ? 'text-[9px]' : 'text-[10px] sm:text-xs'}`}>
                {COLOR_LABELS[roomData.indicator.color] || ''} {roomData.indicator.number}
              </span>
            </div>
          )}

          {/* Katlamalı mod barajları — herkese görünür. SERİ barajı puan,
              ÇİFT barajı (5. madde) çift sayısı üzerinden ayrı ayrı işler.
              İKİSİ ALT ALTA (tek bir dikey sütunda) durur: yan yana
              dizildiklerinde orta blok genişleyip Desteyi soldaki oyuncunun,
              kendisini de sağdaki oyuncunun ismiyle çakıştırıyordu. */}
          {(roomData.foldBarrier || roomData.foldPairsBarrier) && (
            <div className="flex flex-col items-stretch gap-1">
              {/* Madde 8: barajı EŞİM kurduysa ve "Eşe Katlama" kapalıyken ben
                  ondan muafsam, bu SADECE bilgi amaçlıdır — benim açma sınırım
                  (mySeriesTarget) değişmez. Rozet daha SOLUK (fuchsia değil
                  slate) ve "Eşinin Açtığı" yazarak bunu netleştirir. */}
              {roomData.foldBarrier && (
                <div className={`flex items-center justify-between rounded-lg pointer-events-none ${seriesBarrierIsInfoOnly ? 'bg-slate-800/60 border border-slate-600/50' : 'bg-fuchsia-500/10 border border-fuchsia-500/40'} ${isCompact ? 'gap-1 px-1.5 py-0.5' : 'gap-1.5 sm:gap-2 px-2 py-1'}`}>
                  <span className={`font-bold uppercase tracking-widest ${seriesBarrierIsInfoOnly ? 'text-slate-400' : 'text-fuchsia-300/90'} ${isCompact ? 'text-[8px]' : 'text-[9px] sm:text-[10px]'}`}>{seriesBarrierIsInfoOnly ? 'Eşinin Açtığı' : 'Baraj'}</span>
                  <span className={`font-mono font-bold whitespace-nowrap ${seriesBarrierIsInfoOnly ? 'text-slate-300' : 'text-fuchsia-200'} ${isCompact ? 'text-[10px]' : 'text-xs sm:text-sm'}`}>{formatFoldBarrier(roomData.foldBarrier.total)}</span>
                </div>
              )}
              {roomData.foldPairsBarrier && (
                <div className={`flex items-center justify-between rounded-lg pointer-events-none ${pairsBarrierIsInfoOnly ? 'bg-slate-800/60 border border-slate-600/50' : 'bg-fuchsia-500/10 border border-fuchsia-500/40'} ${isCompact ? 'gap-1 px-1.5 py-0.5' : 'gap-1.5 sm:gap-2 px-2 py-1'}`}>
                  <span className={`font-bold uppercase tracking-widest ${pairsBarrierIsInfoOnly ? 'text-slate-400' : 'text-fuchsia-300/90'} ${isCompact ? 'text-[8px]' : 'text-[9px] sm:text-[10px]'}`}>{pairsBarrierIsInfoOnly ? 'Eşinin Açtığı (Çift)' : 'Çift'}</span>
                  <span className={`font-mono font-bold whitespace-nowrap ${pairsBarrierIsInfoOnly ? 'text-slate-300' : 'text-fuchsia-200'} ${isCompact ? 'text-[10px]' : 'text-xs sm:text-sm'}`}>{roomData.foldPairsBarrier.count} çift</span>
                </div>
              )}
            </div>
          )}

          {/* 2. madde: eli bitiren atış (ister taş atarak, ister işleyerek)
              MASANIN ORTASINA, Göstergenin hemen yanına gelir — "sağdaki
              oyuncuya atma" görüntüsü vermez, oyun ortaya atarak biter. */}
          {roomData.centerDiscard && (
            <div className={`flex items-center bg-emerald-500/10 border border-emerald-500/40 rounded-lg pointer-events-none ${isCompact ? 'gap-1 px-1.5 py-1' : 'gap-1.5 sm:gap-2 px-2 py-1.5 sm:px-3'}`}>
              <span className={`text-emerald-300/90 font-bold uppercase tracking-widest ${isCompact ? 'text-[8px]' : 'text-[9px] sm:text-[10px]'}`}>Bitiren Taş</span>
              <Tile tile={roomData.centerDiscard} size="small" okeyInfo={okeyInfo} />
            </div>
          )}

          {/* 4. madde: elde tam 1 taş kalınca VE sıra bizdeyse, elimizi
              BİTİRMEK için son taşımızı buraya (göstergenin yanına) sürükleyip
              bırakabildiğimiz, yanıp sönerek dikkat çeken YENİ bir hedef alan.
              Eskiden bu SADECE ıstakanın altındaki "Sağa At" bölmesinden
              yapılabiliyordu; artık ASIL bitiriş burasıdır. */}
          {isFinishingDiscard && (
            <div
              data-center-finish-zone="true"
              title="Elini bitirmek için son taşını buraya sürükle"
              className={`flex items-center bg-emerald-500/15 border-2 border-dashed border-emerald-400 rounded-lg animate-pulse transition-colors touch-none ${isCompact ? 'gap-1 px-1.5 py-1' : 'gap-1.5 sm:gap-2 px-2 py-1.5 sm:px-3'}`}
            >
              <span className={`text-emerald-300 font-black uppercase tracking-widest ${isCompact ? 'text-[8px]' : 'text-[9px] sm:text-[10px]'}`}>Bitir</span>
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
          yüz gösterilir. Konum React state'i değil `ghostRef` üzerinden
          doğrudan DOM yazımıyla güncellenir (bkz. useDrawDrag) — performans
          için; sadece ilk anda hafifçe büyür. */}
      {pileDrag.active && (
        <div ref={pileDrag.ghostRef} className="fixed left-0 top-0 -ml-[22px] -mt-[30px] z-[4000] pointer-events-none">
          <div className="transition-transform duration-150 ease-out" style={{ transform: pileDrag.grown ? 'scale(1)' : 'scale(0.55)' }}>
            <div className="w-9 h-12 sm:w-11 sm:h-16 rounded-md bg-gradient-to-b from-amber-50 to-amber-100 border border-slate-400 shadow-xl flex items-center justify-center">
              <span className="text-slate-400 font-black text-lg">?</span>
            </div>
          </div>
        </div>
      )}

      {incomingDrag.active && incomingTile && (
        <div ref={incomingDrag.ghostRef} className="fixed left-0 top-0 -ml-[22px] -mt-[30px] z-[4000] pointer-events-none">
          <div className="transition-transform duration-150 ease-out" style={{ transform: incomingDrag.grown ? 'scale(1)' : 'scale(0.55)' }}>
            <Tile tile={incomingTile} okeyInfo={okeyInfo} />
          </div>
        </div>
      )}

      {/* HOST: seyircilerden gelen "botun yerine geçme" teklifleri. Kabul
          edilirse bot koltuğu (ıstakası, açtığı perler, puanı ve sırasıyla
          birlikte) teklifi yapana devredilir. */}
      {isHost && pendingSeatRequests.length > 0 && (
        <div className="w-full max-w-md flex flex-col gap-2 bg-indigo-500/10 border border-indigo-500/50 rounded-xl px-3 py-2">
          <span className="text-[11px] sm:text-xs font-bold text-indigo-200">Masaya katılma teklifi</span>
          {pendingSeatRequests.map(([uid, req]) => (
            <div key={uid} className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] sm:text-xs text-slate-200 min-w-0">
                <b>{req.name || 'Seyirci'}</b>, <b>{players.find((p) => p.uid === req.botUid)?.name || 'bot'}</b> yerine oynamak istiyor.
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleResolveSeatRequest(uid, true)}
                  className="text-[11px] font-bold bg-emerald-600/25 hover:bg-emerald-600/45 text-emerald-200 border border-emerald-500/50 px-2.5 py-1 rounded-lg transition-colors"
                >
                  Kabul Et
                </button>
                <button
                  type="button"
                  onClick={() => handleResolveSeatRequest(uid, false)}
                  className="text-[11px] font-bold bg-red-600/20 hover:bg-red-600/40 text-red-200 border border-red-500/50 px-2.5 py-1 rounded-lg transition-colors"
                >
                  Reddet
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {mySideTakePending && (
        <div className="w-full max-w-md flex items-center justify-between gap-2 bg-amber-500/10 border border-amber-500/50 rounded-xl px-3 py-2">
          <span className="text-[11px] sm:text-sm font-bold text-amber-300">
            {myHasOpened
              ? 'Yandan taş aldın! Bu taşı bir pere işlemeli ya da yeni bir per olarak masaya sürmelisin — yoksa atamazsın (bu taş için ceza YOK).'
              : 'Yandan taş aldın! Şimdi elini açmalısın (Seri/Çift Aç) ya da taşı geri koymalısın.'}
          </span>
          <button
            type="button"
            onClick={() => handleCancelSideTake()}
            className="shrink-0 text-[11px] font-bold bg-slate-900/70 hover:bg-slate-700 text-slate-200 border border-slate-600 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            Taşı Geri Koy
          </button>
        </div>
      )}

      {/* Bu panel NORMAL (kompakt olmayan) modda artık OpponentStrip'in ORTA
          sütununda render ediliyor (bkz. `centerExtra` prop'u yukarıda) —
          sol/sağ koltukların YANINDA durması için. Sadece KOMPAKT (telefon
          yatay) modda eskisi gibi ayrı ve tam genişlikte kalır. */}
      {isCompact && openedHandsPanel}

      {/* NOT: "Masada çift açan bir oyuncu var…" bilgilendirmesi VE "Çift
          açtın: per açamazsın..." ipucu kullanıcı isteğiyle kaldırıldı —
          kural zaten butonların açık/kapalı olmasından (Seri Aç/Çift İşle)
          anlaşılıyor, ayrıca bir metin ipucuna gerek yok. */}

      {!isCompact && (
        <button onClick={leaveRoom} className="text-xs text-red-400 hover:text-red-300 border border-red-500/40 hover:bg-red-500/10 px-4 py-2 rounded-lg font-medium transition-colors">Odadan Çık</button>
      )}
      </div>

      {/* Kompakt modda üst başlık tamamen gizlendiği için çıkış buraya alınır. */}
      {isCompact && (
        <button
          onClick={leaveRoom}
          title="Odadan Çık"
          className="fixed top-1 right-1 z-[4600] text-[10px] font-bold text-red-300 bg-slate-900/80 border border-red-500/40 px-2 py-1 rounded-lg backdrop-blur-sm"
        >
          Çık
        </button>
      )}

      {/* Istaka: kompakt modda ekranın altında SABİT kalır (kaydırma alanının
          dışındadır), böylece telefon yatayken de her zaman görünür. */}
      {/* Yeşil ıstaka paneli, taşların büyüyebildiği en geniş noktada durur:
          daha geniş ekranlarda taşlar zaten büyümediği için panelin uzaması
          sadece iki yanda taş sürüklenemeyen ölü alan üretiyordu. */}
      <div
        style={isCompact ? undefined : { maxWidth: `${maxRackContentWidth() + RACK_PANEL_PADDING_PX * 2}px` }}
        className={`w-full mx-auto bg-gradient-to-b from-emerald-900/40 to-emerald-950/60 border border-emerald-800/50 ${isCompact ? 'shrink-0 rounded-xl p-1' : 'rounded-2xl p-2 sm:p-4'}`}
      >
        {isPlayer ? (
          <PlayerRack
            compact={isCompact}
            rack={myRack}
            groups={myGroups}
            isOwner={true}
            onUpdateRack={handleUpdateRack}
            okeyInfo={okeyInfo}
            canAct={mustDiscard}
            canDiscard={mustDiscard && !mySideTakePending}
            flippedTileIds={flippedTileIds}
            onToggleFlippedTile={toggleFlippedTile}
            indicator={myHasOpened ? null : (roomData.indicator || null)}
            lastDiscardTile={myTopDiscard}
            incomingDiscard={incomingTileView}
            canTakeIncoming={canTakeIncomingNow}
            incomingDragHandlers={incomingDrag.handlers}
            canOpenPairsRule={myCanLayPairs}
            canOpenMeldsRule={myCanLayMelds}
            pairsButtonLabel={pairsButtonLabel}
            minPairsToOpen={myMinPairsToOpen}
            seriesTarget={mySeriesTarget}
            assisted={assisted}
            tackableTileIds={tackableTileIds}
            sideTakeTileId={mySideTakeTileId}
            onCancelSideTake={handleCancelSideTake}
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
          // SEYİRCİ PANELİ: eskiden burada sadece "oyuncu değilsin" yazan boş
          // bir yeşil şerit vardı. Artık masadaki BOT koltuklarına geçme
          // teklifi buradan yapılır (bkz. handleRequestBotSeat).
          <div className="flex flex-col items-center gap-2 py-3 px-2 text-center">
            <span className="text-slate-300 text-sm font-bold">Seyirci modundasın — masayı izliyorsun.</span>
            {mySeatRequest ? (
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <span className="text-[11px] sm:text-xs text-amber-300 font-bold">
                  {(players.find((p) => p.uid === mySeatRequest.botUid)?.name) || 'Bot'} koltuğu için teklifin host'a iletildi, onay bekleniyor...
                </span>
                <button
                  type="button"
                  onClick={handleCancelSeatRequest}
                  className="text-[11px] font-bold bg-slate-900/70 hover:bg-slate-700 text-slate-200 border border-slate-600 px-2.5 py-1 rounded-lg transition-colors"
                >
                  Teklifi Geri Çek
                </button>
              </div>
            ) : botSeats.length > 0 ? (
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11px] text-slate-400">Bir botun yerine geçmek istersen host'a teklif gönderebilirsin:</span>
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  {botSeats.map((b) => (
                    <button
                      key={b.uid}
                      type="button"
                      onClick={() => handleRequestBotSeat(b.uid)}
                      className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-200 border border-indigo-500/50 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5" /> {b.name} yerine geç
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <span className="text-[11px] text-slate-500">Masada bot yok — boşalan bir koltuk olursa buradan katılabilirsin.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
