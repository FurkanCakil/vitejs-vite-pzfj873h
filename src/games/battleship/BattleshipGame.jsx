import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ship, RotateCw, Check, Loader2, Lock, Eye, RotateCcw, Anchor, Droplet, Flame, Skull, X } from 'lucide-react';
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

  // Ortak tahta iskeleti: sütun/satır etiketleri + verilen hücre üretici
  // fonksiyonuna göre 10x10 gövde. Yerleştirme (Faz 1) ve savaş (Faz 2)
  // tahtaları aynı iskeleti, farklı hücre görünümleriyle kullanır.
  const renderGrid = (renderCell, onMouseLeaveBoard) => (
    <div className="inline-flex flex-col select-none" onMouseLeave={onMouseLeaveBoard}>
      <div className="flex">
        <div className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 shrink-0" />
        {Array.from({ length: BOARD_SIZE }, (_, c) => (
          <div key={c} className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 flex items-center justify-center text-[10px] sm:text-xs font-bold text-slate-400 shrink-0">{c + 1}</div>
        ))}
      </div>
      {ROW_LABELS.map((label, r) => (
        <div key={label} className="flex">
          <div className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 flex items-center justify-center text-[10px] sm:text-xs font-bold text-slate-400 shrink-0">{label}</div>
          {Array.from({ length: BOARD_SIZE }, (_, c) => renderCell(r, c))}
        </div>
      ))}
    </div>
  );

  const renderSetupMyCell = (r, c) => {
    const occupantId = occupancy[cellKey(r, c)];
    const inPreview = previewSet.has(cellKey(r, c));
    let cls = 'bg-slate-800/60 border-slate-700 hover:border-slate-500';
    if (occupantId) cls = 'bg-indigo-600/70 border-indigo-400';
    if (inPreview) cls = previewInfo.valid ? 'bg-emerald-500/60 border-emerald-300' : 'bg-red-500/50 border-red-300';
    const shaking = occupantId && shakeShipId === occupantId;
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
        className={`w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 border shrink-0 transition-colors ${cls} ${setupLocked ? 'cursor-default' : 'cursor-pointer'} ${shaking ? 'animate-[shake_0.35s_ease-in-out]' : ''}`}
        title={occupantId ? 'Çevirmek için çift tıkla / sağ tıkla' : undefined}
      />
    );
  };

  const renderLockedCell = (r, c) => (
    <div key={c} className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 border border-slate-700/60 bg-slate-800/30 shrink-0" />
  );

  // FAZ 2 — "Kendi Filom": kendi gemilerim (sabit) + rakibin bana yaptığı
  // atışların üstten gösterimi (isabet: alev/kızıl, ıska: damla/mavi).
  const renderBattleMyCell = (r, c) => {
    const key = cellKey(r, c);
    const shipId = myShips.find((s) => s.cells.some((cell) => cell.row === r && cell.col === c))?.id || null;
    const shot = opponentShotMap[key];
    const sunk = shipId && mySunkShipIds.has(shipId);
    let cls = 'bg-slate-800/60 border-slate-700';
    if (shipId) cls = 'bg-indigo-600/70 border-indigo-400';
    if (sunk) cls = 'bg-amber-600/80 border-amber-300 ring-1 ring-amber-300';
    else if (shot?.hit) cls = 'bg-red-600/70 border-red-400';
    else if (shot && !shot.hit) cls = 'bg-sky-900/50 border-sky-700';
    return (
      <div key={c} className={`w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 border shrink-0 transition-colors flex items-center justify-center ${cls}`}>
        {sunk ? <Skull className="w-3.5 h-3.5 text-amber-100" /> : shot?.hit ? <Flame className="w-3.5 h-3.5 text-red-100" /> : shot ? <Droplet className="w-3 h-3 text-sky-200" /> : null}
      </div>
    );
  };

  // FAZ 2 — "Hedef Tahtası": SADECE bu tahtaya atış yapılabilir. Kendi
  // atışlarımın sonucu + batırdığım gemilerin tam hatları burada belirginleşir.
  const renderBattleTargetCell = (r, c) => {
    const key = cellKey(r, c);
    const shot = myShotMap[key];
    const sunkShip = opponentShips.find((s) => opponentSunkShipIds.has(s.id) && s.cells.some((cell) => cell.row === r && cell.col === c));
    const clickable = isMyTurn && !shot;
    let cls = 'bg-sky-950/40 border-slate-700';
    if (sunkShip) cls = 'bg-amber-600/80 border-amber-300 ring-1 ring-amber-300';
    else if (shot?.hit) cls = 'bg-red-600/70 border-red-400';
    else if (shot && !shot.hit) cls = 'bg-sky-900/50 border-sky-700';
    else if (clickable) cls = 'bg-sky-950/40 border-slate-700 hover:border-sky-400 hover:bg-sky-900/40';
    return (
      <div
        key={c}
        onClick={() => handleShoot(r, c)}
        className={`w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 border shrink-0 transition-colors flex items-center justify-center ${cls} ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
        title={sunkShip ? `${sunkShip.name} battı!` : undefined}
      >
        {sunkShip ? <Skull className="w-3.5 h-3.5 text-amber-100" /> : shot?.hit ? <Flame className="w-3.5 h-3.5 text-red-100" /> : shot ? <Droplet className="w-3 h-3 text-sky-200" /> : null}
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
      <style>{`
        @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
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
                    className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border transition-colors ${
                      isPlaced ? 'bg-slate-800/40 border-slate-700 opacity-50' :
                      isSelected ? 'bg-indigo-600/25 border-indigo-400 cursor-pointer' :
                      `bg-slate-800/80 border-slate-600 hover:border-indigo-400 ${setupLocked ? '' : 'cursor-pointer'}`
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Ship className="w-4 h-4 text-sky-400 shrink-0" />
                      <span className="text-xs sm:text-sm font-medium text-slate-200 truncate">{def.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className={`flex ${isSelected && pendingOrientation === 'V' ? 'flex-col' : 'flex-row'} gap-0.5`}>
                        {Array.from({ length: def.length }, (_, i) => (
                          <div key={i} className="w-3 h-3 sm:w-3.5 sm:h-3.5 bg-sky-500 rounded-sm" />
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
            {roomData.setupPhase ? renderGrid(renderLockedCell) : renderGrid(renderBattleTargetCell)}
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
