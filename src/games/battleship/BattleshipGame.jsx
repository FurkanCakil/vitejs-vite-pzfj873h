import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ship, RotateCw, Check, Loader2, Lock, Eye, RotateCcw, Anchor, Flame, X } from 'lucide-react';
import { doc, updateDoc, runTransaction } from 'firebase/firestore';
import { playSound } from '../../utils/sound.js';
import { BOARD_SIZE, ROW_LABELS, SHIP_DEFS, getShipCells, canPlaceShip, allShipsPlaced, cellKey } from './logic.js';

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
export default function BattleshipGame({ roomData, roomCode, user, db, appId }) {
  if (!roomData || !roomData.players) return null; // GÜVENLİK: Veri henüz gelmediyse bekle

  const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);

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
    const cells = getShipCells(hoverOrigin, pendingOrientation, def.length);
    const { valid } = canPlaceShip(placedShips, cells);
    return { cells, valid };
  }, [setupLocked, selectedShipId, hoverOrigin, pendingOrientation, placedShips]);
  const previewSet = useMemo(() => new Set((previewInfo?.cells || []).map((c) => cellKey(c.row, c.col))), [previewInfo]);

  const flashInvalid = (shipId) => {
    playSound('error');
    setShakeShipId(shipId || 'preview');
    setTimeout(() => setShakeShipId(null), 350);
  };

  const attemptPlace = (shipId, origin, orientation) => {
    if (setupLocked) return;
    const def = SHIP_DEFS.find((d) => d.id === shipId);
    if (!def) return;
    const cells = getShipCells(origin, orientation, def.length);
    const { valid } = canPlaceShip(placedShips, cells);
    if (!valid) { flashInvalid(shipId); return; }
    playSound('move');
    setPlacedShips((prev) => [...prev, { id: def.id, name: def.name, length: def.length, orientation, origin, cells }]);
    setSelectedShipId(null);
    setHoverOrigin(null);
  };

  const pickUpShip = (shipId) => {
    if (setupLocked) return;
    const ship = placedShips.find((s) => s.id === shipId);
    if (!ship) return;
    setPlacedShips((prev) => prev.filter((s) => s.id !== shipId));
    setSelectedShipId(shipId);
    setPendingOrientation(ship.orientation);
  };

  const rotateInPlace = (shipId) => {
    if (setupLocked) return;
    const ship = placedShips.find((s) => s.id === shipId);
    if (!ship) return;
    const newOrientation = ship.orientation === 'H' ? 'V' : 'H';
    const newCells = getShipCells(ship.origin, newOrientation, ship.length);
    const { valid } = canPlaceShip(placedShips, newCells, ship.id);
    if (!valid) { flashInvalid(shipId); return; }
    playSound('move');
    setPlacedShips((prev) => prev.map((s) => (s.id === ship.id ? { ...s, orientation: newOrientation, cells: newCells } : s)));
  };

  const handleCellClick = (row, col) => {
    if (setupLocked) return;
    const occupantId = occupancy[cellKey(row, col)];
    if (occupantId) { if (!selectedShipId) pickUpShip(occupantId); return; }
    if (selectedShipId) attemptPlace(selectedShipId, { row, col }, pendingOrientation);
  };

  const handleCellRotateGesture = (e, row, col) => {
    e.preventDefault();
    const occupantId = occupancy[cellKey(row, col)];
    if (occupantId) rotateInPlace(occupantId);
  };

  const handleResetAll = () => {
    if (setupLocked) return;
    setPlacedShips([]);
    setSelectedShipId(null);
    setHoverOrigin(null);
  };

  const handleConfirmReady = async () => {
    if (setupLocked || !readyToConfirm) return;
    setIsSaving(true);
    try {
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
      playSound('check');
    } catch (err) { console.error('Amiral Battı hazır kaydı hatası:', err); }
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
  const opponentSunkShipIds = new Set(opponentShips.filter((s) => isShipSunk(s, myShotMap)).map((s) => s.id));
  const mySunkShipIds = new Set(myShips.filter((s) => isShipSunk(s, opponentShotMap)).map((s) => s.id));

  // Yeni batan gemi tespiti: her render'da sette olan gemileri önceki bilinen
  // sete göre karşılaştırıp SADECE yeni battığı anda toast/ses tetikler
  // (bkz. aşağıdaki bağımlılık dizisinde stabil string anahtarlar).
  const opponentSunkKey = Array.from(opponentSunkShipIds).sort().join(',');
  const mySunkKey = Array.from(mySunkShipIds).sort().join(',');
  const prevOpponentSunkRef = useRef(new Set());
  const prevMySunkRef = useRef(new Set());
  useEffect(() => {
    if (!isPlaying) return;
    opponentSunkShipIds.forEach((id) => {
      if (!prevOpponentSunkRef.current.has(id)) {
        const ship = opponentShips.find((s) => s.id === id);
        showToast(`Rakibin ${ship?.name || 'gemisi'} battı!`, 'emerald');
        playSound('check');
      }
    });
    prevOpponentSunkRef.current = opponentSunkShipIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opponentSunkKey, isPlaying]);
  useEffect(() => {
    if (!isPlaying) return;
    mySunkShipIds.forEach((id) => {
      if (!prevMySunkRef.current.has(id)) {
        const ship = myShips.find((s) => s.id === id);
        showToast(`Bir geminiz battı: ${ship?.name || ''}!`, 'red');
        playSound('error');
      }
    });
    prevMySunkRef.current = mySunkShipIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mySunkKey, isPlaying]);

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

    playSound(isHit ? 'capture' : 'move');
    try { await updateDoc(roomRef, update); } catch (err) { console.error('Amiral Battı atış hatası:', err); }
  };

  const requestRematch = async () => {
    if (isSpectator) return;
    await updateDoc(roomRef, { rematchRequestedBy: user.uid });
  };
  const acceptRematch = async () => {
    if (isSpectator) return;
    await updateDoc(roomRef, {
      setupPhase: true, ships: {}, readyPlayers: {}, shots: {},
      turn: null, winner: null, rematchRequestedBy: null,
    });
  };
  const rejectRematch = async () => {
    if (isSpectator) return;
    await updateDoc(roomRef, { status: 'closed', closedBy: user.uid });
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

  // Tek bir gemi parçası: yukarıdan bakılan METALİK savaş gemisi gövdesi.
  // Hücre kenarlarını (inset -1px) örterek yan parçayla dikişsiz birleşir.
  //   state: 'intact' | 'hit' | 'sunk'
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
    const inPreview = previewSet.has(key);
    const shaking = occupantId && shakeShipId === occupantId;
    // Önizleme (sürüklerken/hedeflerken) hücrenin ÜSTÜNE bindirilen renk.
    const previewCls = inPreview
      ? (previewInfo.valid ? 'bg-emerald-400/45 border-emerald-300/80' : 'bg-rose-500/45 border-rose-300/80')
      : '';
    return (
      <div
        key={c}
        onClick={() => handleCellClick(r, c)}
        onDoubleClick={(e) => handleCellRotateGesture(e, r, c)}
        onContextMenu={(e) => handleCellRotateGesture(e, r, c)}
        onMouseEnter={() => { if (!setupLocked && selectedShipId) setHoverOrigin({ row: r, col: c }); }}
        onDragOver={(e) => { e.preventDefault(); if (!setupLocked) setHoverOrigin({ row: r, col: c }); }}
        onDrop={(e) => {
          e.preventDefault();
          const shipId = e.dataTransfer.getData('text/plain') || selectedShipId;
          if (shipId) attemptPlace(shipId, { row: r, col: c }, pendingOrientation);
        }}
        className={`${CELL} bs-cell ${!setupLocked && !occupantId ? 'bs-cell-live' : ''} transition-colors ${previewCls} ${setupLocked ? 'cursor-default' : 'cursor-pointer'} ${shaking ? 'animate-[shake_0.35s_ease-in-out] z-20' : ''}`}
        title={occupantId ? 'Çevirmek için çift tıkla / sağ tıkla' : undefined}
      >
        {seg && <ShipHull seg={seg} state="intact" placing />}
      </div>
    );
  };

  const renderLockedCell = (r, c) => (
    <div key={c} className={`${CELL} bs-cell`} />
  );

  // FAZ 2 — "Kendi Filom": kendi gemilerim (sabit) + rakibin bana yaptığı
  // atışların üstten gösterimi (isabet: alev/kızıl, ıska: damla/mavi).
  const myBattleSegments = buildSegmentMap(myShips);

  // Bir atış hücresinin ÜSTÜNE binen efekt katmanı: isabet -> patlama,
  // karavana -> su halkası. Gemi gövdesinin üzerine çizilir (gövdeyi silmez).
  //   sunk: gemi TAMAMEN battıysa patlama topu küçülüp saydamlaşır — böylece
  //   altındaki KÖMÜRLEŞMİŞ gövde (ve onun duman/alev nabzı) görünür kalır.
  //   Aksi halde opak ateş topu gövdeyi tamamen örtüyordu.
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
  // atışlarımın sonucu + batırdığım gemilerin tam hatları burada belirginleşir.
  // Batırılan rakip gemilerin TAM hatları radar üzerinde açığa çıkar; bunun
  // için sadece batmış gemilerden bir segment haritası kurulur.
  const sunkOpponentSegments = buildSegmentMap(opponentShips.filter((s) => opponentSunkShipIds.has(s.id)));

  const renderBattleTargetCell = (r, c) => {
    const key = cellKey(r, c);
    const shot = myShotMap[key];
    const sunkSeg = sunkOpponentSegments[key];
    const clickable = isMyTurn && !shot;
    return (
      <div
        key={c}
        onClick={() => handleShoot(r, c)}
        className={`${CELL} bs-cell flex items-center justify-center transition-colors ${clickable ? 'bs-cell-live bs-crosshair cursor-pointer' : 'cursor-default'}`}
        title={sunkSeg ? `${sunkSeg.name} battı!` : undefined}
      >
        {/* Batan gemi radar üzerinde hurda gövdesiyle görünür hale gelir. */}
        {sunkSeg && <ShipHull seg={sunkSeg} state="sunk" />}
        {shot && <ShotMarker hit={!!shot.hit} sunk={!!sunkSeg} />}
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

      <h2 className="text-2xl font-bold mb-1 text-slate-200 z-10 tracking-widest drop-shadow-md flex items-center gap-2"><Anchor className="w-6 h-6 text-sky-400" /> Amiral Battı</h2>
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

      <div className="w-full flex flex-col lg:flex-row gap-8 z-10 items-start justify-center">
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

          {/* GEMİ ENVANTERİ — sadece yerleştirme aşamasında */}
          {roomData.setupPhase && (
            <div className="w-full flex flex-col gap-2">
              {SHIP_DEFS.map((def) => {
                const isPlaced = placedShips.some((s) => s.id === def.id);
                const isSelected = selectedShipId === def.id;
                return (
                  <div
                    key={def.id}
                    draggable={!setupLocked && !isPlaced}
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', def.id); setSelectedShipId(def.id); }}
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
                <p className="text-xs font-bold text-slate-400 text-center px-4">Faz 2'de (Atış Aşaması) Aktif Olacak</p>
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
