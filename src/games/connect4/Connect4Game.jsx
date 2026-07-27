import React, { useEffect, useState } from 'react';
import { Eye, Crown, Users, Loader2, Check, X, Bot } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { playSound } from '../../utils/sound.js';
import {
  CONNECT4_COLS, CONNECT4_ROWS, createInitialConnect4Board,
  findDropRow, isColumnFull, isConnect4BoardFull, checkConnect4Winner,
} from './logic.js';
import { BOT_UID, getBotColumn, DIFFICULTY_LABELS } from './bot.js';

// Kullanıcı isteği: klasik sarı/kırmızı yerine KIRMIZI ve MAVİ oyuncu.
const DISC_CLASS = { red: 'bg-gradient-to-br from-red-400 to-red-600 border-red-300', blue: 'bg-gradient-to-br from-blue-400 to-blue-600 border-blue-300' };
const TEXT_CLASS = { red: 'text-red-400', blue: 'text-blue-400' };

// FAZ 2: Minimax + Alpha-Beta budamalı bot yapay zekası (bkz. bot.js).
export default function Connect4Game({ roomData, roomCode, user, db, appId, leaveRoom, isBot = false, botDifficulty = 'medium', setLocalRoomData }) {
  if (!roomData || !roomData.players) return null; // GÜVENLİK: Veri henüz gelmediyse bekle

  const isPlayer1 = roomData.players[0] === user.uid;
  const isPlayer2 = roomData.players?.[1] === user.uid;
  const isSpectator = !isPlayer1 && !isPlayer2;
  const myColor = isPlayer1 ? 'red' : (isPlayer2 ? 'blue' : null);
  const isMyTurn = roomData.turn === user.uid && !isSpectator;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hoveredCol, setHoveredCol] = useState(null);

  const updateRoom = async (patch) => {
    if (isBot) { setLocalRoomData((prev) => ({ ...prev, ...patch })); return; }
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), patch);
  };

  const p1Uid = roomData.players[0]; const p2Uid = roomData.players?.[1];
  const p1Name = roomData.playerNames?.[p1Uid] || 'Oyuncu 1'; const p2Name = roomData.playerNames?.[p2Uid] || 'Oyuncu 2';
  const p1Score = roomData.scores?.[p1Uid] || 0; const p2Score = roomData.scores?.[p2Uid] || 0;

  const board = roomData.board || createInitialConnect4Board();
  const lastMove = roomData.lastMove || null; // { row, col } — bırakma animasyonunu tetiklemek için

  // 2. MADDE (Yerçekimi Mantığı): Oyuncu SÜTUNA tıklar; sistem o sütundaki
  // EN ALT BOŞ hücreyi bulup taşı oraya yerleştirir. Sütun doluysa hamle
  // yapılmaz (findDropRow null döner).
  const handleColumnClick = async (col) => {
    if (!isMyTurn || isSpectator || roomData.winner || roomData.status === 'abandoned' || isSubmitting) return;
    const row = findDropRow(board, col);
    if (row === null) { playSound('error'); return; } // sütun dolu

    setIsSubmitting(true);
    try {
      playSound('move');
      const newBoard = [...board];
      newBoard[row * CONNECT4_COLS + col] = myColor;

      // 3. MADDE (Kazanma Algoritması): yatay, dikey, sağ-çapraz, sol-çapraz
      // yönlerde 4-üst-üste kontrolü. Bulunamazsa ve tahta doluysa berabere.
      const winInfo = checkConnect4Winner(newBoard, row, col);
      const isDraw = !winInfo && isConnect4BoardFull(newBoard);
      const nextTurn = roomData.players.find((id) => id !== user.uid) || null;

      const update = {
        board: newBoard,
        lastMove: { row, col },
        turn: (winInfo || isDraw) ? null : nextTurn,
        winner: winInfo ? winInfo.winner : (isDraw ? 'Draw' : null),
        winningLine: winInfo?.line || null,
      };
      if (winInfo) {
        playSound('win');
        const winnerUid = winInfo.winner === 'red' ? p1Uid : p2Uid;
        update.scores = { ...roomData.scores, [winnerUid]: (roomData.scores?.[winnerUid] || 0) + 1 };
      }
      await updateRoom(update);
    } catch (err) { console.error(err); }
    finally { setIsSubmitting(false); }
  };

  // 4. MADDE (İnsansı Gecikme): sıra bota geldiğinde taşı ANINDA atmaz — 1 ile
  // 2.5 saniye arası rastgele bir "düşünüyor" bekleyişinden sonra Minimax +
  // Alpha-Beta ile bulduğu en iyi sütuna oynar. Mevcut turn/transaction
  // state'lerine dokunmadan, tıpkı bir insan oyuncunun `handleColumnClick`'i
  // gibi aynı board/turn/winner/score güncellemesini üretir.
  useEffect(() => {
    if (!isBot || isSpectator || roomData.turn !== BOT_UID || roomData.winner || roomData.status === 'abandoned') return;
    const botColor = p1Uid === BOT_UID ? 'red' : 'blue';
    const humanColor = botColor === 'red' ? 'blue' : 'red';
    const timer = setTimeout(() => {
      const col = getBotColumn(board, botDifficulty, botColor, humanColor);
      if (col === null || col === undefined) return;
      const row = findDropRow(board, col);
      if (row === null) return;
      playSound('move');
      const newBoard = [...board];
      newBoard[row * CONNECT4_COLS + col] = botColor;
      const winInfo = checkConnect4Winner(newBoard, row, col);
      const isDraw = !winInfo && isConnect4BoardFull(newBoard);
      const update = {
        board: newBoard,
        lastMove: { row, col },
        turn: (winInfo || isDraw) ? null : user.uid,
        winner: winInfo ? winInfo.winner : (isDraw ? 'Draw' : null),
        winningLine: winInfo?.line || null,
      };
      if (winInfo) {
        playSound('win');
        const winnerUid = winInfo.winner === 'red' ? p1Uid : p2Uid;
        update.scores = { ...roomData.scores, [winnerUid]: (roomData.scores?.[winnerUid] || 0) + 1 };
      }
      updateRoom(update);
    }, 1000 + Math.random() * 1500);
    return () => clearTimeout(timer);
  }, [isBot, roomData.turn, roomData.winner, roomData.status]);

  const requestRematch = async () => {
    if (isSpectator) return;
    if (isBot) {
      const nextStarter = roomData.startingPlayer === user.uid ? BOT_UID : user.uid;
      await updateRoom({
        board: createInitialConnect4Board(), turn: nextStarter, startingPlayer: nextStarter,
        winner: null, winningLine: null, lastMove: null, rematchRequestedBy: null,
      });
      return;
    }
    await updateRoom({ rematchRequestedBy: user.uid });
  };
  const acceptRematch = async () => {
    if (isSpectator) return;
    const nextStarter = roomData.players.find((id) => id !== roomData.startingPlayer) || roomData.players[0];
    await updateRoom({
      board: createInitialConnect4Board(), turn: nextStarter, startingPlayer: nextStarter,
      winner: null, winningLine: null, lastMove: null, rematchRequestedBy: null,
    });
  };
  const rejectRematch = async () => {
    if (isSpectator) return;
    if (isBot) { leaveRoom(); return; }
    await updateRoom({ status: 'closed', closedBy: user.uid });
  };

  let statusMsg = ''; let statusColor = 'text-slate-300';
  if (roomData.winner) {
    if (roomData.winner === 'Draw') { statusMsg = 'Oyun Berabere!'; statusColor = 'text-yellow-400'; }
    else {
      const winnerUid = roomData.winner === 'red' ? p1Uid : p2Uid;
      if (isSpectator) { statusMsg = `${roomData.playerNames?.[winnerUid]} Kazandı! 🎉`; statusColor = TEXT_CLASS[roomData.winner]; }
      else if (roomData.winner === myColor) { statusMsg = 'Kazandın! 🎉'; statusColor = 'text-green-400'; }
      else { statusMsg = 'Kaybettin! 😢'; statusColor = 'text-red-400'; }
    }
  } else {
    if (isSpectator) { statusMsg = roomData.turn === p1Uid ? `${p1Name} Hamle Yapıyor...` : `${p2Name} Hamle Yapıyor...`; statusColor = roomData.turn === p1Uid ? TEXT_CLASS.red : TEXT_CLASS.blue; }
    else { statusMsg = isMyTurn ? 'Senin Sıran!' : 'Rakibin Sırası...'; statusColor = isMyTurn ? TEXT_CLASS[myColor] || 'text-indigo-400' : 'text-slate-400'; }
  }

  const canDropInHover = isMyTurn && !roomData.winner && hoveredCol !== null && !isColumnFull(board, hoveredCol);

  return (
    <div className="relative flex flex-col items-center w-full max-w-lg bg-gradient-to-br from-blue-950/60 to-slate-900 p-4 md:p-8 rounded-[2rem] border border-blue-500/30 shadow-xl overflow-hidden">
      <style>{`
        @keyframes connect4Drop {
          0% { transform: translateY(-520%); opacity: 0.5; }
          65% { transform: translateY(6%); opacity: 1; }
          82% { transform: translateY(-3%); }
          100% { transform: translateY(0); opacity: 1; }
        }
        .connect4-drop { animation: connect4Drop 420ms cubic-bezier(0.33, 0, 0.2, 1) both; }
      `}</style>

      <h2 className="text-2xl font-bold mb-6 text-slate-200 z-10 tracking-widest drop-shadow-md">Bağlan 4</h2>

      <div className="w-full flex flex-col items-center z-10">
        <div className="flex flex-col w-full mb-6 bg-slate-900/80 backdrop-blur-md p-4 rounded-xl border border-blue-500/20 shadow-lg">
          {isSpectator && <div className="text-center text-xs text-yellow-400 font-bold mb-3 tracking-widest uppercase flex items-center justify-center gap-1"><Eye className="w-4 h-4" /> SEYİRCİ MODU</div>}
          {isBot && !isSpectator && <div className="text-center text-xs text-indigo-300 font-bold mb-3 tracking-widest uppercase flex items-center justify-center gap-1"><Bot className="w-4 h-4" /> BOTA KARŞI ({DIFFICULTY_LABELS[botDifficulty] || botDifficulty})</div>}
          <div className={`text-center font-bold text-xl md:text-2xl mb-4 ${statusColor} drop-shadow-md`}>{statusMsg}</div>
          <div className="flex justify-between items-start w-full px-2">
            <div className={`text-center flex flex-col items-center ${TEXT_CLASS.red} flex-1 min-w-0 p-1 rounded-lg transition-colors ${roomData.turn === p1Uid ? 'bg-slate-700/50 ring-1 ring-red-400/50' : ''}`}>
              <div className="flex items-center gap-1 mb-1 shrink-0">{p1Score > p2Score && <Crown className="w-4 h-4 text-yellow-400 drop-shadow-md" />}<span className="w-5 h-5 rounded-full bg-gradient-to-br from-red-400 to-red-600 border border-red-300 shadow" /></div>
              <div className="text-xs truncate w-full px-1 font-medium">{p1Name} {isPlayer1 ? '(Sen)' : ''}</div>
              <div className="text-xl font-mono font-bold text-white mt-1 shrink-0">{p1Score}</div>
            </div>
            <div className="text-slate-500 font-bold text-xl md:text-2xl shrink-0 px-4 opacity-50 flex items-center justify-center h-full pt-4">VS</div>
            <div className={`text-center flex flex-col items-center ${TEXT_CLASS.blue} flex-1 min-w-0 p-1 rounded-lg transition-colors ${roomData.turn === p2Uid ? 'bg-slate-700/50 ring-1 ring-blue-400/50' : ''}`}>
              <div className="flex items-center gap-1 mb-1 shrink-0">{p2Score > p1Score && <Crown className="w-4 h-4 text-yellow-400 drop-shadow-md" />}<span className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 border border-blue-300 shadow" /></div>
              <div className="text-xs truncate w-full px-1 font-medium">{p2Name} {isPlayer2 ? '(Sen)' : ''}</div>
              <div className="text-xl font-mono font-bold text-white mt-1 shrink-0">{p2Score}</div>
            </div>
          </div>
          <div className="text-[10px] text-slate-500 font-bold tracking-widest flex items-center justify-center gap-1 mt-3"><Users className="w-3 h-3" /> {roomData.spectators?.length || 0} İzleyici</div>
        </div>

        {/* 1. MADDE (7x6 Tahta): mavi çerçeve + yuvarlak delikler. Sütuna
            tıklamak için tüm sütun (üstteki "düşürme" ipucu dahil) tıklanabilir. */}
        <div className="flex gap-1 sm:gap-1.5 p-2 sm:p-3 bg-gradient-to-b from-blue-700 to-blue-800 rounded-2xl shadow-2xl border-2 border-blue-900 mx-auto z-10">
          {Array.from({ length: CONNECT4_COLS }, (_, col) => {
            const colFull = isColumnFull(board, col);
            const clickable = isMyTurn && !roomData.winner && !colFull;
            return (
              <div
                key={col}
                onClick={() => handleColumnClick(col)}
                onMouseEnter={() => setHoveredCol(col)}
                onMouseLeave={() => setHoveredCol((c) => (c === col ? null : c))}
                className={`flex flex-col gap-1 sm:gap-1.5 rounded-lg transition-colors ${clickable ? 'cursor-pointer hover:bg-white/5' : 'cursor-default'}`}
              >
                {/* Sütun üstü ipucu: sırası gelen oyuncunun taşı nereye
                    düşeceğini önceden görmesi için hayalet bir pul. */}
                <div className="w-8 h-4 sm:w-11 sm:h-5 flex items-end justify-center">
                  {canDropInHover && hoveredCol === col && (
                    <span className={`w-6 h-3 sm:w-8 sm:h-4 rounded-full opacity-50 ${DISC_CLASS[myColor]}`} />
                  )}
                </div>
                {Array.from({ length: CONNECT4_ROWS }, (_, row) => {
                  const index = row * CONNECT4_COLS + col;
                  const cell = board[index];
                  const isWinningCell = roomData.winningLine?.includes(index);
                  const justDropped = lastMove && lastMove.row === row && lastMove.col === col;
                  return (
                    <div key={row} className="w-8 h-8 sm:w-11 sm:h-11 rounded-full bg-slate-950/80 shadow-inner flex items-center justify-center overflow-hidden">
                      {cell && (
                        <div
                          className={`w-[85%] h-[85%] rounded-full border shadow-md ${DISC_CLASS[cell]} ${isWinningCell ? 'ring-4 ring-yellow-300 shadow-[0_0_16px_rgba(253,224,71,0.9)] scale-105' : ''} ${justDropped ? 'connect4-drop' : ''}`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {roomData.winner && roomData.status !== 'abandoned' && (
          <div className="w-full mt-6 flex flex-col items-center bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-blue-500/20 shadow-lg">
            {isSpectator ? (
              <div className="text-slate-400 text-sm py-2 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Oyuncuların kararı bekleniyor...</div>
            ) : !roomData.rematchRequestedBy ? (
              <button onClick={requestRematch} className="bg-blue-600 hover:bg-blue-500 w-full py-3 rounded-xl font-bold text-lg shadow-lg shadow-blue-500/30 transition-all hover:scale-[1.02] hover:shadow-blue-500/50">Yeniden Oyna</button>
            ) : roomData.rematchRequestedBy === user.uid ? (
              <div className="flex items-center gap-3 text-slate-400 py-2"><Loader2 className="w-5 h-5 animate-spin" /><span>Rakibin cevabı bekleniyor...</span></div>
            ) : (
              <div className="flex flex-col items-center w-full">
                <span className="text-blue-200 font-medium mb-3 text-center drop-shadow-md">Rakibiniz rövanş istiyor!</span>
                <div className="flex gap-4 w-full">
                  <button onClick={acceptRematch} className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/40 text-green-400 border border-green-500/50 py-3 rounded-xl font-bold"><Check className="w-5 h-5" /> Kabul Et</button>
                  <button onClick={rejectRematch} className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/50 py-3 rounded-xl font-bold"><X className="w-5 h-5" /> Reddet</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {roomData.status === 'abandoned' && (
        <div className="absolute inset-0 z-[100] bg-slate-900/80 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-[2rem] p-4 text-center transition-all duration-300 transform scale-100 opacity-100">
          <Loader2 className="w-12 h-12 animate-spin text-blue-500 mb-4 drop-shadow-lg" />
          <h3 className="text-xl font-bold text-white mb-2">Rakip Bekleniyor...</h3>
          <button onClick={leaveRoom} className="mt-8 bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50 px-6 py-2 rounded-lg font-medium transition-colors">Odadan Çık</button>
        </div>
      )}
    </div>
  );
}
