// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { Copy, Users, Gamepad2, AlertCircle, Loader2, ArrowLeft, Check, X, Crown, Eye, Dice5 } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, getDoc, updateDoc } from 'firebase/firestore';

// --- FIREBASE INITIALIZATION ---
const firebaseConfig = {
  apiKey: "AIzaSyC2jyw68o1Qd8bwPfPE1u8D3absXrw9rVQ",
  authDomain: "oyun-odasi-8ecee.firebaseapp.com",
  projectId: "oyun-odasi-8ecee",
  storageBucket: "oyun-odasi-8ecee.firebasestorage.app",
  messagingSenderId: "687462141533",
  appId: "1:687462141533:web:443e84d21f13a4a578c7b4",
  measurementId: "G-2DPCSQH143"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = firebaseConfig.projectId;

const GAMES = [
  { id: 'xox', name: 'XOX (Tic-Tac-Toe)', desc: 'Klasik 3x3 strateji oyunu.', available: true, icon: '❌⭕' },
  { id: 'tavla', name: 'Tavla', desc: 'Zar at, pulları topla.', available: true, icon: '🎲' },
  { id: 'satranc', name: 'Satranç', desc: 'Şah mat zamanı.', available: true, icon: '♟️' },
  { id: 'okey101', name: '101 Okey', desc: 'Katlamalı, ceza puanlı efsane.', available: false, icon: '🀄' },
  { id: 'poker', name: 'Texas Hold\'em', desc: 'Blöf ve taktik zamanı.', available: false, icon: '🃏' },
  { id: 'blof', name: 'Blöf', desc: 'Yalan söyleyebilen kazanır.', available: false, icon: '🤫' },
  { id: 'dostkazigi', name: 'Dost Kazığı', desc: 'Arkadaşlıkları bitiren oyun.', available: false, icon: '🤝' },
];

// ==========================================
// SATRANÇ OYUN MANTIĞI VE YARDIMCILARI
// ==========================================
const CHESS_ICONS = { p: '♟\uFE0E', r: '♜\uFE0E', n: '♞\uFE0E', b: '♝\uFE0E', q: '♛\uFE0E', k: '♚\uFE0E' };
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function createInitialChessBoard() {
  const board = Array(64).fill(null);
  const order = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let i = 0; i < 8; i++) {
    board[i] = { type: order[i], color: 'b' };
    board[i + 8] = { type: 'p', color: 'b' };
    board[48 + i] = { type: 'p', color: 'w' };
    board[56 + i] = { type: order[i], color: 'w' };
  }
  return board;
}

function getPseudoLegalMoves(board, index) {
  const piece = board[index];
  if (!piece) return [];
  const moves = [];
  const r = Math.floor(index / 8);
  const c = index % 8;

  const add = (nr, nc) => {
    if (nr < 0 || nr > 7 || nc < 0 || nc > 7) return false;
    const target = board[nr * 8 + nc];
    if (!target) {
      moves.push(nr * 8 + nc);
      return true;
    }
    if (target.color !== piece.color) {
      moves.push(nr * 8 + nc);
    }
    return false;
  };

  if (piece.type === 'p') {
    const dir = piece.color === 'w' ? -1 : 1;
    const startRow = piece.color === 'w' ? 6 : 1;
    if (r + dir >= 0 && r + dir <= 7 && !board[(r + dir) * 8 + c]) {
      moves.push((r + dir) * 8 + c);
      if (r === startRow && !board[(r + 2 * dir) * 8 + c]) {
        moves.push((r + 2 * dir) * 8 + c);
      }
    }
    if (r + dir >= 0 && r + dir <= 7) {
      if (c - 1 >= 0 && board[(r + dir) * 8 + (c - 1)]?.color && board[(r + dir) * 8 + (c - 1)].color !== piece.color) moves.push((r + dir) * 8 + (c - 1));
      if (c + 1 <= 7 && board[(r + dir) * 8 + (c + 1)]?.color && board[(r + dir) * 8 + (c + 1)].color !== piece.color) moves.push((r + dir) * 8 + (c + 1));
    }
  } else if (piece.type === 'n') {
    [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]].forEach(([dr, dc]) => add(r + dr, c + dc));
  } else if (piece.type === 'k') {
    [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]].forEach(([dr, dc]) => add(r + dr, c + dc));
  } else {
    const dirs = [];
    if (piece.type === 'r' || piece.type === 'q') dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
    if (piece.type === 'b' || piece.type === 'q') dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
    dirs.forEach(([dr, dc]) => {
      let nr = r + dr, nc = c + dc;
      while (add(nr, nc)) { nr += dr; nc += dc; }
    });
  }
  return moves;
}

function isSquareAttacked(board, targetIdx, attackerColor) {
  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (piece && piece.color === attackerColor) {
      const moves = getPseudoLegalMoves(board, i);
      if (moves.includes(targetIdx)) return true;
    }
  }
  return false;
}

function getStrictLegalMoves(board, index) {
  const piece = board[index];
  if (!piece) return [];
  const pseudo = getPseudoLegalMoves(board, index);
  const legal = [];
  for (const target of pseudo) {
    const newBoard = [...board];
    newBoard[target] = newBoard[index];
    newBoard[index] = null;
    let kingIdx = -1;
    for (let i = 0; i < 64; i++) {
      if (newBoard[i] && newBoard[i].type === 'k' && newBoard[i].color === piece.color) {
        kingIdx = i; break;
      }
    }
    const enemyColor = piece.color === 'w' ? 'b' : 'w';
    if (kingIdx !== -1 && !isSquareAttacked(newBoard, kingIdx, enemyColor)) {
      legal.push(target);
    }
  }
  return legal;
}

function getGameState(board, nextTurnColor) {
  let hasMoves = false;
  let kingIdx = -1;
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p && p.color === nextTurnColor) {
      if (p.type === 'k') kingIdx = i;
      if (!hasMoves && getStrictLegalMoves(board, i).length > 0) hasMoves = true;
    }
  }
  if (!hasMoves) {
    const enemyColor = nextTurnColor === 'w' ? 'b' : 'w';
    if (kingIdx !== -1 && isSquareAttacked(board, kingIdx, enemyColor)) return 'mate';
    return 'stalemate';
  }
  return 'active';
}

// ==========================================
// TAVLA OYUN MANTIĞI
// ==========================================
function createInitialBoard() {
  const board = Array(24).fill(null).map(() => ({ count: 0, color: null }));
  board[0] = { count: 2, color: 'white' };
  board[11] = { count: 5, color: 'white' };
  board[16] = { count: 3, color: 'white' };
  board[18] = { count: 5, color: 'white' };
  board[23] = { count: 2, color: 'black' };
  board[12] = { count: 5, color: 'black' };
  board[7] = { count: 3, color: 'black' };
  board[5] = { count: 5, color: 'black' };
  return board;
}

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function getValidMoves(board, color, dice, bar, borneOff) {
  const uniqueDice = [...new Set(dice)];
  const moves = []; 
  const direction = color === 'white' ? 1 : -1;
  const homeStart = color === 'white' ? 18 : 0; 
  const homeEnd = color === 'white' ? 23 : 5;   

  const totalPieces = 15;
  const piecesOnBoard = board.reduce((acc, pt) => pt.color === color ? acc + pt.count : acc, 0);
  const piecesOnBar = bar;
  const canBearOff = (piecesOnBoard + piecesOnBar + borneOff === totalPieces) &&
                     (borneOff + piecesOnBoard === totalPieces - piecesOnBar) &&
                     allInHome(board, color, homeStart, homeEnd, piecesOnBar);

  for (const die of uniqueDice) {
    if (bar > 0) {
      const entryIdx = color === 'white' ? die - 1 : 24 - die;
      const pt = board[entryIdx];
      if (!pt || pt.color === null || pt.color === color || pt.count === 1) {
        moves.push({ from: -1, to: entryIdx, die });
      }
      continue;
    }

    for (let i = 0; i < 24; i++) {
      const pt = board[i];
      if (!pt || pt.color !== color || pt.count === 0) continue;
      const toIdx = i + direction * die;

      if (color === 'white' && toIdx >= 24 && canBearOff) {
        const exact = toIdx === 24;
        const highest = highestPiece(board, color, homeStart, homeEnd);
        if (exact || (toIdx > 24 && i === highest)) {
          moves.push({ from: i, to: 24, die });
        }
        continue;
      }
      if (color === 'black' && toIdx < 0 && canBearOff) {
        const exact = toIdx === -1;
        const highest = highestPiece(board, color, homeStart, homeEnd);
        if (exact || (toIdx < -1 && i === highest)) {
          moves.push({ from: i, to: -1, die });
        }
        continue;
      }

      if (toIdx < 0 || toIdx > 23) continue;

      const dest = board[toIdx];
      if (!dest || dest.color === null || dest.color === color || dest.count <= 1) {
        moves.push({ from: i, to: toIdx, die });
      }
    }
  }
  return moves;
}

function allInHome(board, color, homeStart, homeEnd, bar) {
  if (bar > 0) return false;
  for (let i = 0; i < 24; i++) {
    if (i >= homeStart && i <= homeEnd) continue;
    const pt = board[i];
    if (pt && pt.color === color && pt.count > 0) return false;
  }
  return true;
}

function highestPiece(board, color, homeStart, homeEnd) {
  if (color === 'white') {
    for (let i = homeStart; i <= homeEnd; i++) {
      if (board[i] && board[i].color === color && board[i].count > 0) return i;
    }
  } else {
    for (let i = homeEnd; i >= homeStart; i--) {
      if (board[i] && board[i].color === color && board[i].count > 0) return i;
    }
  }
  return -1;
}

function applyMove(board, bar, borneOff, color, from, to, die) {
  const newBoard = board.map(pt => pt ? { ...pt } : { count: 0, color: null });
  const newBar = { ...bar };
  const newBorneOff = { ...borneOff };
  const opp = color === 'white' ? 'black' : 'white';

  if (from === -1) {
    newBar[color] = Math.max(0, newBar[color] - 1);
  } else {
    newBoard[from].count--;
    if (newBoard[from].count === 0) newBoard[from].color = null;
  }

  if ((color === 'white' && to === 24) || (color === 'black' && to === -1)) {
    newBorneOff[color] = (newBorneOff[color] || 0) + 1;
    return { board: newBoard, bar: newBar, borneOff: newBorneOff };
  }

  if (newBoard[to] && newBoard[to].color === opp && newBoard[to].count === 1) {
    newBoard[to] = { count: 0, color: null };
    newBar[opp] = (newBar[opp] || 0) + 1;
  }

  if (!newBoard[to] || newBoard[to].count === 0) {
    newBoard[to] = { count: 1, color };
  } else {
    newBoard[to].count++;
    newBoard[to].color = color;
  }

  return { board: newBoard, bar: newBar, borneOff: newBorneOff };
}

// ==========================================
// ANA APP BİLEŞENİ
// ==========================================

export default function App() {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  
  const [nickname, setNickname] = useState(localStorage.getItem('nickname') || '');
  const [copySuccess, setCopySuccess] = useState(false);

  const [currentView, setCurrentView] = useState('lobby'); 
  const [roomCode, setRoomCode] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  
  const [disconnectCountdown, setDisconnectCountdown] = useState(null);
  const [spectatePrompt, setSpectatePrompt] = useState(null);
  const [leftOverlayTimer, setLeftOverlayTimer] = useState(null); 

  const roomStateRef = useRef({ roomCode, user, roomData });

  useEffect(() => {
    roomStateRef.current = { roomCode, user, roomData };
  }, [roomCode, user, roomData]);

  // Sayfa Yenilendiğinde Odaya Otomatik Bağlanma (Session Storage)
  useEffect(() => {
    const savedCode = sessionStorage.getItem('activeRoom');
    if (savedCode && !roomCode) {
      setRoomCode(savedCode);
    }
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth Error:", err);
        setErrorMsg("Bağlantı hatası oluştu.");
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoadingAuth(false);
    });
    return () => unsubscribe();
  }, []);

  const leaveRoomLocal = () => {
    setRoomCode('');
    setRoomData(null);
    setCurrentView('lobby');
    setDisconnectCountdown(null);
    setSpectatePrompt(null);
    sessionStorage.removeItem('activeRoom');
  };

  useEffect(() => {
    if (leftOverlayTimer === null) return;
    if (leftOverlayTimer <= 0) {
      setLeftOverlayTimer(null);
      return;
    }
    const timer = setTimeout(() => setLeftOverlayTimer(prev => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [leftOverlayTimer]);

  useEffect(() => {
    if (!user || !roomCode) return;

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        
        if (data.status === 'closed') {
          if (currentView === 'room' && data.players.includes(user.uid)) {
            setLeftOverlayTimer(5);
          } else {
             setErrorMsg("Oda kapatıldı.");
          }
          leaveRoomLocal();
        } 
        else if (data.status === 'abandoned') {
          setRoomData(data);
          if (data.players.includes(user.uid)) {
            if (data.abandonedBy !== user.uid && disconnectCountdown === null) {
              setDisconnectCountdown(15);
            }
          } else if (!data.players.includes(user.uid)) {
            setErrorMsg("Oyuncular oyundan ayrıldı. Oda kapandı.");
            leaveRoomLocal();
          }
        } 
        else {
          if (data.status === 'waiting' && data.players.length === 2 && data.host === user.uid) {
            updateDoc(roomRef, { status: 'playing' }).catch(()=>{});
          }
          setRoomData(data);
          setDisconnectCountdown(null);
          setCurrentView('room');
          sessionStorage.setItem('activeRoom', roomCode);
        }
      } else {
        setErrorMsg("Oda bulunamadı veya kapandı.");
        leaveRoomLocal();
      }
    }, (err) => {
      console.error("Listen Error:", err);
      setErrorMsg("Oda verisi alınamadı.");
    });

    return () => unsubscribe();
  }, [user, roomCode, currentView]);

  useEffect(() => {
    if (disconnectCountdown === null || disconnectCountdown === 'paused') return;
    if (disconnectCountdown === 0) {
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
      updateDoc(roomRef, { status: 'closed' }).catch(()=>{});
      setLeftOverlayTimer(5); 
      leaveRoomLocal();
      return;
    }
    const timer = setTimeout(() => {
      setDisconnectCountdown(prev => typeof prev === 'number' ? prev - 1 : prev);
    }, 1000);
    return () => clearTimeout(timer);
  }, [disconnectCountdown, roomCode]);

  useEffect(() => {
    const handleDisconnect = () => {
      const { roomCode: code, user: u, roomData: data } = roomStateRef.current;
      if (code && u && data && data.status === 'playing' && data.players.includes(u.uid)) {
        const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', code);
        updateDoc(roomRef, { status: 'abandoned', abandonedBy: u.uid }).catch(() => {});
      }
    };

    const handleVisibility = () => {
      const { roomCode: code, user: u, roomData: data } = roomStateRef.current;
      if (!code || !u || !data) return;
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', code);
      
      if (document.visibilityState === 'hidden') {
        if (data.status === 'playing' && data.players.includes(u.uid)) {
          updateDoc(roomRef, { status: 'abandoned', abandonedBy: u.uid }).catch(() => {});
        }
      } 
      else if (document.visibilityState === 'visible') {
        if (data.status === 'abandoned' && data.abandonedBy === u.uid) {
          updateDoc(roomRef, { status: 'playing', abandonedBy: null }).catch(() => {});
        }
      }
    };
    
    window.addEventListener('beforeunload', handleDisconnect);
    window.addEventListener('pagehide', handleDisconnect); 
    window.addEventListener('visibilitychange', handleVisibility); 
    
    return () => {
      window.removeEventListener('beforeunload', handleDisconnect);
      window.removeEventListener('pagehide', handleDisconnect);
      window.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const createRoom = async (gameId) => {
    if (!user) return;
    const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', newCode);
    
    const initialState = {
      gameId: gameId,
      host: user.uid,
      players: [user.uid],
      spectators: [],
      playerNames: { [user.uid]: nickname || 'Oyuncu 1' }, 
      scores: { [user.uid]: 0 }, 
      status: 'waiting', 
      board: gameId === 'xox' ? Array(9).fill(null) : null,
      turn: null, 
      startingPlayer: null,
      winner: null,
      rematchRequestedBy: null,
      abandonedBy: null,
      createdAt: new Date().toISOString()
    };

    if (gameId === 'tavla') {
      Object.assign(initialState, {
        dice: [], usedDice: [], phase: 'rolling', bar: {white:0, black:0}, borneOff: {white:0, black:0}, playerColors: {}
      });
    } else if (gameId === 'satranc') {
      Object.assign(initialState, {
        board: createInitialChessBoard(),
        playerColors: {}, captured: { w: [], b: [] }
      });
    }

    try {
      await setDoc(roomRef, initialState);
      setRoomCode(newCode);
      sessionStorage.setItem('activeRoom', newCode);
      setDisconnectCountdown(null);
    } catch (err) {
      setErrorMsg("Oda kurulamadı.");
    }
  };

  const joinRoom = async (code) => {
    if (!user || !code) return;
    const cleanCode = code.trim().toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', cleanCode);
    
    try {
      const roomSnap = await getDoc(roomRef);
      if (!roomSnap.exists()) {
        setErrorMsg("Böyle bir oda kodu yok.");
        return;
      }
      
      const data = roomSnap.data();

      if (data.status === 'closed') {
        setErrorMsg("Bu oda kapalı.");
        return;
      }

      if (data.players.length >= 2 && !data.players.includes(user.uid)) {
        if (data.spectators && data.spectators.includes(user.uid)) {
           setRoomCode(cleanCode);
           sessionStorage.setItem('activeRoom', cleanCode);
           setJoinCodeInput('');
           return;
        }
        setSpectatePrompt(cleanCode);
        return;
      }

      if (!data.players.includes(user.uid)) {
        const updatedPlayers = [...data.players, user.uid];
        const startingPlayer = updatedPlayers[Math.random() < 0.5 ? 0 : 1];
        
        let updatePayload = {
          players: updatedPlayers,
          playerNames: { ...data.playerNames, [user.uid]: nickname || 'Oyuncu 2' },
          scores: { ...data.scores, [user.uid]: 0 },
          status: 'playing', 
          turn: startingPlayer,
          startingPlayer: startingPlayer
        };

        if (data.gameId === 'tavla') {
          const hostColor = data.playerColors?.[data.players[0]] || 'white';
          const joinColor = hostColor === 'white' ? 'black' : 'white';
          updatePayload = {
            ...updatePayload,
            playerColors: { [data.players[0]]: hostColor, [user.uid]: joinColor },
            board: createInitialBoard(),
            bar: { white: 0, black: 0 },
            borneOff: { white: 0, black: 0 },
            dice: [], usedDice: [], phase: 'rolling', winner: null
          };
        } else if (data.gameId === 'satranc') {
          // Satrançta her zaman BEYAZ başlar
          const isHostWhite = Math.random() < 0.5;
          const hostColor = isHostWhite ? 'w' : 'b';
          const joinColor = isHostWhite ? 'b' : 'w';
          const whitePlayerUid = isHostWhite ? data.players[0] : user.uid;
          
          updatePayload = {
            ...updatePayload,
            playerColors: { [data.players[0]]: hostColor, [user.uid]: joinColor },
            board: createInitialChessBoard(),
            captured: { w: [], b: [] },
            turn: whitePlayerUid, 
            startingPlayer: whitePlayerUid,
            winner: null
          };
        }

        await updateDoc(roomRef, updatePayload);
      }
      
      setRoomCode(cleanCode);
      sessionStorage.setItem('activeRoom', cleanCode);
      setJoinCodeInput('');
      setErrorMsg('');
      setDisconnectCountdown(null);
    } catch (err) {
      setErrorMsg("Odaya katılırken bir hata oluştu.");
    }
  };

  const acceptSpectate = async () => {
    if (!spectatePrompt || !user) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', spectatePrompt);
    try {
      const roomSnap = await getDoc(roomRef);
      if (roomSnap.exists()) {
        const data = roomSnap.data();
        const updatedSpectators = data.spectators ? [...data.spectators, user.uid] : [user.uid];
        await updateDoc(roomRef, { spectators: updatedSpectators });
        setRoomCode(spectatePrompt);
        sessionStorage.setItem('activeRoom', spectatePrompt);
        setSpectatePrompt(null);
        setJoinCodeInput('');
        setErrorMsg('');
      }
    } catch (err) {
      setErrorMsg("Seyirci olarak bağlanılamadı.");
    }
  };

  const leaveRoom = async () => {
    const currentCode = roomCode;
    const isPlayer = roomData?.players?.includes(user?.uid);
    leaveRoomLocal();

    if (currentCode && user && isPlayer) {
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentCode);
      try {
        await updateDoc(roomRef, { status: 'closed' });
      } catch (err) {
        console.error("Oda kapatılamadı:", err);
      }
    }
  };

  const copyToClipboard = () => {
    const textArea = document.createElement("textarea");
    textArea.value = roomCode;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000); 
    } catch (err) {
      console.error('Kopyalama başarısız', err);
    }
    document.body.removeChild(textArea);
  };

  if (loadingAuth) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white"><Loader2 className="animate-spin w-8 h-8" /></div>;
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-4 md:p-8 relative">
      
      {/* 5 Saniyelik ZARİF Ayrılma Mesajı */}
      {leftOverlayTimer !== null && currentView === 'lobby' && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/80 flex flex-col items-center justify-center backdrop-blur-sm p-4 h-[100dvh]">
          <div className="bg-slate-800 p-8 rounded-2xl border border-slate-600 shadow-2xl flex flex-col items-center max-w-sm w-full relative animate-in fade-in zoom-in duration-300">
            <button 
              onClick={() => setLeftOverlayTimer(null)} 
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
            <Users className="w-16 h-16 text-red-400 mb-4 opacity-80" />
            <h2 className="text-xl font-bold text-center mb-2">Rakibiniz Ayrıldı</h2>
            <p className="text-slate-400 text-center mb-6 text-sm">Oyun sonlandırıldı ve lobiye döndünüz.</p>
            <div className="w-12 h-12 rounded-full border-4 border-slate-700 flex items-center justify-center font-mono font-bold text-lg text-slate-300">
              {leftOverlayTimer}
            </div>
          </div>
        </div>
      )}

      {/* Bağlantı Kopma Ekranı */}
      {typeof disconnectCountdown === 'number' && roomData?.status === 'abandoned' && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/90 flex flex-col items-center justify-center backdrop-blur-sm p-4 h-[100dvh]">
          <AlertCircle className="w-16 h-16 text-yellow-500 mb-4 animate-pulse" />
          <h2 className="text-2xl font-bold text-center mb-2">Rakibin Bağlantısı Koptu!</h2>
          <p className="text-slate-300 text-center mb-8 max-w-md">
            Rakibiniz oyunu alta almış veya interneti kopmuş olabilir. Otomatik kapanmasına:
          </p>
          <div className="text-5xl font-mono font-bold text-yellow-400 mb-8">
            {disconnectCountdown}
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <button 
              onClick={() => setDisconnectCountdown('paused')}
              className="bg-indigo-600 hover:bg-indigo-500 border border-indigo-400 px-6 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Loader2 className="w-5 h-5 animate-spin" /> Bekle
            </button>
            <button 
              onClick={leaveRoom}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-600 px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Hemen Lobiye Dön
            </button>
          </div>
        </div>
      )}

      {/* Seyirci Modu Onay Ekranı */}
      {spectatePrompt && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/90 flex flex-col items-center justify-center backdrop-blur-sm p-4 h-[100dvh]">
          <Eye className="w-16 h-16 text-indigo-500 mb-4" />
          <h2 className="text-2xl font-bold text-center mb-2">Bu Oda Dolu</h2>
          <p className="text-slate-300 text-center mb-8 max-w-md">
            Odaya zaten iki oyuncu bağlanmış durumda. Maçı seyirci olarak izlemek ister misiniz?
          </p>
          <div className="flex gap-4">
            <button onClick={acceptSpectate} className="bg-indigo-600 hover:bg-indigo-500 px-6 py-3 rounded-lg font-bold transition-colors">
              İzle
            </button>
            <button onClick={() => setSpectatePrompt(null)} className="bg-slate-800 hover:bg-slate-700 border border-slate-600 px-6 py-3 rounded-lg font-medium transition-colors">
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {/* HATA MESAJI (TOAST) */}
      {errorMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 w-[90%] max-w-md z-[99999] bg-red-500/95 backdrop-blur-sm border border-red-400 text-white p-4 rounded-xl flex items-center gap-3 shadow-2xl animate-in slide-in-from-top-4">
          <AlertCircle className="w-6 h-6 shrink-0" />
          <span className="font-medium text-sm md:text-base flex-grow text-center">{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="bg-black/20 hover:bg-black/40 p-1 rounded transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      <header className="max-w-5xl mx-auto flex items-center justify-between mb-8 pb-4 border-b border-slate-700 mt-4 md:mt-0">
        <div className="flex items-center gap-3">
          <Gamepad2 className="w-8 h-8 text-indigo-400" />
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            Masa Oyunları Portalı
          </h1>
        </div>
        <div className="text-xs text-slate-400 bg-slate-800 px-3 py-1 rounded-full truncate max-w-[120px]">
          {nickname || `Oyuncu: ${user?.uid.substring(0,4)}`}
        </div>
      </header>

      {currentView === 'lobby' ? (
        <main className="max-w-5xl mx-auto">
          <div className="bg-slate-800 p-6 rounded-xl mb-6 shadow-lg border border-slate-700 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold mb-1">Oyuncu İsmin</h2>
              <p className="text-sm text-slate-400">Oyunlarda bu isimle görüneceksin.</p>
            </div>
            <input 
              type="text" placeholder="İsmini yaz..." value={nickname}
              onChange={(e) => { setNickname(e.target.value); localStorage.setItem('nickname', e.target.value); }}
              className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-center w-full md:w-64 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" maxLength={15}
            />
          </div>

          <div className="bg-slate-800 p-6 rounded-xl mb-8 shadow-xl border border-slate-700 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold mb-1">Davet Kodun Var Mı?</h2>
              <p className="text-sm text-slate-400">Arkadaşının gönderdiği 6 haneli kodu gir ve masaya otur.</p>
            </div>
            <div className="flex w-full md:w-auto gap-2">
              <input type="text" placeholder="Örn: AB12CD" value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 uppercase tracking-widest text-center w-full md:w-40 focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono" maxLength={6}
              />
              <button onClick={() => joinRoom(joinCodeInput)} className="bg-indigo-500 hover:bg-indigo-600 px-6 py-2 rounded-lg font-medium transition-colors">
                Katıl
              </button>
            </div>
          </div>

          <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
            <Users className="w-6 h-6 text-slate-400" /> Oda Kur & Oyun Seç
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {GAMES.map(game => {
              const isPremium = game.available && (game.id === 'xox' || game.id === 'tavla' || game.id === 'satranc');
              return (
                <div 
                  key={game.id} 
                  className={`p-6 rounded-xl border-2 flex flex-col transition-all duration-300 relative overflow-hidden
                    ${!game.available ? 'bg-slate-800/60 border-slate-700 opacity-70 grayscale' : ''}
                    ${isPremium ? 'bg-slate-800 border-indigo-500/40 hover:border-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.15)] cursor-pointer hover:-translate-y-1' : ''}
                    ${game.available && !isPremium ? 'bg-slate-800 border-slate-600 hover:border-indigo-400 hover:bg-slate-700 cursor-pointer' : ''}
                  `}
                >
                  {/* Oyunlara Özel Arkaplan Işıkları */}
                  {game.id === 'xox' && (
                    <>
                       <div className="absolute -top-10 -left-10 w-32 h-32 bg-indigo-500/20 blur-[40px] rounded-full pointer-events-none"></div>
                       <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-purple-500/20 blur-[40px] rounded-full pointer-events-none"></div>
                    </>
                  )}
                  {game.id === 'tavla' && (
                    <>
                       <div className="absolute -top-10 -left-10 w-32 h-32 bg-amber-600/20 blur-[40px] rounded-full pointer-events-none"></div>
                       <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-orange-700/20 blur-[40px] rounded-full pointer-events-none"></div>
                    </>
                  )}
                  {game.id === 'satranc' && (
                    <>
                       <div className="absolute -top-10 -left-10 w-32 h-32 bg-emerald-500/20 blur-[40px] rounded-full pointer-events-none"></div>
                       <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-teal-500/20 blur-[40px] rounded-full pointer-events-none"></div>
                    </>
                  )}

                  <div className="text-4xl mb-4 relative z-10 drop-shadow-md">{game.icon}</div>
                  <h3 className="text-xl font-bold mb-2 relative z-10">{game.name}</h3>
                  <p className="text-sm text-slate-400 flex-grow mb-6 relative z-10">{game.desc}</p>
                  
                  {game.available ? (
                    <button 
                      onClick={() => createRoom(game.id)} 
                      className={`w-full relative z-10 py-2.5 rounded-lg font-bold transition-colors border
                        ${game.id === 'xox' ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50 hover:bg-indigo-600 hover:text-white' : ''}
                        ${game.id === 'tavla' ? 'bg-amber-600/20 text-amber-300 border-amber-600/50 hover:bg-amber-600 hover:text-white' : ''}
                        ${game.id === 'satranc' ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/50 hover:bg-emerald-600 hover:text-white' : ''}
                      `}
                    >
                      Oda Kur
                    </button>
                  ) : (
                    <button disabled className="w-full relative z-10 bg-slate-700 text-slate-400 py-2.5 rounded-lg font-medium cursor-not-allowed">Çok Yakında</button>
                  )}
                </div>
              )
            })}
          </div>
        </main>
      ) : (
        <main className="max-w-5xl mx-auto flex flex-col items-center">
          <div className="w-full flex items-center justify-between mb-8">
            <button onClick={leaveRoom} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" /> Lobiden Çık
            </button>
            <div className="flex items-center gap-4 bg-slate-800 px-4 py-2 rounded-full border border-slate-700 shadow-md">
              <span className="text-sm text-slate-400 hidden md:block">Oda Kodu:</span>
              <span className="font-mono font-bold tracking-wider text-indigo-300 text-lg">{roomCode}</span>
              <button onClick={copyToClipboard} className="text-slate-400 hover:text-white relative" title="Kodu Kopyala">
                {copySuccess ? <Check className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5" />}
                {copySuccess && <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-700 text-white text-xs px-2 py-1 rounded shadow-lg">Kopyalandı!</span>}
              </button>
            </div>
          </div>

          <div className="w-full bg-slate-800 rounded-2xl p-4 md:p-8 shadow-2xl border border-slate-700 flex flex-col items-center">
            {roomData?.status === 'waiting' ? (
              <div className="text-center py-12">
                <Loader2 className="w-12 h-12 animate-spin text-indigo-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold mb-2">Rakip Bekleniyor...</h2>
                <p className="text-slate-400 max-w-sm mx-auto mb-6">
                  Arkadaşına oda kodunu gönder. O da bu kodu yazarak masaya katılabilir.
                </p>
                <div className="text-3xl font-mono bg-slate-900 px-6 py-3 rounded-lg border border-slate-600 inline-block shadow-inner">
                  {roomCode}
                </div>
              </div>
            ) : (
              <div className="w-full flex flex-col items-center">
                 {roomData?.gameId === 'xox' && (
                   <TicTacToeGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} />
                 )}
                 {roomData?.gameId === 'tavla' && (
                   <TavlaGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} />
                 )}
                 {roomData?.gameId === 'satranc' && (
                   <ChessGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} />
                 )}
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}

// ==========================================
// TAVLA OYUNU BİLEŞENİ
// ==========================================
function TavlaGame({ roomData, roomCode, user, db, appId, leaveRoom }) {
  const p1Uid = roomData.players[0];
  const p2Uid = roomData.players[1];
  const isSpectator = !roomData.players.includes(user.uid);
  const myColor = roomData.playerColors?.[user.uid] || null;
  const isMyTurn = roomData.turn === user.uid && !isSpectator;
  const myPhase = roomData.phase;

  const [selectedPoint, setSelectedPoint] = useState(null);
  const [rollingDice, setRollingDice] = useState(false);
  const [diceAnim, setDiceAnim] = useState([null, null]);
  const [gameToast, setGameToast] = useState(null);

  const showToast = (msg) => {
    setGameToast(msg);
    setTimeout(() => setGameToast(null), 3500);
  };

  const p1Name = roomData.playerNames?.[p1Uid] || 'Oyuncu 1';
  const p2Name = roomData.playerNames?.[p2Uid] || 'Oyuncu 2';
  const p1Score = roomData.scores?.[p1Uid] || 0;
  const p2Score = roomData.scores?.[p2Uid] || 0;
  const p1Color = roomData.playerColors?.[p1Uid] || 'white';
  const p2Color = roomData.playerColors?.[p2Uid] || 'black';

  const board = roomData.board || createInitialBoard();
  const bar = roomData.bar || { white: 0, black: 0 };
  const borneOff = roomData.borneOff || { white: 0, black: 0 };
  const dice = roomData.dice || [];
  const usedDice = roomData.usedDice || [];

  const remainingDice = (() => {
    const d = [...dice];
    const u = [...usedDice];
    for (const v of u) {
      const i = d.indexOf(v);
      if (i !== -1) d.splice(i, 1);
    }
    return d;
  })();

  const validMoves = (isMyTurn && myPhase === 'moving' && remainingDice.length > 0)
    ? getValidMoves(board, myColor, remainingDice, bar[myColor] || 0, borneOff[myColor] || 0)
    : [];

  const validFromPoints = new Set(validMoves.map(m => m.from));
  const validToPoints = selectedPoint !== null
    ? new Set(validMoves.filter(m => m.from === selectedPoint).map(m => m.to))
    : new Set();

  const handleRollDice = async () => {
    if (!isMyTurn || myPhase !== 'rolling' || rollingDice) return;
    setRollingDice(true);

    const d1 = rollDie(), d2 = rollDie();
    const finalDice = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
    setDiceAnim([d1, d2]);
    
    setTimeout(async () => {
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
      const moves = getValidMoves(board, myColor, finalDice, bar[myColor] || 0, borneOff[myColor] || 0);
      if (moves.length === 0) {
        showToast("Geçerli hamle yok! Sıra rakibe geçiyor...");
        const oppUid = roomData.players.find(id => id !== user.uid);
        await updateDoc(roomRef, {
          dice: finalDice, usedDice: finalDice,
          phase: 'rolling', turn: oppUid
        });
      } else {
        await updateDoc(roomRef, { dice: finalDice, usedDice: [], phase: 'moving' });
      }
      setRollingDice(false);
    }, 400); 
  };

  const handlePointClick = async (pointIdx) => {
    if (!isMyTurn || myPhase !== 'moving') return;

    if (selectedPoint === null) {
      const hasBar = (bar[myColor] || 0) > 0;
      if (hasBar && pointIdx !== 'bar') return; 
      if (pointIdx === 'bar') {
        if (validFromPoints.has(-1)) setSelectedPoint(-1);
        return;
      }
      if (validFromPoints.has(pointIdx)) setSelectedPoint(pointIdx);
    } else {
      if (pointIdx === selectedPoint || (pointIdx === 'bar' && selectedPoint !== -1)) {
        setSelectedPoint(null);
        return;
      }

      const targetIdx = pointIdx;
      const movesForFrom = validMoves.filter(m => m.from === selectedPoint && m.to === targetIdx);

      if (movesForFrom.length === 0) {
        if (validFromPoints.has(pointIdx)) setSelectedPoint(pointIdx);
        else setSelectedPoint(null);
        return;
      }

      const move = movesForFrom.sort((a, b) => a.die - b.die)[0];
      const { board: newBoard, bar: newBar, borneOff: newBorneOff } = applyMove(
        board, bar, borneOff, myColor, selectedPoint, targetIdx, move.die
      );

      const newUsedDice = [...usedDice, move.die];
      const newRemainingDice = (() => {
        const d = [...dice];
        const u = [...newUsedDice];
        for (const v of u) { const i = d.indexOf(v); if (i !== -1) d.splice(i, 1); }
        return d;
      })();

      setSelectedPoint(null);

      if (newBorneOff[myColor] >= 15) {
        const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
        const newScores = { ...roomData.scores, [user.uid]: (roomData.scores?.[user.uid] || 0) + 1 };
        await updateDoc(roomRef, {
          board: newBoard, bar: newBar, borneOff: newBorneOff,
          dice, usedDice: newUsedDice, winner: user.uid,
          scores: newScores, phase: 'rolling', turn: null
        });
        return;
      }

      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
      if (newRemainingDice.length === 0) {
        const oppUid = roomData.players.find(id => id !== user.uid);
        await updateDoc(roomRef, {
          board: newBoard, bar: newBar, borneOff: newBorneOff,
          dice, usedDice: newUsedDice, phase: 'rolling', turn: oppUid
        });
      } else {
        const nextMoves = getValidMoves(newBoard, myColor, newRemainingDice, newBar[myColor] || 0, newBorneOff[myColor] || 0);
        if (nextMoves.length === 0) {
          showToast("Kalan zarlar için geçerli hamle yok! Sıra geçiyor...");
          const oppUid = roomData.players.find(id => id !== user.uid);
          await updateDoc(roomRef, {
            board: newBoard, bar: newBar, borneOff: newBorneOff,
            dice, usedDice: newUsedDice.concat(newRemainingDice), phase: 'rolling', turn: oppUid
          });
        } else {
          await updateDoc(roomRef, {
            board: newBoard, bar: newBar, borneOff: newBorneOff,
            dice, usedDice: newUsedDice, phase: 'moving', turn: user.uid
          });
        }
      }
    }
  };

  const handleBearOffClick = async () => {
    if (!isMyTurn || myPhase !== 'moving' || selectedPoint === null) return;
    const bearOffTo = myColor === 'white' ? 24 : -1;
    await handlePointClick(bearOffTo);
  };

  const requestRematch = async () => {
    if (isSpectator) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    await updateDoc(roomRef, { rematchRequestedBy: user.uid });
  };

  const acceptRematch = async () => {
    if (isSpectator) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    const nextStarter = roomData.players.find(id => id !== roomData.startingPlayer) || roomData.players[0];
    const newColors = {};
    for (const uid of roomData.players) {
      newColors[uid] = roomData.playerColors[uid] === 'white' ? 'black' : 'white';
    }
    await updateDoc(roomRef, {
      board: createInitialBoard(),
      bar: { white: 0, black: 0 },
      borneOff: { white: 0, black: 0 },
      dice: [], usedDice: [], phase: 'rolling',
      turn: nextStarter, startingPlayer: nextStarter,
      playerColors: newColors,
      winner: null, rematchRequestedBy: null
    });
  };

  const rejectRematch = async () => {
    if (isSpectator) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    await updateDoc(roomRef, { status: 'closed', closedBy: user.uid });
  };

  const isWhitePlayer = myColor === 'white' || isSpectator;
  const winnerName = roomData.winner ? (roomData.winner === p1Uid ? p1Name : p2Name) : null;
  const currentTurnName = roomData.turn === p1Uid ? p1Name : p2Name;
  const canBearOff = isMyTurn && myPhase === 'moving' && selectedPoint !== null && validToPoints.has(myColor === 'white' ? 24 : -1);

  const displayDice = rollingDice ? diceAnim : (remainingDice.length > 0 ? remainingDice : dice);

  const getTopPoints = () => isWhitePlayer
    ? Array.from({ length: 12 }, (_, i) => 12 + i)
    : Array.from({ length: 12 }, (_, i) => 11 - i);

  const getBottomPoints = () => isWhitePlayer
    ? Array.from({ length: 12 }, (_, i) => 11 - i)
    : Array.from({ length: 12 }, (_, i) => 12 + i);

  const topPoints = getTopPoints();
  const bottomPoints = getBottomPoints();

  const renderCheckers = (color, count, isTop, pointIdx) => {
    const isSelected = selectedPoint === pointIdx;
    const maxShow = 5;
    const extra = count > maxShow ? count - maxShow : 0;
    const showCount = Math.min(count, maxShow);

    return (
      <div className={`absolute ${isTop ? 'top-1' : 'bottom-1'} flex flex-col ${isTop ? '' : 'flex-col-reverse'} items-center gap-[1px] w-full z-10 pointer-events-none`}>
        {Array.from({ length: showCount }).map((_, i) => (
          <div key={i} className={`
            w-[14px] h-[14px] sm:w-[24px] sm:h-[24px] md:w-[30px] md:h-[30px] rounded-full flex items-center justify-center text-[8px] sm:text-[10px] md:text-xs font-bold shadow-md
            ${color === 'white' ? 'bg-slate-100 border-2 border-slate-400 text-slate-800' : 'bg-slate-800 border-2 border-slate-600 text-slate-100'}
            ${isSelected ? 'ring-2 ring-yellow-400' : ''}
          `}>
            {i === (isTop ? showCount - 1 : 0) && extra > 0 ? `+${extra}` : ''}
          </div>
        ))}
      </div>
    );
  };

  const renderPoint = (pointIdx, isTop) => {
    const pt = board[pointIdx] || { count: 0, color: null };
    const isSelected = selectedPoint === pointIdx;
    const isValidFrom = isMyTurn && myPhase === 'moving' && validFromPoints.has(pointIdx) && !isSelected;
    const isValidTo = selectedPoint !== null && validToPoints.has(pointIdx);
    const visualIndex = isTop ? topPoints.indexOf(pointIdx) : bottomPoints.indexOf(pointIdx);
    const isDark = visualIndex % 2 === 0;
    const hasBar = (bar?.[myColor] || 0) > 0;
    const clickable = isMyTurn && myPhase === 'moving' && !hasBar;

    return (
      <div
        key={pointIdx}
        onClick={() => clickable && handlePointClick(pointIdx)}
        className={`relative flex-1 flex flex-col items-center h-full group ${isValidFrom || isValidTo ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {isTop ? (
           <svg preserveAspectRatio="none" viewBox="0 0 100 100" className={`absolute inset-0 w-full h-full transition-all ${isSelected ? 'opacity-80' : 'opacity-60'} ${isValidTo ? 'drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]' : ''}`}>
             <polygon points="0,0 100,0 50,100" fill={isValidTo ? '#10b981' : (isDark ? '#7f1d1d' : '#475569')} />
           </svg>
        ) : (
           <svg preserveAspectRatio="none" viewBox="0 0 100 100" className={`absolute inset-0 w-full h-full transition-all ${isSelected ? 'opacity-80' : 'opacity-60'} ${isValidTo ? 'drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]' : ''}`}>
             <polygon points="0,100 100,100 50,0" fill={isValidTo ? '#10b981' : (isDark ? '#7f1d1d' : '#475569')} />
           </svg>
        )}

        {isValidFrom && <div className="absolute inset-x-0 inset-y-1 ring-2 ring-indigo-400 ring-inset rounded-sm pointer-events-none" />}
        {isSelected && <div className="absolute inset-x-0 inset-y-1 bg-yellow-400/20 ring-2 ring-yellow-400 rounded-sm pointer-events-none" />}

        <div className={`absolute ${isTop ? 'bottom-0' : 'top-0'} text-[8px] sm:text-[10px] text-slate-300 font-mono font-bold opacity-50 pointer-events-none`}>
          {pointIdx + 1}
        </div>

        {pt.count > 0 && renderCheckers(pt.color, pt.count, isTop, pointIdx)}
      </div>
    );
  };

  const renderDie = (value, used = false) => {
    const dots = {
      1: [[50, 50]], 2: [[25, 25], [75, 75]], 3: [[25, 25], [50, 50], [75, 75]],
      4: [[25, 25], [75, 25], [25, 75], [75, 75]], 5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
      6: [[25, 20], [75, 20], [25, 50], [75, 50], [25, 80], [75, 80]],
    };
    const positions = value ? (dots[value] || []) : [];
    return (
      <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg relative border-2 transition-all flex items-center justify-center ${used ? 'border-slate-600 bg-slate-700 opacity-40' : 'border-slate-300 bg-slate-100 shadow-lg'}`}>
         {value ? (
            <svg viewBox="0 0 100 100" className="w-full h-full absolute inset-0">
              {positions.map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r="10" fill={used ? '#64748b' : '#0f172a'} />
              ))}
            </svg>
         ) : (
            <span className="text-slate-400 font-bold">?</span>
         )}
      </div>
    );
  };

  return (
    <div className="relative w-full max-w-4xl flex flex-col items-center gap-4 bg-gradient-to-br from-amber-900/40 via-slate-900/80 to-yellow-900/40 p-4 md:p-6 rounded-[2rem] border border-amber-500/30 shadow-[0_0_40px_rgba(217,119,6,0.15)]">
      
      {/* OYUN İÇİ BİLDİRİM (TOAST) */}
      {gameToast && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-red-500/90 text-white px-6 py-3 rounded-xl shadow-2xl font-bold border border-red-400 animate-in fade-in zoom-in duration-300 pointer-events-none text-center">
          {gameToast}
        </div>
      )}

      {/* BAŞLIK VE SKOR */}
      <div className="w-full flex items-center justify-between bg-slate-900/80 rounded-xl p-3 border border-amber-500/30">
        <div className="flex items-center gap-2">
          <div className={`w-4 h-4 rounded-full border-2 ${p1Color === 'white' ? 'bg-slate-100 border-slate-300' : 'bg-slate-800 border-slate-500'}`} />
          <div>
            <div className="text-sm font-bold text-slate-200">{p1Name} {p1Uid === user.uid && !isSpectator ? '(Sen)' : ''}</div>
            <div className="text-[10px] sm:text-xs text-slate-400">{p1Color === 'white' ? 'Beyaz' : 'Siyah'} • {(borneOff?.[p1Color] || 0)}/15 çıktı</div>
          </div>
          {p1Score > p2Score && <Crown className="w-4 h-4 text-yellow-400" />}
        </div>

        <div className="flex flex-col items-center px-2">
          <div className="text-lg font-mono font-bold">{p1Score} — {p2Score}</div>
          <div className="text-[10px] text-slate-500 font-bold tracking-widest">TAVLA</div>
        </div>

        <div className="flex items-center gap-2">
          {p2Score > p1Score && <Crown className="w-4 h-4 text-yellow-400" />}
          <div className="text-right">
            <div className="text-sm font-bold text-slate-200">{p2Name} {p2Uid === user.uid && !isSpectator ? '(Sen)' : ''}</div>
            <div className="text-[10px] sm:text-xs text-slate-400">{p2Color === 'white' ? 'Beyaz' : 'Siyah'} • {(borneOff?.[p2Color] || 0)}/15 çıktı</div>
          </div>
          <div className={`w-4 h-4 rounded-full border-2 ${p2Color === 'white' ? 'bg-slate-100 border-slate-300' : 'bg-slate-800 border-slate-500'}`} />
        </div>
      </div>

      {/* DURUM MESAJI */}
      <div className={`text-center font-bold text-lg drop-shadow-md ${roomData.winner ? 'text-yellow-400' : isMyTurn ? 'text-amber-400' : 'text-slate-400'}`}>
        {isSpectator && <span className="text-xs text-yellow-400 font-bold mr-2 uppercase flex items-center gap-1 justify-center"><Eye className="w-3 h-3" /> SEYİRCİ</span>}
        {roomData.winner ? `🏆 ${winnerName} Kazandı!` : isMyTurn ? (myPhase === 'rolling' ? 'Zarları At!' : 'Hamle Yap') : `${currentTurnName} düşünüyor...`}
      </div>

      {/* ZAR ALANI */}
      <div className="flex flex-wrap items-center justify-center gap-4 bg-slate-900/80 rounded-xl px-4 sm:px-6 py-3 border border-slate-700 shadow-inner">
        <div className="flex gap-2">
          {(displayDice.length > 0 ? displayDice : [null, null]).map((val, i) => (
            <div key={i}>{renderDie(val, false)}</div>
          ))}
        </div>
        {isMyTurn && myPhase === 'rolling' && !roomData.winner && (
          <button onClick={handleRollDice} disabled={rollingDice} className="bg-amber-600 hover:bg-amber-500 disabled:opacity-60 px-4 sm:px-5 py-2 rounded-lg font-bold text-sm sm:text-base transition-colors flex items-center gap-2 shadow-lg hover:shadow-amber-500/50 text-white">
            {rollingDice ? <Loader2 className="w-4 h-4 animate-spin" /> : '🎲'} Zar At
          </button>
        )}
        {isMyTurn && myPhase === 'moving' && remainingDice.length > 0 && (
          <div className="text-xs sm:text-sm text-slate-400">
            Kalan: <span className="font-mono text-amber-300 font-bold">{remainingDice.join(', ')}</span>
          </div>
        )}
      </div>

      {/* ANA TAHTA */}
      <div className="relative w-full aspect-[3/4] sm:aspect-square md:aspect-[4/3] max-w-3xl bg-amber-950/80 border-4 border-amber-900 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.5)] flex flex-col p-1 sm:p-2">
        
        {/* Üst Sıra */}
        <div className="flex-1 w-full flex">
          <div className="flex-1 flex gap-[1px]">
            {topPoints.slice(0, 6).map(idx => renderPoint(idx, true))}
          </div>
          {/* BAR Üst (Siyah Pullar) */}
          <div 
            onClick={() => isMyTurn && myPhase === 'moving' && myColor === 'black' && handlePointClick('bar')}
            className={`w-6 sm:w-12 md:w-16 flex flex-col items-center pt-2 bg-amber-900/40 border-x-4 border-amber-900 cursor-pointer ${selectedPoint === -1 && myColor === 'black' ? 'bg-yellow-500/20' : ''}`}
          >
             {Array.from({ length: Math.min((bar?.black || 0), 4) }).map((_, i) => (
                <div key={i} className="w-[14px] h-[14px] sm:w-[24px] sm:h-[24px] md:w-[30px] md:h-[30px] rounded-full bg-slate-800 border-2 border-slate-600 flex items-center justify-center text-[8px] md:text-xs text-slate-100 font-bold mb-1 shadow-md">
                  {i === 3 && (bar?.black || 0) > 4 ? `+${(bar?.black || 0) - 3}` : ''}
                </div>
             ))}
          </div>
          <div className="flex-1 flex gap-[1px]">
            {topPoints.slice(6, 12).map(idx => renderPoint(idx, true))}
          </div>
        </div>

        {/* Orta Çizgi */}
        <div className="h-6 sm:h-8 md:h-10 w-full flex items-center justify-center bg-amber-900/60 my-1 rounded border-y border-amber-800/50">
          <div className="text-[10px] sm:text-xs text-amber-700 font-black tracking-widest uppercase">Masa Oyunları</div>
        </div>

        {/* Alt Sıra */}
        <div className="flex-1 w-full flex">
          <div className="flex-1 flex gap-[1px]">
            {bottomPoints.slice(0, 6).map(idx => renderPoint(idx, false))}
          </div>
          {/* BAR Alt (Beyaz Pullar) */}
          <div 
            onClick={() => isMyTurn && myPhase === 'moving' && myColor === 'white' && handlePointClick('bar')}
            className={`w-6 sm:w-12 md:w-16 flex flex-col-reverse items-center pb-2 bg-amber-900/40 border-x-4 border-amber-900 cursor-pointer ${selectedPoint === -1 && myColor === 'white' ? 'bg-yellow-500/20' : ''}`}
          >
             {Array.from({ length: Math.min((bar?.white || 0), 4) }).map((_, i) => (
                <div key={i} className="w-[14px] h-[14px] sm:w-[24px] sm:h-[24px] md:w-[30px] md:h-[30px] rounded-full bg-slate-100 border-2 border-slate-400 flex items-center justify-center text-[8px] md:text-xs text-slate-800 font-bold mt-1 shadow-md">
                  {i === 3 && (bar?.white || 0) > 4 ? `+${(bar?.white || 0) - 3}` : ''}
                </div>
             ))}
          </div>
          <div className="flex-1 flex gap-[1px]">
            {bottomPoints.slice(6, 12).map(idx => renderPoint(idx, false))}
          </div>
        </div>
      </div>

      {/* BEARING OFF (ÇIKMA ALANI) + SEÇİLİ BİLGİ */}
      <div className="flex flex-wrap justify-center gap-4 items-center w-full mt-2">
        <div onClick={handleBearOffClick} className={`flex items-center gap-3 p-3 sm:px-6 rounded-xl border-2 transition-all cursor-pointer ${canBearOff ? 'border-emerald-400 bg-emerald-500/20 shadow-[0_0_15px_rgba(52,211,153,0.4)]' : 'border-slate-700 bg-slate-800/60 cursor-default'}`}>
          <div className="text-xs sm:text-sm text-slate-300 font-bold uppercase">Pulları Topla</div>
          <div className="flex gap-2">
            {['white', 'black'].map(color => (
              <div key={color} className="flex flex-col items-center bg-slate-900/50 px-2 py-1 rounded">
                <div className={`w-3 h-3 rounded-full mb-1 ${color === 'white' ? 'bg-slate-100 border border-slate-400' : 'bg-slate-700 border border-slate-500'}`} />
                <div className="text-xs sm:text-sm font-mono font-bold text-slate-300">{borneOff?.[color] || 0}</div>
              </div>
            ))}
          </div>
          {canBearOff && <div className="text-xs sm:text-sm text-emerald-400 font-bold bg-emerald-500/20 px-2 py-1 rounded animate-pulse">Tıkla!</div>}
        </div>

        {selectedPoint !== null && (
          <div className="flex items-center text-xs sm:text-sm text-yellow-400 bg-yellow-400/10 border border-yellow-400/30 px-4 py-3 rounded-xl shadow-lg">
            <span>Seçili: Nokta <strong>{selectedPoint === -1 ? 'BAR' : selectedPoint + 1}</strong> — Hedef seç</span>
            <button onClick={() => setSelectedPoint(null)} className="ml-3 p-1 bg-yellow-400/20 rounded hover:bg-yellow-400/40 text-yellow-200 transition-colors"><X className="w-4 h-4" /></button>
          </div>
        )}
      </div>

      {/* RÖVANŞ EKRANI */}
      {roomData.winner && roomData.status !== 'abandoned' && (
        <div className="w-full max-w-lg bg-slate-900/90 backdrop-blur-md rounded-2xl p-6 border border-amber-500/30 shadow-2xl mt-4">
          {isSpectator ? (
            <div className="text-slate-400 text-sm flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Oyuncuların kararı bekleniyor...</div>
          ) : !roomData.rematchRequestedBy ? (
            <button onClick={requestRematch} className="bg-amber-600 hover:bg-amber-500 w-full py-3 rounded-xl font-bold text-lg shadow-lg transition-all text-white hover:scale-[1.02]">Yeniden Oyna</button>
          ) : roomData.rematchRequestedBy === user.uid ? (
            <div className="flex items-center justify-center gap-3 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /> Rakibin cevabı bekleniyor...</div>
          ) : (
            <div className="flex flex-col items-center w-full gap-4">
              <span className="text-amber-200 font-medium text-center text-lg drop-shadow-sm">Rakibiniz rövanş istiyor!</span>
              <div className="flex gap-4 w-full">
                <button onClick={acceptRematch} className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/40 text-green-400 border border-green-500/50 py-3 rounded-xl font-bold transition-all hover:scale-[1.05]"><Check className="w-5 h-5" /> Kabul Et</button>
                <button onClick={rejectRematch} className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/50 py-3 rounded-xl font-bold transition-all hover:scale-[1.05]"><X className="w-5 h-5" /> Reddet</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==========================================
// XOX (Tic-Tac-Toe) Orijinal ve Kusursuz Versiyon
// ==========================================
function TicTacToeGame({ roomData, roomCode, user, db, appId, leaveRoom }) {
  const isPlayer1 = roomData.players[0] === user.uid;
  const isPlayer2 = roomData.players[1] === user.uid;
  const isSpectator = !isPlayer1 && !isPlayer2; 
  
  const mySymbol = isPlayer1 ? 'X' : (isPlayer2 ? 'O' : null);
  const isMyTurn = roomData.turn === user.uid;

  const p1Uid = roomData.players[0];
  const p2Uid = roomData.players[1];
  
  const p1Name = roomData.playerNames?.[p1Uid] || 'Oyuncu 1';
  const p2Name = roomData.playerNames?.[p2Uid] || 'Oyuncu 2';

  const p1Score = roomData.scores?.[p1Uid] || 0;
  const p2Score = roomData.scores?.[p2Uid] || 0;

  const handleMove = async (index) => {
    if (!isMyTurn || isSpectator || roomData.board[index] || roomData.winner || roomData.status === 'abandoned') return;

    const newBoard = [...roomData.board];
    newBoard[index] = mySymbol;

    const winnerInfo = calculateWinner(newBoard);
    const nextTurn = roomData.players.find(id => id !== user.uid) || user.uid;

    let updatePayload = {
      board: newBoard,
      turn: winnerInfo ? null : nextTurn,
      winner: winnerInfo ? winnerInfo.winner : (newBoard.every(cell => cell) ? 'Draw' : null),
      winningLine: winnerInfo ? winnerInfo.line : null
    };

    if (winnerInfo && winnerInfo.winner) {
      const winnerUid = winnerInfo.winner === 'X' ? p1Uid : p2Uid;
      updatePayload.scores = {
        ...roomData.scores,
        [winnerUid]: (roomData.scores?.[winnerUid] || 0) + 1
      };
    }

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    await updateDoc(roomRef, updatePayload);
  };

  const requestRematch = async () => {
    if (isSpectator) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    await updateDoc(roomRef, { rematchRequestedBy: user.uid });
  };

  const acceptRematch = async () => {
    if (isSpectator) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    const nextStarter = roomData.players.find(id => id !== roomData.startingPlayer) || roomData.players[0];
    
    await updateDoc(roomRef, {
      board: Array(9).fill(null),
      turn: nextStarter, 
      startingPlayer: nextStarter,
      winner: null,
      winningLine: null,
      rematchRequestedBy: null 
    });
  };

  const rejectRematch = async () => {
    if (isSpectator) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    await updateDoc(roomRef, { status: 'closed', closedBy: user.uid });
  };

  const calculateWinner = (squares) => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], 
      [0, 3, 6], [1, 4, 7], [2, 5, 8], 
      [0, 4, 8], [2, 4, 6]             
    ];
    for (let i = 0; i < lines.length; i++) {
      const [a, b, c] = lines[i];
      if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
        return { winner: squares[a], line: lines[i] };
      }
    }
    return null;
  };

  let statusMsg = "";
  let statusColor = "text-slate-300";
  if (roomData.winner) {
    if (roomData.winner === 'Draw') {
      statusMsg = "Oyun Berabere!";
      statusColor = "text-yellow-400";
    } else {
      const winnerUid = roomData.winner === 'X' ? p1Uid : p2Uid;
      if (isSpectator) {
         statusMsg = `${roomData.playerNames[winnerUid]} Kazandı! 🎉`;
         statusColor = roomData.winner === 'X' ? "text-indigo-400" : "text-purple-400";
      } else if (roomData.winner === mySymbol) {
         statusMsg = "Kazandın! 🎉";
         statusColor = "text-green-400";
      } else {
         statusMsg = "Kaybettin! 😢";
         statusColor = "text-red-400";
      }
    }
  } else {
    if (isSpectator) {
      statusMsg = roomData.turn === p1Uid ? `${p1Name} Hamle Yapıyor...` : `${p2Name} Hamle Yapıyor...`;
      statusColor = roomData.turn === p1Uid ? "text-indigo-400" : "text-purple-400";
    } else {
      statusMsg = isMyTurn ? "Senin Sıran!" : "Rakibin Sırası...";
      statusColor = isMyTurn ? "text-indigo-400" : "text-slate-400";
    }
  }

  return (
    <div className="relative flex flex-col items-center w-full max-w-md bg-gradient-to-br from-indigo-900/60 via-slate-900/80 to-purple-900/60 p-4 md:p-8 rounded-[2rem] border border-indigo-500/40 shadow-[0_0_40px_rgba(99,102,241,0.25)] overflow-hidden">
      
      {/* Oyun İsmi */}
      <h2 className="text-2xl font-bold mb-6 text-slate-200 z-10 uppercase tracking-widest drop-shadow-md">
        Tic-Tac-Toe
      </h2>

      {/* Estetik Arka Plan Işıkları (Tema) */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-20 -left-20 w-48 h-48 bg-indigo-500/30 blur-[80px] rounded-full"></div>
        <div className="absolute -bottom-20 -right-20 w-48 h-48 bg-purple-500/30 blur-[80px] rounded-full"></div>
      </div>

      {/* İçerik */}
      <div className="relative z-10 w-full flex flex-col items-center">
        
        {/* İSİM ve SKOR TABLOSU */}
        <div className="flex flex-col w-full mb-6 bg-slate-900/80 backdrop-blur-md p-4 rounded-xl border border-indigo-500/30 shadow-lg">
          {isSpectator && (
            <div className="text-center text-xs text-yellow-400 font-bold mb-3 tracking-widest uppercase flex items-center justify-center gap-1">
              <Eye className="w-4 h-4" /> SEYİRCİ MODU
            </div>
          )}

          <div className={`text-center font-bold text-xl md:text-2xl mb-4 ${statusColor} drop-shadow-md`}>
            {statusMsg}
          </div>
          
          <div className="flex justify-between items-center w-full px-2">
            <div className="text-center flex flex-col items-center text-indigo-400 w-1/3">
              <div className="flex items-center gap-1 mb-1">
                {p1Score > p2Score && <Crown className="w-4 h-4 text-yellow-400 drop-shadow-md" />}
                <span className="text-2xl font-bold">X</span>
              </div>
              <div className="text-xs truncate w-full px-1 font-medium" title={p1Name}>{p1Name} {isPlayer1 ? '(Sen)' : ''}</div>
              <div className="text-xl font-mono font-bold text-white mt-1">{p1Score}</div>
            </div>

            <div className="text-slate-500 font-bold text-xl md:text-2xl w-1/3 text-center opacity-50">
              VS
            </div>

            <div className="text-center flex flex-col items-center text-purple-400 w-1/3">
              <div className="flex items-center gap-1 mb-1">
                {p2Score > p1Score && <Crown className="w-4 h-4 text-yellow-400 drop-shadow-md" />}
                <span className="text-2xl font-bold">O</span>
              </div>
              <div className="text-xs truncate w-full px-1 font-medium" title={p2Name}>{p2Name} {isPlayer2 ? '(Sen)' : ''}</div>
              <div className="text-xl font-mono font-bold text-white mt-1">{p2Score}</div>
            </div>
          </div>
        </div>

        {/* OYUN TAHTASI (BETON GİBİ SABİT KARELER) */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 w-fit mb-8 p-3 sm:p-4 bg-slate-800/90 backdrop-blur-md rounded-2xl shadow-inner border border-slate-600 mx-auto">
          {roomData.board.map((cell, index) => {
            const isWinningCell = roomData.winningLine?.includes(index);
            return (
              <button
                key={index}
                onClick={() => handleMove(index)}
                disabled={!isMyTurn || isSpectator || cell !== null || roomData.winner !== null || roomData.status === 'abandoned'}
                className={`
                  w-[80px] h-[80px] sm:w-[90px] sm:h-[90px] flex-shrink-0 flex items-center justify-center rounded-xl transition-all m-0 p-0 box-border
                  ${cell === null && isMyTurn && !isSpectator && !roomData.winner && roomData.status !== 'abandoned' ? 'hover:bg-slate-700 bg-slate-900 cursor-pointer' : 'bg-slate-900'}
                  ${(cell !== null || !isMyTurn || isSpectator || roomData.winner || roomData.status === 'abandoned') ? 'cursor-default' : ''}
                  ${isWinningCell ? 'bg-indigo-500/40 border-2 border-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.6)]' : 'border border-slate-700 shadow-sm'}
                  ${cell === 'X' ? 'text-indigo-400 drop-shadow-[0_4px_4px_rgba(0,0,0,0.6)]' : 'text-purple-400 drop-shadow-[0_4px_4px_rgba(0,0,0,0.6)]'}
                `}
              >
                <span className="leading-none text-6xl sm:text-7xl font-black select-none pointer-events-none mt-2">{cell}</span>
              </button>
            )
          })}
        </div>

        {/* RÖVANŞ EKRANI */}
        {roomData.winner && roomData.status !== 'abandoned' && (
          <div className="w-full flex flex-col items-center bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-indigo-500/30 shadow-lg">
            {isSpectator ? (
              <div className="text-slate-400 text-sm py-2 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Oyuncuların kararı bekleniyor...
              </div>
            ) : !roomData.rematchRequestedBy ? (
              <button 
                onClick={requestRematch}
                className="bg-indigo-600 hover:bg-indigo-500 w-full py-3 rounded-xl font-bold text-lg shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.02] hover:shadow-indigo-500/50"
              >
                Yeniden Oyna
              </button>
            ) : roomData.rematchRequestedBy === user.uid ? (
              <div className="flex items-center gap-3 text-slate-400 py-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Rakibin cevabı bekleniyor...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center w-full">
                <span className="text-indigo-200 font-medium mb-3 text-center drop-shadow-md">Rakibiniz rövanş istiyor!</span>
                <div className="flex gap-4 w-full">
                  <button onClick={acceptRematch} className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/40 text-green-400 border border-green-500/50 py-3 rounded-xl font-bold transition-all hover:scale-[1.02]">
                    <Check className="w-5 h-5" /> Kabul Et
                  </button>
                  <button onClick={rejectRematch} className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/50 py-3 rounded-xl font-bold transition-all hover:scale-[1.02]">
                    <X className="w-5 h-5" /> Reddet
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// SATRANÇ OYUNU MANTIĞI VE BİLEŞENİ
// ==========================================

function ChessGame({ roomData, roomCode, user, db, appId, leaveRoom }) {
  const p1Uid = roomData.players[0];
  const p2Uid = roomData.players[1];
  const isSpectator = !roomData.players.includes(user.uid);
  const myColor = roomData.playerColors?.[user.uid] || null;
  const isMyTurn = roomData.turn === user.uid && !isSpectator;

  const [selectedSquare, setSelectedSquare] = useState(null);
  const [promotionPrompt, setPromotionPrompt] = useState(null); 

  const p1Name = roomData.playerNames?.[p1Uid] || 'Oyuncu 1';
  const p2Name = roomData.playerNames?.[p2Uid] || 'Oyuncu 2';
  const p1Score = roomData.scores?.[p1Uid] || 0;
  const p2Score = roomData.scores?.[p2Uid] || 0;
  
  const p1Color = roomData.playerColors?.[p1Uid] || 'w';
  const p2Color = roomData.playerColors?.[p2Uid] || 'b';

  const board = roomData.board || createInitialChessBoard();
  
  const validMoves = (selectedSquare !== null && isMyTurn) ? getStrictLegalMoves(board, selectedSquare) : [];

  const executeMove = async (from, to, movingPiece, targetPiece, currentBoard) => {
    currentBoard[to] = movingPiece;
    currentBoard[from] = null;

    const newCaptured = { w: [...(roomData.captured?.w || [])], b: [...(roomData.captured?.b || [])] };
    if (targetPiece) {
        newCaptured[myColor].push(targetPiece.type);
    }

    const oppUid = roomData.players.find(id => id !== user.uid) || user.uid;
    const oppColor = myColor === 'w' ? 'b' : 'w';

    const gameState = getGameState(currentBoard, oppColor);
    let newWinner = null;
    if (gameState === 'mate') {
       newWinner = user.uid; 
    } else if (gameState === 'stalemate') {
       newWinner = 'Draw';
    }

    let updatePayload = {
      board: currentBoard,
      turn: newWinner ? null : oppUid,
      captured: newCaptured,
      winner: newWinner
    };

    if (newWinner && newWinner !== 'Draw') {
      updatePayload.scores = {
        ...roomData.scores,
        [newWinner]: (roomData.scores?.[newWinner] || 0) + 1
      };
    }

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    await updateDoc(roomRef, updatePayload);
    setSelectedSquare(null);
    setPromotionPrompt(null);
  };

  const handleSquareClick = async (index) => {
    if (!isMyTurn || isSpectator || roomData.winner || roomData.status === 'abandoned' || promotionPrompt) return;

    const piece = board[index];

    if (selectedSquare === null || (piece && piece.color === myColor)) {
      if (piece && piece.color === myColor) {
        setSelectedSquare(index === selectedSquare ? null : index);
      }
      return;
    }

    if (validMoves.includes(index)) {
      const newBoard = [...board];
      const movingPiece = { ...newBoard[selectedSquare] };
      const targetPiece = newBoard[index];
      
      const r = Math.floor(index / 8);
      const isPromotion = movingPiece.type === 'p' && ((movingPiece.color === 'w' && r === 0) || (movingPiece.color === 'b' && r === 7));

      if (isPromotion) {
         setPromotionPrompt({ from: selectedSquare, to: index, movingPiece, targetPiece, newBoard });
         return;
      }

      await executeMove(selectedSquare, index, movingPiece, targetPiece, newBoard);
    }
  };

  const requestRematch = async () => {
    if (isSpectator) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    await updateDoc(roomRef, { rematchRequestedBy: user.uid });
  };

  const acceptRematch = async () => {
    if (isSpectator) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    
    const newColors = {};
    let whiteUid = null;
    for (const uid of roomData.players) {
      const c = roomData.playerColors[uid] === 'w' ? 'b' : 'w';
      newColors[uid] = c;
      if (c === 'w') whiteUid = uid;
    }

    await updateDoc(roomRef, {
      board: createInitialChessBoard(),
      turn: whiteUid, 
      startingPlayer: whiteUid,
      playerColors: newColors,
      captured: { w: [], b: [] },
      winner: null,
      rematchRequestedBy: null 
    });
  };

  const rejectRematch = async () => {
    if (isSpectator) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    await updateDoc(roomRef, { status: 'closed', closedBy: user.uid });
  };

  let statusMsg = "";
  let statusColor = "text-slate-300";
  if (roomData.winner) {
    if (roomData.winner === 'Draw') {
        statusMsg = "Pat (Berabere)!";
        statusColor = "text-yellow-400";
    } else {
        const winnerUid = roomData.winner;
        if (isSpectator) {
            statusMsg = `${roomData.playerNames[winnerUid]} Şah Mat Yaptı! 🎉`;
            statusColor = "text-yellow-400";
        } else if (winnerUid === user.uid) {
            statusMsg = "Şah Mat! Kazandın! 🎉";
            statusColor = "text-green-400";
        } else {
            statusMsg = "Şah Mat! Kaybettin 😢";
            statusColor = "text-red-400";
        }
    }
  } else {
    if (isSpectator) {
      statusMsg = roomData.turn === p1Uid ? `${p1Name} Hamle Bekleniyor...` : `${p2Name} Hamle Bekleniyor...`;
      statusColor = "text-emerald-400";
    } else {
      statusMsg = isMyTurn ? "Senin Sıran!" : "Rakibin Sırası...";
      statusColor = isMyTurn ? "text-emerald-400" : "text-slate-400";
    }
  }

  const isBlackPlayer = myColor === 'b';
  const visualIndices = isBlackPlayer 
    ? Array.from({length: 64}, (_, i) => 63 - i) 
    : Array.from({length: 64}, (_, i) => i);

  const wCaptured = roomData.captured?.w || [];
  const bCaptured = roomData.captured?.b || [];
  const wPoints = wCaptured.reduce((acc, p) => acc + PIECE_VALUES[p], 0);
  const bPoints = bCaptured.reduce((acc, p) => acc + PIECE_VALUES[p], 0);
  
  const renderCaptured = (caps, isWhitePieces) => {
    if (!caps || caps.length === 0) return null;
    const sorted = [...caps].sort((a,b) => PIECE_VALUES[b] - PIECE_VALUES[a]);
    return (
        <div className="flex flex-wrap gap-[2px] items-center mt-1">
            {sorted.map((p, i) => (
                <span key={i} className={`text-xl md:text-2xl leading-none drop-shadow-sm ${isWhitePieces ? 'text-white' : 'text-slate-900'}`}>{CHESS_ICONS[p]}</span>
            ))}
        </div>
    );
  };

  return (
    <div className="relative flex flex-col items-center w-full max-w-xl bg-gradient-to-br from-slate-800 to-slate-900 p-4 md:p-6 rounded-[2rem] border border-slate-700 shadow-2xl overflow-hidden">
      
      {/* Puan ve Kullanıcı Tablosu */}
      <div className="w-full flex items-center justify-between bg-slate-900/80 rounded-xl p-3 border border-slate-700/50 mb-4 min-h-[70px]">
        <div className="flex flex-col items-start w-[40%]">
          <div className="flex items-center gap-2">
            <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${p1Color === 'w' ? 'bg-white border-slate-300' : 'bg-slate-900 border-slate-500'}`} />
            <div className="text-sm font-bold text-slate-200 truncate">{p1Name} {p1Uid === user.uid && !isSpectator ? '(Sen)' : ''}</div>
          </div>
          <div className="flex flex-wrap items-center gap-1 mt-1 min-h-[24px]">
             {renderCaptured(p1Color === 'w' ? wCaptured : bCaptured, p1Color === 'w' ? false : true)}
             {p1Color === 'w' && wPoints > bPoints && <span className="text-emerald-400 text-xs font-bold ml-1">+{wPoints - bPoints}</span>}
             {p1Color === 'b' && bPoints > wPoints && <span className="text-emerald-400 text-xs font-bold ml-1">+{bPoints - wPoints}</span>}
          </div>
        </div>

        <div className="flex flex-col items-center px-2 shrink-0">
          <div className="text-lg font-mono font-bold">{p1Score} — {p2Score}</div>
          <div className="text-[10px] text-slate-500 font-bold tracking-widest">SATRANÇ</div>
        </div>

        <div className="flex flex-col items-end w-[40%] text-right">
          <div className="flex items-center justify-end gap-2">
            <div className="text-sm font-bold text-slate-200 truncate">{p2Name} {p2Uid === user.uid && !isSpectator ? '(Sen)' : ''}</div>
            <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${p2Color === 'w' ? 'bg-white border-slate-300' : 'bg-slate-900 border-slate-500'}`} />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1 mt-1 min-h-[24px] flex-row-reverse">
             {renderCaptured(p2Color === 'w' ? wCaptured : bCaptured, p2Color === 'w' ? false : true)}
             {p2Color === 'w' && wPoints > bPoints && <span className="text-emerald-400 text-xs font-bold mr-1">+{wPoints - bPoints}</span>}
             {p2Color === 'b' && bPoints > wPoints && <span className="text-emerald-400 text-xs font-bold mr-1">+{bPoints - wPoints}</span>}
          </div>
        </div>
      </div>

      <div className={`text-center font-bold text-lg mb-4 drop-shadow-md ${statusColor}`}>
        {isSpectator && <span className="text-xs text-yellow-400 font-bold mr-2 uppercase flex items-center justify-center gap-1"><Eye className="w-3 h-3" /> SEYİRCİ</span>}
        {statusMsg}
      </div>

      {/* TAHTA (Tamamen Esnek ve Kare Olmaya Zorlanmış Grid) */}
      <div className="relative w-full max-w-[400px] sm:max-w-[480px] bg-slate-800 p-2 md:p-3 rounded-lg shadow-2xl mx-auto border border-slate-700">
        <div className="grid grid-cols-8 grid-rows-8 w-full aspect-square bg-[#769656] rounded-sm overflow-hidden select-none shadow-inner border-[3px] border-slate-900">
          {visualIndices.map((i) => {
            const cell = board[i];
            const r = Math.floor(i / 8);
            const c = i % 8;
            const isDark = (r + c) % 2 !== 0;
            const isSelected = selectedSquare === i;
            const isValidMove = validMoves.includes(i);
            
            return (
              <div 
                key={i} 
                onClick={() => handleSquareClick(i)}
                className={`
                  w-full h-full flex items-center justify-center relative cursor-pointer
                  ${isDark ? 'bg-[#769656]' : 'bg-[#eeeed2]'}
                  ${isSelected ? 'bg-yellow-400/50' : ''}
                `}
              >
                {/* Geçerli hamle göstergesi */}
                {isValidMove && !cell && <div className="w-4 h-4 md:w-5 md:h-5 bg-black/20 rounded-full" />}
                {isValidMove && cell && <div className="absolute inset-0 border-[4px] md:border-[5px] border-black/20 rounded-full m-1 pointer-events-none" />}
                
                {/* Taşlar */}
                {cell && (
                  <span 
                    className={`text-[32px] sm:text-[45px] md:text-[55px] leading-none drop-shadow-md select-none flex items-center justify-center w-full h-full
                    ${cell.color === 'w' ? 'text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]' : 'text-black drop-shadow-[0_1px_1px_rgba(255,255,255,0.4)]'}`}
                  >
                    {CHESS_ICONS[cell.type]}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* PİYON TERFİ MENÜSÜ (Overlay) */}
        {promotionPrompt && (
           <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center backdrop-blur-sm rounded-lg">
              <div className="bg-slate-800 p-6 rounded-2xl border border-slate-600 shadow-2xl flex flex-col items-center">
                  <h3 className="text-white font-bold mb-4">Piyon Terfisi</h3>
                  <div className="flex gap-4">
                     {['q', 'r', 'b', 'n'].map(type => (
                         <button 
                            key={type}
                            onClick={() => {
                               const promotedPiece = { ...promotionPrompt.movingPiece, type };
                               executeMove(promotionPrompt.from, promotionPrompt.to, promotedPiece, promotionPrompt.targetPiece, promotionPrompt.newBoard);
                            }} 
                            className={`w-16 h-16 md:w-20 md:h-20 rounded-xl bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-4xl md:text-5xl transition-colors border-2 ${myColor === 'w' ? 'text-slate-100' : 'text-slate-900'}`}
                         >
                            {CHESS_ICONS[type]}
                         </button>
                     ))}
                  </div>
              </div>
           </div>
        )}
      </div>

      {roomData.winner && roomData.status !== 'abandoned' && (
        <div className="w-full max-w-[400px] mt-6 flex flex-col items-center bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-slate-700/50 shadow-lg">
          {isSpectator ? (
            <div className="text-slate-400 text-sm py-2 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Oyuncuların kararı bekleniyor...
            </div>
          ) : !roomData.rematchRequestedBy ? (
            <button 
              onClick={requestRematch}
              className="bg-indigo-600 hover:bg-indigo-500 w-full py-3 rounded-xl font-bold text-lg shadow-lg transition-all"
            >
              Yeniden Oyna
            </button>
          ) : roomData.rematchRequestedBy === user.uid ? (
            <div className="flex items-center gap-3 text-slate-400 py-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Rakibin cevabı bekleniyor...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center w-full">
              <span className="text-indigo-200 font-medium mb-3 text-center">Rakibiniz rövanş istiyor!</span>
              <div className="flex gap-4 w-full">
                <button onClick={acceptRematch} className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/40 text-green-400 border border-green-500/50 py-3 rounded-xl font-bold transition-all">
                  <Check className="w-5 h-5" /> Kabul Et
                </button>
                <button onClick={rejectRematch} className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/50 py-3 rounded-xl font-bold transition-all">
                  <X className="w-5 h-5" /> Reddet
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {roomData.status === 'abandoned' && (
        <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-[2rem] p-4 text-center">
          <Loader2 className="w-12 h-12 animate-spin text-emerald-500 mb-4 drop-shadow-lg" />
          <h3 className="text-xl font-bold text-white mb-2">Rakip Bekleniyor...</h3>
          <p className="text-slate-400 text-sm mb-8">Bağlantısı kopan rakibiniz bekleniyor. İsterseniz bu sırada lobiye dönebilirsiniz.</p>
          <button onClick={leaveRoom} className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50 px-6 py-2 rounded-lg font-medium transition-colors">
            Lobiye Dön
          </button>
        </div>
      )}
    </div>
  );
}