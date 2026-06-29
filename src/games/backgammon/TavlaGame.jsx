import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Users, Loader2, X, Check, Crown, ArrowUpDown, Undo2 } from 'lucide-react';
import { doc, updateDoc, runTransaction } from 'firebase/firestore';
import { playSound } from '../../utils/sound.js';
import { rollDie, createInitialBoard, applyMove, getStrictValidMoves } from './logic.js';

export default function TavlaGame({ roomData, roomCode, user, db, appId, leaveRoom }) {
  const p1Uid = roomData.players?.[0]; const p2Uid = roomData.players?.[1];
  const isSpectator = !roomData.players?.includes(user.uid);
  const myColor = roomData.playerColors?.[user.uid] || null;
  const isMyTurn = roomData.turn === user.uid && !isSpectator;
  const myPhase = roomData.phase;

  const [selectedPoint, setSelectedPoint] = useState(null);
  const [gameToast, setGameToast] = useState(null); 
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [spectatorFlipped, setSpectatorFlipped] = useState(false);
  
  const toastTimeoutRef = useRef(null);
  const showToast = (msg) => {
    playSound('error'); setGameToast(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setGameToast(null), 3000);
  };
  useEffect(() => { return () => { if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current); }; }, []);

  const p1Name = roomData.playerNames?.[p1Uid] || 'Oyuncu 1'; const p2Name = roomData.playerNames?.[p2Uid] || 'Oyuncu 2';
  const p1Score = roomData.scores?.[p1Uid] || 0; const p2Score = roomData.scores?.[p2Uid] || 0;
  const p1Color = roomData.playerColors?.[p1Uid] || 'white'; const p2Color = roomData.playerColors?.[p2Uid] || 'black';

  const board = useMemo(() => {
    // Tavla tahtası iç içe dizilerden oluştuğu için derin kopyalama (Deep Copy) zorunludur.
    if (!roomData.board || !Array.isArray(roomData.board) || roomData.board.length !== 24) {
        return createInitialBoard();
    }
    // Sadece destekleyen modern tarayıcılarda structuredClone, yoksa klasik JSON kopyalama
    try {
        return structuredClone(roomData.board);
    } catch (e) {
        return JSON.parse(JSON.stringify(roomData.board));
    }
 }, [roomData.board]);
  
  const dice = roomData.dice || []; const usedDice = roomData.usedDice || [];
  const barW = roomData.bar?.white || 0; const barB = roomData.bar?.black || 0;
  const borneW = roomData.borneOff?.white || 0; const borneB = roomData.borneOff?.black || 0;
  
  const diceStr = dice.join(','); const usedDiceStr = usedDice.join(',');
  const remainingDice = useMemo(() => {
    const d = [...dice]; const u = [...usedDice];
    for (const v of u) { const i = d.indexOf(v); if (i !== -1) d.splice(i, 1); }
    return d;
  }, [diceStr, usedDiceStr]);

  const remainingDiceStr = remainingDice.join(',');
  const validMoves = useMemo(() => {
    if (isMyTurn && myPhase === 'moving' && remainingDice.length > 0) {
      return getStrictValidMoves(board, myColor, remainingDice, {white: barW, black: barB}, {white: borneW, black: borneB});
    }
    return [];
  }, [isMyTurn, myPhase, remainingDiceStr, board, myColor, barW, barB, borneW, borneB]);

  const validFromPoints = new Set(validMoves.map(m => m.from));
  const validToPoints = selectedPoint !== null ? new Set(validMoves.filter(m => m.from === selectedPoint).map(m => m.to)) : new Set();
  
  const canBearOff = validToPoints.has(myColor === 'white' ? 24 : -1);

  const handleRollDice = async () => {
    if (isSubmitting || isSpectator || roomData.winner) return;
    setIsSubmitting(true); playSound('dice');
    try {
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
      
      if (myPhase === 'opening') {
         const roll = rollDie();
         
         await runTransaction(db, async (transaction) => {
             const snap = await transaction.get(roomRef);
             if (!snap.exists()) return;
             const data = snap.data();
             const currentRolls = data.openingRolls || { p1: null, p2: null };
             const myKey = myColor === 'white' ? 'p1' : 'p2';
             if (currentRolls[myKey] !== null) return; 
             
             currentRolls[myKey] = roll;
             
             if (currentRolls.p1 !== null && currentRolls.p2 !== null) {
                 if (currentRolls.p1 === currentRolls.p2) {
                     transaction.update(roomRef, { openingRolls: currentRolls }); 
                 } else {
                     const p1Starts = currentRolls.p1 > currentRolls.p2;
                     const p1Col = data.playerColors[p1Uid];
                     const starterUid = p1Col === 'white' ? (p1Starts ? p1Uid : p2Uid) : (p1Starts ? p2Uid : p1Uid);
                     transaction.update(roomRef, { 
                         openingRolls: currentRolls, turn: starterUid, startingPlayer: starterUid, phase: 'moving', 
                         dice: [currentRolls.p1, currentRolls.p2].sort((a,b)=>b-a), usedDice: [],
                         initialTurnState: { board: data.board, bar: data.bar, borneOff: data.borneOff }
                     });
                 }
             } else {
                 transaction.update(roomRef, { openingRolls: currentRolls });
             }
         });
         setIsSubmitting(false); return;
      }

      if (!isMyTurn || myPhase !== 'rolling') { setIsSubmitting(false); return; }

      const d1 = rollDie(); const d2 = rollDie(); const finalDice = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
      const moves = getStrictValidMoves(board, myColor, finalDice, {white: barW, black: barB}, {white: borneW, black: borneB});
      if (moves.length === 0) {
        showToast("Geçerli hamle yok! Sıra geçiyor...");
        const oppUid = roomData.players.find(id => id !== user.uid) || null;
        await updateDoc(roomRef, { dice: finalDice, usedDice: finalDice, phase: 'rolling', turn: oppUid });
      } else { 
        await updateDoc(roomRef, { 
          dice: finalDice, usedDice: [], phase: 'moving',
          initialTurnState: { board: roomData.board, bar: roomData.bar, borneOff: roomData.borneOff }
        }); 
      }
    } catch (err) { showToast("Ağ hatası: Zar atılamadı."); } 
    finally { setIsSubmitting(false); }
  };

  useEffect(() => {
     if (myPhase === 'opening' && roomData.openingRolls?.p1 && roomData.openingRolls?.p2 && roomData.openingRolls.p1 === roomData.openingRolls.p2) {
         showToast("Zarlar eşit! Tekrar atılacak.");
         const timer = setTimeout(() => {
             updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { openingRolls: { p1: null, p2: null } }).catch(()=>{});
         }, 1500);
         return () => clearTimeout(timer);
     }
  }, [roomData.openingRolls?.p1, roomData.openingRolls?.p2, myPhase, roomCode, appId, db]);

  const handlePointClick = async (pointIdx) => {
    if (!isMyTurn || myPhase !== 'moving' || isSubmitting) return;

    if (selectedPoint === null) {
      const myBarCount = myColor === 'white' ? barW : barB;
      if (myBarCount > 0 && pointIdx !== 'bar') return; 
      if (pointIdx === 'bar') { if (validFromPoints.has(-1)) setSelectedPoint(-1); return; }
      if (validFromPoints.has(pointIdx)) setSelectedPoint(pointIdx);
    } else {
      if (pointIdx === selectedPoint || (pointIdx === 'bar' && selectedPoint !== -1)) { setSelectedPoint(null); return; }
      const targetIdx = pointIdx; const movesForFrom = validMoves.filter(m => m.from === selectedPoint && m.to === targetIdx);
      if (movesForFrom.length === 0) {
        if (validFromPoints.has(pointIdx)) setSelectedPoint(pointIdx); else setSelectedPoint(null); return;
      }
      setIsSubmitting(true);
      try {
        const move = movesForFrom.sort((a, b) => a.die - b.die)[0];
        const { board: newBoard, bar: newBar, borneOff: newBorneOff } = applyMove(board, {white: barW, black: barB}, {white: borneW, black: borneB}, myColor, selectedPoint, targetIdx);
        playSound((board[targetIdx] && board[targetIdx].color !== null && board[targetIdx].color !== myColor) ? 'capture' : 'move');

        const newUsedDice = [...usedDice, move.die];
        const newRemainingDice = (() => { const d = [...dice]; const u = [...newUsedDice]; for (const v of u) { const i = d.indexOf(v); if (i !== -1) d.splice(i, 1); } return d; })();
        setSelectedPoint(null);

        if (newBorneOff[myColor] >= 15) {
          playSound('win');
          const oppColor = myColor === 'white' ? 'black' : 'white';
          let pointsWon = 1;
          if (newBorneOff[oppColor] === 0) {
             let hasBackgammon = newBar[oppColor] > 0;
             if (!hasBackgammon) {
                 const mS = myColor === 'white' ? 18 : 0; const mE = myColor === 'white' ? 23 : 5;
                 for(let i=mS; i<=mE; i++) { if (newBoard[i]?.color === oppColor) hasBackgammon = true; }
             }
             pointsWon = hasBackgammon ? 3 : 2; 
          }
          const finalScore = (roomData.scores?.[user.uid] || 0) + (pointsWon * (roomData.cubeValue || 1));
          await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { board: newBoard, bar: newBar, borneOff: newBorneOff, dice, usedDice: newUsedDice, winner: user.uid, scores: { ...roomData.scores, [user.uid]: finalScore }, phase: 'rolling', turn: null, cubeOfferBy: null });
          return;
        }

        const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
        if (newRemainingDice.length === 0) {
          const nextTurnUid = roomData.players.find(id => id !== user.uid) || null;
          await updateDoc(roomRef, { board: newBoard, bar: newBar, borneOff: newBorneOff, dice, usedDice: newUsedDice, phase: 'rolling', turn: nextTurnUid });
        } else {
          const nextMoves = getStrictValidMoves(newBoard, myColor, newRemainingDice, newBar, newBorneOff);
          if (nextMoves.length === 0) {
            showToast("Kalan zarlar için geçerli hamle yok! Sıra geçiyor...");
            const nextTurnUid = roomData.players.find(id => id !== user.uid) || null;
            await updateDoc(roomRef, { board: newBoard, bar: newBar, borneOff: newBorneOff, dice, usedDice: newUsedDice.concat(newRemainingDice), phase: 'rolling', turn: nextTurnUid });
          } else {
            await updateDoc(roomRef, { board: newBoard, bar: newBar, borneOff: newBorneOff, dice, usedDice: newUsedDice, phase: 'moving', turn: user.uid });
          }
        }
      } catch(err) { showToast("Hamle yapılamadı."); } finally { setIsSubmitting(false); }
    }
  };

  const handleUndoMove = async () => {
    if (!isMyTurn || myPhase !== 'moving' || isSubmitting || !roomData.initialTurnState) return;
    setIsSubmitting(true);
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), {
            board: roomData.initialTurnState.board,
            bar: roomData.initialTurnState.bar,
            borneOff: roomData.initialTurnState.borneOff,
            usedDice: []
        });
        setSelectedPoint(null);
    } catch(e) { showToast("Geri alınamadı."); }
    finally { setIsSubmitting(false); }
  };

  const handleCubeOffer = async () => {
     if (!isMyTurn || myPhase !== 'rolling' || roomData.winner || isSubmitting) return; 
     if (roomData.cubeOwner !== null && roomData.cubeOwner !== user.uid) { showToast("Küp rakipte!"); return; }
     setIsSubmitting(true);
     try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { cubeOfferBy: user.uid }); } 
     catch(err) { showToast("Küp teklif edilemedi."); } finally { setIsSubmitting(false); }
  };
  
  const answerCube = async (accept) => {
     if (isSpectator || roomData.cubeOfferBy === user.uid) return;
     setIsSubmitting(true); const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
     try {
       if (accept) { await updateDoc(roomRef, { cubeValue: (roomData.cubeValue || 1) * 2, cubeOwner: user.uid, cubeOfferBy: null }); } 
       else {
         playSound('win'); const oppUid = roomData.cubeOfferBy; const finalScore = (roomData.scores?.[oppUid] || 0) + (roomData.cubeValue || 1);
         await updateDoc(roomRef, { winner: oppUid, scores: { ...roomData.scores, [oppUid]: finalScore }, cubeOfferBy: null, turn: null });
       }
     } catch(err) { showToast("Hata oluştu."); } finally { setIsSubmitting(false); }
  };
  
  const handleBearOffClick = async () => { if (!isMyTurn || myPhase !== 'moving' || selectedPoint === null) return; await handlePointClick(myColor === 'white' ? 24 : -1); };
  
  const requestRematch = async () => { if (isSpectator) return; await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { rematchRequestedBy: user.uid }); };
  const acceptRematch = async () => {
    if (isSpectator) return; const nextStarter = roomData.players.find(id => id !== roomData.startingPlayer) || roomData.players[0];
    const newColors = {}; for (const uid of roomData.players) newColors[uid] = roomData.playerColors[uid] === 'white' ? 'black' : 'white';
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { board: createInitialBoard(), bar: { white: 0, black: 0 }, borneOff: { white: 0, black: 0 }, dice: [], usedDice: [], phase: 'opening', openingRolls: {p1: null, p2: null}, turn: null, startingPlayer: nextStarter, playerColors: newColors, winner: null, rematchRequestedBy: null, cubeValue: 1, cubeOwner: null, cubeOfferBy: null, initialTurnState: null });
  };
  const rejectRematch = async () => { if (isSpectator) return; await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { status: 'closed', closedBy: user.uid }); };

  const isWhitePerspective = isSpectator ? !spectatorFlipped : myColor === 'white';
  const topPoints = isWhitePerspective ? Array.from({ length: 12 }, (_, i) => 12 + i) : Array.from({ length: 12 }, (_, i) => 11 - i);
  const bottomPoints = isWhitePerspective ? Array.from({ length: 12 }, (_, i) => 11 - i) : Array.from({ length: 12 }, (_, i) => 12 + i);

  const topBarColor = isWhitePerspective ? 'black' : 'white'; const topBarCount = isWhitePerspective ? barB : barW;
  const bottomBarColor = isWhitePerspective ? 'white' : 'black'; const bottomBarCount = isWhitePerspective ? barW : barB;

  const renderCheckers = (color, count, isTop, pointIdx) => {
    const isSelected = selectedPoint === pointIdx; const showCount = Math.max(0, Math.min(count || 0, 5));
    return (
      <div className={`absolute ${isTop ? 'top-1' : 'bottom-1'} flex flex-col ${isTop ? '' : 'flex-col-reverse'} items-center gap-[1px] w-full z-10 pointer-events-none`}>
        {Array.from({ length: showCount }).map((_, i) => (
          <div key={i} className={`w-[14px] h-[14px] sm:w-[24px] sm:h-[24px] md:w-[30px] md:h-[30px] rounded-full flex items-center justify-center text-[8px] sm:text-[10px] md:text-xs font-bold shadow-md transition-transform duration-200 ${color === 'white' ? 'bg-slate-100 border-2 border-slate-400 text-slate-800' : 'bg-slate-800 border-2 border-slate-600 text-slate-100'} ${isSelected ? 'ring-2 ring-yellow-400 scale-110' : ''}`}>
            {i === (isTop ? showCount - 1 : 0) && (count > 5) ? `+${count - 5}` : ''}
          </div>
        ))}
      </div>
    );
  };

  const renderPoint = (pointIdx, isTop) => {
    const pt = board[pointIdx] || { count: 0, color: null };
    const isValidFrom = isMyTurn && myPhase === 'moving' && validFromPoints.has(pointIdx) && selectedPoint !== pointIdx;
    const isValidTo = selectedPoint !== null && validToPoints.has(pointIdx);
    const isDark = (isTop ? topPoints.indexOf(pointIdx) : bottomPoints.indexOf(pointIdx)) % 2 === 0;
    const clickable = isMyTurn && myPhase === 'moving' && (!((myColor === 'white' ? barW : barB) > 0) || selectedPoint === -1);
    return (
      <div key={pointIdx} onClick={() => clickable && handlePointClick(pointIdx)} className={`relative flex-1 flex flex-col items-center h-full group ${isValidFrom || isValidTo ? 'cursor-pointer' : 'cursor-default'}`}>
        <svg preserveAspectRatio="none" viewBox="0 0 100 100" className={`absolute inset-0 w-full h-full transition-all ${selectedPoint === pointIdx ? 'opacity-80' : 'opacity-60'} ${isValidTo ? 'drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]' : ''}`}>
          <polygon points={isTop ? "0,0 100,0 50,100" : "0,100 100,100 50,0"} fill={isValidTo ? '#10b981' : (isDark ? '#7f1d1d' : '#475569')} />
        </svg>
        {isValidFrom && <div className="absolute inset-x-0 inset-y-1 ring-2 ring-indigo-400 ring-inset rounded-sm pointer-events-none" />}
        {selectedPoint === pointIdx && <div className="absolute inset-x-0 inset-y-1 bg-yellow-400/20 ring-2 ring-yellow-400 rounded-sm pointer-events-none" />}
        <div className={`absolute ${isTop ? 'bottom-0' : 'top-0'} text-[8px] sm:text-[10px] text-slate-300 font-mono font-bold opacity-50 pointer-events-none`}>{pointIdx + 1}</div>
        {pt.count > 0 && renderCheckers(pt.color, pt.count, isTop, pointIdx)}
      </div>
    );
  };

  const renderDie = (val, used = false, isPlaceholder = false) => {
    const dots = { 1:[[50,50]], 2:[[25,25],[75,75]], 3:[[25,25],[50,50],[75,75]], 4:[[25,25],[75,25],[25,75],[75,75]], 5:[[25,25],[75,25],[50,50],[25,75],[75,75]], 6:[[25,20],[75,20],[25,50],[75,50],[25,80],[75,80]] };
    return (
      <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg relative border-2 transition-all flex items-center justify-center ${used ? 'border-slate-600 bg-slate-700 opacity-40' : 'border-slate-300 bg-slate-100 shadow-lg'} ${isPlaceholder ? 'opacity-30 border-dashed' : ''}`}>
         {val ? (<svg viewBox="0 0 100 100" className="w-full h-full absolute inset-0">{dots[val]?.map((c, i) => <circle key={i} cx={c[0]} cy={c[1]} r="10" fill={used ? '#64748b' : '#0f172a'} />)}</svg>) : ( <span className="text-slate-400 font-bold">?</span> )}
      </div>
    );
  };

  const hasMyBar = myColor && (myColor === 'white' ? barW : barB) > 0;
  const canOfferCube = !isSpectator && myPhase === 'rolling' && (roomData.cubeOwner === user.uid || roomData.cubeOwner === null);

  const whiteUid = Object.keys(roomData.playerColors || {}).find(uid => roomData.playerColors[uid] === 'white') || p1Uid;
  const blackUid = Object.keys(roomData.playerColors || {}).find(uid => roomData.playerColors[uid] === 'black') || p2Uid;
  const whiteName = roomData.playerNames?.[whiteUid] || 'Beyaz';
  const blackName = roomData.playerNames?.[blackUid] || 'Siyah';

  return (
    <div className="relative w-full max-w-4xl flex flex-col items-center gap-4 bg-gradient-to-br from-amber-900/40 via-slate-900/80 to-yellow-900/40 p-4 md:p-6 rounded-[2rem] border border-amber-500/30 shadow-[0_0_40px_rgba(217,119,6,0.15)] overflow-hidden">
      {gameToast && <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-red-500/90 text-white px-6 py-3 rounded-xl shadow-2xl font-bold border border-red-400 transition-all duration-300 transform scale-100 opacity-100 pointer-events-none text-center">{gameToast}</div>}
      
      {roomData.cubeOfferBy && !roomData.winner && (
         <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center backdrop-blur-sm rounded-[2rem]">
            <div className="bg-slate-800 p-8 rounded-2xl border border-amber-500 text-center max-w-sm">
               <h3 className="text-2xl font-bold text-white mb-2">Çiftleme Küpü</h3>
               <p className="text-slate-300 mb-6">Rakibiniz oyunu <b>{(roomData.cubeValue || 1) * 2}</b> puan değerine çıkarmak istiyor.</p>
               {roomData.cubeOfferBy !== user.uid && !isSpectator ? (
                  <div className="flex gap-4">
                    <button onClick={()=>answerCube(true)} disabled={isSubmitting} className="flex-1 bg-green-600 hover:bg-green-500 py-3 rounded-xl font-bold text-white shadow-lg">Kabul Et</button>
                    <button onClick={()=>answerCube(false)} disabled={isSubmitting} className="flex-1 bg-red-600 hover:bg-red-500 py-3 rounded-xl font-bold text-white shadow-lg">Çekil (Kaybet)</button>
                  </div>
               ) : ( <div className="flex items-center justify-center gap-2 text-amber-400"><Loader2 className="w-5 h-5 animate-spin" /> {isSpectator ? "Oyuncunun kararı bekleniyor..." : "Rakibin kararı bekleniyor..."}</div> )}
            </div>
         </div>
      )}

      <div className="w-full flex items-center justify-between bg-slate-900/80 rounded-xl p-3 border border-amber-500/30">
        <div className={`flex flex-col items-start flex-1 min-w-0 pr-2 p-1 rounded-lg transition-colors ${roomData.turn === p1Uid ? 'bg-slate-700/50 ring-1 ring-amber-400/50' : ''}`}>
          <div className="flex items-center gap-2 w-full"><div className={`w-4 h-4 rounded-full border-2 shrink-0 ${p1Color === 'white' ? 'bg-slate-100 border-slate-300' : 'bg-slate-800 border-slate-500'}`} /><div className="text-sm font-bold text-slate-200 truncate">{p1Name} {p1Uid === user.uid && !isSpectator ? '(Sen)' : ''}</div>{p1Score > p2Score && <Crown className="w-4 h-4 text-yellow-400 shrink-0" />}</div>
          <div className="text-[10px] sm:text-xs text-slate-400 mt-1 truncate">{p1Color === 'white' ? 'Beyaz' : 'Siyah'} • {p1Color === 'white' ? borneW : borneB}/15 çıktı</div>
        </div>
        <div className="flex flex-col items-center px-4 shrink-0 group">
           <div className="text-lg font-mono font-bold">{p1Score} — {p2Score}</div>
           <div className="text-[10px] text-slate-500 font-bold tracking-widest flex items-center gap-1"><Users className="w-3 h-3"/> {roomData.spectators?.length || 0}</div>
        </div>
        <div className={`flex flex-col items-end flex-1 min-w-0 pl-2 text-right p-1 rounded-lg transition-colors ${roomData.turn === p2Uid ? 'bg-slate-700/50 ring-1 ring-amber-400/50' : ''}`}>
          <div className="flex items-center justify-end gap-2 w-full">{p2Score > p1Score && <Crown className="w-4 h-4 text-yellow-400 shrink-0" />}<div className="text-sm font-bold text-slate-200 truncate">{p2Name} {p2Uid === user.uid && !isSpectator ? '(Sen)' : ''}</div><div className={`w-4 h-4 rounded-full border-2 shrink-0 ${p2Color === 'white' ? 'bg-slate-100 border-slate-300' : 'bg-slate-800 border-slate-500'}`} /></div>
          <div className="text-[10px] sm:text-xs text-slate-400 mt-1 truncate">{p2Color === 'white' ? 'Beyaz' : 'Siyah'} • {p2Color === 'white' ? borneW : borneB}/15 çıktı</div>
        </div>
      </div>

      <div className="w-full flex justify-between items-end mb-2 px-2">
         {isSpectator && <button onClick={() => setSpectatorFlipped(!spectatorFlipped)} className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded flex items-center gap-1 transition-colors"><ArrowUpDown className="w-3 h-3" /> Tahtayı Çevir</button>}
         <div className={`text-center font-bold text-lg drop-shadow-md flex-grow ${roomData.winner ? 'text-yellow-400' : (isMyTurn || (myPhase==='opening' && !roomData.openingRolls?.[myColor==='white'?'p1':'p2'])) ? 'text-amber-400' : 'text-slate-400'}`}>
           {roomData.winner ? `🏆 ${roomData.winner === p1Uid ? p1Name : p2Name} Kazandı!` : myPhase === 'opening' ? 'Açılış Zarları Bekleniyor...' : isMyTurn ? (myPhase === 'rolling' ? 'Zarları At!' : 'Hamle Yap') : `${roomData.turn === p1Uid ? p1Name : p2Name} düşünüyor...`}
         </div>
         <button disabled={!isMyTurn || isSpectator || myPhase !== 'rolling' || (roomData.cubeOwner !== null && roomData.cubeOwner !== user.uid)} className={`bg-amber-600 text-white text-xs font-bold px-3 py-1.5 rounded flex items-center gap-1 transition-colors disabled:opacity-50 ${(!isSpectator && myPhase === 'rolling' && (roomData.cubeOwner === user.uid || roomData.cubeOwner === null)) ? 'hover:bg-amber-500' : ''}`} onClick={handleCubeOffer} title={isSpectator ? "Küp Değeri" : roomData.cubeOwner === user.uid || roomData.cubeOwner === null ? "Bahsi Katla" : "Küp Rakipte"}>
            KÜP: x{roomData.cubeValue || 1}
         </button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4 bg-slate-900/80 rounded-xl px-4 sm:px-6 py-3 border border-slate-700 shadow-inner min-h-[64px]">
        {myPhase === 'opening' ? (
           <div className="flex gap-8 items-center text-center">
              <div><div className="text-xs text-slate-400 mb-1">{whiteName}</div>{renderDie(roomData.openingRolls?.p1)}</div>
              <div className="text-slate-500 font-bold text-sm">VS</div>
              <div><div className="text-xs text-slate-400 mb-1">{blackName}</div>{renderDie(roomData.openingRolls?.p2)}</div>
              {!isSpectator && !roomData.openingRolls?.[myColor==='white'?'p1':'p2'] && ( <button onClick={handleRollDice} disabled={isSubmitting} className="ml-4 bg-amber-600 hover:bg-amber-500 px-4 py-2 rounded-lg font-bold text-sm transition-colors shadow-lg text-white disabled:opacity-50">Zar At</button> )}
           </div>
        ) : (
           <>
              <div className="flex flex-col items-center">
                 <div className="text-[10px] text-slate-500 mb-1 font-bold tracking-widest">{isMyTurn ? 'SENİN ZARLARIN' : 'RAKİBİN ZARLARI'}</div>
                 <div className="flex gap-2">
                    {remainingDice.length > 0 ? remainingDice.map((val, i) => <div key={i}>{renderDie(val, false)}</div>) : dice.length > 0 ? dice.map((val, i) => <div key={i}>{renderDie(val, true)}</div>) : <>{renderDie(null, false, true)}{renderDie(null, false, true)}</>}
                 </div>
              </div>
              {isMyTurn && myPhase === 'rolling' && !roomData.winner && ( <button onClick={handleRollDice} disabled={isSubmitting} className="bg-amber-600 hover:bg-amber-500 px-4 sm:px-5 py-2 rounded-lg font-bold text-sm sm:text-base transition-colors shadow-lg text-white disabled:opacity-50">🎲 Zar At</button> )}
              {isMyTurn && myPhase === 'moving' && remainingDice.length > 0 && usedDice.length > 0 && (
                 <button onClick={handleUndoMove} disabled={isSubmitting} className="ml-2 text-amber-500 hover:text-amber-400 underline decoration-amber-500/30 underline-offset-4 flex items-center gap-1 text-sm font-medium transition-colors disabled:opacity-50"><Undo2 className="w-4 h-4" /> Geri Al</button>
              )}
           </>
        )}
      </div>

      <div className="relative w-full aspect-[3/4] sm:aspect-square md:aspect-[4/3] max-w-3xl bg-amber-950/80 border-4 border-amber-900 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.5)] flex flex-col p-1 sm:p-2">
        <div className="flex-1 w-full flex">
          <div className="flex-1 flex gap-[1px]">{topPoints.slice(0, 6).map(idx => renderPoint(idx, true))}</div>
          <div onClick={() => isMyTurn && myPhase === 'moving' && myColor === topBarColor && handlePointClick('bar')} className={`w-8 sm:w-12 md:w-16 flex flex-col items-center pt-2 bg-[#290f02]/90 border-x-[4px] sm:border-x-[8px] border-[#1a0901] shadow-[inset_0_0_15px_rgba(0,0,0,1)] cursor-pointer relative z-10 transition-colors ${(hasMyBar && myColor===topBarColor && isMyTurn) ? 'bg-amber-900/40 ring-2 ring-yellow-400 ring-inset animate-pulse' : ''} ${selectedPoint === -1 && myColor === topBarColor ? 'ring-2 ring-yellow-400 bg-yellow-900/50 animate-none' : ''}`}>
             {Array.from({ length: Math.max(0, Math.min(topBarCount, 4)) }).map((_, i) => ( <div key={i} className={`w-[18px] h-[18px] sm:w-[24px] sm:h-[24px] md:w-[30px] md:h-[30px] rounded-full border-2 flex items-center justify-center text-[8px] md:text-xs font-bold mb-1 shadow-md ${topBarColor === 'white' ? 'bg-slate-100 border-slate-400 text-slate-800' : 'bg-slate-800 border-slate-600 text-slate-100'}`}>{i === 3 && topBarCount > 4 ? `+${topBarCount - 3}` : ''}</div> ))}
          </div>
          <div className="flex-1 flex gap-[1px]">{topPoints.slice(6, 12).map(idx => renderPoint(idx, true))}</div>
        </div>
        <div className="h-8 sm:h-12 md:h-14 w-full flex items-center justify-center bg-[#290f02] my-1 sm:my-2 border-y-[6px] border-[#1a0901] shadow-[inset_0_0_15px_rgba(0,0,0,0.8)] relative z-20"><div className="text-[10px] sm:text-xs text-amber-700/30 font-black tracking-widest uppercase">Menteşe</div></div>
        <div className="flex-1 w-full flex">
          <div className="flex-1 flex gap-[1px]">{bottomPoints.slice(0, 6).map(idx => renderPoint(idx, false))}</div>
          <div onClick={() => isMyTurn && myPhase === 'moving' && myColor === bottomBarColor && handlePointClick('bar')} className={`w-8 sm:w-12 md:w-16 flex flex-col-reverse items-center pb-2 bg-[#290f02]/90 border-x-[4px] sm:border-x-[8px] border-[#1a0901] shadow-[inset_0_0_15px_rgba(0,0,0,1)] cursor-pointer relative z-10 transition-colors ${(hasMyBar && myColor===bottomBarColor && isMyTurn) ? 'bg-amber-900/40 ring-2 ring-yellow-400 ring-inset animate-pulse' : ''} ${selectedPoint === -1 && myColor === bottomBarColor ? 'ring-2 ring-yellow-400 bg-yellow-900/50 animate-none' : ''}`}>
             {Array.from({ length: Math.max(0, Math.min(bottomBarCount, 4)) }).map((_, i) => ( <div key={i} className={`w-[18px] h-[18px] sm:w-[24px] sm:h-[24px] md:w-[30px] md:h-[30px] rounded-full border-2 flex items-center justify-center text-[8px] md:text-xs font-bold mt-1 shadow-md ${bottomBarColor === 'white' ? 'bg-slate-100 border-slate-400 text-slate-800' : 'bg-slate-800 border-slate-600 text-slate-100'}`}>{i === 3 && bottomBarCount > 4 ? `+${bottomBarCount - 3}` : ''}</div> ))}
          </div>
          <div className="flex-1 flex gap-[1px]">{bottomPoints.slice(6, 12).map(idx => renderPoint(idx, false))}</div>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-4 items-center w-full mt-2">
        <div onClick={handleBearOffClick} className={`flex items-center gap-3 p-3 sm:px-6 rounded-xl border-2 transition-all cursor-pointer ${canBearOff ? 'border-emerald-400 bg-emerald-500/20 shadow-[0_0_15px_rgba(52,211,153,0.4)]' : 'border-slate-700 bg-slate-800/60 cursor-default'}`}>
          <div className="text-xs sm:text-sm text-slate-300 font-bold uppercase">Pulları Topla</div>
          <div className="flex gap-2">
            {['white', 'black'].map(color => (
              <div key={`bear-${color}`} className="flex flex-col items-center bg-slate-900/50 px-2 py-1 rounded">
                <div className={`w-3 h-3 rounded-full mb-1 ${color === 'white' ? 'bg-slate-100 border border-slate-400' : 'bg-slate-700 border border-slate-500'}`} />
                <div className="text-xs sm:text-sm font-mono font-bold text-slate-300">{color === 'white' ? borneW : borneB}</div>
              </div>
            ))}
          </div>
          {canBearOff && <div className="text-xs sm:text-sm text-emerald-400 font-bold bg-emerald-500/20 px-2 py-1 rounded animate-pulse">Tıkla!</div>}
        </div>
        {selectedPoint !== null && ( <div className="flex items-center text-xs sm:text-sm text-yellow-400 bg-yellow-400/10 border border-yellow-400/30 px-4 py-3 rounded-xl shadow-lg"><span>Seçili: Nokta <strong>{selectedPoint === -1 ? 'BAR' : selectedPoint + 1}</strong> — Hedef seç</span><button onClick={() => setSelectedPoint(null)} className="ml-3 p-1 bg-yellow-400/20 rounded hover:bg-yellow-400/40 text-yellow-200 transition-colors"><X className="w-4 h-4" /></button></div> )}
      </div>

      {roomData.winner && roomData.status !== 'abandoned' && (
        <div className="w-full max-w-lg bg-slate-900/90 backdrop-blur-md rounded-2xl p-6 border border-amber-500/30 shadow-2xl mt-4">
          {isSpectator ? ( <div className="text-slate-400 text-sm flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Oyuncuların kararı bekleniyor...</div> ) : !roomData.rematchRequestedBy ? (
            <button onClick={requestRematch} className="bg-amber-600 hover:bg-amber-500 w-full py-3 rounded-xl font-bold text-lg shadow-lg transition-all text-white hover:scale-[1.02]">Yeniden Oyna</button>
          ) : roomData.rematchRequestedBy === user.uid ? ( <div className="flex items-center justify-center gap-3 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /> Rakibin cevabı bekleniyor...</div> ) : (
            <div className="flex flex-col items-center w-full gap-4"><span className="text-amber-200 font-medium text-center text-lg drop-shadow-sm">Rakibiniz rövanş istiyor!</span>
              <div className="flex gap-4 w-full"><button onClick={acceptRematch} className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/40 text-green-400 border border-green-500/50 py-3 rounded-xl font-bold"><Check className="w-5 h-5" /> Kabul Et</button><button onClick={rejectRematch} className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/50 py-3 rounded-xl font-bold"><X className="w-5 h-5" /> Reddet</button></div>
            </div>
          )}
        </div>
      )}

      {roomData.status === 'abandoned' && (
        <div className="absolute inset-0 z-[100] bg-slate-900/80 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-[2rem] p-4 text-center transition-all duration-300 transform scale-100 opacity-100">
          <Loader2 className="w-12 h-12 animate-spin text-amber-500 mb-4 drop-shadow-lg" />
          <h3 className="text-xl font-bold text-white mb-2">Rakip Bekleniyor...</h3>
          <button onClick={leaveRoom} className="mt-8 bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50 px-6 py-2 rounded-lg font-medium transition-colors">Odadan Çık</button>
        </div>
      )}
    </div>
  );
}