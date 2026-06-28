import React, { useState } from 'react';
import { Eye, Crown, Users, Loader2, Check, X } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { playSound } from '../../utils/sound.js';

export default function TicTacToeGame({ roomData, roomCode, user, db, appId, leaveRoom }) {
  const isPlayer1 = roomData.players[0] === user.uid; 
  const isPlayer2 = roomData.players?.[1] === user.uid; 
  const isSpectator = !isPlayer1 && !isPlayer2; 
  const mySymbol = isPlayer1 ? 'X' : (isPlayer2 ? 'O' : null);
  const isMyTurn = roomData.turn === user.uid;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const p1Uid = roomData.players[0]; const p2Uid = roomData.players?.[1];
  const p1Name = roomData.playerNames?.[p1Uid] || 'Oyuncu 1'; const p2Name = roomData.playerNames?.[p2Uid] || 'Oyuncu 2';
  const p1Score = roomData.scores?.[p1Uid] || 0; const p2Score = roomData.scores?.[p2Uid] || 0;

  const handleMove = async (index) => {
    if (!isMyTurn || isSpectator || roomData.board[index] || roomData.winner || roomData.status === 'abandoned' || isSubmitting) return;
    setIsSubmitting(true);
    try {
      playSound('move'); const newBoard = [...roomData.board]; newBoard[index] = mySymbol;
      const lines = [ [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6] ];
      let winInfo = null; for (let i = 0; i < lines.length; i++) { const [a,b,c] = lines[i]; if (newBoard[a] && newBoard[a]===newBoard[b] && newBoard[a]===newBoard[c]) winInfo = {winner: newBoard[a], line: lines[i]}; }
      const nextTurn = roomData.players.find(id => id !== user.uid) || null; 
      let up = { board: newBoard, turn: winInfo ? null : nextTurn, winner: winInfo ? winInfo.winner : (newBoard.every(c => c) ? 'Draw' : null), winningLine: winInfo?.line || null };
      if (winInfo) { playSound('win'); const wUid = winInfo.winner === 'X' ? p1Uid : p2Uid; up.scores = { ...roomData.scores, [wUid]: (roomData.scores?.[wUid] || 0) + 1 }; }
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), up);
    } catch(err) {} finally { setIsSubmitting(false); }
  };

  const requestRematch = async () => { if (isSpectator) return; await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { rematchRequestedBy: user.uid }); };
  const acceptRematch = async () => {
    if (isSpectator) return; const nextStarter = roomData.players.find(id => id !== roomData.startingPlayer) || roomData.players[0];
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { board: Array(9).fill(null), turn: nextStarter, startingPlayer: nextStarter, winner: null, winningLine: null, rematchRequestedBy: null });
  };
  const rejectRematch = async () => { if (isSpectator) return; await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { status: 'closed', closedBy: user.uid }); };

  let statusMsg = ""; let statusColor = "text-slate-300";
  if (roomData.winner) {
    if (roomData.winner === 'Draw') { statusMsg = "Oyun Berabere!"; statusColor = "text-yellow-400"; }
    else {
      const winnerUid = roomData.winner === 'X' ? p1Uid : p2Uid;
      if (isSpectator) { statusMsg = `${roomData.playerNames[winnerUid]} Kazandı! 🎉`; statusColor = roomData.winner === 'X' ? "text-indigo-400" : "text-purple-400"; }
      else if (roomData.winner === mySymbol) { statusMsg = "Kazandın! 🎉"; statusColor = "text-green-400"; }
      else { statusMsg = "Kaybettin! 😢"; statusColor = "text-red-400"; }
    }
  } else {
    if (isSpectator) { statusMsg = roomData.turn === p1Uid ? `${p1Name} Hamle Yapıyor...` : `${p2Name} Hamle Yapıyor...`; statusColor = roomData.turn === p1Uid ? "text-indigo-400" : "text-purple-400"; }
    else { statusMsg = isMyTurn ? "Senin Sıran!" : "Rakibin Sırası..."; statusColor = isMyTurn ? "text-indigo-400" : "text-slate-400"; }
  }

  return (
     <div className="relative flex flex-col items-center w-full max-w-md bg-gradient-to-br from-indigo-900/60 to-purple-900/60 p-4 md:p-8 rounded-[2rem] border border-indigo-500/40 shadow-xl overflow-hidden">
        <h2 className="text-2xl font-bold mb-6 text-slate-200 z-10 tracking-widest drop-shadow-md">Tic-Tac-Toe</h2>
        <div className="w-full flex flex-col items-center z-10">
          <div className="flex flex-col w-full mb-6 bg-slate-900/80 backdrop-blur-md p-4 rounded-xl border border-indigo-500/30 shadow-lg">
            {isSpectator && <div className="text-center text-xs text-yellow-400 font-bold mb-3 tracking-widest uppercase flex items-center justify-center gap-1"><Eye className="w-4 h-4" /> SEYİRCİ MODU</div>}
            <div className={`text-center font-bold text-xl md:text-2xl mb-4 ${statusColor} drop-shadow-md`}>{statusMsg}</div>
            <div className="flex justify-between items-start w-full px-2">
              <div className={`text-center flex flex-col items-center text-indigo-400 flex-1 min-w-0 p-1 rounded-lg transition-colors ${roomData.turn === p1Uid ? 'bg-slate-700/50 ring-1 ring-indigo-400/50' : ''}`}><div className="flex items-center gap-1 mb-1 shrink-0">{p1Score > p2Score && <Crown className="w-4 h-4 text-yellow-400 drop-shadow-md" />}<span className="text-2xl font-bold">X</span></div><div className="text-xs truncate w-full px-1 font-medium">{p1Name} {isPlayer1 ? '(Sen)' : ''}</div><div className="text-xl font-mono font-bold text-white mt-1 shrink-0">{p1Score}</div></div>
              <div className="text-slate-500 font-bold text-xl md:text-2xl shrink-0 px-4 opacity-50 flex items-center justify-center h-full pt-4">VS</div>
              <div className={`text-center flex flex-col items-center text-purple-400 flex-1 min-w-0 p-1 rounded-lg transition-colors ${roomData.turn === p2Uid ? 'bg-slate-700/50 ring-1 ring-purple-400/50' : ''}`}><div className="flex items-center gap-1 mb-1 shrink-0">{p2Score > p1Score && <Crown className="w-4 h-4 text-yellow-400 drop-shadow-md" />}<span className="text-2xl font-bold">O</span></div><div className="text-xs truncate w-full px-1 font-medium">{p2Name} {isPlayer2 ? '(Sen)' : ''}</div><div className="text-xl font-mono font-bold text-white mt-1 shrink-0">{p2Score}</div></div>
            </div>
            <div className="text-[10px] text-slate-500 font-bold tracking-widest flex items-center justify-center gap-1 mt-3"><Users className="w-3 h-3"/> {roomData.spectators?.length || 0} İzleyici</div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3 w-fit mb-8 p-3 sm:p-4 bg-slate-800/90 rounded-2xl mx-auto z-10 border border-slate-600">
            {roomData.board.map((cell, index) => (
               <button key={index} onClick={() => handleMove(index)} disabled={!isMyTurn || isSpectator || cell !== null || roomData.winner} className={`w-[80px] h-[80px] sm:w-[90px] sm:h-[90px] rounded-xl text-6xl font-black ${cell === null && isMyTurn && !roomData.winner ? 'hover:bg-slate-700 bg-slate-900 cursor-pointer' : 'bg-slate-900 cursor-default'} ${roomData.winningLine?.includes(index) ? 'border-2 border-indigo-400 bg-indigo-500/40 shadow-lg' : 'border border-slate-700'} ${cell === 'X' ? 'text-indigo-400' : 'text-purple-400'}`}>{cell}</button>
            ))}
          </div>
          {roomData.winner && roomData.status !== 'abandoned' && (
            <div className="w-full flex flex-col items-center bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-indigo-500/30 shadow-lg">
              {isSpectator ? ( <div className="text-slate-400 text-sm py-2 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Oyuncuların kararı bekleniyor...</div> ) : !roomData.rematchRequestedBy ? (
                <button onClick={requestRematch} className="bg-indigo-600 hover:bg-indigo-500 w-full py-3 rounded-xl font-bold text-lg shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.02] hover:shadow-indigo-500/50">Yeniden Oyna</button>
              ) : roomData.rematchRequestedBy === user.uid ? ( <div className="flex items-center gap-3 text-slate-400 py-2"><Loader2 className="w-5 h-5 animate-spin" /><span>Rakibin cevabı bekleniyor...</span></div> ) : (
                <div className="flex flex-col items-center w-full"><span className="text-indigo-200 font-medium mb-3 text-center drop-shadow-md">Rakibiniz rövanş istiyor!</span><div className="flex gap-4 w-full"><button onClick={acceptRematch} className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/40 text-green-400 border border-green-500/50 py-3 rounded-xl font-bold"><Check className="w-5 h-5" /> Kabul Et</button><button onClick={rejectRematch} className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/50 py-3 rounded-xl font-bold"><X className="w-5 h-5" /> Reddet</button></div></div>
              )}
            </div>
          )}
        </div>
        {roomData.status === 'abandoned' && (
          <div className="absolute inset-0 z-[100] bg-slate-900/80 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-[2rem] p-4 text-center transition-all duration-300 transform scale-100 opacity-100">
            <Loader2 className="w-12 h-12 animate-spin text-indigo-500 mb-4 drop-shadow-lg" />
            <h3 className="text-xl font-bold text-white mb-2">Rakip Bekleniyor...</h3>
            <button onClick={leaveRoom} className="mt-8 bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50 px-6 py-2 rounded-lg font-medium transition-colors">Odadan Çık</button>
          </div>
        )}
     </div>
  );
}