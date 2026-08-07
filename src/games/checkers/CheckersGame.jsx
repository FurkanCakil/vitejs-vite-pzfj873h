import React, { useState, useMemo, useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { playSound } from '../../utils/sound.js';
import { getValidCheckersMoves, checkCheckersWinner, createInitialCheckersBoard } from './logic.js';
import { BOT_UID, DIFFICULTY_LABELS, getBotTurn } from './bot.js';
import { Crown, Loader2, Check, X, Bot } from 'lucide-react';
import useViewport from '../../hooks/useViewport.js';
import useBoardScale from '../../hooks/useBoardScale.js';

export default function CheckersGame({ roomData, roomCode, user, db, appId, leaveRoom, isBot = false, botDifficulty = 'medium', setLocalRoomData }) {
  const p1Uid = roomData.players?.[0]; const p2Uid = roomData.players?.[1];
  const isSpectator = !roomData.players?.includes(user.uid);
  const myColor = roomData.playerColors?.[user.uid] || null;
  const isMyTurn = roomData.turn === user.uid && !isSpectator;

  // Telefonda tam ekranken tahta, üstteki başlık/skor tablosunun ALTINDA
  // kalan boş alanı doldursun diye büyütülür (bkz. useBoardScale) — skor
  // tablosu kendi doğal boyutunda kalır, gerekirse kaydırılarak görülür.
  const { width: viewportW, height: viewportH, isPhone, isCompact } = useViewport();
  const [isFullscreenView, setIsFullscreenView] = useState(false);
  useEffect(() => {
    const sync = () => setIsFullscreenView(!!document.fullscreenElement);
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const boardFit = isFullscreenView && (isPhone || isCompact);
  // Telefon YATAY: dikey alan çok kısıtlı, skor tablosu tek satıra indirilir.
  const tightHeader = isFullscreenView && isCompact;
  const { wrapRef, boardRef, wrapStyle, boardStyle } = useBoardScale(boardFit);

  // Masaüstünde tam ekrana geçilince tahta (satrançtaki gibi) EKSTRA büyür —
  // önceden `boardFit` sadece telefon/kompakt içindi, masaüstünde tam ekran
  // tahtayı büyütmüyordu (bkz. kullanıcı raporu). Piksel cinsinden doğrudan
  // boyutlandırma kullanılır (useBoardScale'in transform:scale'i, kartın
  // `max-w-xl` sınırına takılıp tahtayı kırpardı).
  const desktopFullscreenBoost = isFullscreenView && !isPhone && !isCompact;
  const boostedBoardPx = Math.round(Math.max(420, Math.min(viewportW * 0.5, viewportH - 240, viewportH * 0.68, 760)));

  const [selectedSquare, setSelectedSquare] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateRoom = async (patch) => {
    if (isBot) { setLocalRoomData(prev => ({ ...prev, ...patch })); return; }
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), patch);
  };

  const board = Array.isArray(roomData.board) ? roomData.board : Array(64).fill(null);
  
  const validMoves = (selectedSquare !== null && isMyTurn) ? getValidCheckersMoves(board, selectedSquare, roomData.multiJumpIdx ?? null) : [];

  const mandatoryPieces = useMemo(() => {
    if (!isMyTurn || roomData.winner) return [];
    // Eğer zincirleme yeme (multi-jump) devam ediyorsa sadece o taş zorunludur
    if (roomData.multiJumpIdx !== null && roomData.multiJumpIdx !== undefined) {
       return [roomData.multiJumpIdx];
    }
    const mandatories = [];
    let globalJumpExists = false;
    for (let i = 0; i < 64; i++) {
      if (board[i]?.color === myColor) {
         const moves = getValidCheckersMoves(board, i, null);
         if (moves.length > 0 && moves.some(m => m.isJump)) {
             mandatories.push(i);
             globalJumpExists = true;
         }
      }
    }
    return globalJumpExists ? mandatories : [];
  }, [board, isMyTurn, myColor, roomData.multiJumpIdx, roomData.winner]);

  const handleSquareClick = async (index) => {
    if (!isMyTurn || isSpectator || roomData.winner || roomData.status === 'abandoned' || isSubmitting) return;

    const piece = board[index];
    
    // GÜNCELLEME (Bug 8): Zorunlu yeme bildirimi eklendi
    if (roomData.multiJumpIdx !== undefined && roomData.multiJumpIdx !== null && index !== roomData.multiJumpIdx && piece?.color === myColor) {
        playSound('error'); // Uyarı sesi
        // Animasyonlu uyarı için seçimi o taşa zorla
        setSelectedSquare(roomData.multiJumpIdx); 
        return; 
    }

    if (piece && piece.color === myColor) {
      setSelectedSquare(index === selectedSquare ? null : index);
      return;
    }

    const move = validMoves.find(m => m.to === index);
    if (move) {
      setIsSubmitting(true);
      try {
        const newBoard = [...board];
        const movingPiece = { ...newBoard[selectedSquare] };
        
        const targetRow = Math.floor(index / 8);
        if (movingPiece.color === 'w' && targetRow === 0) movingPiece.isKing = true;
        if (movingPiece.color === 'b' && targetRow === 7) movingPiece.isKing = true;

        newBoard[index] = movingPiece;
        newBoard[selectedSquare] = null;

        let nextTurn = roomData.players.find(id => id !== user.uid) || null;
        let newMultiJumpIdx = null;

        if (move.isJump) {
          newBoard[move.capturedIdx] = null;
          playSound('capture');
          
          const furtherMoves = getValidCheckersMoves(newBoard, index, index);
          if (furtherMoves.some(m => m.isJump)) {
             nextTurn = user.uid; 
             newMultiJumpIdx = index; 
          }
        } else {
          playSound('move');
        }

        let winnerColor = checkCheckersWinner(newBoard);
        let winnerUid = null;

        // GÜNCELLEME (Bug 7): Rakibin hamlesi kalmadıysa (Blokaj) kazanmış say
        if (!winnerColor && nextTurn) {
          let oppHasMoves = false;
          const oppColor = myColor === 'w' ? 'b' : 'w';
          for (let i = 0; i < 64; i++) {
            if (newBoard[i]?.color === oppColor) {
              if (getValidCheckersMoves(newBoard, i).length > 0) { oppHasMoves = true; break; }
            }
          }
          if (!oppHasMoves) {
            winnerUid = user.uid; // Rakip bloke oldu, sen kazandın!
            nextTurn = null;
          }
        }

        const newScores = { ...roomData.scores };

        // Kazanan normal yollarla belirlendiyse
        if (winnerColor && !winnerUid) {
           winnerUid = Object.keys(roomData.playerColors || {}).find(uid => roomData.playerColors[uid] === winnerColor) || null;
        }
        
        if (winnerUid) {
           newScores[winnerUid] = (newScores[winnerUid] || 0) + 1;
           playSound('win');
        }
        
        await updateRoom({
          board: newBoard,
          turn: winnerUid ? null : nextTurn,
          winner: winnerUid,
          scores: newScores,
          multiJumpIdx: newMultiJumpIdx
        });
        setSelectedSquare(null);
      } catch (err) { console.error(err); }
      finally { setIsSubmitting(false); }
    }
  };

  // Bot rakip: sıra bota geldiğinde küçük bir gecikmeyle elini (zıplama zinciri dahil) tek seferde oynar.
  useEffect(() => {
    if (!isBot || isSpectator || roomData.turn !== BOT_UID || roomData.winner || roomData.status === 'abandoned') return;
    const timer = setTimeout(() => {
      const botColor = roomData.playerColors?.[BOT_UID];
      const humanColor = botColor === 'w' ? 'b' : 'w';
      const turn = getBotTurn(board, botDifficulty, botColor, humanColor);

      if (!turn) { updateRoom({ winner: user.uid, turn: null }); return; }

      const captured = turn.path.some(p => p.isJump);
      playSound(captured ? 'capture' : 'move');

      const newBoard = turn.board;
      let winnerColor = checkCheckersWinner(newBoard);
      let winnerUid = null;
      let nextTurn = user.uid;

      if (!winnerColor) {
        let oppHasMoves = false;
        for (let i = 0; i < 64; i++) {
          if (newBoard[i]?.color === humanColor && getValidCheckersMoves(newBoard, i).length > 0) { oppHasMoves = true; break; }
        }
        if (!oppHasMoves) { winnerUid = BOT_UID; nextTurn = null; }
      } else {
        winnerUid = Object.keys(roomData.playerColors || {}).find(uid => roomData.playerColors[uid] === winnerColor) || null;
      }

      const newScores = { ...roomData.scores };
      if (winnerUid) { newScores[winnerUid] = (newScores[winnerUid] || 0) + 1; playSound('win'); }

      updateRoom({ board: newBoard, turn: winnerUid ? null : nextTurn, winner: winnerUid, scores: newScores, multiJumpIdx: null });
    }, 500 + Math.random() * 500);
    return () => clearTimeout(timer);
  }, [isBot, roomData.turn, roomData.winner, roomData.status]);

  const requestRematch = async () => {
    if (isSpectator) return;
    const newColors = {}; let whiteUid = null;
    for (const uid of roomData.players) { const c = roomData.playerColors[uid] === 'w' ? 'b' : 'w'; newColors[uid] = c; if (c === 'w') whiteUid = uid; }
    if (isBot) {
      await updateRoom({ board: createInitialCheckersBoard(), turn: whiteUid, startingPlayer: whiteUid, playerColors: newColors, winner: null, rematchRequestedBy: null, multiJumpIdx: null });
      return;
    }
    await updateRoom({ rematchRequestedBy: user.uid });
  };
  const acceptRematch = async () => {
    if (isSpectator) return;
    const newColors = {}; let whiteUid = null;
    for (const uid of roomData.players) { const c = roomData.playerColors[uid] === 'w' ? 'b' : 'w'; newColors[uid] = c; if (c === 'w') whiteUid = uid; }
    await updateRoom({
        board: createInitialCheckersBoard(), turn: whiteUid, startingPlayer: whiteUid,
        playerColors: newColors, winner: null, rematchRequestedBy: null, multiJumpIdx: null
    });
  };
  const rejectRematch = async () => {
    if (isSpectator) return;
    if (isBot) { leaveRoom(); return; }
    await updateRoom({ status: 'closed', closedBy: user.uid });
  };

  const p1Name = roomData.playerNames?.[p1Uid] || 'Oyuncu 1'; 
  const p2Name = roomData.playerNames?.[p2Uid] || 'Oyuncu 2';
  const isBlackPerspective = isSpectator ? false : myColor === 'b';
  const visualIndices = isBlackPerspective ? Array.from({length: 64}, (_, i) => 63 - i) : Array.from({length: 64}, (_, i) => i);

  const p1ColorStr = roomData.playerColors?.[p1Uid] === 'w' ? 'Beyaz' : 'Siyah';
  const p2ColorStr = roomData.playerColors?.[p2Uid] === 'w' ? 'Beyaz' : 'Siyah';
  // İki oyuncunun ismi de beyaz yazıldığında (taş rengi ne olursa olsun) garip
  // duruyordu — artık isim rengi oyuncunun taş rengini yansıtıyor: beyaz taş
  // beyaz yazı, siyah taş SİYAH yazı. Siyah yazı koyu paneldeki koyu arkaplanda
  // kaybolmasın diye etrafına ince beyaz bir çerçeve (text-shadow ile) eklendi.
  const blackNameStyle = { color: '#0f172a', textShadow: '-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff, 0 0 4px rgba(255,255,255,0.5)' };
  const nameStyleFor = (uid) => (roomData.playerColors?.[uid] === 'w' ? undefined : blackNameStyle);
  const nameClassFor = (uid) => `font-bold ${roomData.playerColors?.[uid] === 'w' ? 'text-white' : ''}`;

  // Telefon YATAY'da kartın zemini/çerçevesi kaldırılır: tahtadan çok daha
  // geniş kaldığı için gereksiz büyük bir panel gibi duruyordu.
  const cardClass = tightHeader
    ? 'p-1'
    : `bg-slate-900 rounded-[2rem] border border-slate-700 shadow-2xl ${boardFit ? 'p-2' : 'p-4 md:p-6'}`;

  return (
    <div className={`relative flex flex-col items-center w-full ${desktopFullscreenBoost ? '' : 'max-w-xl'} ${cardClass}`}>
      {isBot && !isSpectator && !boardFit && <div className="text-center text-xs text-slate-300 font-bold mb-3 tracking-widest uppercase flex items-center justify-center gap-1"><Bot className="w-4 h-4" /> BOTA KARŞI ({DIFFICULTY_LABELS[botDifficulty] || botDifficulty})</div>}
      {/* Telefon YATAY tam ekranda skor tablosu + durum yazısı TEK SATIRDA
          birleşir; artan alanın tamamı tahtaya gider (bkz. useBoardScale). */}
      {tightHeader ? (
        <div className="w-full flex items-center justify-center gap-2 bg-slate-800 rounded-lg border border-slate-700 px-2 py-1 mb-1 text-xs">
          <span className={`truncate max-w-[90px] ${nameClassFor(p1Uid)}`} style={nameStyleFor(p1Uid)}>{p1Name}</span>
          <span className="font-mono font-bold text-slate-200">{roomData.scores?.[p1Uid] || 0}</span>
          <span className="px-2 font-bold text-slate-300">
            {roomData.winner
              ? `Kazanan: ${roomData.winner === p1Uid ? p1Name : p2Name}!`
              : isSpectator
                ? (roomData.turn === p1Uid ? `${p1Name} oynuyor...` : `${p2Name} oynuyor...`)
                : (isMyTurn ? (roomData.multiJumpIdx !== null && roomData.multiJumpIdx !== undefined ? "Atlamaya Devam Et!" : "Senin Sıran!") : "Rakip Bekleniyor...")}
          </span>
          <span className="font-mono font-bold text-slate-200">{roomData.scores?.[p2Uid] || 0}</span>
          <span className={`truncate max-w-[90px] ${nameClassFor(p2Uid)}`} style={nameStyleFor(p2Uid)}>{p2Name}</span>
        </div>
      ) : (
      <>
      <div className={`w-full flex items-center justify-between bg-slate-800 rounded-xl border border-slate-700 ${boardFit ? 'p-1.5 mb-1' : 'p-3 mb-4'}`}>
        <div className={`flex flex-col items-center flex-1 ${roomData.turn === p1Uid ? 'ring-2 ring-slate-400 rounded-lg' : ''}`}>
           <span className={nameClassFor(p1Uid)} style={nameStyleFor(p1Uid)}>{p1Name} ({p1ColorStr})</span>
           <span className="text-xl font-mono text-slate-300 mt-1">{roomData.scores?.[p1Uid] || 0}</span>
        </div>
        <div className="px-4 font-bold text-slate-500">VS</div>
        <div className={`flex flex-col items-center flex-1 ${roomData.turn === p2Uid ? 'ring-2 ring-slate-400 rounded-lg' : ''}`}>
           <span className={nameClassFor(p2Uid)} style={nameStyleFor(p2Uid)}>{p2Name} ({p2ColorStr})</span>
           <span className="text-xl font-mono text-slate-300 mt-1">{roomData.scores?.[p2Uid] || 0}</span>
        </div>
      </div>

      <div className={`text-center font-bold text-slate-300 ${boardFit ? 'text-sm mb-1' : 'text-lg mb-4'}`}>
        {roomData.winner
          ? `Kazanan: ${roomData.winner === p1Uid ? p1Name : p2Name}!`
          : isSpectator
            ? (roomData.turn === p1Uid ? `${p1Name} Hamle Yapıyor...` : `${p2Name} Hamle Yapıyor...`)
            : (isMyTurn ? (roomData.multiJumpIdx !== null && roomData.multiJumpIdx !== undefined ? "Atlamaya Devam Et!" : "Senin Sıran!") : "Rakip Bekleniyor...")}
      </div>
      </>
      )}

      <div ref={wrapRef} style={desktopFullscreenBoost ? { width: boostedBoardPx, margin: '0 auto' } : wrapStyle} className="w-full">
        <div ref={boardRef} style={desktopFullscreenBoost ? { width: boostedBoardPx, height: boostedBoardPx } : boardStyle} className={`grid grid-cols-8 grid-rows-8 ${desktopFullscreenBoost ? '' : 'w-full max-w-[400px]'} aspect-square mx-auto bg-[#c2a176] rounded-sm overflow-hidden shadow-inner border-4 border-slate-800 touch-action-manipulation`}>
          {visualIndices.map((i) => {
            const cell = board[i]; const r = Math.floor(i / 8); const c = i % 8;
            const isDark = (r + c) % 2 !== 0;
            const isSelected = selectedSquare === i || roomData.multiJumpIdx === i;
            const isValidMove = validMoves.some(m => m.to === i);
            const isMandatory = mandatoryPieces.includes(i); // <-- EKLENDİ

            return (
              <div key={i} onClick={() => handleSquareClick(i)} className={`w-full h-full flex items-center justify-center relative cursor-pointer ${isDark ? 'bg-[#5c4033]' : 'bg-[#e0c9a6]'} ${isSelected ? 'ring-inset ring-4 ring-yellow-400' : ''}`}>
                {isValidMove && !cell && <div className="w-4 h-4 bg-black/30 rounded-full" />}
                {cell && (
                  <div className={`w-[80%] h-[80%] rounded-full shadow-[0_4px_4px_rgba(0,0,0,0.5)] border-2 flex items-center justify-center pointer-events-none transition-all ${cell.color === 'w' ? 'bg-slate-200 border-white' : 'bg-slate-800 border-slate-900'} ${isMandatory ? 'ring-4 ring-red-500 shadow-[0_0_20px_rgba(239,68,68,0.9)] animate-pulse' : ''}`}>
                    {cell.isKing && <Crown className={`w-1/2 h-1/2 ${cell.color === 'w' ? 'text-slate-800' : 'text-slate-300'}`} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {roomData.winner && roomData.status !== 'abandoned' && (
        <div className="w-full max-w-[400px] mt-6 flex flex-col items-center bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-slate-700/50 shadow-lg">
          {isSpectator ? ( <div className="text-slate-400 text-sm py-2 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Oyuncuların kararı bekleniyor...</div> ) : !roomData.rematchRequestedBy ? (
            <button onClick={requestRematch} className="bg-slate-700 hover:bg-slate-600 w-full py-3 rounded-xl font-bold text-lg shadow-lg transition-all text-white">Yeniden Oyna</button>
          ) : roomData.rematchRequestedBy === user.uid ? (
            <div className="flex items-center gap-3 text-slate-400 py-2"><Loader2 className="w-5 h-5 animate-spin" /><span>Rakibin cevabı bekleniyor...</span></div>
          ) : (
            <div className="flex flex-col items-center w-full">
              <span className="text-slate-200 font-medium mb-3 text-center">Rakibiniz rövanş istiyor!</span>
              <div className="flex gap-4 w-full">
                <button onClick={acceptRematch} className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/40 text-green-400 border border-green-500/50 py-3 rounded-xl font-bold transition-all"><Check className="w-5 h-5" /> Kabul Et</button>
                <button onClick={rejectRematch} className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/50 py-3 rounded-xl font-bold transition-all"><X className="w-5 h-5" /> Reddet</button>
              </div>
            </div>
          )}
        </div>
      )}

      {roomData.status === 'abandoned' && (
        <div className="absolute inset-0 z-[100] bg-slate-900/80 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-[2rem] p-4 text-center transition-all duration-300 transform scale-100 opacity-100">
          <Loader2 className="w-12 h-12 animate-spin text-slate-500 mb-4 drop-shadow-lg" />
          <h3 className="text-xl font-bold text-white mb-2">Rakip Bekleniyor...</h3>
          <button onClick={leaveRoom} className="mt-8 bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50 px-6 py-2 rounded-lg font-medium transition-colors">Odadan Çık</button>
        </div>
      )}
    </div>
  );
}