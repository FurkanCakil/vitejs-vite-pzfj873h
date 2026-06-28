import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { playSound } from '../../utils/sound.js';
import { getValidCheckersMoves, checkCheckersWinner, createInitialCheckersBoard } from './logic.js';
import { Crown, Loader2, Check, X } from 'lucide-react';

export default function CheckersGame({ roomData, roomCode, user, db, appId, leaveRoom }) {
  const p1Uid = roomData.players?.[0]; const p2Uid = roomData.players?.[1];
  const isSpectator = !roomData.players?.includes(user.uid);
  const myColor = roomData.playerColors?.[user.uid] || null;
  const isMyTurn = roomData.turn === user.uid && !isSpectator;

  const [selectedSquare, setSelectedSquare] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const board = Array.isArray(roomData.board) ? roomData.board : Array(64).fill(null);
  
  const validMoves = (selectedSquare !== null && isMyTurn) ? getValidCheckersMoves(board, selectedSquare, roomData.multiJumpIdx ?? null) : [];

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
        
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), {
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

  const requestRematch = async () => { if (!isSpectator) await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { rematchRequestedBy: user.uid }); };
  const acceptRematch = async () => {
    if (isSpectator) return;
    const newColors = {}; let whiteUid = null;
    for (const uid of roomData.players) { const c = roomData.playerColors[uid] === 'w' ? 'b' : 'w'; newColors[uid] = c; if (c === 'w') whiteUid = uid; }
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { 
        board: createInitialCheckersBoard(), turn: whiteUid, startingPlayer: whiteUid, 
        playerColors: newColors, winner: null, rematchRequestedBy: null, multiJumpIdx: null 
    });
  };
  const rejectRematch = async () => { if (!isSpectator) await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { status: 'closed', closedBy: user.uid }); };

  const p1Name = roomData.playerNames?.[p1Uid] || 'Oyuncu 1'; 
  const p2Name = roomData.playerNames?.[p2Uid] || 'Oyuncu 2';
  const isBlackPerspective = isSpectator ? false : myColor === 'b';
  const visualIndices = isBlackPerspective ? Array.from({length: 64}, (_, i) => 63 - i) : Array.from({length: 64}, (_, i) => i);

  return (
    <div className="relative flex flex-col items-center w-full max-w-xl bg-slate-900 p-4 md:p-6 rounded-[2rem] border border-slate-700 shadow-2xl">
      <div className="w-full flex items-center justify-between bg-slate-800 rounded-xl p-3 border border-slate-700 mb-4">
        <div className={`flex flex-col items-center flex-1 ${roomData.turn === p1Uid ? 'ring-2 ring-slate-400 rounded-lg' : ''}`}>
           <span className="font-bold text-white">{p1Name} (Beyaz)</span>
           <span className="text-xl font-mono text-slate-300 mt-1">{roomData.scores?.[p1Uid] || 0}</span>
        </div>
        <div className="px-4 font-bold text-slate-500">VS</div>
        <div className={`flex flex-col items-center flex-1 ${roomData.turn === p2Uid ? 'ring-2 ring-slate-400 rounded-lg' : ''}`}>
           <span className="font-bold text-white">{p2Name} (Siyah)</span>
           <span className="text-xl font-mono text-slate-300 mt-1">{roomData.scores?.[p2Uid] || 0}</span>
        </div>
      </div>

      <div className="text-center font-bold text-lg mb-4 text-slate-300">
        {roomData.winner ? `Kazanan: ${roomData.winner === p1Uid ? p1Name : p2Name}!` : (isMyTurn ? (roomData.multiJumpIdx !== null && roomData.multiJumpIdx !== undefined ? "Atlamaya Devam Et!" : "Senin Sıran!") : "Rakip Bekleniyor...")}
      </div>

      <div className="grid grid-cols-8 grid-rows-8 w-full max-w-[400px] aspect-square bg-[#c2a176] rounded-sm overflow-hidden shadow-inner border-4 border-slate-800 touch-action-manipulation">
        {visualIndices.map((i) => {
          const cell = board[i]; const r = Math.floor(i / 8); const c = i % 8;
          const isDark = (r + c) % 2 !== 0; 
          const isSelected = selectedSquare === i || roomData.multiJumpIdx === i; 
          const isValidMove = validMoves.some(m => m.to === i);

          return (
            <div key={i} onClick={() => handleSquareClick(i)} className={`w-full h-full flex items-center justify-center relative cursor-pointer ${isDark ? 'bg-[#5c4033]' : 'bg-[#e0c9a6]'} ${isSelected ? 'ring-inset ring-4 ring-yellow-400' : ''}`}>
              {isValidMove && !cell && <div className="w-4 h-4 bg-black/30 rounded-full" />}
              {cell && (
                <div className={`w-[80%] h-[80%] rounded-full shadow-[0_4px_4px_rgba(0,0,0,0.5)] border-2 flex items-center justify-center pointer-events-none ${cell.color === 'w' ? 'bg-slate-200 border-white' : 'bg-slate-800 border-slate-900'}`}>
                  {cell.isKing && <Crown className={`w-1/2 h-1/2 ${cell.color === 'w' ? 'text-slate-800' : 'text-slate-300'}`} />}
                </div>
              )}
            </div>
          );
        })}
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