import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Loader2, Check, X, Users, ArrowUpDown, Undo2, Handshake, Flag } from 'lucide-react';
import { doc, updateDoc, runTransaction } from 'firebase/firestore';
import { playSound } from '../../utils/sound.js';
import { CHESS_ICONS, PIECE_VALUES, chessPieceStyle } from './constants.js';
import { createInitialChessBoard, getStrictLegalMoves, isSquareAttacked, getBoardStateString, getGameState } from './logic.js';

export default function ChessGame({ roomData, roomCode, user, db, appId, leaveRoom }) {
  const p1Uid = roomData.players?.[0]; const p2Uid = roomData.players?.[1];
  const isSpectator = !roomData.players?.includes(user.uid);
  const myColor = roomData.playerColors?.[user.uid] || null;
  const isMyTurn = roomData.turn === user.uid && !isSpectator;

  const [selectedSquare, setSelectedSquare] = useState(null);
  const [promotionPrompt, setPromotionPrompt] = useState(null); 
  const [spectatorFlipped, setSpectatorFlipped] = useState(false); 
  const [isSubmitting, setIsSubmitting] = useState(false); 
  const [gameToast, setGameToast] = useState(null);
  const [resignConfirm, setResignConfirm] = useState(false); 
  
  const toastTimeoutRef = useRef(null);
  const showToast = (msg) => {
    playSound('error'); setGameToast(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setGameToast(null), 3000);
  };
  useEffect(() => { return () => { if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current); }; }, []);

  useEffect(() => { setSelectedSquare(null); }, [roomData.turn]);

  const boardStr = useMemo(() => getBoardStateString(roomData.board || [], roomData.enPassantTarget, roomData.turn), [roomData.board, roomData.enPassantTarget, roomData.turn]);
  
  const board = useMemo(() => (Array.isArray(roomData.board) && roomData.board.length === 64) ? roomData.board : Array(64).fill(null), [roomData.board]);
  
  const validMoves = useMemo(() => {
     return (selectedSquare !== null && isMyTurn) ? getStrictLegalMoves(board, selectedSquare, roomData.enPassantTarget) : [];
  }, [selectedSquare, isMyTurn, boardStr, roomData.enPassantTarget]);

  const inCheckKings = useMemo(() => {
     let kings = []; if (roomData.winner) return kings;
     let wK = -1, bK = -1;
     for(let i=0; i<64; i++){ if(board[i]?.type==='k'){ if(board[i].color==='w') wK=i; else bK=i; } }
     if (wK !== -1 && isSquareAttacked(board, wK, 'b', roomData.enPassantTarget)) kings.push(wK);
     if (bK !== -1 && isSquareAttacked(board, bK, 'w', roomData.enPassantTarget)) kings.push(bK);
     return kings;
  }, [boardStr, roomData.winner, roomData.enPassantTarget]);

  const prevInCheckRef = useRef(null);
  useEffect(() => {
     if (prevInCheckRef.current !== null) {
        if (inCheckKings.length > prevInCheckRef.current && !roomData.winner) playSound('check');
     }
     prevInCheckRef.current = inCheckKings.length;
  }, [inCheckKings.length, roomData.winner]);

  useEffect(() => { if (roomData.status === 'abandoned' || roomData.status === 'closed' || !isMyTurn) setPromotionPrompt(null); }, [roomData.status, isMyTurn]);

  const p1Name = roomData.playerNames?.[p1Uid] || 'Oyuncu 1'; const p2Name = roomData.playerNames?.[p2Uid] || 'Oyuncu 2';
  const p1Color = roomData.playerColors?.[p1Uid] || 'w'; const p2Color = roomData.playerColors?.[p2Uid] || 'b';
  const p1Score = roomData.scores?.[p1Uid] || 0; const p2Score = roomData.scores?.[p2Uid] || 0;

  const executeMove = async (from, to, movingPiece, targetPiece, currentBoard) => {
    if (movingPiece.type === 'k' && Math.abs(from - to) === 2) {
      if (to === 62) { currentBoard[61] = currentBoard[63]; currentBoard[61].hasMoved = true; currentBoard[63] = null; } 
      if (to === 58) { currentBoard[59] = currentBoard[56]; currentBoard[59].hasMoved = true; currentBoard[56] = null; } 
      if (to === 6)  { currentBoard[5] = currentBoard[7]; currentBoard[5].hasMoved = true; currentBoard[7] = null; }  
      if (to === 2)  { currentBoard[3] = currentBoard[0]; currentBoard[3].hasMoved = true; currentBoard[0] = null; }  
    }

    if (movingPiece.type === 'p' && to === roomData.enPassantTarget) {
       const captureIdx = movingPiece.color === 'w' ? to + 8 : to - 8;
       targetPiece = currentBoard[captureIdx]; currentBoard[captureIdx] = null;
    }

    playSound(targetPiece ? 'capture' : 'move');

    let newEnPassantTarget = null;
    if (movingPiece.type === 'p' && Math.abs(from - to) === 16) { newEnPassantTarget = movingPiece.color === 'w' ? from - 8 : from + 8; }

    movingPiece.hasMoved = true; currentBoard[to] = movingPiece; currentBoard[from] = null;

    const newCaptured = { w: [...(roomData.captured?.w || [])], b: [...(roomData.captured?.b || [])] };
    if (targetPiece && myColor) newCaptured[myColor].push(targetPiece.type);

    const oppUid = roomData.players.find(id => id !== user.uid) ?? null; 
    const oppColor = myColor === 'w' ? 'b' : 'w';

    let newHalfmoveClock = (roomData.halfmoveClock || 0) + 1;
    let newPositionHistory = [...(roomData.positionHistory || [])];
    
    if (movingPiece.type === 'p' || targetPiece) { 
       newHalfmoveClock = 0; 
       newPositionHistory = []; 
    } 
    
    newPositionHistory.push(getBoardStateString(currentBoard, newEnPassantTarget, oppColor));
    if (newPositionHistory.length > 100) newPositionHistory = newPositionHistory.slice(-100);

    const gameState = getGameState(currentBoard, oppColor, newHalfmoveClock, newPositionHistory, newEnPassantTarget);
    let newWinner = null, newDrawReason = null;
    
    if (gameState === 'mate') { newWinner = user.uid; playSound('win'); } 
    else if (gameState === 'draw_stalemate') { newWinner = 'Draw'; newDrawReason = 'stalemate'; }
    else if (gameState === 'draw_material') { newWinner = 'Draw'; newDrawReason = 'material'; }
    else if (gameState === 'draw_50move') { newWinner = 'Draw'; newDrawReason = '50move'; }
    else if (gameState === 'draw_repetition') { newWinner = 'Draw'; newDrawReason = 'repetition'; }

    let updatePayload = {
      board: currentBoard, turn: newWinner ? null : oppUid, captured: newCaptured, winner: newWinner,
      halfmoveClock: newHalfmoveClock, positionHistory: newPositionHistory, enPassantTarget: newEnPassantTarget,
      lastMove: { from, to }, drawOffer: null, takebackOffer: null,
      previousState: {
         board: roomData.board, turn: roomData.turn, captured: roomData.captured || {w:[], b:[]},
         halfmoveClock: roomData.halfmoveClock || 0, positionHistory: roomData.positionHistory || [],
         enPassantTarget: roomData.enPassantTarget || null, lastMove: roomData.lastMove || null
      }
    };
    if (newDrawReason) updatePayload.drawReason = newDrawReason;
    if (newWinner && newWinner !== 'Draw') updatePayload.scores = { ...roomData.scores, [newWinner]: (roomData.scores?.[newWinner] || 0) + 1 };

    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), updatePayload);
    setSelectedSquare(null); setPromotionPrompt(null);
  };

  const handleSquareClick = async (index) => {
    if (!isMyTurn || isSpectator || roomData.winner || roomData.status === 'abandoned' || promotionPrompt || isSubmitting) return;
    const piece = board[index];

    if (selectedSquare === null || (piece && piece.color === myColor)) {
      if (piece && piece.color === myColor) setSelectedSquare(index === selectedSquare ? null : index);
      return;
    }

    if (validMoves.includes(index)) {
      setIsSubmitting(true);
      try {
        const newBoard = board.map(p => p ? { ...p } : null); 
        const movingPiece = { ...newBoard[selectedSquare] }; const targetPiece = newBoard[index] ? { ...newBoard[index] } : null;
        const r = Math.floor(index / 8);
        const isPromotion = movingPiece.type === 'p' && ((movingPiece.color === 'w' && r === 0) || (movingPiece.color === 'b' && r === 7));

        if (isPromotion) { playSound('move'); setPromotionPrompt({ from: selectedSquare, to: index, movingPiece, targetPiece, newBoard }); setIsSubmitting(false); return; }
        await executeMove(selectedSquare, index, movingPiece, targetPiece, newBoard);
      } catch(err) { 
         showToast("Hamle gönderilemedi."); 
     } finally { 
         setIsSubmitting(false); 
     }
   }
 };

  const handleResign = async () => {
    if (isSpectator || roomData.winner || isSubmitting) return; setIsSubmitting(true);
    try {
       const oppUid = roomData.players.find(id => id !== user.uid) ?? null;
       await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { winner: oppUid, winReason: 'resign', turn: null, scores: { ...roomData.scores, [oppUid]: (roomData.scores?.[oppUid] || 0) + 1 }, drawOffer: null, takebackOffer: null });
       setResignConfirm(false);
    } catch(err) {} finally { setIsSubmitting(false); }
  };

  const handleDrawOffer = async () => {
    if (isSpectator || roomData.winner || isSubmitting) return; setIsSubmitting(true);
    try {
       const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
       await runTransaction(db, async (transaction) => {
           const snap = await transaction.get(roomRef);
           if (!snap.exists()) return;
           const data = snap.data();
           if (data.drawOffer && data.drawOffer !== user.uid) {
               transaction.update(roomRef, { winner: 'Draw', drawReason: 'agreement', turn: null, drawOffer: null });
           } else {
               transaction.update(roomRef, { drawOffer: user.uid });
           }
       });
    } catch(err) {} finally { setIsSubmitting(false); }
  };

  const handleTakebackOffer = async () => {
    if (isSpectator || roomData.winner || isSubmitting) return; 
    const canTakeback = !isMyTurn && roomData.previousState && roomData.previousState.turn === user.uid;
    if (!canTakeback) { showToast("Geri alma isteği geçersiz."); return; }
    
    setIsSubmitting(true);
    try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { takebackOffer: user.uid }); }
    finally { setIsSubmitting(false); }
  };

  const answerTakeback = async (accept) => {
    if (isSpectator || isSubmitting) return; setIsSubmitting(true);
    try {
       if (accept && roomData.previousState) {
           await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), {
               ...roomData.previousState, takebackOffer: null, drawOffer: null
           });
       } else { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { takebackOffer: null }); }
    } finally { setIsSubmitting(false); }
  };

  const requestRematch = async () => { if (!isSpectator) await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { rematchRequestedBy: user.uid }); };
  const acceptRematch = async () => {
    if (isSpectator) return; const newColors = {}; let whiteUid = null;
    for (const uid of roomData.players) { const c = roomData.playerColors[uid] === 'w' ? 'b' : 'w'; newColors[uid] = c; if (c === 'w') whiteUid = uid; }
    const initBoard = createInitialChessBoard();
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { board: initBoard, turn: whiteUid, startingPlayer: whiteUid, playerColors: newColors, captured: { w: [], b: [] }, halfmoveClock: 0, positionHistory: [getBoardStateString(initBoard, null, 'w')], winner: null, drawReason: null, winReason: null, rematchRequestedBy: null, enPassantTarget: null, lastMove: null, drawOffer: null, takebackOffer: null, previousState: null });
  };
  const rejectRematch = async () => { if (!isSpectator) await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { status: 'closed', closedBy: user.uid }); };

  let statusMsg = ""; let statusColor = "text-slate-300";
  if (roomData.winner) {
    if (roomData.winner === 'Draw') {
      statusMsg = "Berabere! ";
      if (roomData.drawReason === '50move') statusMsg += "(50 Hamle Kuralı)"; else if (roomData.drawReason === 'material') statusMsg += "(Yetersiz Materyal)"; else if (roomData.drawReason === 'repetition') statusMsg += "(3 Konum Tekrarı)"; else if (roomData.drawReason === 'agreement') statusMsg += "(Anlaşma)"; else statusMsg += "(Pat)";
      statusColor = "text-yellow-400";
    } else {
        const wUid = roomData.winner; const wName = roomData.playerNames?.[wUid] || 'Biri';
        if (roomData.winReason === 'resign') { statusMsg = `${wName} Kazandı (Rakip Çekildi)`; statusColor = wUid === user.uid ? "text-green-400" : "text-red-400"; }
        else {
           if (isSpectator) { statusMsg = `${wName} Kazandı! 🎉`; statusColor = "text-yellow-400"; } else if (wUid === user.uid) { statusMsg = "Şah Mat! Kazandın! 🎉"; statusColor = "text-green-400"; } else { statusMsg = "Şah Mat! Kaybettin 😢"; statusColor = "text-red-400"; }
        }
    }
  } else {
    if (isSpectator) { statusMsg = `${roomData.turn === p1Uid ? p1Name : p2Name} Hamle Bekleniyor...`; statusColor = "text-emerald-400"; } 
    else { statusMsg = isMyTurn ? "Senin Sıran!" : "Rakibin Sırası..."; statusColor = isMyTurn ? "text-emerald-400" : "text-slate-400"; }
  }

  const isBlackPerspective = isSpectator ? spectatorFlipped : myColor === 'b';
  const visualIndices = isBlackPerspective ? Array.from({length: 64}, (_, i) => 63 - i) : Array.from({length: 64}, (_, i) => i);
  const files = ['a','b','c','d','e','f','g','h']; const ranks = ['8','7','6','5','4','3','2','1'];

  const wCaptured = roomData.captured?.w || []; const bCaptured = roomData.captured?.b || [];
  const wPoints = wCaptured.reduce((acc, p) => acc + (PIECE_VALUES[p] || 0), 0); const bPoints = bCaptured.reduce((acc, p) => acc + (PIECE_VALUES[p] || 0), 0);
  
  const renderCaptured = (caps, isWhitePieces) => {
    if (!caps || caps.length === 0) return null; const sorted = [...caps].sort((a,b) => (PIECE_VALUES[b] || 0) - (PIECE_VALUES[a] || 0));
    return ( <div className="flex flex-wrap gap-[1px] items-center mt-1 bg-slate-500/40 px-2 py-1 rounded-md border border-slate-500/50 shadow-inner max-w-full"> {sorted.map((p, i) => <span key={i} style={chessPieceStyle} className={`text-lg md:text-xl leading-none drop-shadow-md ${isWhitePieces ? 'text-white' : 'text-slate-900 drop-shadow-[0_0_3px_rgba(255,255,255,0.6)]'}`}>{CHESS_ICONS[p]}</span> )} </div> );
  };

  const canTakeback = !isMyTurn && roomData.previousState && roomData.previousState.turn === user.uid;
  
  return (
    <div className="relative flex flex-col items-center w-full max-w-xl bg-gradient-to-br from-slate-800 to-slate-900 p-4 md:p-6 rounded-[2rem] border border-slate-700 shadow-2xl overflow-hidden">
      {gameToast && <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-red-500/90 text-white px-6 py-3 rounded-xl shadow-2xl font-bold border border-red-400 transition-all duration-300 transform scale-100 opacity-100 pointer-events-none text-center">{gameToast}</div>}
      
      {roomData.drawOffer && roomData.drawOffer !== user.uid && !isSpectator && !roomData.winner && (
         <div className="w-full bg-emerald-600/30 border border-emerald-400 text-emerald-100 p-3 rounded-xl mb-4 flex justify-between items-center shadow-lg animate-pulse">
            <span className="text-sm font-bold">Rakip beraberlik teklif ediyor!</span>
            <button onClick={handleDrawOffer} disabled={isSubmitting} className="bg-emerald-500 hover:bg-emerald-400 px-4 py-1.5 rounded-lg text-sm font-bold shadow-md disabled:opacity-50">Kabul Et</button>
         </div>
      )}

      {roomData.takebackOffer && roomData.takebackOffer !== user.uid && !isSpectator && !roomData.winner && (
         <div className="w-full bg-amber-600/30 border border-amber-400 text-amber-100 p-3 rounded-xl mb-4 flex justify-between items-center shadow-lg animate-pulse">
            <span className="text-sm font-bold">Rakip son hamlesini geri almak istiyor!</span>
            <div className="flex gap-2">
              <button onClick={()=>answerTakeback(true)} disabled={isSubmitting} className="bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 rounded-lg text-sm font-bold shadow-md disabled:opacity-50">Kabul</button>
              <button onClick={()=>answerTakeback(false)} disabled={isSubmitting} className="bg-red-500 hover:bg-red-400 px-3 py-1.5 rounded-lg text-sm font-bold shadow-md disabled:opacity-50">Red</button>
            </div>
         </div>
      )}
      
      <div className="w-full flex items-center justify-between bg-slate-900/80 rounded-xl p-3 border border-slate-700/50 mb-4 min-h-[70px]">
         <div className={`flex flex-col items-start flex-1 min-w-0 pr-2 p-1 rounded-lg transition-colors ${roomData.turn === p1Uid ? 'bg-slate-700/50 ring-1 ring-emerald-400/50' : ''}`}>
            <div className="flex items-center gap-2 w-full"><div className={`w-4 h-4 rounded-full border-2 shrink-0 ${p1Color === 'w' ? 'bg-white border-slate-300' : 'bg-slate-900 border-slate-500'}`} /><div className="text-sm font-bold text-slate-200 truncate">{p1Name}</div></div>
            <div className="flex flex-wrap items-center gap-1 mt-1 w-full min-h-[24px]">
               {renderCaptured(p1Color === 'w' ? wCaptured : bCaptured, p1Color === 'w' ? false : true)}
               {p1Color === 'w' && wPoints > bPoints && <span className="text-emerald-400 text-xs font-bold ml-1 shrink-0">+{wPoints - bPoints}</span>}
               {p1Color === 'b' && bPoints > wPoints && <span className="text-emerald-400 text-xs font-bold ml-1 shrink-0">+{bPoints - wPoints}</span>}
            </div>
         </div>
         <div className="flex flex-col items-center px-4 shrink-0"><div className="text-lg font-mono font-bold">{p1Score} — {p2Score}</div><div className="text-[10px] text-slate-500 font-bold tracking-widest flex items-center gap-1"><Users className="w-3 h-3"/> {roomData.spectators?.length || 0}</div></div>
         <div className={`flex flex-col items-end flex-1 min-w-0 pl-2 text-right p-1 rounded-lg transition-colors ${roomData.turn === p2Uid ? 'bg-slate-700/50 ring-1 ring-emerald-400/50' : ''}`}>
            <div className="flex items-center justify-end gap-2 w-full"><div className="text-sm font-bold text-slate-200 truncate">{p2Name}</div><div className={`w-4 h-4 rounded-full border-2 shrink-0 ${p2Color === 'w' ? 'bg-white border-slate-300' : 'bg-slate-900 border-slate-500'}`} /></div>
            <div className="flex flex-wrap items-center justify-end gap-1 mt-1 w-full min-h-[24px] flex-row-reverse">
               {renderCaptured(p2Color === 'w' ? wCaptured : bCaptured, p2Color === 'w' ? false : true)}
               {p2Color === 'w' && wPoints > bPoints && <span className="text-emerald-400 text-xs font-bold mr-1 shrink-0">+{wPoints - bPoints}</span>}
               {p2Color === 'b' && bPoints > wPoints && <span className="text-emerald-400 text-xs font-bold mr-1 shrink-0">+{bPoints - wPoints}</span>}
            </div>
         </div>
      </div>

      <div className="w-full flex justify-between items-center mb-2 min-h-[40px]">
         <div className="flex-1 flex justify-start items-center">
             {isSpectator && <button onClick={() => setSpectatorFlipped(!spectatorFlipped)} className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded flex items-center gap-1 transition-colors"><ArrowUpDown className="w-3 h-3" /> Tahtayı Çevir</button>}
         </div>
         
         <div className={`text-center font-bold text-lg drop-shadow-md flex-1 ${statusColor}`}>{statusMsg}</div>
         
         <div className="flex-1 flex justify-end items-center gap-2">
            {!isSpectator && !roomData.winner && (
               <>
                  {canTakeback && (
                     <button onClick={handleTakebackOffer} disabled={isSubmitting || roomData.takebackOffer === user.uid} className="text-xs bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/50 px-3 py-1.5 rounded flex items-center gap-1 transition-colors disabled:opacity-50">
                        <Undo2 className="w-3 h-3" /> {roomData.takebackOffer === user.uid ? 'İstek Gönderildi' : 'Geri Al'}
                     </button>
                  )}
                  <button onClick={handleDrawOffer} disabled={isSubmitting || roomData.drawOffer === user.uid} className="text-xs bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/50 px-3 py-1.5 rounded flex items-center gap-1 transition-colors disabled:opacity-50"><Handshake className="w-3 h-3" /> {roomData.drawOffer === user.uid ? 'Teklif Edildi' : 'Berabere'}</button>
                  
                  {!resignConfirm ? (
                     <button onClick={() => setResignConfirm(true)} disabled={isSubmitting} className="text-xs bg-red-600/30 hover:bg-red-600/50 border border-red-500/50 px-3 py-1.5 rounded flex items-center gap-1 transition-colors disabled:opacity-50">
                        <Flag className="w-3 h-3" /> Teslim Ol
                     </button>
                  ) : (
                     <div className="flex items-center gap-1">
                        <button onClick={handleResign} disabled={isSubmitting} className="text-xs bg-red-500 hover:bg-red-400 text-white border border-red-400 px-3 py-1.5 rounded flex items-center gap-1 transition-colors disabled:opacity-50">
                           Emin misin?
                        </button>
                        <button onClick={() => setResignConfirm(false)} disabled={isSubmitting} className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 px-2 py-1.5 rounded transition-colors">
                           <X className="w-3 h-3" />
                        </button>
                     </div>
                  )}
               </>
            )}
         </div>
      </div>

      <div className="relative w-full max-w-[400px] sm:max-w-[480px] bg-slate-800 p-2 md:p-3 rounded-lg shadow-2xl mx-auto border border-slate-700">
        <div className="grid grid-cols-8 grid-rows-8 w-full aspect-square bg-[#769656] rounded-sm overflow-hidden select-none shadow-inner border-[3px] border-slate-900 relative">
          {visualIndices.map((i) => {
            const cell = board[i]; const r = Math.floor(i / 8); const c = i % 8;
            const isDark = (r + c) % 2 !== 0; const isSelected = selectedSquare === i; const isValidMove = validMoves.includes(i); 
            const isKingInDanger = inCheckKings.includes(i);
            const isLastMove = roomData.lastMove?.from === i || roomData.lastMove?.to === i;
            
            const showFile = isBlackPerspective ? r === 0 : r === 7;
            const showRank = isBlackPerspective ? c === 7 : c === 0;

            return (
              <div key={i} onClick={() => handleSquareClick(i)} className={`w-full h-full flex items-center justify-center relative cursor-pointer ${isDark ? 'bg-[#769656]' : 'bg-[#eeeed2]'} ${isSelected ? 'bg-yellow-400/70' : ''} ${isLastMove && !isSelected ? 'bg-yellow-400/40' : ''}`}>
                {showFile && <div className={`absolute bottom-0 right-1 text-[8px] sm:text-[10px] font-bold ${isDark ? 'text-[#eeeed2]/80' : 'text-[#769656]/80'}`}>{files[c]}</div>}
                {showRank && <div className={`absolute top-0 left-1 text-[8px] sm:text-[10px] font-bold ${isDark ? 'text-[#eeeed2]/80' : 'text-[#769656]/80'}`}>{ranks[r]}</div>}

                {isKingInDanger && <div className="absolute inset-0 bg-red-500/60 shadow-[inset_0_0_20px_rgba(220,38,38,0.9)] pointer-events-none" />}
                {isValidMove && !cell && <div className="w-4 h-4 md:w-5 md:h-5 bg-black/20 rounded-full" />}
                {isValidMove && cell && <div className="absolute inset-0 border-[4px] md:border-[5px] border-black/20 rounded-full m-1 pointer-events-none" />}
                {cell && ( <div style={chessPieceStyle} className={`text-[32px] sm:text-[45px] md:text-[55px] leading-none drop-shadow-md select-none flex items-center justify-center w-full h-full font-sans transition-transform duration-200 ${cell.color === 'w' ? 'text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]' : 'text-black drop-shadow-[0_1px_1px_rgba(255,255,255,0.4)]'}`}>{CHESS_ICONS[cell.type]}</div> )}
              </div>
            );
          })}
        </div>
        {/* FIX 12: Terfi Dialoguna Vazgeç Butonu Eklendi */}
        {promotionPrompt && (
           <div className="absolute inset-0 z-50 bg-black/70 flex items-center justify-center backdrop-blur-sm rounded-lg">
              <div className="bg-slate-800 p-6 rounded-2xl border border-slate-600 shadow-2xl flex flex-col items-center">
                  <h3 className="text-white font-bold mb-4">Piyon Terfisi</h3>
                  <div className="flex gap-4 mb-6">
                     {['q', 'r', 'b', 'n'].map(type => (
                         <button key={type} onClick={async () => { 
                            setIsSubmitting(true); 
                            const freshBoard = board.map(p => p ? { ...p } : null);
                            const promotedPiece = { ...freshBoard[promotionPrompt.from], type }; 
                            const targetPiece = freshBoard[promotionPrompt.to] ? { ...freshBoard[promotionPrompt.to] } : null;
                            try { await executeMove(promotionPrompt.from, promotionPrompt.to, promotedPiece, targetPiece, freshBoard); } 
                            catch(e){} finally {setIsSubmitting(false);} 
                         }} 
                            style={chessPieceStyle} className={`w-16 h-16 md:w-20 md:h-20 rounded-xl bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-4xl md:text-5xl transition-colors border-2 ${myColor === 'w' ? 'text-slate-100' : 'text-slate-900'}`}>{CHESS_ICONS[type]}</button>
                     ))}
                  </div>
                  <button onClick={() => { setPromotionPrompt(null); setIsSubmitting(false); }} className="text-red-400 hover:text-red-300 font-medium px-4 py-2 border border-red-500/50 rounded-lg bg-red-500/10 transition-colors w-full text-center">Vazgeç</button>
              </div>
           </div>
        )}
      </div>

      {roomData.winner && roomData.status !== 'abandoned' && (
        <div className="w-full max-w-[400px] mt-6 flex flex-col items-center bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-slate-700/50 shadow-lg">
          {isSpectator ? ( <div className="text-slate-400 text-sm py-2 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Oyuncuların kararı bekleniyor...</div> ) : !roomData.rematchRequestedBy ? (
            <button onClick={requestRematch} className="bg-indigo-600 hover:bg-indigo-500 w-full py-3 rounded-xl font-bold text-lg shadow-lg transition-all">Yeniden Oyna</button>
          ) : roomData.rematchRequestedBy === user.uid ? (
            <div className="flex items-center gap-3 text-slate-400 py-2"><Loader2 className="w-5 h-5 animate-spin" /><span>Rakibin cevabı bekleniyor...</span></div>
          ) : (
            <div className="flex flex-col items-center w-full">
              <span className="text-indigo-200 font-medium mb-3 text-center">Rakibiniz rövanş istiyor!</span>
              <div className="flex gap-4 w-full">
                <button onClick={acceptRematch} className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/40 text-green-400 border border-green-500/50 py-3 rounded-xl font-bold transition-all"><Check className="w-5 h-5" /> Kabul Et</button>
                <button onClick={rejectRematch} className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/50 py-3 rounded-xl font-bold transition-all"><X className="w-5 h-5" /> Reddet</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}