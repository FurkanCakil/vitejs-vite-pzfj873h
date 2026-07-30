import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ship, RotateCw, Check, Loader2, Lock, Eye, RotateCcw, Anchor, Flame, X, Trash2 } from 'lucide-react';
import { doc, updateDoc, runTransaction } from 'firebase/firestore';
import { playSound } from '../../utils/sound.js';
import { playBattleshipSound } from './battleshipSound.js';
import { BOARD_SIZE, ROW_LABELS, SHIP_DEFS, getShipCells, canPlaceShip, allShipsPlaced, cellKey, anchorOrigin, centerCellIndex } from './logic.js';
import { BOT_UID, generateBotFleet, chooseBotShot } from './bot.js';

// ============================================================
// FAZ 1: 10x10 tahta + gemi yerleştirme aşaması.
// FAZ 2: atış/batırma/kazanma döngüsü (setupPhase false olunca devreye girer).
// ============================================================
// NOT: Rakibin gemi konumları BİLEREK hiçbir zaman ayrı bir gizli kanaldan
// taşınmaz — ama şunu açıkça belirtmek gerekir: bu projedeki oda mimarisi
// TÜM oda dokümanını (roomData) tek bir onSnapshot ile HER İKİ oyuncuya da
// senkronlar (bkz. diğer oyunlardaki `racks`, `openedHands` gibi alanlar).
// Yani "gizlilik" burada da (okey101'deki elde kalan taşlar gibi) sadece
// ARAYÜZ seviyesinde sağlanır — ships.{uid} verisi Firestore belgesinde her
// iki taraf için de teknik olarak erişilebilir kalır; FAZ 2'nin batırma
// tespiti de zaten bu ships.{opponentUid} verisini (yalnızca isabet eden
// atışlarla kesişimini) okuyarak çalışır. Gerçek sunucu-taraflı gizlilik
// için Cloud Functions / güvenlik kuralları ile ayrı bir alt-koleksiyon
// gerekir; bu projede hiçbir oyun (şu ana kadar) böyle bir arka uca sahip
// değil.
// Tek bir gemi parçası: yukarıdan bakılan METALİK savaş gemisi gövdesi.
// Hücre kenarlarını (inset -1px) örterek yan parçayla dikişsiz birleşir.
//   state: 'intact' | 'hit' | 'sunk'
//
// PERFORMANS/GÖRSEL HATA DÜZELTMESİ: Bu bileşen eskiden BattleshipGame'in
// İÇİNDE tanımlıydı — yani BattleshipGame her yeniden render olduğunda
// (ör. yeni bir gemi yerleştirildiğinde) `ShipHull` YENİDEN OLUŞTURULAN bir
// fonksiyondu. React, bir bileşenin "tipini" (function referansını) önceki
// render'la KARŞILAŞTIRIR; tip değiştiyse eski DOM düğümünü SÖKÜP YENİDEN
// TAKAR (unmount+mount). Sonuç: yeni bir gemi yerleştirildiğinde DAHA ÖNCE
// yerleştirilmiş TÜM gemiler de yeniden mount ediliyor, bu da her birinin
// "yerleşme" (bs-place) animasyonunu BAŞTAN oynatıyordu — kullanıcının tarif
// ettiği "kareler açılıp kapanıyor" (flicker) tam olarak buydu. Modül
// seviyesine taşınınca fonksiyon referansı HER RENDER'DA SABİT kalır, React
// aynı DOM düğümünü korur, animasyon sadece GERÇEKTEN yeni yerleştirilen
// gemide bir kez oynar.
const ShipHull = ({ seg, state = 'intact', placing = false }) => {
  const horiz = seg.orientation === 'H';
  // Gövde gradyanı gemi EKSENİNE DİK uygulanır: üstte güverte ışığı, altta
  // gölge -> yuvarlak/hacimli bir gövde izlenimi.
  const steel = horiz
    ? 'linear-gradient(to bottom, #e2e8f0 0%, #a8b6c8 30%, #6b7c93 62%, #3d4a5c 100%)'
    : 'linear-gradient(to right,  #e2e8f0 0%, #a8b6c8 30%, #6b7c93 62%, #3d4a5c 100%)';
  const burnt = horiz
    ? 'linear-gradient(to bottom, #5b3a30 0%, #3a201b 38%, #23100d 70%, #150809 100%)'
    : 'linear-gradient(to right,  #5b3a30 0%, #3a201b 38%, #23100d 70%, #150809 100%)';
  // Baş/kıç yuvarlatma: sadece geminin DIŞ uçları.
  const R = '46%';
  const radius = horiz
    ? { borderTopLeftRadius: seg.isFirst ? R : 0, borderBottomLeftRadius: seg.isFirst ? R : 0, borderTopRightRadius: seg.isLast ? R : 0, borderBottomRightRadius: seg.isLast ? R : 0 }
    : { borderTopLeftRadius: seg.isFirst ? R : 0, borderTopRightRadius: seg.isFirst ? R : 0, borderBottomLeftRadius: seg.isLast ? R : 0, borderBottomRightRadius: seg.isLast ? R : 0 };

  return (
    <div
      className={`absolute pointer-events-none transition-[background,filter] duration-500 ${placing ? 'bs-place' : ''}`}
      style={{
        inset: '-1px',
        background: state === 'sunk' ? burnt : steel,
        ...radius,
        boxShadow: state === 'sunk'
          ? 'inset 0 0 6px rgba(0,0,0,0.85)'
          : 'inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -2px 3px rgba(0,0,0,0.45)',
        filter: state === 'hit' ? 'saturate(0.5) brightness(0.72)' : undefined,
      }}
    >
      {/* Güverte orta hattı — gövdeye "gemi" karakteri veren ince çizgi. */}
      <div
        className="absolute bg-slate-900/25"
        style={horiz
          ? { left: 0, right: 0, top: '50%', height: 1, transform: 'translateY(-0.5px)' }
          : { top: 0, bottom: 0, left: '50%', width: 1, transform: 'translateX(-0.5px)' }}
      />
      {/* Taret/baca detayı: her parçanın ortasında küçük bir kule. */}
      <div
        className={`absolute rounded-[1px] ${state === 'sunk' ? 'bg-black/50' : 'bg-slate-700/70'}`}
        style={{ left: '34%', top: '34%', width: '32%', height: '32%' }}
      />
      {/* Batan gemide sürekli duman/alev nabzı. */}
      {state === 'sunk' && (
        <div
          className="bs-sunk-glow absolute rounded-full"
          style={{ inset: '10%', background: 'radial-gradient(circle, rgba(251,146,60,0.85) 0%, rgba(239,68,68,0.4) 45%, rgba(0,0,0,0) 72%)' }}
        />
      )}
    </div>
  );
};

// Bir atış hücresinin ÜSTÜNE binen efekt katmanı: isabet -> patlama,
// karavana -> su halkası. Gemi gövdesinin üzerine çizilir (gövdeyi silmez).
//   sunk: gemi TAMAMEN battıysa patlama topu küçülüp saydamlaşır — böylece
//   altındaki KÖMÜRLEŞMİŞ gövde (ve onun duman/alev nabzı) görünür kalır.
//   Aksi halde opak ateş topu gövdeyi tamamen örtüyordu.
// (Bu bileşen de ShipHull ile AYNI sebepten modül seviyesine taşındı —
// bkz. yukarıdaki yorum.)
const ShotMarker = ({ hit, sunk = false }) => (hit ? (
  <>
    <div
      className={`bs-burst absolute rounded-full ${sunk ? 'opacity-50' : ''}`}
      style={{
        inset: sunk ? '26%' : '13%',
        background: 'radial-gradient(circle at 50% 45%, #fff7ed 0%, #fbbf24 26%, #f97316 48%, #dc2626 70%, rgba(127,29,29,0) 88%)',
      }}
    />
    <Flame className={`bs-ember relative z-[1] text-amber-50 drop-shadow-[0_0_3px_rgba(239,68,68,0.9)] ${sunk ? 'w-2.5 h-2.5 opacity-80' : 'w-3 h-3 sm:w-3.5 sm:h-3.5'}`} />
  </>
) : (
  <>
    <div className="bs-ripple absolute inset-0" />
    <div className="absolute rounded-full bg-sky-300/80" style={{ width: '18%', height: '18%' }} />
  </>
));

// Basılı tutma (long-press) eşiği: dokunmatik ekranda henüz bir gemisi
// olmayan bir hücreye (yerleştirme akışında) parmakla basılı tutulduğunda
// önizlemenin (geminin boyutu) ne kadar sonra belirmesi gerektiği. Masaüstünde
// fare zaten hücreye değince (mouseenter) anında önizleme gösterdiği için bu
// gecikme SADECE dokunmatik girişte uygulanır.
const LONG_PRESS_MS = 300;
// Basılı tutulan bir gemiyi SÜRÜKLEYEREK TAŞIMA ile sadece TIKLAYIP (hareket
// etmeden) Döndür/Kaldır menüsünü AÇMA arasındaki ayrım bu piksel eşiğine
// göre yapılır. KULLANICI RAPORU: özellikle 2 hücreli küçük gemilerde tıklama
// "bazen çalışmıyordu" — kök neden, dokunmatik ekranda parmağın basılı
// tutulurken kaçınılmaz ufak titreşiminin (birkaç piksel) eski eşiği (4px)
// aşıp tıklamayı sessizce bir "sürükleme"ye çevirmesiydi; sürükleme de hücre
// değiştirmediği için (bkz. handleCellPointerUp'taki `!d.origin` düşüşü)
// hiçbir şey olmuyordu. Eşik büyütülerek bu yanlış sınıflandırma azaltılır.
const DRAG_MOVE_THRESHOLD = 10;

// KÖK NEDEN DÜZELTMESİ (bota karşı oynarken atışların/gemilerin hiç
// görünmemesi): Bu dosyadaki `handleShoot`/`handleConfirmReady` gibi
// fonksiyonlar Firestore'un "alan yolu" (field path) sözdizimini kullanır —
// ör. `{ 'ships.<uid>': [...] }`, gerçek bir odada `updateDoc` bunu otomatik
// olarak `roomData.ships.<uid>`'e YAZAR (iç içe alanı günceller). Bot modunda
// ise `updateRoom` bu patch'i SADECE `{...prev, ...patch}` ile YÜZEYSEL
// birleştiriyordu — bu da `roomData`'ya "ships.<uid>" adında, İÇİNDE NOKTA
// OLAN, tamamen AYRI/ÇÖP bir üst-seviye alan ekliyordu; gerçek `ships`/`shots`/
// `readyPlayers` nesneleri HİÇ değişmiyordu. Sonuç: insanın gemileri
// `roomData.ships[insan]`'a hiç yazılmıyordu (bot her zaman "ıska" sayıyordu)
// ve HER İKİ tarafın da atışları (`roomData.shots[...]`) hiç kalıcı olmuyordu
// — yani ne kendi vuruşlarınız ne de botun vuruşları ekranda görünüyordu.
// Bu yardımcı, Firestore'un nokta-yolu davranışını YEREL nesnede DOĞRU
// şekilde (iç içe alanı gerçekten güncelleyerek) taklit eder.
function applyDotPathPatch(prev, patch) {
  const next = { ...prev };
  Object.entries(patch).forEach(([key, value]) => {
    if (!key.includes('.')) { next[key] = value; return; }
    const parts = key.split('.');
    const rootKey = parts[0];
    next[rootKey] = { ...(next[rootKey] || {}) };
    let cursor = next[rootKey];
    for (let i = 1; i < parts.length - 1; i++) {
      cursor[parts[i]] = { ...(cursor[parts[i]] || {}) };
      cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = value;
  });
  return next;
}

// FAZ 3: Tek oyunculu "Bota Karşı" modu (bkz. bot.js). Bot yerleşimi/atışları
// tamamen ŞANSA dayalı standart (zorluk seviyesiz) bir Hunt & Target
// algoritmasıyla çalışır. `isBot` true iken TÜM Firestore yazımları
// `setLocalRoomData` üzerinden tamamen YEREL state güncellemesine döner
// (bkz. `updateRoom`) — gerçek çok oyunculu (Firestore) akışa HİÇ dokunulmaz.
export default function BattleshipGame({ roomData, roomCode, user, db, appId, leaveRoom, isBot = false, setLocalRoomData }) {
  if (!roomData || !roomData.players) return null; // GÜVENLİK: Veri henüz gelmediyse bekle

  const roomRef = isBot ? null : doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);

  // Diğer bot-destekli oyunlarla (connect4/Connect4Game.jsx) AYNI desen:
  // bot modunda hiçbir Firestore yazımı/transaction'ı GERÇEKLEŞMEZ, sadece
  // App.tsx'in tuttuğu yerel `roomData` state'i güncellenir — bu sayede
  // gerçek odalardaki (host/misafir) eşzamanlılık/transaction mantığına HİÇ
  // dokunulmamış olur.
  const updateRoom = async (patch) => {
    if (isBot) { setLocalRoomData((prev) => applyDotPathPatch(prev, patch)); return; }
    await updateDoc(roomRef, patch);
  };

  const isPlayer1 = roomData.players[0] === user.uid;
  const isPlayer2 = roomData.players?.[1] === user.uid;
  const isSpectator = !isPlayer1 && !isPlayer2;

  const opponentUid = roomData.players.find((uid) => uid !== user.uid) || null;
  const myName = roomData.playerNames?.[user.uid] || 'Sen';
  const opponentName = roomData.playerNames?.[opponentUid] || 'Rakip';
  const myScore = roomData.scores?.[user.uid] || 0;
  const opponentScore = roomData.scores?.[opponentUid] || 0;

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = (msg, tone = 'red') => {
    setToast({ msg, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const toastColors = { red: 'bg-red-500/95 border-red-400', amber: 'bg-amber-500/95 border-amber-400', emerald: 'bg-emerald-500/95 border-emerald-400' };

  const amIReady = !!roomData.readyPlayers?.[user.uid];
  const isOpponentReady = !!roomData.readyPlayers?.[opponentUid];

  // ============================================================
  // FAZ 1: gemi yerleştirme state'i (bkz. üstteki dosya notu)
  // ============================================================
  const [placedShips, setPlacedShips] = useState(() => roomData.ships?.[user.uid] || []);
  const [selectedShipId, setSelectedShipId] = useState(null);
  const [pendingOrientation, setPendingOrientation] = useState('H');
  const [hoverOrigin, setHoverOrigin] = useState(null);
  const [shakeShipId, setShakeShipId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  // KULLANICI İSTEĞİ: yerleştirilmiş bir gemiye (hareket etmeden) tıklandığında
  // artık DOĞRUDAN ele alınmıyor — bunun yerine "Döndür"/"Kaldır" seçeneklerini
  // sunan küçük bir menü açılır (bkz. openShipMenu / handleCellPointerUp).
  const [shipMenu, setShipMenu] = useState(null); // { shipId, x, y }
  // Yerleştirilmiş bir gemi sürüklenip alt taraftaki gemi ENVANTERİ üzerine
  // getirildiğinde (bkz. handleCellPointerMove) görsel geri bildirim için.
  const [dragOverInventory, setDragOverInventory] = useState(false);

  // Bir sonraki el (rematch — hem bot hem gerçek çok oyunculu modda) sunucuda
  // `ships`'i sıfırlar, ama `placedShips`'in `useState` başlangıç değeri
  // SADECE bileşen mount olurken okunur — `setupPhase` false'tan true'ya HER
  // geçtiğinde (yeni bir el başladığında) bu yerel yerleştirme state'i de
  // burada senkron sıfırlanır. Aksi halde bir önceki elden kalma gemiler yeni
  // yerleştirme ekranında "zaten yerleştirilmiş" gibi hayalet olarak kalırdı.
  const prevSetupPhaseRef = useRef(roomData.setupPhase);
  useEffect(() => {
    if (roomData.setupPhase && !prevSetupPhaseRef.current) {
      setPlacedShips(roomData.ships?.[user.uid] || []);
      setSelectedShipId(null);
      setHoverOrigin(null);
      setShipMenu(null);
    }
    prevSetupPhaseRef.current = roomData.setupPhase;
  }, [roomData.setupPhase, roomData.ships, user.uid]);

  const setupLocked = amIReady || isSaving;

  const occupancy = useMemo(() => {
    const map = {};
    placedShips.forEach((ship) => { ship.cells.forEach((c) => { map[cellKey(c.row, c.col)] = ship.id; }); });
    return map;
  }, [placedShips]);

  const readyToConfirm = allShipsPlaced(placedShips);

  const previewInfo = useMemo(() => {
    if (setupLocked || !selectedShipId || !hoverOrigin) return null;
    const def = SHIP_DEFS.find((d) => d.id === selectedShipId);
    if (!def) return null;
    // KULLANICI İSTEĞİ: imlecin/parmağın altındaki hücre artık geminin SOL
    // UCU değil — merkez hücresi sayılır (bkz. logic.js#anchorOrigin /
    // centerCellIndex): tek sayılı gemilerde (5,3,3) tam ortası, çift sayılı
    // gemilerde (4,2) ortadaki iki hücreden SOLDAKİ/ÜSTTEKİ.
    const origin = anchorOrigin(hoverOrigin, pendingOrientation, def.length);
    const cells = getShipCells(origin, pendingOrientation, def.length);
    const { valid } = canPlaceShip(placedShips, cells);
    return { cells, valid };
  }, [setupLocked, selectedShipId, hoverOrigin, pendingOrientation, placedShips]);
  const previewSet = useMemo(() => new Set((previewInfo?.cells || []).map((c) => cellKey(c.row, c.col))), [previewInfo]);

  // ============================================================
  // Yerleştirilmiş bir gemiyi BASILI TUTUP SÜRÜKLEYEREK taşıma.
  // ============================================================
  // `dragMove`: sürükleme SIRASINDA gösterilen aday yeni konum (ekranda hem
  // önizleme rengi hem de geminin ESKİ hücrelerdeki görüntüsünün gizlenmesi
  // için kullanılır — bkz. renderSetupMyCell). Kalıcı karar (taşı/iptal et)
  // `shipDragRef` (senkron, render'a bağlı olmayan) üzerinden verilir.
  const [dragMove, setDragMove] = useState(null); // { shipId, orientation, length, origin }
  const shipDragRef = useRef(null);
  useEffect(() => () => { if (shipDragRef.current?.timer) clearTimeout(shipDragRef.current.timer); }, []);

  const dragPreviewInfo = useMemo(() => {
    if (!dragMove?.origin) return null;
    const cells = getShipCells(dragMove.origin, dragMove.orientation, dragMove.length);
    const { valid } = canPlaceShip(placedShips, cells, dragMove.shipId);
    return { cells, valid };
  }, [dragMove, placedShips]);
  const dragPreviewSet = useMemo(() => new Set((dragPreviewInfo?.cells || []).map((c) => cellKey(c.row, c.col))), [dragPreviewInfo]);

  const openShipMenu = (shipId, x, y) => setShipMenu({ shipId, x, y });

  // Bir hücreye basıldığında: üzerinde YERLEŞTİRİLMİŞ bir gemi varsa taşıma
  // sürüklemesini başlatır (hareket etmeden bırakılırsa `handleCellPointerUp`
  // bunu basit bir TIKLAMA sayıp Döndür/Kaldır menüsünü açar — bkz.
  // openShipMenu). Hücre BOŞSA ve elde seçili bir gemi varsa (yerleştirme
  // akışı) SADECE dokunmatik girişte, kısa bir gecikmeyle önizlemeyi
  // (`hoverOrigin`) açar — masaüstünde fareyle zaten anında (mouseenter) açılıyor.
  const handleCellPointerDown = (e, row, col) => {
    if (setupLocked) return;
    setShipMenu(null);
    const occupantId = occupancy[cellKey(row, col)];
    if (occupantId) {
      // Sağ tık (contextmenu) SADECE çevirmeye ayrılmıştır — bkz.
      // handleCellRotateGesture; burada devreye girmemeli.
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const ship = placedShips.find((s) => s.id === occupantId);
      if (!ship) return;
      const grabIndex = ship.cells.findIndex((cell) => cell.row === row && cell.col === col);
      shipDragRef.current = {
        kind: 'move', shipId: ship.id, orientation: ship.orientation, length: ship.length, grabIndex,
        startX: e.clientX, startY: e.clientY, moved: false, origin: null, overInventory: false,
      };
      e.preventDefault();
      window.getSelection?.()?.removeAllRanges?.();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    if (selectedShipId && e.pointerType !== 'mouse') {
      shipDragRef.current = {
        kind: 'longPressPreview', startX: e.clientX, startY: e.clientY, moved: false,
        timer: setTimeout(() => {
          const d = shipDragRef.current;
          if (d && d.kind === 'longPressPreview') setHoverOrigin({ row, col });
        }, LONG_PRESS_MS),
      };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
  };

  const handleCellPointerMove = (e) => {
    const d = shipDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX; const dy = e.clientY - d.startY;
    const movedNow = Math.hypot(dx, dy) > DRAG_MOVE_THRESHOLD;
    if (d.kind === 'move') {
      if (!d.moved && movedNow) d.moved = true;
      if (!d.moved) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      // KULLANICI İSTEĞİ: yerleştirilmiş bir gemi sürüklenip alt taraftaki
      // gemi ENVANTERİ üzerine getirilirse (bkz. render'daki
      // `data-ship-inventory`) tahtadan kaldırılabilsin — bırakıldığında
      // (handleCellPointerUp) filodan silinir.
      const overInv = !!el?.closest('[data-ship-inventory]');
      if (overInv !== d.overInventory) {
        d.overInventory = overInv;
        setDragOverInventory(overInv);
        if (overInv) { d.origin = null; setDragMove(null); }
      }
      if (overInv) return;
      const cellEl = el?.closest('[data-row]');
      if (!cellEl) return;
      const hr = Number(cellEl.dataset.row); const hc = Number(cellEl.dataset.col);
      // `grabIndex` hücresi imlecin/parmağın altında kalacak şekilde,
      // geminin yeni başlangıç (origin) hücresi geriye doğru hesaplanır.
      const origin = d.orientation === 'H' ? { row: hr, col: hc - d.grabIndex } : { row: hr - d.grabIndex, col: hc };
      d.origin = origin;
      setDragMove({ shipId: d.shipId, orientation: d.orientation, length: d.length, origin });
    } else if (d.kind === 'longPressPreview') {
      // Zamanlayıcı henüz ateşlenmeden önemli bir hareket olduysa (ör. sayfa
      // kaydırma niyeti) uzun-basma iptal edilir.
      if (movedNow && d.timer) { clearTimeout(d.timer); d.timer = null; }
    }
  };

  const handleCellPointerUp = () => {
    const d = shipDragRef.current;
    shipDragRef.current = null;
    if (!d) return;
    if (d.kind === 'longPressPreview') { if (d.timer) clearTimeout(d.timer); return; }
    setDragMove(null);
    setDragOverInventory(false);
    if (d.overInventory) { setPlacedShips((prev) => prev.filter((s) => s.id !== d.shipId)); return; } // envantere bırakıldı: kaldır
    // KÖK NEDEN DÜZELTMESİ: eskiden sadece `!d.moved` iken menü/ele alma
    // tetiklenirdi; küçük (2 hücreli) gemilerde dokunmatik titreşim genelde
    // eşiği aşıp `d.moved = true` yapıyordu AMA parmak asla farklı bir
    // hücreye geçmediği (`d.origin` hiç set edilmediği) için tıklama sessizce
    // hiçbir şey yapmadan kayboluyordu. Artık `d.origin` hâlâ boşsa (gerçek
    // bir hücre değişikliği hiç olmadıysa) bu da bir TIKLAMA sayılır.
    if (!d.moved || !d.origin) { openShipMenu(d.shipId, d.startX, d.startY); return; }
    const cells = getShipCells(d.origin, d.orientation, d.length);
    const { valid } = canPlaceShip(placedShips, cells, d.shipId);
    if (!valid) { flashInvalid(d.shipId); return; } // geçersizse gemi eski yerinde kalır
    playBattleshipSound('place');
    setPlacedShips((prev) => prev.map((s) => (s.id === d.shipId ? { ...s, origin: d.origin, cells } : s)));
  };

  const handleCellPointerCancel = () => {
    const d = shipDragRef.current;
    if (d?.timer) clearTimeout(d.timer);
    shipDragRef.current = null;
    setDragMove(null);
    setDragOverInventory(false);
  };

  const flashInvalid = (shipId) => {
    playSound('error');
    setShakeShipId(shipId || 'preview');
    setTimeout(() => setShakeShipId(null), 350);
  };

  // `anchorCell`: kullanıcının tıkladığı/bıraktığı hücre. KULLANICI İSTEĞİ:
  // bu hücre her zaman geminin MERKEZ hücresi sayılır — tek sayılı gemilerde
  // (5,3,3) tam ortası, çift sayılı gemilerde (4,2) ortadaki iki hücreden
  // SOLDAKİ/ÜSTTEKİ (2 uzunlukta bu zaten sol ucun kendisidir) — bkz.
  // logic.js#anchorOrigin / centerCellIndex.
  const attemptPlace = (shipId, anchorCell, orientation) => {
    if (setupLocked) return;
    const def = SHIP_DEFS.find((d) => d.id === shipId);
    if (!def) return;
    const origin = anchorOrigin(anchorCell, orientation, def.length);
    const cells = getShipCells(origin, orientation, def.length);
    const { valid } = canPlaceShip(placedShips, cells);
    if (!valid) { flashInvalid(shipId); return; }
    playBattleshipSound('place');
    setPlacedShips((prev) => [...prev, { id: def.id, name: def.name, length: def.length, orientation, origin, cells }]);
    setSelectedShipId(null);
    setHoverOrigin(null);
  };

  // "Kaldır" (bkz. şipMenu): gemiyi tahtadan söker ve elde tutulan (seçili)
  // gemi olarak geri verir — kullanıcı hemen başka bir hücreye tıklayıp
  // yeniden yerleştirebilir.
  const pickUpShip = (shipId) => {
    if (setupLocked) return;
    const ship = placedShips.find((s) => s.id === shipId);
    if (!ship) return;
    setPlacedShips((prev) => prev.filter((s) => s.id !== shipId));
    setSelectedShipId(shipId);
    setPendingOrientation(ship.orientation);
  };

  // "Döndür" (bkz. shipMenu / çift-tık / sağ-tık): KULLANICI İSTEĞİ — gemi
  // artık bir UCUNDAN değil ORTASINDAN döner: döndürmeden önceki/sonraki
  // hücre dizisinde `centerCellIndex` ile bulunan "merkez" hücre SABİT kalır.
  const rotateInPlace = (shipId) => {
    if (setupLocked) return;
    const ship = placedShips.find((s) => s.id === shipId);
    if (!ship) return;
    const newOrientation = ship.orientation === 'H' ? 'V' : 'H';
    const idx = centerCellIndex(ship.length);
    const pivot = ship.cells[idx];
    const newOrigin = newOrientation === 'H' ? { row: pivot.row, col: pivot.col - idx } : { row: pivot.row - idx, col: pivot.col };
    const newCells = getShipCells(newOrigin, newOrientation, ship.length);
    const { valid } = canPlaceShip(placedShips, newCells, ship.id);
    if (!valid) { flashInvalid(shipId); return; }
    playBattleshipSound('place');
    setPlacedShips((prev) => prev.map((s) => (s.id === ship.id ? { ...s, orientation: newOrientation, origin: newOrigin, cells: newCells } : s)));
  };

  const handleCellClick = (row, col) => {
    if (setupLocked) return;
    const occupantId = occupancy[cellKey(row, col)];
    // Dolu hücreler artık basılı-tutma/sürükleme (pointer) akışı tarafından
    // yönetiliyor — bkz. handleCellPointerDown/Up (tıklama = Döndür/Kaldır
    // menüsünü aç, sürükleme = taşı). Buradan hiçbir şey tetiklenmemeli.
    if (occupantId) return;
    if (selectedShipId) attemptPlace(selectedShipId, { row, col }, pendingOrientation);
  };

  const handleCellRotateGesture = (e, row, col) => {
    e.preventDefault();
    const occupantId = occupancy[cellKey(row, col)];
    if (occupantId) rotateInPlace(occupantId);
  };

  // Envanterdeki bir gemiyi (masaüstü) native sürükle-bırak ile tahtaya
  // taşımaya başlarken: tarayıcının varsayılan "izin verilmiyor" (çarpı/⊘)
  // imlecini önlemek için `effectAllowed`/`dropEffect` açıkça 'move' yapılır.
  // Ayrıca tarayıcının kendi soluk hayalet-resmi, tahtadaki YEŞİL/KIRMIZI
  // önizlememizle ÇAKIŞIP imleçle "ayrı bir resim" olarak taşınıyormuş gibi
  // görünüyordu; boş/şeffaf bir görüntü verilerek bu varsayılan hayalet
  // gizlenir, sadece bizim tahta-üstü önizlememiz görünür kalır.
  const handleShipInventoryDragStart = (e, def) => {
    e.dataTransfer.setData('text/plain', def.id);
    e.dataTransfer.effectAllowed = 'move';
    if (typeof document !== 'undefined') {
      const empty = document.createElement('div');
      empty.style.width = '1px'; empty.style.height = '1px'; empty.style.opacity = '0';
      document.body.appendChild(empty);
      e.dataTransfer.setDragImage(empty, 0, 0);
      requestAnimationFrame(() => { if (empty.parentNode) empty.parentNode.removeChild(empty); });
    }
    setSelectedShipId(def.id);
  };

  const handleResetAll = () => {
    if (setupLocked) return;
    setPlacedShips([]);
    setSelectedShipId(null);
    setHoverOrigin(null);
    setShipMenu(null);
  };

  const handleConfirmReady = async () => {
    if (setupLocked || !readyToConfirm) return;
    setShipMenu(null);
    setIsSaving(true);
    try {
      if (isBot) {
        // Bot MODU: bot filosu zaten oda kurulurken (App.tsx#startBotGame)
        // yerleştirilip "hazır" işaretlenmiş durumda — tek bir yerel oyuncu
        // olduğu için yarış durumu YOK, transaction'a gerek DUYULMAZ. İnsan
        // hazır olduğu an savaş doğrudan başlar; başlangıç sırası (kim ilk
        // ateş eder) rastgele belirlenir.
        await updateRoom({
          [`ships.${user.uid}`]: placedShips,
          [`readyPlayers.${user.uid}`]: true,
          setupPhase: false,
          turn: Math.random() < 0.5 ? user.uid : BOT_UID,
        });
        // KULLANICI İSTEĞİ: jenerik `playSound('check')` (sert/yüksek sesli)
      // yerine bu oyuna özel, kısık ve yumuşak bir onay sesi (bkz.
      // battleshipSound.js#readyChime).
      playBattleshipSound('ready');
        return;
      }
      // İki oyuncu da neredeyse aynı anda "Hazır"a basarsa, client'taki
      // (henüz senkronlanmamış olabilecek) roomData'ya güvenmek yarışı
      // KAÇIRABİLİR — ikisi de rakibi "hazır değil" görüp setupPhase hiç
      // kapanmayabilir. Bunun yerine transaction içinde SUNUCUDAKİ GÜNCEL
      // veriyi okuyup, ikisi de hazırsa (1. madde) setupPhase'i kapatıp
      // sırayı Host'a veriyoruz — Firestore çakışma durumunda otomatik
      // tekrar dener, yani sonuç her koşulda tutarlı olur.
      await runTransaction(db, async (t) => {
        const snap = await t.get(roomRef);
        const data = snap.data();
        if (!data || !data.setupPhase) return;
        const newReadyPlayers = { ...data.readyPlayers, [user.uid]: true };
        const bothReady = (data.players || []).every((uid) => newReadyPlayers[uid]);
        const update = {
          [`ships.${user.uid}`]: placedShips,
          [`readyPlayers.${user.uid}`]: true,
        };
        if (bothReady) {
          update.setupPhase = false;
          update.turn = data.host;
        }
        t.update(roomRef, update);
      });
      // KULLANICI İSTEĞİ: jenerik `playSound('check')` (sert/yüksek sesli)
      // yerine bu oyuna özel, kısık ve yumuşak bir onay sesi (bkz.
      // battleshipSound.js#readyChime).
      playBattleshipSound('ready');
    } catch (err) { console.error('Amiral Battı hazır kaydı hatası:', err); }
    finally { setIsSaving(false); }
  };

  // Rakip henüz "Hazır" demediyse, kendi "Hazır" durumunu iptal edip
  // gemileri tekrar düzenleyebilme (kullanıcı isteği). Rakip de hazırsa artık
  // setupPhase zaten kapanmış olur, bu yüzden bu durumda iptal ANLAMSIZDIR.
  const handleCancelReady = async () => {
    if (!amIReady || isOpponentReady || isSaving) return;
    setIsSaving(true);
    try {
      await updateRoom({ [`readyPlayers.${user.uid}`]: false });
    } catch (err) { console.error('Amiral Battı hazır iptali hatası:', err); }
    finally { setIsSaving(false); }
  };

  // ============================================================
  // FAZ 2: atış / batırma / kazanma
  // ============================================================
  const isPlaying = !roomData.setupPhase;
  const myShots = roomData.shots?.[user.uid] || [];
  const opponentShots = roomData.shots?.[opponentUid] || [];
  const myShips = roomData.ships?.[user.uid] || [];
  const opponentShips = roomData.ships?.[opponentUid] || [];
  const isMyTurn = isPlaying && roomData.turn === user.uid && !roomData.winner;

  const myShotMap = {}; myShots.forEach((s) => { myShotMap[cellKey(s.row, s.col)] = s; });
  const opponentShotMap = {}; opponentShots.forEach((s) => { opponentShotMap[cellKey(s.row, s.col)] = s; });

  const isShipSunk = (ship, shotMap) => ship.cells.every((c) => shotMap[cellKey(c.row, c.col)]?.hit);
  // KULLANICI İSTEĞİ: Bir gemi tamamen battığında SALDIRAN oyuncuya bunu
  // belli eden hiçbir şey (bildirim/ses/görsel dökülme) YOKTUR — tam olarak
  // emin olabilmek için fazladan atış yapması gerekir. Bu yüzden
  // `opponentShips` için ARTIK "kaçı battı" hesaplanıp REACT STATE'e/render'a
  // yansıtılmıyor; sadece `handleShoot` içinde (aşağıda) KAZANMA koşulunu
  // (tüm gemiler battı mı?) kontrol etmek için YEREL ve GEÇİCİ olarak
  // hesaplanıyor, hiçbir görsel/ses tetiklemiyor.
  //
  // Kendi (mySunkShipIds) gemilerim İÇİN bu kısıtlama YOKTUR: kendi tahtamda
  // zaten tüm hücrelerim (isabet/sağlam) her zaman görünür durumda — "hangi
  // gemim battı" bilgisi zaten oradan okunabiliyor, ayrıca gizlenecek bir şey
  // yok. Bu yüzden kendi batan gemim için toast/ses (bkz. aşağıdaki useEffect)
  // KORUNUYOR.
  const mySunkShipIds = new Set(myShips.filter((s) => isShipSunk(s, opponentShotMap)).map((s) => s.id));
  const mySunkKey = Array.from(mySunkShipIds).sort().join(',');
  const prevMySunkRef = useRef(new Set());
  useEffect(() => {
    if (!isPlaying) return;
    mySunkShipIds.forEach((id) => {
      if (!prevMySunkRef.current.has(id)) {
        const ship = myShips.find((s) => s.id === id);
        showToast(`Bir geminiz battı: ${ship?.name || ''}!`, 'red');
        playBattleshipSound('ownShipSunk');
      }
    });
    prevMySunkRef.current = mySunkShipIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mySunkKey, isPlaying]);

  // Atış/vuruş sesleri: HEM atan (kendi tıklamasında ANINDA, bkz. handleShoot)
  // HEM DE atılan oyuncu (kendi ekranında rakibin attığı taş Firestore'dan
  // gelince) doğru sesi duymalı — eskiden SADECE atan taraf ses duyuyordu, bu
  // hiç gerçekçi değildi. `opponentShots` (rakibin BANA attığı atışlar) uzunluğu
  // arttığında (ve ilk yüklemede DEĞİL — bkz. `prev === null` koruması, aksi
  // halde odaya girildiğinde geçmiş atışların sesi topluca çalınırdı) doğrudan
  // isabet/ıska sesi çalınır.
  //
  // KULLANICI İSTEĞİ: eskiden önce kısa bir "dı" (top/tüfek) sesi çalınıp
  // ardından "tuf" (isabet/ıska) geliyordu; baştaki "dı" hem ıskada hem
  // isabette RAHATSIZ EDİCİ bulunduğu için kaldırıldı — artık SADECE isabet/
  // ıska sesi (tek başına) çalıyor.
  const prevOpponentShotsLenRef = useRef(null);
  useEffect(() => {
    if (!isPlaying) { prevOpponentShotsLenRef.current = null; return; }
    const prev = prevOpponentShotsLenRef.current;
    prevOpponentShotsLenRef.current = opponentShots.length;
    if (prev === null || opponentShots.length <= prev) return;
    const lastShot = opponentShots[opponentShots.length - 1];
    playBattleshipSound(lastShot?.hit ? 'hit' : 'miss');
  }, [opponentShots.length, isPlaying]);

  const prevWinnerRef = useRef(null);
  useEffect(() => {
    if (roomData.winner && prevWinnerRef.current !== roomData.winner) {
      playSound(roomData.winner === user.uid ? 'win' : 'error');
      prevWinnerRef.current = roomData.winner;
    }
    if (!roomData.winner) prevWinnerRef.current = null;
  }, [roomData.winner, user.uid]);

  const handleShoot = async (row, col) => {
    if (!isMyTurn) return;
    const key = cellKey(row, col);
    if (myShotMap[key]) return; // zaten bu hücreye atış yapılmış

    const hitShip = opponentShips.find((ship) => ship.cells.some((c) => c.row === row && c.col === col));
    const isHit = !!hitShip;
    const updatedShots = [...myShots, { row, col, hit: isHit }];
    const update = { [`shots.${user.uid}`]: updatedShots };

    const updatedShotMap = { ...myShotMap, [key]: { row, col, hit: isHit } };
    const sunkCount = opponentShips.filter((s) => isShipSunk(s, updatedShotMap)).length;
    const isWin = sunkCount >= SHIP_DEFS.length;

    if (isWin) {
      update.winner = user.uid;
      update.turn = null;
      update.scores = { ...roomData.scores, [user.uid]: (roomData.scores?.[user.uid] || 0) + 1 };
    } else {
      update.turn = opponentUid;
    }

    // Gerçekçi ses: doğrudan İSABET (patlama) ya da IŞKA (su sıçraması) sesi —
    // eskiden önce bir "dı" (top/tüfek) sesi çalınıyordu, kullanıcı isteğiyle
    // kaldırıldı. Sunucu yazımı beklenmeden ANINDA çalınır (iyimser ses).
    playBattleshipSound(isHit ? 'hit' : 'miss');
    try { await updateRoom(update); } catch (err) { console.error('Amiral Battı atış hatası:', err); }
  };

  // FAZ 3 (Bot Yapay Zekası): sıra bota (`BOT_UID`) geçtiğinde ANINDA ateş
  // etmez — İNSANSI GECİKME olarak 1.5-2.5sn rastgele bir "düşünüyor"
  // bekleyişinden sonra Hunt & Target algoritmasıyla (bkz. bot.js#chooseBotShot)
  // bir hücre seçip ateş eder. İnsanın `handleShoot`'u ile AYNI board/turn/
  // winner/score güncellemesini üretir — TEK fark, atış/isabet SESİNİN burada
  // ÇALINMAMASI: bu ses zaten `opponentShots` büyüdüğünde (bkz. yukarıdaki
  // reaktif useEffect) otomatik tetikleniyor; burada da çalınsaydı ses İKİ KEZ
  // duyulurdu (bot modu tamamen yerel/tek istemci olduğu için).
  useEffect(() => {
    if (!isBot || isSpectator || !isPlaying || roomData.turn !== BOT_UID || roomData.winner || roomData.status === 'abandoned') return;
    const timer = setTimeout(() => {
      const botShots = roomData.shots?.[BOT_UID] || [];
      const humanShips = roomData.ships?.[user.uid] || [];
      const shot = chooseBotShot(botShots, humanShips);
      if (!shot) return; // güvenlik: teorik olarak tahta tamamen dolamaz
      const { row, col } = shot;
      const hitShip = humanShips.find((ship) => ship.cells.some((c) => c.row === row && c.col === col));
      const isHit = !!hitShip;
      const updatedShots = [...botShots, { row, col, hit: isHit }];
      const update = { [`shots.${BOT_UID}`]: updatedShots };

      const updatedShotMap = {}; updatedShots.forEach((s) => { updatedShotMap[cellKey(s.row, s.col)] = s; });
      const sunkCount = humanShips.filter((s) => isShipSunk(s, updatedShotMap)).length;
      const isWin = sunkCount >= SHIP_DEFS.length;

      if (isWin) {
        update.winner = BOT_UID;
        update.turn = null;
        update.scores = { ...roomData.scores, [BOT_UID]: (roomData.scores?.[BOT_UID] || 0) + 1 };
      } else {
        update.turn = user.uid;
      }
      updateRoom(update);
    }, 1500 + Math.random() * 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBot, roomData.turn, roomData.winner, roomData.status, isPlaying]);

  const requestRematch = async () => {
    if (isSpectator) return;
    if (isBot) {
      // Bot MODU: onay beklemeye gerek yok (karşıda gerçek bir ikinci oyuncu
      // yok) — yeni el DOĞRUDAN kurulur, bot filosu yeniden rastgele dizilip
      // otomatik "hazır" işaretlenir.
      await updateRoom({
        setupPhase: true, ships: { [BOT_UID]: generateBotFleet() }, readyPlayers: { [BOT_UID]: true }, shots: {},
        turn: null, winner: null, rematchRequestedBy: null,
      });
      return;
    }
    await updateRoom({ rematchRequestedBy: user.uid });
  };
  const acceptRematch = async () => {
    if (isSpectator) return;
    await updateRoom({
      setupPhase: true, ships: {}, readyPlayers: {}, shots: {},
      turn: null, winner: null, rematchRequestedBy: null,
    });
  };
  const rejectRematch = async () => {
    if (isSpectator) return;
    if (isBot) { leaveRoom(); return; }
    await updateRoom({ status: 'closed', closedBy: user.uid });
  };

  if (isSpectator) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto">
        <Eye className="w-10 h-10 text-yellow-400 mb-3" />
        <h2 className="text-xl font-bold text-slate-200 mb-2">Seyirci Modu</h2>
        <p className="text-slate-400 text-sm">Amiral Battı'da seyirci modu şu an desteklenmiyor.</p>
      </div>
    );
  }

  // Her HÜCRE için "hangi geminin kaçıncı parçası" bilgisini çıkarır. Gemiyi
  // 3 ayrı kutu gibi değil TEK BİR GÖVDE gibi çizebilmek için gerekli: sadece
  // baş/kıç uçları yuvarlatılır, aradaki parçalar birbirine yapışır.
  const buildSegmentMap = (ships) => {
    const map = {};
    (ships || []).forEach((ship) => {
      const cells = ship.cells || [];
      cells.forEach((cell, i) => {
        map[cellKey(cell.row, cell.col)] = {
          shipId: ship.id,
          name: ship.name,
          orientation: ship.orientation,
          isFirst: i === 0,
          isLast: i === cells.length - 1,
        };
      });
    });
    return map;
  };

  // Ortak tahta iskeleti: sütun/satır etiketleri + verilen hücre üretici
  // fonksiyonuna göre 10x10 gövde. Yerleştirme (Faz 1) ve savaş (Faz 2)
  // tahtaları aynı iskeleti, farklı hücre görünümleriyle kullanır.
  //   radar: hedef tahtasına dönen tarama ışığı ekler.
  const renderGrid = (renderCell, onMouseLeaveBoard, { radar = false } = {}) => (
    <div className="inline-flex flex-col select-none" onMouseLeave={onMouseLeaveBoard}>
      <div className="flex">
        <div className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 shrink-0" />
        {Array.from({ length: BOARD_SIZE }, (_, c) => (
          <div key={c} className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 flex items-center justify-center text-[10px] sm:text-xs font-bold text-cyan-300/70 shrink-0">{c + 1}</div>
        ))}
      </div>
      <div className="flex">
        <div className="flex flex-col">
          {ROW_LABELS.map((label) => (
            <div key={label} className="w-5 h-6 sm:w-6 sm:h-7 md:w-7 md:h-8 flex items-center justify-center text-[10px] sm:text-xs font-bold text-cyan-300/70 shrink-0">{label}</div>
          ))}
        </div>
        <div className="bs-board relative rounded-md overflow-hidden">
          {radar && <div className="bs-sweep absolute inset-[-25%] pointer-events-none z-0" />}
          <div className="relative z-[1]">
            {ROW_LABELS.map((label, r) => (
              <div key={label} className="flex">
                {Array.from({ length: BOARD_SIZE }, (_, c) => renderCell(r, c))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const CELL = 'w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 shrink-0 relative';

  const setupSegments = buildSegmentMap(placedShips);

  const renderSetupMyCell = (r, c) => {
    const key = cellKey(r, c);
    const occupantId = occupancy[key];
    const seg = setupSegments[key];
    // Bu hücredeki gemi ŞU AN basılı-tutup-sürüklenerek taşınıyorsa, ESKİ
    // konumundaki gövde gizlenir — aksi halde hem eski hem yeni (önizleme)
    // konumda aynı anda görünüp kafa karıştırırdı.
    const hiddenForDrag = !!(dragMove && seg && seg.shipId === dragMove.shipId);
    // İki AYRI önizleme kaynağı olabilir (aynı anda sadece biri aktiftir):
    // envanterden yeni gemi yerleştirme (previewSet) ya da yerleştirilmiş bir
    // gemiyi sürükleyerek taşıma (dragPreviewSet).
    const inInventoryPreview = previewSet.has(key);
    const inDragPreview = dragPreviewSet.has(key);
    const inPreview = inInventoryPreview || inDragPreview;
    const previewValid = inInventoryPreview ? previewInfo.valid : (inDragPreview ? dragPreviewInfo.valid : true);
    const shaking = occupantId && shakeShipId === occupantId;
    // Önizleme (sürüklerken/hedeflerken) hücrenin ÜSTÜNE bindirilen renk.
    const previewCls = inPreview
      ? (previewValid ? 'bg-emerald-400/45 border-emerald-300/80' : 'bg-rose-500/45 border-rose-300/80')
      : '';
    return (
      <div
        key={c}
        data-row={r}
        data-col={c}
        onClick={() => handleCellClick(r, c)}
        onDoubleClick={(e) => handleCellRotateGesture(e, r, c)}
        onContextMenu={(e) => handleCellRotateGesture(e, r, c)}
        onMouseEnter={() => { if (!setupLocked && selectedShipId) setHoverOrigin({ row: r, col: c }); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!setupLocked) setHoverOrigin({ row: r, col: c }); }}
        onDrop={(e) => {
          e.preventDefault();
          const shipId = e.dataTransfer.getData('text/plain') || selectedShipId;
          if (shipId) attemptPlace(shipId, { row: r, col: c }, pendingOrientation);
        }}
        onPointerDown={(e) => handleCellPointerDown(e, r, c)}
        onPointerMove={handleCellPointerMove}
        onPointerUp={handleCellPointerUp}
        onPointerCancel={handleCellPointerCancel}
        className={`${CELL} bs-cell ${!setupLocked && !occupantId ? 'bs-cell-live' : ''} ${occupantId ? 'touch-none' : ''} transition-colors ${previewCls} ${setupLocked ? 'cursor-default' : (occupantId ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer')} ${shaking ? 'animate-[shake_0.35s_ease-in-out] z-20' : ''}`}
        title={occupantId ? 'Tıkla: döndür/kaldır seçenekleri — taşımak için basılı tutup sürükle' : undefined}
      >
        {seg && !hiddenForDrag && <ShipHull seg={seg} state="intact" placing />}
      </div>
    );
  };

  const renderLockedCell = (r, c) => (
    <div key={c} className={`${CELL} bs-cell`} />
  );

  // FAZ 2 — "Kendi Filom": kendi gemilerim (sabit) + rakibin bana yaptığı
  // atışların üstten gösterimi (isabet: alev/kızıl, ıska: damla/mavi).
  const myBattleSegments = buildSegmentMap(myShips);

  const renderBattleMyCell = (r, c) => {
    const key = cellKey(r, c);
    const seg = myBattleSegments[key];
    const shot = opponentShotMap[key];
    const sunk = seg && mySunkShipIds.has(seg.shipId);
    const state = sunk ? 'sunk' : (shot?.hit ? 'hit' : 'intact');
    return (
      <div key={c} className={`${CELL} bs-cell flex items-center justify-center`}>
        {seg && <ShipHull seg={seg} state={state} />}
        {shot && <ShotMarker hit={!!shot.hit} sunk={!!sunk} />}
      </div>
    );
  };

  // FAZ 2 — "Hedef Tahtası": SADECE bu tahtaya atış yapılabilir. Kendi
  // atışlarımın sonucunu (isabet/ıska) gösterir.
  //
  // KULLANICI İSTEĞİ: Bir rakip gemisi TAMAMEN battığında (oyun HÂLÂ
  // SÜRERKEN) bunu belli eden HİÇBİR ŞEY yoktur — ne tam gemi hattının açığa
  // çıkması, ne "X battı!" ipucu, ne farklı bir patlama sesi (bkz.
  // battleshipSound.js). Her isabet TAMAMEN AYNI görünür/duyulur — geminin
  // son parçası mı yoksa ilk parçası mı olduğunu ayırt edemezsiniz, bu yüzden
  // emin olmak için etrafına da atış yapmanız gerekir.
  //
  // OYUN BİTTİĞİNDE (bir kazanan belirlendiğinde) İSE artık gizlenecek bir
  // şey kalmaz — rakibin TÜM filosu (kaçırdığınız/hiç ateş etmediğiniz
  // hücreler DAHİL) radar üzerinde açığa çıkar, böylece "gemiler nerede
  // duruyormuş" görebilirsiniz.
  const revealedOpponentSegments = roomData.winner ? buildSegmentMap(opponentShips) : null;
  const revealedSunkIds = roomData.winner
    ? new Set(opponentShips.filter((s) => isShipSunk(s, myShotMap)).map((s) => s.id))
    : null;

  const renderBattleTargetCell = (r, c) => {
    const key = cellKey(r, c);
    const shot = myShotMap[key];
    const clickable = isMyTurn && !shot;
    const revealSeg = revealedOpponentSegments?.[key];
    const revealState = revealSeg ? (revealedSunkIds.has(revealSeg.shipId) ? 'sunk' : (shot?.hit ? 'hit' : 'intact')) : null;
    return (
      <div
        key={c}
        onClick={() => handleShoot(r, c)}
        className={`${CELL} bs-cell flex items-center justify-center transition-colors ${clickable ? 'bs-cell-live bs-crosshair cursor-pointer' : 'cursor-default'}`}
      >
        {revealSeg && <ShipHull seg={revealSeg} state={revealState} />}
        {shot && <ShotMarker hit={!!shot.hit} />}
      </div>
    );
  };

  let statusMsg = ''; let statusColor = 'text-slate-300';
  if (roomData.winner) {
    if (roomData.winner === user.uid) { statusMsg = 'Kazandın! 🎉'; statusColor = 'text-emerald-400'; }
    else { statusMsg = 'Kaybettin! 😢'; statusColor = 'text-red-400'; }
  } else if (isPlaying) {
    statusMsg = isMyTurn ? 'Senin Sıran! Hedef tahtasından ateş et 🎯' : `${opponentName} ateş ediyor...`;
    statusColor = isMyTurn ? 'text-sky-300' : 'text-slate-400';
  }

  return (
    <div className="relative flex flex-col items-center w-full max-w-4xl bg-gradient-to-br from-sky-950/40 to-slate-900 p-4 md:p-8 rounded-[2rem] border border-sky-800/30 shadow-xl overflow-hidden">
      {/* ============================================================
          GÖRSEL KATMAN (sadece sunum — oyun mantığına HİÇ dokunmaz)
          ============================================================ */}
      <style>{`
        @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }

        /* KARAVANA: suya düşen merminin genişleyip kaybolan dalga halkası. */
        @keyframes bsRipple {
          0%   { transform: scale(0.25); opacity: 0.95; border-width: 2px; }
          70%  { opacity: 0.35; }
          100% { transform: scale(2.1);  opacity: 0;    border-width: 1px; }
        }
        .bs-ripple::after {
          content: ''; position: absolute; inset: 12%;
          border: 2px solid rgba(125, 211, 252, 0.95); border-radius: 9999px;
          animation: bsRipple 900ms ease-out 1 both;
        }

        /* İSABET: aniden büyüyüp hafifçe geri oturan ateş topu. */
        @keyframes bsBurst {
          0%   { transform: scale(0.25); opacity: 0; }
          30%  { transform: scale(1.35); opacity: 1; }
          60%  { transform: scale(0.88); opacity: 0.95; }
          100% { transform: scale(1);    opacity: 0.92; }
        }
        .bs-burst { animation: bsBurst 520ms cubic-bezier(0.2, 1.4, 0.4, 1) 1 both; }

        /* İsabet hücresinin altında yanıp sönen sıcak çekirdek. */
        @keyframes bsEmber { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
        .bs-ember { animation: bsEmber 1.6s ease-in-out infinite; }

        /* BATTI: hurda/kömür gövdenin üstünde sürekli duman-alev nabzı. */
        @keyframes bsSunkGlow {
          0%, 100% { opacity: 0.28; transform: scale(0.92); }
          50%      { opacity: 0.8;  transform: scale(1.12); }
        }
        .bs-sunk-glow { animation: bsSunkGlow 2.1s ease-in-out infinite; }

        /* Gemi yerleştirilirken "oturma" (bounce) hissi. */
        @keyframes bsPlace {
          0%   { transform: scale(1.3); }
          55%  { transform: scale(0.93); }
          100% { transform: scale(1); }
        }
        .bs-place { animation: bsPlace 320ms cubic-bezier(0.2, 1.5, 0.4, 1) 1 both; }

        /* Radar taraması: hedef tahtasının üstünde dönen ışık süpürgesi. */
        @keyframes bsSweep { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .bs-sweep {
          background: conic-gradient(from 0deg, rgba(34,211,238,0) 0deg, rgba(34,211,238,0) 300deg, rgba(34,211,238,0.16) 350deg, rgba(34,211,238,0.32) 360deg);
          animation: bsSweep 4.5s linear infinite;
        }

        /* Taktiksel ızgara zemini: derin deniz + neon çizgiler. */
        .bs-board {
          background:
            radial-gradient(ellipse at 50% 0%, rgba(14,116,144,0.20) 0%, rgba(2,6,23,0) 65%),
            linear-gradient(160deg, #071a2f 0%, #04101f 55%, #020a14 100%);
          box-shadow: inset 0 0 42px rgba(6,182,212,0.10), 0 0 0 1px rgba(34,211,238,0.16), 0 14px 34px rgba(0,0,0,0.5);
        }
        /* Hücre ayırıcıları: ince, hafif parlayan neon çizgiler. */
        .bs-cell { border: 1px solid rgba(34, 211, 238, 0.13); }
        .bs-cell-live:hover { border-color: rgba(34, 211, 238, 0.55); background-color: rgba(8, 145, 178, 0.16); }

        /* Nişangâh (target lock): SADECE imlecin üzerinde olduğu hedef
           hücrede köşe braketleri belirir (tüm tahtada değil). */
        .bs-crosshair:hover::before, .bs-crosshair:hover::after {
          content: ''; position: absolute; pointer-events: none; z-index: 2;
          border-color: rgba(244, 63, 94, 0.95); border-style: solid;
        }
        .bs-crosshair:hover::before { inset: 8% auto auto 8%; width: 34%; height: 34%; border-width: 2px 0 0 2px; }
        .bs-crosshair:hover::after  { inset: auto 8% 8% auto; width: 34%; height: 34%; border-width: 0 2px 2px 0; }
        .bs-crosshair:hover { background-color: rgba(244, 63, 94, 0.14); border-color: rgba(244, 63, 94, 0.6) !important; }
      `}</style>

      {toast && (
        // NOT: `fixed` overlay yerine BİLEREK normal akışta (in-flow) bir
        // banner kullanılıyor — sabit konumlu bir toast, hemen altındaki
        // "Sen/Rakip" skor satırının üstüne binip onu gizleyebiliyordu.
        <div className={`w-full mb-4 z-10 text-white px-4 py-2.5 sm:px-6 sm:py-3 rounded-xl shadow-lg font-bold border text-center text-xs sm:text-sm ${toastColors[toast.tone] || toastColors.red}`}>
          {toast.msg}
        </div>
      )}

      {/* KULLANICI İSTEĞİ: Yerleştirilmiş bir gemiye (hareket etmeden) tıklanınca
          eskiden doğrudan ele alınıyordu — artık "Döndür"/"Kaldır" seçeneklerini
          sunan bu küçük menü açılır. Arka plandaki tam-ekran şeffaf katman,
          menü dışına yapılan HERHANGİ bir dokunuşta menüyü kapatır. */}
      {shipMenu && (
        <>
          <div className="fixed inset-0 z-40" onPointerDown={() => setShipMenu(null)} />
          <div
            className="fixed z-50 flex items-center gap-1 bg-slate-800 border border-cyan-500/60 rounded-xl shadow-2xl p-1.5"
            style={{ left: shipMenu.x, top: shipMenu.y, transform: 'translate(-50%, -115%)' }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { rotateInPlace(shipMenu.shipId); setShipMenu(null); }}
              className="flex items-center gap-1.5 text-xs font-bold bg-slate-700 hover:bg-cyan-600/40 border border-slate-600 hover:border-cyan-400 px-3 py-2 rounded-lg text-slate-100 transition-colors"
            >
              <RotateCw className="w-4 h-4" /> Döndür
            </button>
            <button
              onClick={() => { pickUpShip(shipMenu.shipId); setShipMenu(null); }}
              className="flex items-center gap-1.5 text-xs font-bold bg-slate-700 hover:bg-rose-600/40 border border-slate-600 hover:border-rose-400 px-3 py-2 rounded-lg text-slate-100 transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Kaldır
            </button>
          </div>
        </>
      )}

      <h2 className="text-2xl font-bold mb-1 text-slate-200 z-10 tracking-widest drop-shadow-md flex items-center gap-2"><Anchor className="w-6 h-6 text-sky-400" /> Amiral Battı</h2>
      {/* Oyun tamamen şansa dayalı olduğu için zorluk seviyesi YOKTUR — tek,
          standart bir bot (bkz. bot.js). */}
      {isBot && <div className="text-xs font-bold text-sky-300 tracking-widest uppercase mb-1 z-10">BOTA KARŞI</div>}
      <p className="text-sm text-slate-400 mb-6 z-10">
        {roomData.setupPhase ? 'Gemilerini Yerleştirme Aşaması' : (roomData.winner ? 'Savaş Bitti' : 'Savaş Başladı!')}
      </p>

      <div className="w-full flex flex-col sm:flex-row justify-between gap-3 mb-6 z-10">
        <div className={`flex-1 flex items-center justify-between gap-2 px-4 py-2 rounded-xl border ${roomData.setupPhase ? (amIReady ? 'bg-emerald-600/15 border-emerald-500/40' : 'bg-slate-800/70 border-slate-700') : (isMyTurn ? 'bg-sky-600/15 border-sky-500/40' : 'bg-slate-800/70 border-slate-700')}`}>
          <span className="text-sm font-medium text-slate-200 truncate">{myName} (Sen)</span>
          {roomData.setupPhase ? (
            amIReady ? <span className="flex items-center gap-1 text-xs font-bold text-emerald-400"><Check className="w-4 h-4" /> Hazır</span> : <span className="text-xs text-slate-400">Diziyor...</span>
          ) : (
            <span className="text-sm font-mono font-bold text-white">{myScore}</span>
          )}
        </div>
        <div className={`flex-1 flex items-center justify-between gap-2 px-4 py-2 rounded-xl border ${roomData.setupPhase ? (isOpponentReady ? 'bg-emerald-600/15 border-emerald-500/40' : 'bg-slate-800/70 border-slate-700') : (!isMyTurn && !roomData.winner ? 'bg-sky-600/15 border-sky-500/40' : 'bg-slate-800/70 border-slate-700')}`}>
          <span className="text-sm font-medium text-slate-200 truncate">{opponentName}</span>
          {roomData.setupPhase ? (
            isOpponentReady ? <span className="flex items-center gap-1 text-xs font-bold text-emerald-400"><Check className="w-4 h-4" /> Hazır</span> : <span className="text-xs text-slate-400">Diziyor...</span>
          ) : (
            <span className="text-sm font-mono font-bold text-white">{opponentScore}</span>
          )}
        </div>
      </div>

      {roomData.setupPhase && amIReady && isOpponentReady && (
        <div className="w-full mb-6 z-10 text-center bg-sky-600/15 border border-sky-500/40 rounded-xl py-3 px-4">
          <p className="text-sky-200 font-bold text-sm">İkiniz de hazırsınız! Savaş başlıyor...</p>
        </div>
      )}
      {roomData.setupPhase && amIReady && !isOpponentReady && (
        <div className="w-full mb-6 z-10 text-center bg-slate-800/70 border border-slate-700 rounded-xl py-3 px-4 flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          <p className="text-slate-300 text-sm">Rakibinin gemilerini dizmesi bekleniyor...</p>
        </div>
      )}
      {!roomData.setupPhase && (
        <div className={`w-full mb-6 z-10 text-center border rounded-xl py-3 px-4 ${roomData.winner ? (roomData.winner === user.uid ? 'bg-emerald-600/15 border-emerald-500/40' : 'bg-red-600/15 border-red-500/40') : 'bg-slate-800/70 border-slate-700'}`}>
          <p className={`font-bold text-sm ${statusColor}`}>{statusMsg}</p>
        </div>
      )}

      {/* GÖRSEL HATA DÜZELTMESİ (telefonda tahtanın hafif sağa/sola kaymış
          görünmesi): mobilde (lg altı) bu kap dikey (flex-col) dizilir; cross
          eksen (yatay) hizalaması `items-start` idi, yani her bölüm (Kendi
          Filom / Hedef Tahtası) MEVCUT GENİŞLİĞE göre SOLA yaslanıyordu —
          gemi envanteri/butonlar gibi tam genişlikte alt bileşenler yüzünden
          bölümün toplam genişliği tahtanın kendisinden daha geniş olduğunda,
          tahta (dar içerik) o genişlik içinde ortalanmak yerine sola/kenara
          yapışık kalıp SAYFANIN gerçek ortasına göre kaymış görünüyordu.
          `lg:` öncesinde `items-center` ile düzeltilir; masaüstünde (lg+, iki
          sütun yan yana) `items-start` (üst hizalama) korunur. */}
      <div className="w-full flex flex-col lg:flex-row gap-8 z-10 items-center lg:items-start justify-center">
        {/* KENDİ FİLOM */}
        <div className="flex flex-col items-center gap-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-indigo-300">Kendi Filom</h3>
          <div className="bg-slate-900/70 p-2 sm:p-3 rounded-xl border border-slate-700 shadow-inner overflow-x-auto">
            {roomData.setupPhase
              ? renderGrid(renderSetupMyCell, () => setHoverOrigin(null))
              : renderGrid(renderBattleMyCell)}
          </div>

          {roomData.setupPhase && !setupLocked && (
            <div className="w-full flex items-center justify-between gap-2">
              <button onClick={() => setPendingOrientation((o) => (o === 'H' ? 'V' : 'H'))} className="flex items-center gap-1.5 text-xs font-bold bg-slate-800 hover:bg-slate-700 border border-slate-600 px-3 py-2 rounded-lg text-slate-200 transition-colors">
                <RotateCw className="w-4 h-4" /> Döndür ({pendingOrientation === 'H' ? 'Yatay' : 'Dikey'})
              </button>
              <button onClick={handleResetAll} className="flex items-center gap-1.5 text-xs font-bold bg-slate-800 hover:bg-red-900/40 border border-slate-600 hover:border-red-600/50 px-3 py-2 rounded-lg text-slate-300 hover:text-red-300 transition-colors">
                <RotateCcw className="w-4 h-4" /> Sıfırla
              </button>
            </div>
          )}

          {/* GEMİ ENVANTERİ — sadece yerleştirme aşamasında. `data-ship-inventory`
              ile işaretlenir: yerleştirilmiş bir gemi sürüklenip buraya
              bırakılırsa (bkz. handleCellPointerMove/Up) tahtadan kaldırılır. */}
          {roomData.setupPhase && (
            <div
              data-ship-inventory
              className={`w-full flex flex-col gap-2 rounded-xl transition-all ${dragOverInventory ? 'ring-2 ring-rose-400 bg-rose-500/10 p-1.5 -m-1.5' : ''}`}
            >
              {dragOverInventory && (
                <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-rose-300 py-1">
                  <Trash2 className="w-3.5 h-3.5" /> Bırak, kaldırılsın
                </div>
              )}
              {SHIP_DEFS.map((def) => {
                const isPlaced = placedShips.some((s) => s.id === def.id);
                const isSelected = selectedShipId === def.id;
                return (
                  <div
                    key={def.id}
                    draggable={!setupLocked && !isPlaced}
                    onDragStart={(e) => handleShipInventoryDragStart(e, def)}
                    onClick={() => { if (!setupLocked && !isPlaced) setSelectedShipId((id) => (id === def.id ? null : def.id)); }}
                    className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border transition-all duration-150 ${
                      isPlaced ? 'bg-slate-800/40 border-slate-700 opacity-50' :
                      // Seçili gemi hafifçe KALKAR (scale + glow) — "elime aldım" hissi.
                      isSelected ? 'bg-cyan-500/15 border-cyan-400 cursor-pointer scale-[1.03] shadow-[0_0_18px_rgba(34,211,238,0.35)]' :
                      `bg-slate-800/80 border-slate-600 hover:border-cyan-400/70 hover:scale-[1.02] ${setupLocked ? '' : 'cursor-pointer active:scale-95'}`
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Ship className={`w-4 h-4 shrink-0 ${isSelected ? 'text-cyan-300' : 'text-sky-400'}`} />
                      <span className="text-xs sm:text-sm font-medium text-slate-200 truncate">{def.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Envanterdeki silüet de TEK BİR metalik gövde olarak
                          çizilir (ayrı kutucuklar değil) — masadaki görünümle
                          aynı dili konuşur. */}
                      <div
                        className={`flex ${isSelected && pendingOrientation === 'V' ? 'flex-col' : 'flex-row'} overflow-hidden`}
                        style={{
                          borderRadius: '9999px',
                          background: (isSelected && pendingOrientation === 'V')
                            ? 'linear-gradient(to right, #e2e8f0 0%, #a8b6c8 32%, #6b7c93 64%, #3d4a5c 100%)'
                            : 'linear-gradient(to bottom, #e2e8f0 0%, #a8b6c8 32%, #6b7c93 64%, #3d4a5c 100%)',
                          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -2px 3px rgba(0,0,0,0.4)',
                        }}
                      >
                        {Array.from({ length: def.length }, (_, i) => (
                          <div key={i} className="w-3 h-3 sm:w-3.5 sm:h-3.5 relative">
                            <span className="absolute rounded-[1px] bg-slate-700/60" style={{ left: '32%', top: '32%', width: '36%', height: '36%' }} />
                          </div>
                        ))}
                      </div>
                      {isPlaced && <Check className="w-4 h-4 text-emerald-400" />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {roomData.setupPhase && (
            !setupLocked ? (
              <button
                onClick={handleConfirmReady}
                disabled={!readyToConfirm || isSaving}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-base transition-all ${
                  readyToConfirm && !isSaving
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-800/30 hover:scale-[1.02]'
                    : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                }`}
              >
                {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                {readyToConfirm ? 'Hazır' : `Hazır (${placedShips.length}/${SHIP_DEFS.length} gemi)`}
              </button>
            ) : !isOpponentReady ? (
              <button
                onClick={handleCancelReady}
                disabled={isSaving}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-base bg-amber-600/15 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                Hazır — Vazgeç ve Düzenle
              </button>
            ) : (
              <div className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-base bg-emerald-600/15 border border-emerald-500/40 text-emerald-300">
                <Check className="w-5 h-5" /> Gemilerin Kaydedildi
              </div>
            )
          )}
        </div>

        {/* HEDEF TAHTASI (RADAR) */}
        <div className="flex flex-col items-center gap-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-rose-300">Hedef Tahtası (Radar)</h3>
          <div className="relative bg-slate-900/70 p-2 sm:p-3 rounded-xl border border-slate-700 shadow-inner overflow-x-auto">
            {roomData.setupPhase
              ? renderGrid(renderLockedCell)
              : renderGrid(renderBattleTargetCell, undefined, { radar: true })}
            {roomData.setupPhase && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/50 rounded-xl">
                <Lock className="w-8 h-8 text-slate-500" />
                <p className="text-xs font-bold text-slate-400 text-center px-4">
                  {isOpponentReady ? 'Rakibiniz gemilerini yerleştirdi' : 'Rakibiniz gemilerini yerleştiriyor'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {roomData.winner && (
        <div className="w-full mt-6 flex flex-col items-center bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-sky-800/20 shadow-lg z-10">
          {!roomData.rematchRequestedBy ? (
            <button onClick={requestRematch} className="bg-sky-700 hover:bg-sky-600 w-full py-3 rounded-xl font-bold text-lg shadow-lg shadow-sky-800/30 transition-all hover:scale-[1.02] hover:shadow-sky-800/50">Yeni Tura Başla</button>
          ) : roomData.rematchRequestedBy === user.uid ? (
            <div className="flex items-center gap-3 text-slate-400 py-2"><Loader2 className="w-5 h-5 animate-spin" /><span>Rakibin cevabı bekleniyor...</span></div>
          ) : (
            <div className="flex flex-col items-center w-full">
              <span className="text-sky-200 font-medium mb-3 text-center drop-shadow-md">Rakibiniz yeni bir tur istiyor!</span>
              <div className="flex gap-4 w-full">
                <button onClick={acceptRematch} className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/40 text-green-400 border border-green-500/50 py-3 rounded-xl font-bold"><Check className="w-5 h-5" /> Kabul Et</button>
                <button onClick={rejectRematch} className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/50 py-3 rounded-xl font-bold"><X className="w-5 h-5" /> Reddet</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
