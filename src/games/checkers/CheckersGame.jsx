import React, { useState, useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { playSound } from '../../utils/sound.js';
import { getValidCheckersMoves, checkCheckersWinner } from './logic.js';
import { Users, Crown, ArrowLeft, Loader2, RefreshCw } from 'lucide-react';

export default function CheckersGame({ roomData, roomCode, user, db, appId, leaveRoom }) {
  const p1Uid = roomData.players?.[0]; const p2Uid = roomData.players?.[1];
  const isSpectator = !roomData.players?.includes(user.uid);
  const myColor = roomData.playerColors?.[user.uid] || null;
  const isMyTurn = roomData.turn === user.uid && !isSpectator;

  const [selectedSquare, setSelectedSquare] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const board = Array.isArray(roomData.board) ? roomData.board : Array(64).fill(null);
  
  const validMoves = (selectedSquare !== null && isMyTurn) ? getValidCheckersMoves(board, selectedSquare) : [];

  const handleSquareClick = async (index) => {
    if (!isMyTurn || isSpectator || roomData.winner || isSubmitting) return;

    const piece = board[index];
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
        
        // Dama (King) olma kuralı
        const targetRow = Math.floor(index / 8);
        if (movingPiece.color === 'w' && targetRow === 0) movingPiece.isKing = true;
        if (movingPiece.color === 'b' && targetRow === 7) movingPiece.isKing = true;

        newBoard[index] = movingPiece;
        newBoard[selectedSquare] = null;

        if (move.isJump) {
          newBoard[move.capturedIdx] = null;
          playSound('capture');
        } else {
          playSound('move');
        }

        const winner = checkCheckersWinner(newBoard);
        const nextTurnUid = roomData.players.find(id => id !== user.uid);
        
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), {
          board: newBoard,
          turn: winner ? null : nextTurnUid,
          winner: winner === 'w' ? p1Uid : (winner === 'b' ? p2Uid : null)
        });
        setSelectedSquare(null);
      } catch (err) { console.error(err); } 
      finally { setIsSubmitting(false); }
    }
  };

  const p1Name = roomData.playerNames?.[p1Uid] || 'Oyuncu 1'; 
  const p2Name = roomData.playerNames?.[p2Uid] || 'Oyuncu 2';
  const isBlackPerspective = isSpectator ? false : myColor === 'b';
  const visualIndices = isBlackPerspective ? Array.from({length: 64}, (_, i) => 63 - i) : Array.from({length: 64}, (_, i) => i);

  return (
    <div className="relative flex flex-col items-center w-full max-w-xl bg-slate-900 p-4 md:p-6 rounded-[2rem] border border-slate-700 shadow-2xl">
      <div className="w-full flex items-center justify-between bg-slate-800 rounded-xl p-3 border border-slate-700 mb-4">
        <div className={`flex flex-col items-center flex-1 ${roomData.turn === p1Uid ? 'ring-2 ring-slate-400 rounded-lg' : ''}`}>
           <span className="font-bold text-white">{p1Name} (Beyaz)</span>
        </div>
        <div className="px-4 font-bold text-slate-500">VS</div>
        <div className={`flex flex-col items-center flex-1 ${roomData.turn === p2Uid ? 'ring-2 ring-slate-400 rounded-lg' : ''}`}>
           <span className="font-bold text-white">{p2Name} (Siyah)</span>
        </div>
      </div>

      <div className="text-center font-bold text-lg mb-4 text-slate-300">
        {roomData.winner ? `Kazanan: ${roomData.winner === p1Uid ? p1Name : p2Name}!` : (isMyTurn ? "Senin Sıran!" : "Rakip Bekleniyor...")}
      </div>

      <div className="grid grid-cols-8 grid-rows-8 w-full max-w-[400px] aspect-square bg-[#c2a176] rounded-sm overflow-hidden shadow-inner border-4 border-slate-800">
        {visualIndices.map((i) => {
          const cell = board[i]; const r = Math.floor(i / 8); const c = i % 8;
          const isDark = (r + c) % 2 !== 0; 
          const isSelected = selectedSquare === i; 
          const isValidMove = validMoves.some(m => m.to === i);

          return (
            <div key={i} onClick={() => handleSquareClick(i)} className={`w-full h-full flex items-center justify-center relative ${isDark ? 'bg-[#5c4033]' : 'bg-[#e0c9a6]'} ${isSelected ? 'ring-inset ring-4 ring-yellow-400' : ''} ${isValidMove ? 'cursor-pointer' : ''}`}>
              {isValidMove && !cell && <div className="w-4 h-4 bg-black/30 rounded-full" />}
              {cell && (
                <div className={`w-[80%] h-[80%] rounded-full shadow-[0_4px_4px_rgba(0,0,0,0.5)] border-2 flex items-center justify-center ${cell.color === 'w' ? 'bg-slate-200 border-white' : 'bg-slate-800 border-slate-900'}`}>
                  {cell.isKing && <Crown className={`w-1/2 h-1/2 ${cell.color === 'w' ? 'text-slate-800' : 'text-slate-300'}`} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}