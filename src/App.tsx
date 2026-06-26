// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { Copy, Users, Gamepad2, AlertCircle, Loader2, ArrowLeft, Check, X, Crown, Eye, Dice5 } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, getDoc, updateDoc, runTransaction } from 'firebase/firestore';

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
// HATA KALKANI (ERROR BOUNDARY)
// ==========================================
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, errorInfo) { console.error("Kritik Oyun Hatası Yakalandı:", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-slate-900 rounded-2xl border-2 border-red-500/50 shadow-2xl w-full max-w-md mx-auto text-center mt-10 z-50">
          <AlertCircle className="w-16 h-16 text-red-500 mb-4 animate-pulse" />
          <h2 className="text-2xl font-bold text-white mb-2">Sistemde Pürüz Çıktı!</h2>
          <p className="text-slate-400 text-sm mb-6">Oyun motoru geçici bir hata ile karşılaştı.</p>
          <button onClick={() => window.location.reload()} className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg">Masaya Geri Dön</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ==========================================
// SES EFEKTLERİ
// ==========================================
let audioCtx = null;
const playSound = (type) => {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    
    if (type === 'move') { 
      osc.type = 'sine'; osc.frequency.setValueAtTime(400, now); osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
      gain.gain.setValueAtTime(1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'capture') { 
      osc.type = 'square'; osc.frequency.setValueAtTime(150, now); osc.frequency.exponentialRampToValueAtTime(50, now + 0.15);
      gain.gain.setValueAtTime(1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc.start(now); osc.stop(now + 0.15);
    } else if (type === 'dice') { 
      osc.type = 'triangle'; osc.frequency.setValueAtTime(800, now); osc.frequency.setValueAtTime(600, now + 0.05); osc.frequency.setValueAtTime(900, now + 0.1);
      gain.gain.setValueAtTime(0.5, now); gain.gain.linearRampToValueAtTime(0, now + 0.15);
      osc.start(now); osc.stop(now + 0.15);
    } else if (type === 'win') {
      osc.type = 'sine'; osc.frequency.setValueAtTime(400, now); osc.frequency.setValueAtTime(600, now + 0.2); osc.frequency.setValueAtTime(800, now + 0.4);
      gain.gain.setValueAtTime(0.5, now); gain.gain.linearRampToValueAtTime(0, now + 0.6);
      osc.start(now); osc.stop(now + 0.6);
    } else if (type === 'error') {
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, now); gain.gain.setValueAtTime(0.5, now); gain.gain.linearRampToValueAtTime(0, now + 0.2);
      osc.start(now); osc.stop(now + 0.2);
    }
  } catch (e) { console.log('Ses çalınamadı'); }
};

// ==========================================
// SATRANÇ OYUN MANTIĞI
// ==========================================
const CHESS_ICONS = { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' };
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const chessPieceStyle = { fontFamily: '"Segoe UI Symbol", "Arial Unicode MS", serif', fontVariantEmoji: 'text', WebkitTextFillColor: 'currentColor' };

function createInitialChessBoard() {
  const board = Array(64).fill(null);
  const order = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let i = 0; i < 8; i++) {
    board[i] = { type: order[i], color: 'b', hasMoved: false };
    board[i + 8] = { type: 'p', color: 'b', hasMoved: false };
    board[48 + i] = { type: 'p', color: 'w', hasMoved: false };
    board[56 + i] = { type: order[i], color: 'w', hasMoved: false };
  }
  return board;
}

function getPseudoLegalMoves(board, index, checkCastling = true) {
  const piece = board[index];
  if (!piece) return [];
  const moves = [];
  const r = Math.floor(index / 8);
  const c = index % 8;

  const add = (nr, nc) => {
    if (nr < 0 || nr > 7 || nc < 0 || nc > 7) return false;
    const target = board[nr * 8 + nc];
    if (!target) { moves.push(nr * 8 + nc); return true; }
    if (target.color !== piece.color) { moves.push(nr * 8 + nc); }
    return false;
  };

  if (piece.type === 'p') {
    const dir = piece.color === 'w' ? -1 : 1;
    const startRow = piece.color === 'w' ? 6 : 1;
    if (r + dir >= 0 && r + dir <= 7 && !board[(r + dir) * 8 + c]) {
      moves.push((r + dir) * 8 + c);
      if (r === startRow && !board[(r + 2 * dir) * 8 + c]) moves.push((r + 2 * dir) * 8 + c);
    }
    if (r + dir >= 0 && r + dir <= 7) {
      if (c - 1 >= 0 && board[(r + dir) * 8 + (c - 1)]?.color && board[(r + dir) * 8 + (c - 1)].color !== piece.color) moves.push((r + dir) * 8 + (c - 1));
      if (c + 1 <= 7 && board[(r + dir) * 8 + (c + 1)]?.color && board[(r + dir) * 8 + (c + 1)].color !== piece.color) moves.push((r + dir) * 8 + (c + 1));
    }
  } else if (piece.type === 'n') {
    [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]].forEach(([dr, dc]) => add(r + dr, c + dc));
  } else if (piece.type === 'k') {
    [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]].forEach(([dr, dc]) => add(r + dr, c + dc));
    if (checkCastling && !piece.hasMoved) {
      const enemyColor = piece.color === 'w' ? 'b' : 'w';
      if (!isSquareAttacked(board, index, enemyColor)) {
        const rookRight = board[index + 3];
        if (rookRight && rookRight.type === 'r' && !rookRight.hasMoved) {
          if (!board[index + 1] && !board[index + 2] && !isSquareAttacked(board, index + 1, enemyColor) && !isSquareAttacked(board, index + 2, enemyColor)) moves.push(index + 2);
        }
        const rookLeft = board[index - 4];
        if (rookLeft && rookLeft.type === 'r' && !rookLeft.hasMoved) {
          if (!board[index - 1] && !board[index - 2] && !board[index - 3] && !isSquareAttacked(board, index - 1, enemyColor) && !isSquareAttacked(board, index - 2, enemyColor)) moves.push(index - 2);
        }
      }
    }
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
      const moves = getPseudoLegalMoves(board, i, false);
      if (moves.includes(targetIdx)) return true;
    }
  }
  return false;
}

function getStrictLegalMoves(board, index) {
  const piece = board[index];
  if (!piece) return [];
  const pseudo = getPseudoLegalMoves(board, index, true);
  const legal = [];
  for (const target of pseudo) {
    const newBoard = [...board];
    newBoard[target] = newBoard[index];
    newBoard[index] = null;
    let kingIdx = -1;
    for (let i = 0; i < 64; i++) {
      if (newBoard[i] && newBoard[i].type === 'k' && newBoard[i].color === piece.color) { kingIdx = i; break; }
    }
    const enemyColor = piece.color === 'w' ? 'b' : 'w';
    if (kingIdx !== -1 && !isSquareAttacked(newBoard, kingIdx, enemyColor)) legal.push(target);
  }
  return legal;
}

// BUG 8 FIX: Yetersiz materyal kontrolü artık aynı renkli filleri de yakalıyor.
function isInsufficientMaterial(board) {
  const pieces = board.filter(p => p !== null);
  if (pieces.length === 2) return true; // Sadece şahlar
  if (pieces.length === 3) {
    return pieces.some(p => p.type === 'n' || p.type === 'b'); // Şah + At/Fil vs Şah
  }
  // K+Fil vs K+Fil (Aynı renkteki kareler)
  const bishops = pieces.filter(p => p.type === 'b');
  const others = pieces.filter(p => p.type !== 'b' && p.type !== 'k');
  if (others.length === 0 && bishops.length >= 2) {
     let colorSet = new Set();
     for (let i = 0; i < 64; i++) {
        if (board[i] && board[i].type === 'b') {
           const r = Math.floor(i / 8);
           const c = i % 8;
           colorSet.add((r + c) % 2);
        }
     }
     if (colorSet.size === 1) return true;
  }
  return false;
}

// BUG 11 FIX: Rok hakları için 'hasMoved' durumu koda eklendi.
function getBoardStateString(board) {
  return board.map(p => p ? p.color + p.type + (p.hasMoved ? '1' : '0') : '.').join('');
}

function getGameState(board, nextTurnColor, halfmoveClock = 0, history = []) {
  if (isInsufficientMaterial(board)) return 'draw_material';
  if (halfmoveClock >= 100) return 'draw_50move'; 
  
  const currentStateStr = getBoardStateString(board);
  const repCount = history.filter(h => h === currentStateStr).length;
  if (repCount >= 3) return 'draw_repetition';

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
    return 'draw_stalemate';
  }
  return 'active';
}

// ==========================================
// TAVLA OYUN MANTIĞI
// ==========================================
function rollDie() { return Math.floor(Math.random() * 6) + 1; }

function createInitialBoard() {
  const board = Array(24).fill(null).map(() => ({ count: 0, color: null }));
  board[0] = { count: 2, color: 'white' }; board[11] = { count: 5, color: 'white' };
  board[16] = { count: 3, color: 'white' }; board[18] = { count: 5, color: 'white' };
  board[23] = { count: 2, color: 'black' }; board[12] = { count: 5, color: 'black' };
  board[7] = { count: 3, color: 'black' }; board[5] = { count: 5, color: 'black' };
  return board;
}

function applyMove(board, bar, borneOff, color, from, to, die) {
  const newBoard = board.map(pt => pt ? { count: pt.count || 0, color: pt.color || null } : { count: 0, color: null });
  const newBar = { white: bar?.white || 0, black: bar?.black || 0 };
  const newBorneOff = { white: borneOff?.white || 0, black: borneOff?.black || 0 };
  const opp = color === 'white' ? 'black' : 'white';

  if (from === -1) newBar[color] = Math.max(0, (newBar[color] || 0) - 1);
  else {
    newBoard[from].count = Math.max(0, (newBoard[from].count || 0) - 1);
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
    newBoard[to].count = (newBoard[to].count || 0) + 1;
    newBoard[to].color = color;
  }
  return { board: newBoard, bar: newBar, borneOff: newBorneOff };
}

function getBaseValidMoves(board, color, dice, bar, borneOff) {
  if (!board || !color || !dice || dice.length === 0) return [];
  const uniqueDice = [...new Set(dice)];
  const moves = []; 
  const direction = color === 'white' ? 1 : -1;
  const homeStart = color === 'white' ? 18 : 0; 
  const homeEnd = color === 'white' ? 23 : 5;   

  const totalPieces = 15;
  const piecesOnBoard = board.reduce((acc, pt) => pt && pt.color === color ? acc + (pt.count || 0) : acc, 0);
  const piecesOnBar = bar || 0;
  const canBearOff = (piecesOnBoard + piecesOnBar + (borneOff || 0) === totalPieces) &&
                     ((borneOff || 0) + piecesOnBoard === totalPieces - piecesOnBar) &&
                     allInHome(board, color, homeStart, homeEnd, piecesOnBar);

  for (const die of uniqueDice) {
    if (piecesOnBar > 0) {
      const entryIdx = color === 'white' ? die - 1 : 24 - die;
      const pt = board[entryIdx];
      if (!pt || pt.color === null || pt.color === color || pt.count === 1) moves.push({ from: -1, to: entryIdx, die });
      continue;
    }

    for (let i = 0; i < 24; i++) {
      const pt = board[i];
      if (!pt || pt.color !== color || !pt.count) continue;
      const toIdx = i + direction * die;

      if (color === 'white' && toIdx >= 24 && canBearOff) {
        const exact = toIdx === 24;
        const highest = highestPiece(board, color, homeStart, homeEnd);
        if (exact || (toIdx > 24 && i === highest)) moves.push({ from: i, to: 24, die });
        continue;
      }
      if (color === 'black' && toIdx < 0 && canBearOff) {
        const exact = toIdx === -1;
        const highest = highestPiece(board, color, homeStart, homeEnd);
        if (exact || (toIdx < -1 && i === highest)) moves.push({ from: i, to: -1, die });
        continue;
      }

      if (toIdx < 0 || toIdx > 23) continue;
      const dest = board[toIdx];
      if (!dest || dest.color === null || dest.color === color || dest.count <= 1) moves.push({ from: i, to: toIdx, die });
    }
  }
  return moves;
}

function getMaxDiceUsage(board, color, dice, barObj, borneOffObj) {
  if (dice.length === 0) return 0;
  const myBar = barObj[color] || 0;
  const myBorne = borneOffObj[color] || 0;
  const moves = getBaseValidMoves(board, color, dice, myBar, myBorne);
  if (moves.length === 0) return 0;

  let maxUsed = 0;
  for (const move of moves) {
    const { board: nb, bar: nbar, borneOff: nboff } = applyMove(board, barObj, borneOffObj, color, move.from, move.to, move.die);
    const remDice = [...dice]; remDice.splice(remDice.indexOf(move.die), 1);
    const usedHere = 1 + getMaxDiceUsage(nb, color, remDice, nbar, nboff);
    if (usedHere > maxUsed) maxUsed = usedHere;
  }
  return maxUsed;
}

function getStrictValidMoves(board, color, dice, barObj, borneOffObj) {
  const myBar = barObj[color] || 0; const myBorne = borneOffObj[color] || 0;
  const baseMoves = getBaseValidMoves(board, color, dice, myBar, myBorne);
  if (baseMoves.length === 0) return [];

  let globalMaxUsage = 0;
  const movesWithUsage = baseMoves.map(move => {
    const { board: nb, bar: nbar, borneOff: nboff } = applyMove(board, barObj, borneOffObj, color, move.from, move.to, move.die);
    const remDice = [...dice]; remDice.splice(remDice.indexOf(move.die), 1);
    const maxFutureUsage = getMaxDiceUsage(nb, color, remDice, nbar, nboff);
    const totalUsage = 1 + maxFutureUsage;
    if (totalUsage > globalMaxUsage) globalMaxUsage = totalUsage;
    return { move, totalUsage };
  });

  let validMoves = movesWithUsage.filter(m => m.totalUsage === globalMaxUsage).map(m => m.move);
  if (globalMaxUsage === 1 && new Set(dice).size > 1) {
    const maxDiePlayable = Math.max(...validMoves.map(m => m.die));
    validMoves = validMoves.filter(m => m.die === maxDiePlayable);
  }
  return validMoves;
}

function allInHome(board, color, homeStart, homeEnd, bar) {
  if ((bar || 0) > 0) return false;
  for (let i = 0; i < 24; i++) {
    if (i >= homeStart && i <= homeEnd) continue;
    const pt = board[i];
    if (pt && pt.color === color && pt.count > 0) return false;
  }
  return true;
}

function highestPiece(board, color, homeStart, homeEnd) {
  if (color === 'white') {
    for (let i = homeStart; i <= homeEnd; i++) { if (board[i] && board[i].color === color && board[i].count > 0) return i; }
  } else {
    for (let i = homeEnd; i >= homeStart; i--) { if (board[i] && board[i].color === color && board[i].count > 0) return i; }
  }
  return -1;
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

  // BUG 1, 3 FIX: roomStateRef içeriği tam senkronize edildi.
  const roomStateRef = useRef({ roomCode, user, roomData, currentView, disconnectCountdown });
  useEffect(() => {
    roomStateRef.current = { roomCode, user, roomData, currentView, disconnectCountdown };
  }, [roomCode, user, roomData, currentView, disconnectCountdown]);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) { await signInWithCustomToken(auth, __initial_auth_token); } 
        else { await signInAnonymously(auth); }
      } catch (err) { setErrorMsg("Bağlantı hatası oluştu."); }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser); setLoadingAuth(false);
      const savedCode = localStorage.getItem('activeRoom');
      if (savedCode && currentUser) setRoomCode(savedCode);
    });
    return () => unsubscribe();
  }, []);

  const leaveRoomLocal = () => {
    setRoomCode(''); setRoomData(null); setCurrentView('lobby');
    setDisconnectCountdown(null); setSpectatePrompt(null);
    localStorage.removeItem('activeRoom');
  };

  useEffect(() => {
    if (leftOverlayTimer === null) return;
    if (leftOverlayTimer <= 0) { setLeftOverlayTimer(null); return; }
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
          // BUG 3 FIX: currentView undefined olmadığı için artık doğru tetikleniyor
          if (roomStateRef.current.currentView === 'room' && data.players?.includes(user.uid)) {
            if (data.closedBy !== user.uid) setLeftOverlayTimer(5);
          } else {
             setErrorMsg("Oda kapatıldı.");
          }
          leaveRoomLocal();
        } 
        else if (data.status === 'abandoned') {
          setRoomData(data); setCurrentView('room'); 
          if (data.players?.includes(user.uid)) {
            // BUG 2 FIX: Sadece connection düşmesi nedeniyle abandoned olanlar geri oynatılır
            if (data.abandonedBy === user.uid && data.abandonReason !== 'left') {
               updateDoc(roomRef, { status: 'playing', abandonedBy: null, abandonReason: null }).catch(()=>{});
            } else {
               // BUG 1 FIX: State functional update kullanıldı
               setDisconnectCountdown(prev => prev === null ? (data.abandonReason === 'left' ? 5 : 15) : prev);
            }
          } 
        } 
        else {
          if (data.status === 'waiting' && data.players?.length === 2 && data.host === user.uid) {
            updateDoc(roomRef, { status: 'playing' }).catch(()=>{});
          }
          setRoomData(data); setDisconnectCountdown(null); setCurrentView('room');
          localStorage.setItem('activeRoom', roomCode);
        }
      } else {
        leaveRoomLocal();
      }
    });
    return () => unsubscribe();
  }, [user, roomCode]);

  useEffect(() => {
    if (disconnectCountdown === null || disconnectCountdown === 'paused') return;
    if (disconnectCountdown === 0) {
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
      updateDoc(roomRef, { status: 'closed' }).catch(()=>{});
      setLeftOverlayTimer(5); leaveRoomLocal(); return;
    }
    const timer = setTimeout(() => { setDisconnectCountdown(prev => typeof prev === 'number' ? prev - 1 : prev); }, 1000);
    return () => clearTimeout(timer);
  }, [disconnectCountdown, roomCode]);

  useEffect(() => {
    const handleDisconnect = () => {
      const { roomCode: code, user: u, roomData: data } = roomStateRef.current;
      if (code && u && data && data.status === 'playing' && data.players?.includes(u.uid)) {
        const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', code);
        updateDoc(roomRef, { status: 'abandoned', abandonedBy: u.uid }).catch(() => {});
      }
    };
    const handleVisibility = () => {
      const { roomCode: code, user: u, roomData: data } = roomStateRef.current;
      if (!code || !u || !data) return;
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', code);
      if (document.visibilityState === 'hidden') {
        if (data.status === 'playing' && data.players?.includes(u.uid)) {
          updateDoc(roomRef, { status: 'abandoned', abandonedBy: u.uid }).catch(() => {});
        }
      } else if (document.visibilityState === 'visible') {
        if (data.status === 'abandoned' && data.abandonedBy === u.uid) {
          updateDoc(roomRef, { status: 'playing', abandonedBy: null, abandonReason: null }).catch(() => {});
        }
      }
    };
    window.addEventListener('beforeunload', handleDisconnect); window.addEventListener('pagehide', handleDisconnect); window.addEventListener('visibilitychange', handleVisibility); 
    return () => { window.removeEventListener('beforeunload', handleDisconnect); window.removeEventListener('pagehide', handleDisconnect); window.removeEventListener('visibilitychange', handleVisibility); };
  }, []);

  const createRoom = async (gameId) => {
    if (!user) return;
    const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', newCode);
    const initialState = {
      gameId: gameId, host: user.uid, players: [user.uid], spectators: [], playerNames: { [user.uid]: nickname || 'Oyuncu 1' }, 
      scores: { [user.uid]: 0 }, status: 'waiting', board: gameId === 'xox' ? Array(9).fill(null) : null,
      turn: null, startingPlayer: null, winner: null, rematchRequestedBy: null, abandonedBy: null, abandonReason: null, createdAt: new Date().toISOString()
    };
    if (gameId === 'tavla') { Object.assign(initialState, { dice: [], usedDice: [], phase: 'rolling', bar: {white:0, black:0}, borneOff: {white:0, black:0}, playerColors: {} }); } 
    else if (gameId === 'satranc') { Object.assign(initialState, { board: createInitialChessBoard(), playerColors: {}, captured: { w: [], b: [] }, halfmoveClock: 0, positionHistory: [] }); }

    try { await setDoc(roomRef, initialState); setRoomCode(newCode); localStorage.setItem('activeRoom', newCode); setDisconnectCountdown(null); } 
    catch (err) { setErrorMsg("Oda kurulamadı."); }
  };

  const joinRoom = async (code) => {
    if (!user || !code) return;
    const cleanCode = code.trim().toUpperCase(); const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', cleanCode);
    try {
      const roomSnap = await getDoc(roomRef);
      if (!roomSnap.exists()) { setErrorMsg("Böyle bir oda kodu yok."); return; }
      const data = roomSnap.data();
      if (data.status === 'closed') { setErrorMsg("Bu oda kapalı."); return; }

      if (data.players?.length >= 2 && !data.players.includes(user.uid)) {
        if (data.spectators && data.spectators.includes(user.uid)) { setRoomCode(cleanCode); localStorage.setItem('activeRoom', cleanCode); setJoinCodeInput(''); return; }
        setSpectatePrompt(cleanCode); return;
      }

      if (!data.players?.includes(user.uid)) {
        const isResume = data.turn !== null && data.gameId !== undefined;
        const updatedPlayers = [...(data.players || []), user.uid];
        let updatePayload = { players: updatedPlayers, status: 'playing', abandonedBy: null, abandonReason: null };

        if (!isResume) {
          const startingPlayer = updatedPlayers[Math.random() < 0.5 ? 0 : 1];
          updatePayload.playerNames = { ...data.playerNames, [user.uid]: nickname || 'Oyuncu 2' }; updatePayload.scores = { ...data.scores, [user.uid]: 0 }; updatePayload.turn = startingPlayer; updatePayload.startingPlayer = startingPlayer;
          if (data.gameId === 'tavla') {
            const hostColor = data.playerColors?.[data.players[0]] || 'white';
            updatePayload.playerColors = { [data.players[0]]: hostColor, [user.uid]: hostColor === 'white' ? 'black' : 'white' };
            updatePayload.board = createInitialBoard(); updatePayload.bar = { white: 0, black: 0 }; updatePayload.borneOff = { white: 0, black: 0 }; updatePayload.dice = []; updatePayload.usedDice = []; updatePayload.phase = 'rolling'; updatePayload.winner = null;
          } else if (data.gameId === 'satranc') {
            const isHostWhite = Math.random() < 0.5; const hostColor = isHostWhite ? 'w' : 'b'; const whitePlayerUid = isHostWhite ? data.players[0] : user.uid;
            updatePayload.playerColors = { [data.players[0]]: hostColor, [user.uid]: isHostWhite ? 'b' : 'w' }; updatePayload.board = createInitialChessBoard(); updatePayload.captured = { w: [], b: [] }; updatePayload.halfmoveClock = 0; updatePayload.positionHistory = []; updatePayload.turn = whitePlayerUid; updatePayload.startingPlayer = whitePlayerUid; updatePayload.winner = null;
          }
        } else {
          let missingUid = null; if (data.scores) missingUid = Object.keys(data.scores).find(uid => !(data.players || []).includes(uid));
          if (missingUid && missingUid !== user.uid) {
              const newScores = { ...data.scores }; newScores[user.uid] = newScores[missingUid] || 0; delete newScores[missingUid]; updatePayload.scores = newScores;
              const newNames = { ...data.playerNames }; newNames[user.uid] = nickname || 'Oyuncu 2'; delete newNames[missingUid]; updatePayload.playerNames = newNames;
              if (data.playerColors) { const newColors = { ...data.playerColors }; newColors[user.uid] = newColors[missingUid]; delete newColors[missingUid]; updatePayload.playerColors = newColors; }
              if (data.turn === missingUid) updatePayload.turn = user.uid; if (data.startingPlayer === missingUid) updatePayload.startingPlayer = user.uid; if (data.winner === missingUid) updatePayload.winner = user.uid;
          } else { updatePayload.playerNames = { ...data.playerNames, [user.uid]: nickname || data.playerNames?.[user.uid] || 'Oyuncu' }; }
        }
        await updateDoc(roomRef, updatePayload);
      }
      setRoomCode(cleanCode); localStorage.setItem('activeRoom', cleanCode); setJoinCodeInput(''); setErrorMsg(''); setDisconnectCountdown(null);
    } catch (err) { setErrorMsg("Odaya katılırken bir hata oluştu."); }
  };

  const acceptSpectate = async () => {
    if (!spectatePrompt || !user) return; const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', spectatePrompt);
    try {
      const roomSnap = await getDoc(roomRef);
      if (roomSnap.exists()) {
        const data = roomSnap.data(); await updateDoc(roomRef, { spectators: data.spectators ? [...data.spectators, user.uid] : [user.uid] });
        setRoomCode(spectatePrompt); localStorage.setItem('activeRoom', spectatePrompt); setSpectatePrompt(null); setJoinCodeInput(''); setErrorMsg('');
      }
    } catch (err) { setErrorMsg("Seyirci olarak bağlanılamadı."); }
  };

  // BUG 9 FIX: Odayı terk işlemi runTransaction ile güvenli (atomik) hale getirildi.
  const leaveRoom = async () => {
    const currentCode = roomCode;
    const isPlayer = roomData?.players?.includes(user?.uid);
    leaveRoomLocal();

    if (currentCode && user && isPlayer) {
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentCode);
      try {
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(roomRef);
          if (!snap.exists()) return;
          const data = snap.data();
          if (data.players.length <= 1) {
             transaction.update(roomRef, { status: 'closed', closedBy: user.uid });
          } else {
             transaction.update(roomRef, { status: 'abandoned', abandonedBy: user.uid, abandonReason: 'left' });
          }
        });
      } catch (err) { console.error("Oda kapatılamadı:", err); }
    }
  };

  const copyToClipboard = () => {
    const textArea = document.createElement("textarea"); textArea.value = roomCode; document.body.appendChild(textArea); textArea.select();
    try { document.execCommand('copy'); setCopySuccess(true); setTimeout(() => setCopySuccess(false), 2000); } catch (err) {}
    document.body.removeChild(textArea);
  };

  if (loadingAuth) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white"><Loader2 className="animate-spin w-8 h-8" /></div>;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-4 md:p-8 relative">
      
      {leftOverlayTimer !== null && currentView === 'lobby' && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/80 flex flex-col items-center justify-center backdrop-blur-sm p-4 h-[100dvh]">
          <div className="bg-slate-800 p-8 rounded-2xl border border-slate-600 shadow-2xl flex flex-col items-center max-w-sm w-full relative animate-in fade-in zoom-in duration-300">
            <button onClick={() => setLeftOverlayTimer(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"><X className="w-6 h-6" /></button>
            <Users className="w-16 h-16 text-red-400 mb-4 opacity-80" />
            <h2 className="text-xl font-bold text-center mb-2">Rakibiniz Ayrıldı</h2>
            <p className="text-slate-400 text-center mb-6 text-sm">Oyun sonlandırıldı ve lobiye döndünüz.</p>
            <div className="w-12 h-12 rounded-full border-4 border-slate-700 flex items-center justify-center font-mono font-bold text-lg text-slate-300">{leftOverlayTimer}</div>
          </div>
        </div>
      )}

      {typeof disconnectCountdown === 'number' && roomData?.status === 'abandoned' && (
        <div className="fixed inset-0 z-[99999] bg-slate-900/95 flex flex-col items-center justify-center backdrop-blur-md p-4 h-[100dvh]">
          <AlertCircle className="w-16 h-16 text-yellow-500 mb-4 animate-pulse" />
          <h2 className="text-2xl font-bold text-center mb-2">{roomData.abandonReason === 'left' ? 'Rakip Odadan Ayrıldı!' : 'Rakibin Bağlantısı Koptu!'}</h2>
          <p className="text-slate-300 text-center mb-8 max-w-md">
            {roomData.abandonReason === 'left' ? 'Bekle derseniz oda yeni oyunculara açılır. Aksi halde oda kapanmasına:' : 'Rakibiniz oyunu alta almış veya interneti kopmuş olabilir. Otomatik kapanmasına:'}
          </p>
          <div className="text-5xl font-mono font-bold text-yellow-400 mb-8">{disconnectCountdown}</div>
          <div className="flex flex-col sm:flex-row gap-4">
            <button 
              onClick={async () => {
                setDisconnectCountdown('paused');
                const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
                if (roomData.abandonReason === 'left') {
                    const newPlayers = roomData.players.filter(id => id === user.uid);
                    await updateDoc(roomRef, { status: 'waiting', players: newPlayers, abandonedBy: null, abandonReason: null });
                } else {
                    await updateDoc(roomRef, { status: 'waiting', abandonedBy: null, abandonReason: null });
                }
              }}
              className="bg-indigo-600 hover:bg-indigo-500 border border-indigo-400 px-6 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Loader2 className="w-5 h-5 animate-spin" /> Bekle
            </button>
            <button onClick={leaveRoom} className="bg-slate-800 hover:bg-slate-700 border border-slate-600 px-6 py-3 rounded-lg font-medium transition-colors">Hemen Lobiye Dön</button>
          </div>
        </div>
      )}

      {spectatePrompt && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/90 flex flex-col items-center justify-center backdrop-blur-sm p-4 h-[100dvh]">
          <Eye className="w-16 h-16 text-indigo-500 mb-4" />
          <h2 className="text-2xl font-bold text-center mb-2">Bu Oda Dolu</h2>
          <p className="text-slate-300 text-center mb-8 max-w-md">Odaya zaten iki oyuncu bağlanmış durumda. Maçı seyirci olarak izlemek ister misiniz?</p>
          <div className="flex gap-4">
            <button onClick={acceptSpectate} className="bg-indigo-600 hover:bg-indigo-500 px-6 py-3 rounded-lg font-bold transition-colors">İzle</button>
            <button onClick={() => setSpectatePrompt(null)} className="bg-slate-800 hover:bg-slate-700 border border-slate-600 px-6 py-3 rounded-lg font-medium transition-colors">Vazgeç</button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 w-[90%] max-w-md z-[99999] bg-red-500/95 backdrop-blur-sm border border-red-400 text-white p-4 rounded-xl flex items-center gap-3 shadow-2xl animate-in slide-in-from-top-4">
          <AlertCircle className="w-6 h-6 shrink-0" />
          <span className="font-medium text-sm md:text-base flex-grow text-center">{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="bg-black/20 hover:bg-black/40 p-1 rounded transition-colors shrink-0"><X className="w-5 h-5" /></button>
        </div>
      )}

      <header className="max-w-5xl mx-auto flex items-center justify-between mb-8 pb-4 border-b border-slate-700 mt-4 md:mt-0">
        <div className="flex items-center gap-3">
          <Gamepad2 className="w-8 h-8 text-indigo-400" />
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Masa Oyunları Portalı</h1>
        </div>
        <div className="text-xs text-slate-400 bg-slate-800 px-3 py-1 rounded-full truncate max-w-[120px]">{nickname || `Oyuncu: ${user?.uid.substring(0,4)}`}</div>
      </header>

      {currentView === 'lobby' ? (
        <main className="max-w-5xl mx-auto">
          <div className="bg-slate-800 p-6 rounded-xl mb-6 shadow-lg border border-slate-700 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div><h2 className="text-xl font-semibold mb-1">Oyuncu İsmin</h2><p className="text-sm text-slate-400">Oyunlarda bu isimle görüneceksin.</p></div>
            <input type="text" placeholder="İsmini yaz..." value={nickname} onChange={(e) => { setNickname(e.target.value); localStorage.setItem('nickname', e.target.value); }} className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-center w-full md:w-64 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" maxLength={15} />
          </div>

          <div className="bg-slate-800 p-6 rounded-xl mb-8 shadow-xl border border-slate-700 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div><h2 className="text-xl font-semibold mb-1">Davet Kodun Var Mı?</h2><p className="text-sm text-slate-400">Arkadaşının gönderdiği 6 haneli kodu gir ve masaya otur.</p></div>
            <div className="flex w-full md:w-auto gap-2">
              <input type="text" placeholder="Örn: AB12CD" value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())} className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 uppercase tracking-widest text-center w-full md:w-40 focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono" maxLength={6} />
              <button onClick={() => joinRoom(joinCodeInput)} className="bg-indigo-500 hover:bg-indigo-600 px-6 py-2 rounded-lg font-medium transition-colors">Katıl</button>
            </div>
          </div>

          <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2"><Users className="w-6 h-6 text-slate-400" /> Oda Kur & Oyun Seç</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {GAMES.map(game => {
              const isPremium = game.available && (game.id === 'xox' || game.id === 'tavla' || game.id === 'satranc');
              return (
                <div key={game.id} className={`p-6 rounded-xl border-2 flex flex-col transition-all duration-300 relative overflow-hidden
                    ${!game.available ? 'bg-slate-800/60 border-slate-700 opacity-70 grayscale' : ''}
                    ${isPremium ? 'bg-slate-800 border-indigo-500/40 hover:border-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.15)] cursor-pointer hover:-translate-y-1' : ''}
                    ${game.available && !isPremium ? 'bg-slate-800 border-slate-600 hover:border-indigo-400 hover:bg-slate-700 cursor-pointer' : ''}
                  `}
                >
                  {game.id === 'xox' && ( <><div className="absolute -top-10 -left-10 w-32 h-32 bg-indigo-500/20 blur-[40px] rounded-full pointer-events-none"></div><div className="absolute -bottom-10 -right-10 w-32 h-32 bg-purple-500/20 blur-[40px] rounded-full pointer-events-none"></div></> )}
                  {game.id === 'tavla' && ( <><div className="absolute -top-10 -left-10 w-32 h-32 bg-amber-600/20 blur-[40px] rounded-full pointer-events-none"></div><div className="absolute -bottom-10 -right-10 w-32 h-32 bg-orange-700/20 blur-[40px] rounded-full pointer-events-none"></div></> )}
                  {game.id === 'satranc' && ( <><div className="absolute -top-10 -left-10 w-32 h-32 bg-emerald-500/20 blur-[40px] rounded-full pointer-events-none"></div><div className="absolute -bottom-10 -right-10 w-32 h-32 bg-teal-500/20 blur-[40px] rounded-full pointer-events-none"></div></> )}

                  <div className="text-4xl mb-4 relative z-10 drop-shadow-md">{game.icon}</div>
                  <h3 className="text-xl font-bold mb-2 relative z-10">{game.name}</h3>
                  <p className="text-sm text-slate-400 flex-grow mb-6 relative z-10">{game.desc}</p>
                  
                  {game.available ? (
                    <button onClick={() => createRoom(game.id)} className={`w-full relative z-10 py-2.5 rounded-lg font-bold transition-colors border
                        ${game.id === 'xox' ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50 hover:bg-indigo-600 hover:text-white' : ''}
                        ${game.id === 'tavla' ? 'bg-amber-600/20 text-amber-300 border-amber-600/50 hover:bg-amber-600 hover:text-white' : ''}
                        ${game.id === 'satranc' ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/50 hover:bg-emerald-600 hover:text-white' : ''}
                      `}
                    >Oda Kur</button>
                  ) : ( <button disabled className="w-full relative z-10 bg-slate-700 text-slate-400 py-2.5 rounded-lg font-medium cursor-not-allowed">Çok Yakında</button> )}
                </div>
              )
            })}
          </div>
        </main>
      ) : (
        <main className="max-w-5xl mx-auto flex flex-col items-center">
          <div className="w-full flex items-center justify-between mb-8">
            <button onClick={leaveRoom} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"><ArrowLeft className="w-5 h-5" /> Lobiden Çık</button>
            <div className="flex items-center gap-4 bg-slate-800 px-4 py-2 rounded-full border border-slate-700 shadow-md">
              <span className="text-sm text-slate-400 hidden md:block">Oda Kodu:</span>
              <span className="font-mono font-bold tracking-wider text-indigo-300 text-lg">{roomCode}</span>
              <button onClick={copyToClipboard} className="text-slate-400 hover:text-white relative" title="Kodu Kopyala">
                {copySuccess ? <Check className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5" />}
                {copySuccess && <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-700 text-white text-xs px-2 py-1 rounded shadow-lg">Kopyalandı!</span>}
              </button>
            </div>
          </div>

          <div className="w-full bg-slate-800 rounded-2xl p-4 md:p-8 shadow-2xl border border-slate-700 flex flex-col items-center relative">
            {roomData?.status === 'waiting' ? (
              <div className="text-center py-12">
                <Loader2 className="w-12 h-12 animate-spin text-indigo-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold mb-2">Rakip Bekleniyor...</h2>
                <p className="text-slate-400 max-w-sm mx-auto mb-6">Arkadaşına oda kodunu gönder. O da bu kodu yazarak masaya katılabilir.</p>
                <div className="text-3xl font-mono bg-slate-900 px-6 py-3 rounded-lg border border-slate-600 inline-block shadow-inner">{roomCode}</div>
              </div>
            ) : (
              <div className="w-full flex flex-col items-center">
                 <ErrorBoundary>
                   {roomData?.gameId === 'xox' && <TicTacToeGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} />}
                   {roomData?.gameId === 'tavla' && <TavlaGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} />}
                   {roomData?.gameId === 'satranc' && <ChessGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} />}
                 </ErrorBoundary>
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
  const p1Uid = roomData.players?.[0];
  const p2Uid = roomData.players?.[1];
  const isSpectator = !roomData.players?.includes(user.uid);
  const myColor = roomData.playerColors?.[user.uid] || null;
  const isMyTurn = roomData.turn === user.uid && !isSpectator;
  const myPhase = roomData.phase;

  const [selectedPoint, setSelectedPoint] = useState(null);
  const [gameToast, setGameToast] = useState(null); 
  const [isRolling, setIsRolling] = useState(false); // BUG 5 FIX: Çift tıklama debouncer
  
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

  const board = (Array.isArray(roomData.board) && roomData.board.length === 24) ? roomData.board : createInitialBoard();
  const bar = { white: roomData.bar?.white || 0, black: roomData.bar?.black || 0 };
  const borneOff = { white: roomData.borneOff?.white || 0, black: roomData.borneOff?.black || 0 };
  const dice = roomData.dice || [];
  const usedDice = roomData.usedDice || [];

  const remainingDice = (() => {
    const d = [...dice]; const u = [...usedDice];
    for (const v of u) { const i = d.indexOf(v); if (i !== -1) d.splice(i, 1); }
    return d;
  })();

  // BUG 6 FIX: DFS tabanlı algoritma ağır olduğu için useMemo'ya alındı. Fare hareketinde (hover vs) tekrar tekrar çalışmaz.
  const remainingDiceStr = remainingDice.join(',');
  const validMoves = React.useMemo(() => {
    if (isMyTurn && myPhase === 'moving' && remainingDice.length > 0) {
      return getStrictValidMoves(board, myColor, remainingDice, bar, borneOff);
    }
    return [];
  }, [isMyTurn, myPhase, remainingDiceStr, board, myColor, bar, borneOff]);

  const validFromPoints = new Set(validMoves.map(m => m.from));
  const validToPoints = selectedPoint !== null ? new Set(validMoves.filter(m => m.from === selectedPoint).map(m => m.to)) : new Set();

  const handleRollDice = async () => {
    if (!isMyTurn || myPhase !== 'rolling' || isRolling) return;
    setIsRolling(true); // BUG 5 FIX
    playSound('dice');

    try {
      const d1 = rollDie(); const d2 = rollDie();
      const finalDice = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
      const moves = getStrictValidMoves(board, myColor, finalDice, bar, borneOff);
      
      if (moves.length === 0) {
        showToast("Geçerli hamle yok! Sıra rakibe geçiyor...");
        const oppUid = roomData.players.find(id => id !== user.uid);
        await updateDoc(roomRef, { dice: finalDice, usedDice: finalDice, phase: 'rolling', turn: oppUid });
      } else {
        await updateDoc(roomRef, { dice: finalDice, usedDice: [], phase: 'moving' });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRolling(false);
    }
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
        setSelectedPoint(null); return;
      }
      const targetIdx = pointIdx;
      const movesForFrom = validMoves.filter(m => m.from === selectedPoint && m.to === targetIdx);

      if (movesForFrom.length === 0) {
        if (validFromPoints.has(pointIdx)) setSelectedPoint(pointIdx);
        else setSelectedPoint(null);
        return;
      }
      const move = movesForFrom.sort((a, b) => a.die - b.die)[0];
      const { board: newBoard, bar: newBar, borneOff: newBorneOff } = applyMove(board, bar, borneOff, myColor, selectedPoint, targetIdx, move.die);

      const isCapture = board[targetIdx] && board[targetIdx].color !== null && board[targetIdx].color !== myColor;
      playSound(isCapture ? 'capture' : 'move');

      const newUsedDice = [...usedDice, move.die];
      const newRemainingDice = (() => {
        const d = [...dice]; const u = [...newUsedDice];
        for (const v of u) { const i = d.indexOf(v); if (i !== -1) d.splice(i, 1); }
        return d;
      })();
      setSelectedPoint(null);

      if (newBorneOff[myColor] >= 15) {
        playSound('win');
        let pointsWon = 1;
        const oppColor = myColor === 'white' ? 'black' : 'white';
        if (newBorneOff[oppColor] === 0) {
           let hasBackgammon = false;
           if (newBar[oppColor] > 0) hasBackgammon = true;
           else {
               const myHomeStart = myColor === 'white' ? 18 : 0; const myHomeEnd = myColor === 'white' ? 23 : 5;
               for(let i=myHomeStart; i<=myHomeEnd; i++) { if (newBoard[i] && newBoard[i].color === oppColor) hasBackgammon = true; }
           }
           pointsWon = hasBackgammon ? 3 : 2; 
        }

        const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
        const newScores = { ...roomData.scores, [user.uid]: (roomData.scores?.[user.uid] || 0) + pointsWon };
        await updateDoc(roomRef, { board: newBoard, bar: newBar, borneOff: newBorneOff, dice, usedDice: newUsedDice, winner: user.uid, scores: newScores, phase: 'rolling', turn: null });
        return;
      }

      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
      if (newRemainingDice.length === 0) {
        const oppUid = roomData.players.find(id => id !== user.uid);
        await updateDoc(roomRef, { board: newBoard, bar: newBar, borneOff: newBorneOff, dice, usedDice: newUsedDice, phase: 'rolling', turn: oppUid });
      } else {
        const nextMoves = getStrictValidMoves(newBoard, myColor, newRemainingDice, newBar, newBorneOff);
        if (nextMoves.length === 0) {
          showToast("Kalan zarlar için geçerli hamle yok! Sıra geçiyor...");
          const oppUid = roomData.players.find(id => id !== user.uid);
          await updateDoc(roomRef, { board: newBoard, bar: newBar, borneOff: newBorneOff, dice, usedDice: newUsedDice.concat(newRemainingDice), phase: 'rolling', turn: oppUid });
        } else {
          await updateDoc(roomRef, { board: newBoard, bar: newBar, borneOff: newBorneOff, dice, usedDice: newUsedDice, phase: 'moving', turn: user.uid });
        }
      }
    }
  };

  const handleBearOffClick = async () => { if (!isMyTurn || myPhase !== 'moving' || selectedPoint === null) return; await handlePointClick(myColor === 'white' ? 24 : -1); };

  const requestRematch = async () => { if (isSpectator) return; await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { rematchRequestedBy: user.uid }); };
  const acceptRematch = async () => {
    if (isSpectator) return;
    const nextStarter = roomData.players.find(id => id !== roomData.startingPlayer) || roomData.players[0];
    const newColors = {}; for (const uid of roomData.players) newColors[uid] = roomData.playerColors[uid] === 'white' ? 'black' : 'white';
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { board: createInitialBoard(), bar: { white: 0, black: 0 }, borneOff: { white: 0, black: 0 }, dice: [], usedDice: [], phase: 'rolling', turn: nextStarter, startingPlayer: nextStarter, playerColors: newColors, winner: null, rematchRequestedBy: null });
  };
  const rejectRematch = async () => { if (isSpectator) return; await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { status: 'closed', closedBy: user.uid }); };

  const isWhitePlayer = myColor === 'white' || isSpectator;
  const winnerName = roomData.winner ? (roomData.winner === p1Uid ? p1Name : p2Name) : null;
  const currentTurnName = roomData.turn === p1Uid ? p1Name : p2Name;
  const canBearOff = isMyTurn && myPhase === 'moving' && selectedPoint !== null && validToPoints.has(myColor === 'white' ? 24 : -1);

  const displayDice = remainingDice.length > 0 ? remainingDice : dice;
  const getTopPoints = () => isWhitePlayer ? Array.from({ length: 12 }, (_, i) => 12 + i) : Array.from({ length: 12 }, (_, i) => 11 - i);
  const getBottomPoints = () => isWhitePlayer ? Array.from({ length: 12 }, (_, i) => 11 - i) : Array.from({ length: 12 }, (_, i) => 12 + i);

  const topPoints = getTopPoints(); const bottomPoints = getBottomPoints();

  const renderCheckers = (color, count, isTop, pointIdx) => {
    const isSelected = selectedPoint === pointIdx;
    const safeCount = Math.max(0, count || 0);
    const extra = safeCount > 5 ? safeCount - 5 : 0;
    const showCount = Math.max(0, Math.min(safeCount, 5));
    return (
      <div className={`absolute ${isTop ? 'top-1' : 'bottom-1'} flex flex-col ${isTop ? '' : 'flex-col-reverse'} items-center gap-[1px] w-full z-10 pointer-events-none`}>
        {Array.from({ length: showCount }).map((_, i) => (
          <div key={`chk-${i}`} className={`w-[14px] h-[14px] sm:w-[24px] sm:h-[24px] md:w-[30px] md:h-[30px] rounded-full flex items-center justify-center text-[8px] sm:text-[10px] md:text-xs font-bold shadow-md ${color === 'white' ? 'bg-slate-100 border-2 border-slate-400 text-slate-800' : 'bg-slate-800 border-2 border-slate-600 text-slate-100'} ${isSelected ? 'ring-2 ring-yellow-400' : ''}`}>
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
    const clickable = isMyTurn && myPhase === 'moving' && (!hasBar || selectedPoint === -1);

    return (
      <div key={`pt-${pointIdx}`} onClick={() => clickable && handlePointClick(pointIdx)} className={`relative flex-1 flex flex-col items-center h-full group ${isValidFrom || isValidTo ? 'cursor-pointer' : 'cursor-default'}`}>
        {isTop ? (
           <svg preserveAspectRatio="none" viewBox="0 0 100 100" className={`absolute inset-0 w-full h-full transition-all ${isSelected ? 'opacity-80' : 'opacity-60'} ${isValidTo ? 'drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]' : ''}`}><polygon points="0,0 100,0 50,100" fill={isValidTo ? '#10b981' : (isDark ? '#7f1d1d' : '#475569')} /></svg>
        ) : (
           <svg preserveAspectRatio="none" viewBox="0 0 100 100" className={`absolute inset-0 w-full h-full transition-all ${isSelected ? 'opacity-80' : 'opacity-60'} ${isValidTo ? 'drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]' : ''}`}><polygon points="0,100 100,100 50,0" fill={isValidTo ? '#10b981' : (isDark ? '#7f1d1d' : '#475569')} /></svg>
        )}
        {isValidFrom && <div className="absolute inset-x-0 inset-y-1 ring-2 ring-indigo-400 ring-inset rounded-sm pointer-events-none" />}
        {isSelected && <div className="absolute inset-x-0 inset-y-1 bg-yellow-400/20 ring-2 ring-yellow-400 rounded-sm pointer-events-none" />}
        <div className={`absolute ${isTop ? 'bottom-0' : 'top-0'} text-[8px] sm:text-[10px] text-slate-300 font-mono font-bold opacity-50 pointer-events-none`}>{pointIdx + 1}</div>
        {pt.count > 0 && renderCheckers(pt.color, pt.count, isTop, pointIdx)}
      </div>
    );
  };

  const renderDie = (value, used = false) => {
    const dots = { 1: [[50, 50]], 2: [[25, 25], [75, 75]], 3: [[25, 25], [50, 50], [75, 75]], 4: [[25, 25], [75, 25], [25, 75], [75, 75]], 5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]], 6: [[25, 20], [75, 20], [25, 50], [75, 50], [25, 80], [75, 80]] };
    const positions = value ? (dots[value] || []) : [];
    return (
      <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg relative border-2 transition-all flex items-center justify-center ${used ? 'border-slate-600 bg-slate-700 opacity-40' : 'border-slate-300 bg-slate-100 shadow-lg'}`}>
         {value ? (<svg viewBox="0 0 100 100" className="w-full h-full absolute inset-0">{positions.map(([cx, cy], i) => <circle key={`dot-${i}`} cx={cx} cy={cy} r="10" fill={used ? '#64748b' : '#0f172a'} />)}</svg>) : ( <span className="text-slate-400 font-bold">?</span> )}
      </div>
    );
  };

  return (
    <div className="relative w-full max-w-4xl flex flex-col items-center gap-4 bg-gradient-to-br from-amber-900/40 via-slate-900/80 to-yellow-900/40 p-4 md:p-6 rounded-[2rem] border border-amber-500/30 shadow-[0_0_40px_rgba(217,119,6,0.15)] overflow-hidden">
      {gameToast && <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-red-500/90 text-white px-6 py-3 rounded-xl shadow-2xl font-bold border border-red-400 animate-in fade-in zoom-in duration-300 pointer-events-none text-center">{gameToast}</div>}

      <div className="w-full flex items-center justify-between bg-slate-900/80 rounded-xl p-3 border border-amber-500/30">
        <div className="flex flex-col items-start flex-1 min-w-0 pr-2">
          <div className="flex items-center gap-2 w-full"><div className={`w-4 h-4 rounded-full border-2 shrink-0 ${p1Color === 'white' ? 'bg-slate-100 border-slate-300' : 'bg-slate-800 border-slate-500'}`} /><div className="text-sm font-bold text-slate-200 truncate">{p1Name} {p1Uid === user.uid && !isSpectator ? '(Sen)' : ''}</div>{p1Score > p2Score && <Crown className="w-4 h-4 text-yellow-400 shrink-0" />}</div>
          <div className="text-[10px] sm:text-xs text-slate-400 mt-1 truncate">{p1Color === 'white' ? 'Beyaz' : 'Siyah'} • {(borneOff?.[p1Color] || 0)}/15 çıktı</div>
        </div>
        <div className="flex flex-col items-center px-4 shrink-0"><div className="text-lg font-mono font-bold">{p1Score} — {p2Score}</div><div className="text-[10px] text-slate-500 font-bold tracking-widest">TAVLA</div></div>
        <div className="flex flex-col items-end flex-1 min-w-0 pl-2 text-right">
          <div className="flex items-center justify-end gap-2 w-full">{p2Score > p1Score && <Crown className="w-4 h-4 text-yellow-400 shrink-0" />}<div className="text-sm font-bold text-slate-200 truncate">{p2Name} {p2Uid === user.uid && !isSpectator ? '(Sen)' : ''}</div><div className={`w-4 h-4 rounded-full border-2 shrink-0 ${p2Color === 'white' ? 'bg-slate-100 border-slate-300' : 'bg-slate-800 border-slate-500'}`} /></div>
          <div className="text-[10px] sm:text-xs text-slate-400 mt-1 truncate">{p2Color === 'white' ? 'Beyaz' : 'Siyah'} • {(borneOff?.[p2Color] || 0)}/15 çıktı</div>
        </div>
      </div>

      <div className={`text-center font-bold text-lg drop-shadow-md ${roomData.winner ? 'text-yellow-400' : isMyTurn ? 'text-amber-400' : 'text-slate-400'}`}>
        {isSpectator && <span className="text-xs text-yellow-400 font-bold mr-2 uppercase flex items-center justify-center gap-1"><Eye className="w-3 h-3" /> SEYİRCİ</span>}
        {roomData.winner ? `🏆 ${winnerName} Kazandı!` : isMyTurn ? (myPhase === 'rolling' ? 'Zarları At!' : 'Hamle Yap') : `${currentTurnName} düşünüyor...`}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4 bg-slate-900/80 rounded-xl px-4 sm:px-6 py-3 border border-slate-700 shadow-inner">
        <div className="flex gap-2">{displayDice.map((val, i) => <div key={`dice-ui-${i}-${val || 'empty'}`}>{renderDie(val, false)}</div>)}</div>
        {isMyTurn && myPhase === 'rolling' && !roomData.winner && (
          <button onClick={handleRollDice} disabled={isRolling} className="bg-amber-600 hover:bg-amber-500 px-4 sm:px-5 py-2 rounded-lg font-bold text-sm sm:text-base transition-colors flex items-center gap-2 shadow-lg hover:shadow-amber-500/50 text-white disabled:opacity-50">
            🎲 Zar At
          </button>
        )}
        {isMyTurn && myPhase === 'moving' && remainingDice.length > 0 && (
          <div className="text-xs sm:text-sm text-slate-400">Kalan: <span className="font-mono text-amber-300 font-bold">{remainingDice.join(', ')}</span></div>
        )}
      </div>

      <div className="relative w-full aspect-[3/4] sm:aspect-square md:aspect-[4/3] max-w-3xl bg-amber-950/80 border-4 border-amber-900 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.5)] flex flex-col p-1 sm:p-2">
        <div className="flex-1 w-full flex">
          <div className="flex-1 flex gap-[1px]">{topPoints.slice(0, 6).map(idx => renderPoint(idx, true))}</div>
          <div onClick={() => isMyTurn && myPhase === 'moving' && myColor === 'black' && handlePointClick('bar')} className={`w-8 sm:w-12 md:w-16 flex flex-col items-center pt-2 bg-[#290f02]/90 border-x-[4px] sm:border-x-[8px] border-[#1a0901] shadow-[inset_0_0_15px_rgba(0,0,0,1)] cursor-pointer relative z-10 ${selectedPoint === -1 && myColor === 'black' ? 'ring-2 ring-yellow-400 bg-yellow-900/30' : ''}`}>
             {Array.from({ length: Math.max(0, Math.min((bar?.black || 0), 4)) }).map((_, i) => ( <div key={i} className="w-[18px] h-[18px] sm:w-[24px] sm:h-[24px] md:w-[30px] md:h-[30px] rounded-full bg-slate-800 border-2 border-slate-600 flex items-center justify-center text-[8px] md:text-xs text-slate-100 font-bold mb-1 shadow-md">{i === 3 && (bar?.black || 0) > 4 ? `+${(bar?.black || 0) - 3}` : ''}</div> ))}
          </div>
          <div className="flex-1 flex gap-[1px]">{topPoints.slice(6, 12).map(idx => renderPoint(idx, true))}</div>
        </div>
        <div className="h-8 sm:h-12 md:h-14 w-full flex items-center justify-center bg-[#290f02] my-1 sm:my-2 border-y-[6px] border-[#1a0901] shadow-[inset_0_0_15px_rgba(0,0,0,0.8)] relative z-20"><div className="text-[10px] sm:text-xs text-amber-700/30 font-black tracking-widest uppercase">Menteşe</div></div>
        <div className="flex-1 w-full flex">
          <div className="flex-1 flex gap-[1px]">{bottomPoints.slice(0, 6).map(idx => renderPoint(idx, false))}</div>
          <div onClick={() => isMyTurn && myPhase === 'moving' && myColor === 'white' && handlePointClick('bar')} className={`w-8 sm:w-12 md:w-16 flex flex-col-reverse items-center pb-2 bg-[#290f02]/90 border-x-[4px] sm:border-x-[8px] border-[#1a0901] shadow-[inset_0_0_15px_rgba(0,0,0,1)] cursor-pointer relative z-10 ${selectedPoint === -1 && myColor === 'white' ? 'ring-2 ring-yellow-400 bg-yellow-900/30' : ''}`}>
             {Array.from({ length: Math.max(0, Math.min((bar?.white || 0), 4)) }).map((_, i) => ( <div key={i} className="w-[18px] h-[18px] sm:w-[24px] sm:h-[24px] md:w-[30px] md:h-[30px] rounded-full bg-slate-100 border-2 border-slate-400 flex items-center justify-center text-[8px] md:text-xs text-slate-800 font-bold mt-1 shadow-md">{i === 3 && (bar?.white || 0) > 4 ? `+${(bar?.white || 0) - 3}` : ''}</div> ))}
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
                <div className="text-xs sm:text-sm font-mono font-bold text-slate-300">{borneOff?.[color] || 0}</div>
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

      {/* BUG 4 FIX: İç Overlay */}
      {roomData.status === 'abandoned' && (
        <div className="absolute inset-0 z-[100] bg-slate-900/80 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-[2rem] p-4 text-center animate-in fade-in duration-300">
          <Loader2 className="w-12 h-12 animate-spin text-amber-500 mb-4 drop-shadow-lg" />
          <h3 className="text-xl font-bold text-white mb-2">Rakip Bekleniyor...</h3>
          <p className="text-slate-400 text-sm mb-8">Bağlantısı kopan rakibiniz bekleniyor. İsterseniz bu sırada lobiye dönebilirsiniz.</p>
          <button onClick={leaveRoom} className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50 px-6 py-2 rounded-lg font-medium transition-colors">Lobiye Dön</button>
        </div>
      )}
    </div>
  );
}

function TicTacToeGame({ roomData, roomCode, user, db, appId, leaveRoom }) {
  const isPlayer1 = roomData.players[0] === user.uid; const isPlayer2 = roomData.players[1] === user.uid;
  const isSpectator = !isPlayer1 && !isPlayer2; 
  const mySymbol = isPlayer1 ? 'X' : (isPlayer2 ? 'O' : null);
  const isMyTurn = roomData.turn === user.uid;

  const p1Uid = roomData.players[0]; const p2Uid = roomData.players[1];
  const p1Name = roomData.playerNames?.[p1Uid] || 'Oyuncu 1'; const p2Name = roomData.playerNames?.[p2Uid] || 'Oyuncu 2';
  const p1Score = roomData.scores?.[p1Uid] || 0; const p2Score = roomData.scores?.[p2Uid] || 0;

  const handleMove = async (index) => {
    if (!isMyTurn || isSpectator || roomData.board[index] || roomData.winner || roomData.status === 'abandoned') return;
    playSound('move');
    const newBoard = [...roomData.board]; newBoard[index] = mySymbol;
    const winnerInfo = calculateWinner(newBoard);
    const nextTurn = roomData.players.find(id => id !== user.uid) || user.uid;

    let updatePayload = { board: newBoard, turn: winnerInfo ? null : nextTurn, winner: winnerInfo ? winnerInfo.winner : (newBoard.every(cell => cell) ? 'Draw' : null), winningLine: winnerInfo ? winnerInfo.line : null };
    if (winnerInfo && winnerInfo.winner) {
      playSound('win');
      const winnerUid = winnerInfo.winner === 'X' ? p1Uid : p2Uid;
      updatePayload.scores = { ...roomData.scores, [winnerUid]: (roomData.scores?.[winnerUid] || 0) + 1 };
    }
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), updatePayload);
  };

  const requestRematch = async () => { if (isSpectator) return; await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { rematchRequestedBy: user.uid }); };
  const acceptRematch = async () => {
    if (isSpectator) return;
    const nextStarter = roomData.players.find(id => id !== roomData.startingPlayer) || roomData.players[0];
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { board: Array(9).fill(null), turn: nextStarter, startingPlayer: nextStarter, winner: null, winningLine: null, rematchRequestedBy: null });
  };
  const rejectRematch = async () => { if (isSpectator) return; await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { status: 'closed', closedBy: user.uid }); };

  const calculateWinner = (squares) => {
    const lines = [ [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6] ];
    for (let i = 0; i < lines.length; i++) { const [a, b, c] = lines[i]; if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) return { winner: squares[a], line: lines[i] }; }
    return null;
  };

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
    <div className="relative flex flex-col items-center w-full max-w-md bg-gradient-to-br from-indigo-900/60 via-slate-900/80 to-purple-900/60 p-4 md:p-8 rounded-[2rem] border border-indigo-500/40 shadow-[0_0_40px_rgba(99,102,241,0.25)] overflow-hidden">
      <h2 className="text-2xl font-bold mb-6 text-slate-200 z-10 uppercase tracking-widest drop-shadow-md">Tic-Tac-Toe</h2>
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden z-0"><div className="absolute -top-20 -left-20 w-48 h-48 bg-indigo-500/30 blur-[80px] rounded-full"></div><div className="absolute -bottom-20 -right-20 w-48 h-48 bg-purple-500/30 blur-[80px] rounded-full"></div></div>
      <div className="relative z-10 w-full flex flex-col items-center">
        <div className="flex flex-col w-full mb-6 bg-slate-900/80 backdrop-blur-md p-4 rounded-xl border border-indigo-500/30 shadow-lg">
          {isSpectator && <div className="text-center text-xs text-yellow-400 font-bold mb-3 tracking-widest uppercase flex items-center justify-center gap-1"><Eye className="w-4 h-4" /> SEYİRCİ MODU</div>}
          <div className={`text-center font-bold text-xl md:text-2xl mb-4 ${statusColor} drop-shadow-md`}>{statusMsg}</div>
          <div className="flex justify-between items-start w-full px-2">
            <div className="text-center flex flex-col items-center text-indigo-400 flex-1 min-w-0"><div className="flex items-center gap-1 mb-1 shrink-0">{p1Score > p2Score && <Crown className="w-4 h-4 text-yellow-400 drop-shadow-md" />}<span className="text-2xl font-bold">X</span></div><div className="text-xs truncate w-full px-1 font-medium" title={p1Name}>{p1Name} {isPlayer1 ? '(Sen)' : ''}</div><div className="text-xl font-mono font-bold text-white mt-1 shrink-0">{p1Score}</div></div>
            <div className="text-slate-500 font-bold text-xl md:text-2xl shrink-0 px-4 opacity-50 flex items-center justify-center h-full pt-4">VS</div>
            <div className="text-center flex flex-col items-center text-purple-400 flex-1 min-w-0"><div className="flex items-center gap-1 mb-1 shrink-0">{p2Score > p1Score && <Crown className="w-4 h-4 text-yellow-400 drop-shadow-md" />}<span className="text-2xl font-bold">O</span></div><div className="text-xs truncate w-full px-1 font-medium" title={p2Name}>{p2Name} {isPlayer2 ? '(Sen)' : ''}</div><div className="text-xl font-mono font-bold text-white mt-1 shrink-0">{p2Score}</div></div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3 w-fit mb-8 p-3 sm:p-4 bg-slate-800/90 backdrop-blur-md rounded-2xl shadow-inner border border-slate-600 mx-auto">
          {roomData.board.map((cell, index) => {
            const isWinningCell = roomData.winningLine?.includes(index);
            return (
              <button key={index} onClick={() => handleMove(index)} disabled={!isMyTurn || isSpectator || cell !== null || roomData.winner !== null || roomData.status === 'abandoned'}
                className={`w-[80px] h-[80px] sm:w-[90px] sm:h-[90px] flex-shrink-0 flex items-center justify-center rounded-xl transition-all m-0 p-0 box-border
                  ${cell === null && isMyTurn && !isSpectator && !roomData.winner && roomData.status !== 'abandoned' ? 'hover:bg-slate-700 bg-slate-900 cursor-pointer' : 'bg-slate-900'}
                  ${(cell !== null || !isMyTurn || isSpectator || roomData.winner || roomData.status === 'abandoned') ? 'cursor-default' : ''}
                  ${isWinningCell ? 'bg-indigo-500/40 border-2 border-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.6)]' : 'border border-slate-700 shadow-sm'}
                  ${cell === 'X' ? 'text-indigo-400 drop-shadow-[0_4px_4px_rgba(0,0,0,0.6)]' : 'text-purple-400 drop-shadow-[0_4px_4px_rgba(0,0,0,0.6)]'}
                `}><span className="leading-none text-6xl sm:text-7xl font-black select-none pointer-events-none mt-2">{cell}</span>
              </button>
            )
          })}
        </div>

        {roomData.winner && roomData.status !== 'abandoned' && (
          <div className="w-full flex flex-col items-center bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-indigo-500/30 shadow-lg">
            {isSpectator ? ( <div className="text-slate-400 text-sm py-2 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Oyuncuların kararı bekleniyor...</div> ) : !roomData.rematchRequestedBy ? (
              <button onClick={requestRematch} className="bg-indigo-600 hover:bg-indigo-500 w-full py-3 rounded-xl font-bold text-lg shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.02] hover:shadow-indigo-500/50">Yeniden Oyna</button>
            ) : roomData.rematchRequestedBy === user.uid ? ( <div className="flex items-center gap-3 text-slate-400 py-2"><Loader2 className="w-5 h-5 animate-spin" /><span>Rakibin cevabı bekleniyor...</span></div> ) : (
              <div className="flex flex-col items-center w-full">
                <span className="text-indigo-200 font-medium mb-3 text-center drop-shadow-md">Rakibiniz rövanş istiyor!</span>
                <div className="flex gap-4 w-full">
                  <button onClick={acceptRematch} className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/40 text-green-400 border border-green-500/50 py-3 rounded-xl font-bold transition-all hover:scale-[1.02]"><Check className="w-5 h-5" /> Kabul Et</button>
                  <button onClick={rejectRematch} className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/50 py-3 rounded-xl font-bold transition-all hover:scale-[1.02]"><X className="w-5 h-5" /> Reddet</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* BUG 4 FIX: İç Overlay */}
      {roomData.status === 'abandoned' && (
        <div className="absolute inset-0 z-[100] bg-slate-900/80 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-[2rem] p-4 text-center animate-in fade-in duration-300">
          <Loader2 className="w-12 h-12 animate-spin text-indigo-500 mb-4 drop-shadow-lg" />
          <h3 className="text-xl font-bold text-white mb-2">Rakip Bekleniyor...</h3>
          <p className="text-slate-400 text-sm mb-8">Bağlantısı kopan rakibiniz bekleniyor. İsterseniz bu sırada lobiye dönebilirsiniz.</p>
          <button onClick={leaveRoom} className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50 px-6 py-2 rounded-lg font-medium transition-colors">Lobiye Dön</button>
        </div>
      )}
    </div>
  );
}

function ChessGame({ roomData, roomCode, user, db, appId, leaveRoom }) {
  const p1Uid = roomData.players?.[0]; const p2Uid = roomData.players?.[1];
  const isSpectator = !roomData.players?.includes(user.uid);
  const myColor = roomData.playerColors?.[user.uid] || null;
  const isMyTurn = roomData.turn === user.uid && !isSpectator;

  const [selectedSquare, setSelectedSquare] = useState(null);
  const [promotionPrompt, setPromotionPrompt] = useState(null); 

  const p1Name = roomData.playerNames?.[p1Uid] || 'Oyuncu 1'; const p2Name = roomData.playerNames?.[p2Uid] || 'Oyuncu 2';
  const p1Score = roomData.scores?.[p1Uid] || 0; const p2Score = roomData.scores?.[p2Uid] || 0;
  const p1Color = roomData.playerColors?.[p1Uid] || 'w'; const p2Color = roomData.playerColors?.[p2Uid] || 'b';

  const board = (Array.isArray(roomData.board) && roomData.board.length === 64) ? roomData.board : createInitialChessBoard();
  const validMoves = (selectedSquare !== null && isMyTurn) ? getStrictLegalMoves(board, selectedSquare) : [];

  const executeMove = async (from, to, movingPiece, targetPiece, currentBoard) => {
    playSound(targetPiece ? 'capture' : 'move');
    
    if (movingPiece.type === 'k' && Math.abs(from - to) === 2) {
      if (to === 62) { currentBoard[61] = currentBoard[63]; currentBoard[63] = null; } 
      if (to === 58) { currentBoard[59] = currentBoard[56]; currentBoard[56] = null; } 
      if (to === 6)  { currentBoard[5] = currentBoard[7]; currentBoard[7] = null; }  
      if (to === 2)  { currentBoard[3] = currentBoard[0]; currentBoard[0] = null; }  
    }

    movingPiece.hasMoved = true;
    currentBoard[to] = movingPiece;
    currentBoard[from] = null;

    const newCaptured = { w: [...(roomData.captured?.w || [])], b: [...(roomData.captured?.b || [])] };
    if (targetPiece && myColor) newCaptured[myColor].push(targetPiece.type);

    const oppUid = roomData.players.find(id => id !== user.uid) || user.uid;
    const oppColor = myColor === 'w' ? 'b' : 'w';

    let newHalfmoveClock = (roomData.halfmoveClock || 0) + 1;
    let newPositionHistory = [...(roomData.positionHistory || [])];
    
    if (movingPiece.type === 'p' || targetPiece) {
       newHalfmoveClock = 0;
       newPositionHistory = [];
    }
    newPositionHistory.push(getBoardStateString(currentBoard));
    
    // BUG 10 FIX: History dizisini 100 limitinde tutarak aşırı büyümeyi ve bandwidth harcamasını kesiyoruz.
    if (newPositionHistory.length > 100) newPositionHistory = newPositionHistory.slice(-100);

    const gameState = getGameState(currentBoard, oppColor, newHalfmoveClock, newPositionHistory);
    
    let newWinner = null;
    let newDrawReason = null; // BUG 7 FIX: Sebebini veritabanına kaydediyoruz
    
    if (gameState === 'mate') { newWinner = user.uid; playSound('win'); } 
    else if (gameState === 'draw_stalemate') { newWinner = 'Draw'; newDrawReason = 'stalemate'; }
    else if (gameState === 'draw_material') { newWinner = 'Draw'; newDrawReason = 'material'; }
    else if (gameState === 'draw_50move') { newWinner = 'Draw'; newDrawReason = '50move'; }
    else if (gameState === 'draw_repetition') { newWinner = 'Draw'; newDrawReason = 'repetition'; }

    let updatePayload = {
      board: currentBoard, turn: newWinner ? null : oppUid, captured: newCaptured, winner: newWinner,
      halfmoveClock: newHalfmoveClock, positionHistory: newPositionHistory
    };
    if (newDrawReason) updatePayload.drawReason = newDrawReason; // BUG 7 FIX
    if (newWinner && newWinner !== 'Draw') updatePayload.scores = { ...roomData.scores, [newWinner]: (roomData.scores?.[newWinner] || 0) + 1 };

    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), updatePayload);
    setSelectedSquare(null); setPromotionPrompt(null);
  };

  const handleSquareClick = async (index) => {
    if (!isMyTurn || isSpectator || roomData.winner || roomData.status === 'abandoned' || promotionPrompt) return;
    const piece = board[index];

    if (selectedSquare === null || (piece && piece.color === myColor)) {
      if (piece && piece.color === myColor) setSelectedSquare(index === selectedSquare ? null : index);
      return;
    }

    if (validMoves.includes(index)) {
      const newBoard = board.map(p => p ? { ...p } : null); 
      const movingPiece = { ...newBoard[selectedSquare] };
      const targetPiece = newBoard[index] ? { ...newBoard[index] } : null;
      const r = Math.floor(index / 8);
      const isPromotion = movingPiece.type === 'p' && ((movingPiece.color === 'w' && r === 0) || (movingPiece.color === 'b' && r === 7));

      if (isPromotion) { playSound('move'); setPromotionPrompt({ from: selectedSquare, to: index, movingPiece, targetPiece, newBoard }); return; }
      await executeMove(selectedSquare, index, movingPiece, targetPiece, newBoard);
    }
  };

  const requestRematch = async () => { if (isSpectator) return; await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { rematchRequestedBy: user.uid }); };
  const acceptRematch = async () => {
    if (isSpectator) return;
    const newColors = {}; let whiteUid = null;
    for (const uid of roomData.players) { const c = roomData.playerColors[uid] === 'w' ? 'b' : 'w'; newColors[uid] = c; if (c === 'w') whiteUid = uid; }
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { board: createInitialChessBoard(), turn: whiteUid, startingPlayer: whiteUid, playerColors: newColors, captured: { w: [], b: [] }, halfmoveClock: 0, positionHistory: [], winner: null, drawReason: null, rematchRequestedBy: null });
  };
  const rejectRematch = async () => { if (isSpectator) return; await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { status: 'closed', closedBy: user.uid }); };

  let statusMsg = ""; let statusColor = "text-slate-300";
  if (roomData.winner) {
    if (roomData.winner === 'Draw') {
      // BUG 7 FIX: Havadan hesaplamak yerine FireStore'dan gelen drawReason okundu!
      statusMsg = "Berabere! ";
      if (roomData.drawReason === '50move') statusMsg += "(50 Hamle Kuralı)";
      else if (roomData.drawReason === 'material') statusMsg += "(Yetersiz Materyal)";
      else if (roomData.drawReason === 'repetition') statusMsg += "(3 Konum Tekrarı)";
      else statusMsg += "(Pat)";
      statusColor = "text-yellow-400";
    } else {
        const winnerUid = roomData.winner;
        if (isSpectator) { statusMsg = `${roomData.playerNames?.[winnerUid] || 'Biri'} Kazandı! 🎉`; statusColor = "text-yellow-400"; } 
        else if (winnerUid === user.uid) { statusMsg = "Şah Mat! Kazandın! 🎉"; statusColor = "text-green-400"; } 
        else { statusMsg = "Şah Mat! Kaybettin 😢"; statusColor = "text-red-400"; }
    }
  } else {
    if (isSpectator) { statusMsg = roomData.turn === p1Uid ? `${p1Name} Hamle Bekleniyor...` : `${p2Name} Hamle Bekleniyor...`; statusColor = "text-emerald-400"; } 
    else { statusMsg = isMyTurn ? "Senin Sıran!" : "Rakibin Sırası..."; statusColor = isMyTurn ? "text-emerald-400" : "text-slate-400"; }
  }

  const isBlackPlayer = myColor === 'b';
  const visualIndices = isBlackPlayer ? Array.from({length: 64}, (_, i) => 63 - i) : Array.from({length: 64}, (_, i) => i);

  const wCaptured = roomData.captured?.w || []; const bCaptured = roomData.captured?.b || [];
  const wPoints = wCaptured.reduce((acc, p) => acc + (PIECE_VALUES[p] || 0), 0);
  const bPoints = bCaptured.reduce((acc, p) => acc + (PIECE_VALUES[p] || 0), 0);
  
  const renderCaptured = (caps, isWhitePieces) => {
    if (!caps || caps.length === 0) return null;
    const sorted = [...caps].sort((a,b) => (PIECE_VALUES[b] || 0) - (PIECE_VALUES[a] || 0));
    return (
        <div className="flex flex-wrap gap-[1px] items-center mt-1 bg-slate-500/40 px-2 py-1 rounded-md border border-slate-500/50 shadow-inner max-w-full">
            {sorted.map((p, i) => <span key={i} style={chessPieceStyle} className={`text-lg md:text-xl leading-none drop-shadow-md ${isWhitePieces ? 'text-white' : 'text-black'}`}>{CHESS_ICONS[p]}</span> )}
        </div>
    );
  };

  // BUG 12 FIX: Sadece kendi şahımızı değil, tehdit altındaki *her* şahı arayıp buluyoruz. Seyirciler de şah glow efektini görüyor.
  let inCheckKings = [];
  if (!roomData.winner) {
    let wKingIdx = -1, bKingIdx = -1;
    for (let i = 0; i < 64; i++) {
       if (board[i]?.type === 'k') {
           if (board[i].color === 'w') wKingIdx = i;
           else bKingIdx = i;
       }
    }
    if (wKingIdx !== -1 && isSquareAttacked(board, wKingIdx, 'b')) inCheckKings.push(wKingIdx);
    if (bKingIdx !== -1 && isSquareAttacked(board, bKingIdx, 'w')) inCheckKings.push(bKingIdx);
  }

  return (
    <div className="relative flex flex-col items-center w-full max-w-xl bg-gradient-to-br from-slate-800 to-slate-900 p-4 md:p-6 rounded-[2rem] border border-slate-700 shadow-2xl overflow-hidden">
      <div className="w-full flex items-center justify-between bg-slate-900/80 rounded-xl p-3 border border-slate-700/50 mb-4 min-h-[70px]">
        <div className="flex flex-col items-start flex-1 min-w-0 pr-2">
          <div className="flex items-center gap-2 w-full"><div className={`w-4 h-4 rounded-full border-2 shrink-0 ${p1Color === 'w' ? 'bg-white border-slate-300' : 'bg-slate-900 border-slate-500'}`} /><div className="text-sm font-bold text-slate-200 truncate">{p1Name} {p1Uid === user?.uid && !isSpectator ? '(Sen)' : ''}</div></div>
          <div className="flex flex-wrap items-center gap-1 mt-1 w-full min-h-[24px]">
             {renderCaptured(p1Color === 'w' ? wCaptured : bCaptured, p1Color === 'w' ? false : true)}
             {p1Color === 'w' && wPoints > bPoints && <span className="text-emerald-400 text-xs font-bold ml-1 shrink-0">+{wPoints - bPoints}</span>}
             {p1Color === 'b' && bPoints > wPoints && <span className="text-emerald-400 text-xs font-bold ml-1 shrink-0">+{bPoints - wPoints}</span>}
          </div>
        </div>
        <div className="flex flex-col items-center px-4 shrink-0"><div className="text-lg font-mono font-bold">{p1Score} — {p2Score}</div><div className="text-[10px] text-slate-500 font-bold tracking-widest">SATRANÇ</div></div>
        <div className="flex flex-col items-end flex-1 min-w-0 pl-2 text-right">
          <div className="flex items-center justify-end gap-2 w-full"><div className="text-sm font-bold text-slate-200 truncate">{p2Name} {p2Uid === user?.uid && !isSpectator ? '(Sen)' : ''}</div><div className={`w-4 h-4 rounded-full border-2 shrink-0 ${p2Color === 'w' ? 'bg-white border-slate-300' : 'bg-slate-900 border-slate-500'}`} /></div>
          <div className="flex flex-wrap items-center justify-end gap-1 mt-1 w-full min-h-[24px] flex-row-reverse">
             {renderCaptured(p2Color === 'w' ? wCaptured : bCaptured, p2Color === 'w' ? false : true)}
             {p2Color === 'w' && wPoints > bPoints && <span className="text-emerald-400 text-xs font-bold mr-1 shrink-0">+{wPoints - bPoints}</span>}
             {p2Color === 'b' && bPoints > wPoints && <span className="text-emerald-400 text-xs font-bold mr-1 shrink-0">+{bPoints - wPoints}</span>}
          </div>
        </div>
      </div>

      <div className={`text-center font-bold text-lg mb-4 drop-shadow-md ${statusColor}`}>
        {isSpectator && <span className="text-xs text-yellow-400 font-bold mr-2 uppercase flex items-center justify-center gap-1"><Eye className="w-3 h-3" /> SEYİRCİ</span>}
        {statusMsg}
      </div>

      <div className="relative w-full max-w-[400px] sm:max-w-[480px] bg-slate-800 p-2 md:p-3 rounded-lg shadow-2xl mx-auto border border-slate-700">
        <div className="grid grid-cols-8 grid-rows-8 w-full aspect-square bg-[#769656] rounded-sm overflow-hidden select-none shadow-inner border-[3px] border-slate-900">
          {visualIndices.map((i) => {
            const cell = board[i]; const r = Math.floor(i / 8); const c = i % 8;
            const isDark = (r + c) % 2 !== 0; const isSelected = selectedSquare === i; const isValidMove = validMoves.includes(i); 
            const isKingInDanger = inCheckKings.includes(i); // BUG 12 FIX 
            return (
              <div key={i} onClick={() => handleSquareClick(i)} className={`w-full h-full flex items-center justify-center relative cursor-pointer ${isDark ? 'bg-[#769656]' : 'bg-[#eeeed2]'} ${isSelected ? 'bg-yellow-400/50' : ''}`}>
                {isKingInDanger && <div className="absolute inset-0 bg-red-500/50 shadow-[inset_0_0_15px_rgba(239,68,68,0.8)] pointer-events-none" />}
                {isValidMove && !cell && <div className="w-4 h-4 md:w-5 md:h-5 bg-black/20 rounded-full" />}
                {isValidMove && cell && <div className="absolute inset-0 border-[4px] md:border-[5px] border-black/20 rounded-full m-1 pointer-events-none" />}
                {cell && ( <span style={chessPieceStyle} className={`text-[32px] sm:text-[45px] md:text-[55px] leading-none drop-shadow-md select-none flex items-center justify-center w-full h-full font-sans ${cell.color === 'w' ? 'text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]' : 'text-black drop-shadow-[0_1px_1px_rgba(255,255,255,0.4)]'}`}>{CHESS_ICONS[cell.type]}</span> )}
              </div>
            );
          })}
        </div>

        {promotionPrompt && (
           <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center backdrop-blur-sm rounded-lg">
              <div className="bg-slate-800 p-6 rounded-2xl border border-slate-600 shadow-2xl flex flex-col items-center">
                  <h3 className="text-white font-bold mb-4">Piyon Terfisi</h3>
                  <div className="flex gap-4">
                     {['q', 'r', 'b', 'n'].map(type => (
                         <button key={type} onClick={() => { const promotedPiece = { ...promotionPrompt.movingPiece, type }; executeMove(promotionPrompt.from, promotionPrompt.to, promotedPiece, promotionPrompt.targetPiece, promotionPrompt.newBoard); }} 
                            style={chessPieceStyle} className={`w-16 h-16 md:w-20 md:h-20 rounded-xl bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-4xl md:text-5xl transition-colors border-2 ${myColor === 'w' ? 'text-slate-100' : 'text-slate-900'}`}>
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

      {/* BUG 4 FIX: İç Overlay */}
      {roomData.status === 'abandoned' && (
        <div className="absolute inset-0 z-[100] bg-slate-900/80 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-[2rem] p-4 text-center animate-in fade-in duration-300">
          <Loader2 className="w-12 h-12 animate-spin text-emerald-500 mb-4 drop-shadow-lg" />
          <h3 className="text-xl font-bold text-white mb-2">Rakip Bekleniyor...</h3>
          <p className="text-slate-400 text-sm mb-8">Bağlantısı kopan rakibiniz bekleniyor. İsterseniz bu sırada lobiye dönebilirsiniz.</p>
          <button onClick={leaveRoom} className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50 px-6 py-2 rounded-lg font-medium transition-colors">Lobiye Dön</button>
        </div>
      )}
    </div>
  );
}