import React, { useEffect, useRef, useState } from 'react';
import { Eye, Crown, Users, Loader2, Check, X, Bot } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { playSound } from '../../utils/sound.js';
import {
  CONNECT4_COLS, CONNECT4_ROWS, createInitialConnect4Board,
  findDropRow, isColumnFull, isConnect4BoardFull, checkConnect4Winner,
} from './logic.js';
import { BOT_UID, getBotColumn, DIFFICULTY_LABELS } from './bot.js';

// Kullanıcı isteği: klasik sarı/kırmızı yerine KIRMIZI ve MAVİ oyuncu.
// `connect4-disc-*` sınıfları .connect4-drop animasyonunun YANINDA aşağıdaki
// <style> bloğunda tanımlanır (ahşap görünümü için katmanlı gradient/gölge).
const DISC_CLASS = { red: 'connect4-disc-red', blue: 'connect4-disc-blue' };
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

  // Madde 4 (kullanıcı isteği): kazanan 4'lü dizinin üzerinden geçen görsel
  // bir bağlama çizgisi. Tahta responsive (sm/md/lg breakpoint'lerine göre
  // hücre boyutu DEĞİŞİYOR — bkz. .connect4-hole sınıfları), bu yüzden
  // koordinatlar CSS'ten değil, kazanan İLK ve SON hücrenin GERÇEK DOM
  // konumundan (getBoundingClientRect) ölçülür — hangi breakpoint aktif
  // olursa olsun her zaman doğru hizalanır.
  const boardRef = useRef(null);
  const [winLineCoords, setWinLineCoords] = useState(null);
  useEffect(() => {
    const line = roomData.winningLine;
    if (!line || line.length < 2 || !boardRef.current) { setWinLineCoords(null); return undefined; }
    // Kazanan hücreler her zaman TEK bir düz doğru üzerindedir (yatay/dikey/
    // çapraz) — satır (row) sonra sütun (col) sırasına göre sıralamak, doğrunun
    // yönü ne olursa olsun İKİ UÇ noktayı (ilk/son) doğru şekilde verir.
    const measure = () => {
      const el = boardRef.current;
      if (!el) return;
      const sorted = [...line].sort((a, b) => {
        const ra = Math.floor(a / CONNECT4_COLS); const rb = Math.floor(b / CONNECT4_COLS);
        return ra !== rb ? ra - rb : (a % CONNECT4_COLS) - (b % CONNECT4_COLS);
      });
      const firstEl = el.querySelector(`[data-cell-index="${sorted[0]}"]`);
      const lastEl = el.querySelector(`[data-cell-index="${sorted[sorted.length - 1]}"]`);
      if (!firstEl || !lastEl) { setWinLineCoords(null); return; }
      const boardRect = el.getBoundingClientRect();
      const r1 = firstEl.getBoundingClientRect(); const r2 = lastEl.getBoundingClientRect();
      setWinLineCoords({
        x1: r1.left + r1.width / 2 - boardRect.left,
        y1: r1.top + r1.height / 2 - boardRect.top,
        x2: r2.left + r2.width / 2 - boardRect.left,
        y2: r2.top + r2.height / 2 - boardRect.top,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [roomData.winningLine]);

  return (
    <div className="relative flex flex-col items-center w-full max-w-xl lg:max-w-2xl bg-gradient-to-br from-amber-950/40 to-slate-900 p-4 md:p-8 rounded-[2rem] border border-amber-800/30 shadow-xl overflow-hidden">
      <style>{`
        @keyframes connect4Drop {
          0% { transform: translateY(-520%); opacity: 0.5; }
          65% { transform: translateY(6%); opacity: 1; }
          82% { transform: translateY(-3%); }
          100% { transform: translateY(0); opacity: 1; }
        }
        .connect4-drop { animation: connect4Drop 420ms cubic-bezier(0.33, 0, 0.2, 1) both; }

        /* Gerçekçi AHŞAP tahta: çizgili dokulu (grain) kahverengi gradyan +
           delikleri "oyulmuş" gösteren iç gölgeler. */
        .connect4-board {
          background:
            repeating-linear-gradient(98deg, rgba(0,0,0,0.09) 0px, rgba(0,0,0,0.09) 2px, transparent 2px, transparent 9px),
            linear-gradient(160deg, #a9743f 0%, #8b5a2b 32%, #6b3f1d 66%, #4a2a12 100%);
          box-shadow: inset 0 6px 14px rgba(0,0,0,0.45), inset 0 -8px 18px rgba(0,0,0,0.5), 0 20px 35px rgba(0,0,0,0.5);
          border: 3px solid #3b2412;
        }
        .connect4-hole {
          background: radial-gradient(circle at 38% 32%, #1e293b 0%, #0f172a 55%, #020617 100%);
          box-shadow: inset 0 4px 7px rgba(0,0,0,0.85), inset 0 -2px 3px rgba(255,255,255,0.05);
        }

        /* Taşlar: parlak (lake) cilalı ahşap pul görünümü — üstte bir ışık
           vurgusu (bevel) + kesilmiş odun enine kesitini andıran ince "yıllık
           halka" deseni (repeating-radial-gradient), boyanmış rengin altından
           hafifçe seçiliyor. */
        .connect4-disc-red, .connect4-disc-blue {
          box-shadow: inset 0 -5px 7px rgba(0,0,0,0.35), inset 0 3px 5px rgba(255,255,255,0.3), 0 3px 6px rgba(0,0,0,0.5);
        }
        .connect4-disc-red {
          background:
            repeating-radial-gradient(circle at 38% 32%, rgba(0,0,0,0.12) 0px, rgba(0,0,0,0.12) 1.5px, transparent 1.5px, transparent 6px),
            radial-gradient(circle at 35% 28%, #fca5a5 0%, #ef4444 45%, #b91c1c 85%, #7f1d1d 100%);
          border: 2px solid #7f1d1d;
        }
        .connect4-disc-blue {
          background:
            repeating-radial-gradient(circle at 38% 32%, rgba(0,0,0,0.12) 0px, rgba(0,0,0,0.12) 1.5px, transparent 1.5px, transparent 6px),
            radial-gradient(circle at 35% 28%, #93c5fd 0%, #3b82f6 45%, #1d4ed8 85%, #1e3a8a 100%);
          border: 2px solid #1e3a8a;
        }

        /* Madde 4: kazanma çizgisi — hücrelerin (deliklerin) ÜSTÜNDEN geçtiği
           için deliğe göre daha ince/parlak; uçtan uca "çiziliyormuş" gibi
           kısa bir animasyonla belirir. */
        .connect4-winline {
          stroke: #facc15;
          stroke-width: 6;
          stroke-linecap: round;
          stroke-dasharray: 100;
          stroke-dashoffset: 100;
          filter: drop-shadow(0 0 6px rgba(250,204,21,0.9)) drop-shadow(0 0 2px rgba(255,255,255,0.8));
          animation: connect4WinLineDraw 500ms 120ms ease-out forwards;
        }
        @keyframes connect4WinLineDraw {
          to { stroke-dashoffset: 0; }
        }
      `}</style>

      <h2 className="text-2xl font-bold mb-6 text-slate-200 z-10 tracking-widest drop-shadow-md">Connect 4</h2>

      <div className="w-full flex flex-col items-center z-10">
        <div className="flex flex-col w-full mb-6 bg-slate-900/80 backdrop-blur-md p-4 rounded-xl border border-amber-800/20 shadow-lg">
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

        {/* 1. MADDE (7x6 Tahta): gerçekçi AHŞAP dokulu çerçeve + oyulmuş
            delikler (bkz. üstteki .connect4-board / .connect4-hole). Sütuna
            tıklamak için tüm sütun (üstteki "düşürme" ipucu dahil) tıklanabilir. */}
        <div ref={boardRef} className="connect4-board relative flex gap-0.5 sm:gap-1.5 md:gap-2 lg:gap-2.5 p-1.5 sm:p-3 md:p-4 rounded-2xl mx-auto z-10 max-w-full">
          {Array.from({ length: CONNECT4_COLS }, (_, col) => {
            const colFull = isColumnFull(board, col);
            const clickable = isMyTurn && !roomData.winner && !colFull;
            return (
              <div
                key={col}
                onClick={() => handleColumnClick(col)}
                onMouseEnter={() => setHoveredCol(col)}
                onMouseLeave={() => setHoveredCol((c) => (c === col ? null : c))}
                className={`flex flex-col gap-0.5 sm:gap-1.5 md:gap-2 lg:gap-2.5 rounded-lg transition-colors ${clickable ? 'cursor-pointer hover:bg-white/10' : 'cursor-default'}`}
              >
                {/* Sütun üstü ipucu: sırası gelen oyuncunun taşı nereye
                    düşeceğini önceden görmesi için hayalet bir pul. */}
                <div className="w-8 h-4 sm:w-12 sm:h-5 md:w-14 md:h-6 lg:w-16 lg:h-6 flex items-end justify-center">
                  {canDropInHover && hoveredCol === col && (
                    <span className={`w-6 h-3 sm:w-9 sm:h-4 md:w-11 md:h-5 lg:w-12 lg:h-5 rounded-full opacity-50 ${DISC_CLASS[myColor]}`} />
                  )}
                </div>
                {Array.from({ length: CONNECT4_ROWS }, (_, row) => {
                  const index = row * CONNECT4_COLS + col;
                  const cell = board[index];
                  const isWinningCell = roomData.winningLine?.includes(index);
                  const justDropped = lastMove && lastMove.row === row && lastMove.col === col;
                  return (
                    <div key={row} data-cell-index={index} className="connect4-hole w-8 h-8 sm:w-12 sm:h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 rounded-full flex items-center justify-center overflow-hidden">
                      {cell && (
                        <div
                          className={`w-[85%] h-[85%] rounded-full ${DISC_CLASS[cell]} ${isWinningCell ? 'ring-4 ring-yellow-300 shadow-[0_0_16px_rgba(253,224,71,0.9)] scale-105' : ''} ${justDropped ? 'connect4-drop' : ''}`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {/* Madde 4: kazanan 4'lünün üzerinden geçen bağlama çizgisi.
              `pathLength={100}` sayesinde stroke-dasharray/dashoffset gerçek
              piksel uzunluğundan BAĞIMSIZ (her zaman 0-100 aralığında) çalışır. */}
          {winLineCoords && (
            <svg className="absolute inset-0 pointer-events-none z-30" width="100%" height="100%">
              <line
                x1={winLineCoords.x1} y1={winLineCoords.y1} x2={winLineCoords.x2} y2={winLineCoords.y2}
                pathLength={100}
                className="connect4-winline"
              />
            </svg>
          )}
        </div>

        {roomData.winner && roomData.status !== 'abandoned' && (
          <div className="w-full mt-6 flex flex-col items-center bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-amber-800/20 shadow-lg">
            {isSpectator ? (
              <div className="text-slate-400 text-sm py-2 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Oyuncuların kararı bekleniyor...</div>
            ) : !roomData.rematchRequestedBy ? (
              <button onClick={requestRematch} className="bg-amber-700 hover:bg-amber-600 w-full py-3 rounded-xl font-bold text-lg shadow-lg shadow-amber-800/30 transition-all hover:scale-[1.02] hover:shadow-amber-800/50">Yeniden Oyna</button>
            ) : roomData.rematchRequestedBy === user.uid ? (
              <div className="flex items-center gap-3 text-slate-400 py-2"><Loader2 className="w-5 h-5 animate-spin" /><span>Rakibin cevabı bekleniyor...</span></div>
            ) : (
              <div className="flex flex-col items-center w-full">
                <span className="text-amber-200 font-medium mb-3 text-center drop-shadow-md">Rakibiniz rövanş istiyor!</span>
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
          <Loader2 className="w-12 h-12 animate-spin text-amber-600 mb-4 drop-shadow-lg" />
          <h3 className="text-xl font-bold text-white mb-2">Rakip Bekleniyor...</h3>
          <button onClick={leaveRoom} className="mt-8 bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50 px-6 py-2 rounded-lg font-medium transition-colors">Odadan Çık</button>
        </div>
      )}
    </div>
  );
}
