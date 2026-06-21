// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { Copy, Users, Gamepad2, AlertCircle, Loader2, ArrowLeft, Check, X, Crown, Eye } from 'lucide-react';
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
  { id: 'okey101', name: '101 Okey', desc: 'Katlamalı, ceza puanlı efsane.', available: false, icon: '🀄' },
  { id: 'poker', name: "Texas Hold'em", desc: 'Blöf ve taktik zamanı.', available: false, icon: '🃏' },
  { id: 'blof', name: 'Blöf', desc: 'Yalan söyleyebilen kazanır.', available: false, icon: '🤫' },
  { id: 'dostkazigi', name: 'Dost Kazığı', desc: 'Arkadaşlıkları bitiren oyun.', available: false, icon: '🤝' },
];

// ==========================================
// TAVLA OYUN MANTIĞI
// ==========================================

// Başlangıç tahtası: 24 nokta, her biri { count, color } veya null
// Beyaz: 1'den 24'e doğru gider (1->24 yönü)
// Siyah: 24'ten 1'e doğru gider (24->1 yönü)
// Standart tavla başlangıç dizilişi
function createInitialBoard() {
  // 0-23 arası index (0 = nokta 1, 23 = nokta 24)
  const board = Array(24).fill(null).map(() => ({ count: 0, color: null }));
  
  // Standart diziliş (beyaz perspektifinden):
  // Beyaz pullar
  board[0] = { count: 2, color: 'white' };   // Nokta 1
  board[11] = { count: 5, color: 'white' };  // Nokta 12
  board[16] = { count: 3, color: 'white' };  // Nokta 17
  board[18] = { count: 5, color: 'white' };  // Nokta 19

  // Siyah pullar
  board[23] = { count: 2, color: 'black' };  // Nokta 24
  board[12] = { count: 5, color: 'black' };  // Nokta 13
  board[7] = { count: 3, color: 'black' };   // Nokta 8
  board[5] = { count: 5, color: 'black' };   // Nokta 6

  return board;
}

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

// Geçerli hamleler: from noktasından hangi noktalara gidilebilir
// color: 'white' (1->24) veya 'black' (24->1)
// board: 24'lük dizi
// dice: kullanılmamış zarlar
// bar: bar üzerindeki pul sayısı (o renk için)
// borneOff: çıkarılmış pul sayısı
function getValidMoves(board, color, dice, bar, borneOff) {
  const uniqueDice = [...new Set(dice)];
  const moves = []; // { from, to, die } from=-1 => bar'dan, to=24 => bearing off

  const direction = color === 'white' ? 1 : -1;
  const homeStart = color === 'white' ? 18 : 0; // home board başlangıç index
  const homeEnd = color === 'white' ? 23 : 5;   // home board bitiş index

  // Tüm pullar home board'da mı?
  const totalPieces = 15;
  const piecesOnBoard = board.reduce((acc, pt) => pt.color === color ? acc + pt.count : acc, 0);
  const piecesOnBar = bar;
  const canBearOff = (piecesOnBoard + piecesOnBar + borneOff === totalPieces) &&
                     (borneOff + piecesOnBoard === totalPieces - piecesOnBar) &&
                     allInHome(board, color, homeStart, homeEnd, piecesOnBar);

  for (const die of uniqueDice) {
    // Bar'dan oynamak zorunlu
    if (bar > 0) {
      // Beyaz: zar değeri kadar ilerler, giriş noktası = die-1 (0-indexed)
      // Siyah: 24-die (0-indexed = 24-die-1 = 23-die+1)
      const entryIdx = color === 'white' ? die - 1 : 24 - die;
      const pt = board[entryIdx];
      if (!pt || pt.color === null || pt.color === color || pt.count === 1) {
        moves.push({ from: -1, to: entryIdx, die });
      }
      continue;
    }

    // Normal hamleler
    for (let i = 0; i < 24; i++) {
      const pt = board[i];
      if (!pt || pt.color !== color || pt.count === 0) continue;

      const toIdx = i + direction * die;

      // Bearing off
      if (color === 'white' && toIdx >= 24 && canBearOff) {
        // Tam hane yoksa en yüksek dolmamış noktadan atabilir
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

// Hamleyi uygula, yeni board + bar döndür
function applyMove(board, bar, borneOff, color, from, to, die) {
  const newBoard = board.map(pt => pt ? { ...pt } : { count: 0, color: null });
  const newBar = { ...bar };
  const newBorneOff = { ...borneOff };
  const opp = color === 'white' ? 'black' : 'white';

  // Kaynaktan pul kaldır
  if (from === -1) {
    newBar[color] = Math.max(0, newBar[color] - 1);
  } else {
    newBoard[from].count--;
    if (newBoard[from].count === 0) newBoard[from].color = null;
  }

  // Hedef: bearing off
  if ((color === 'white' && to === 24) || (color === 'black' && to === -1)) {
    newBorneOff[color] = (newBorneOff[color] || 0) + 1;
    return { board: newBoard, bar: newBar, borneOff: newBorneOff };
  }

  // Rakip blot varsa bar'a gönder
  if (newBoard[to] && newBoard[to].color === opp && newBoard[to].count === 1) {
    newBoard[to] = { count: 0, color: null };
    newBar[opp] = (newBar[opp] || 0) + 1;
  }

  // Koyma
  if (!newBoard[to] || newBoard[to].count === 0) {
    newBoard[to] = { count: 1, color };
  } else {
    newBoard[to].count++;
    newBoard[to].color = color;
  }

  return { board: newBoard, bar: newBar, borneOff: newBorneOff };
}

// ==========================================
// ANA APP
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

  useEffect(() => { roomStateRef.current = { roomCode, user, roomData }; }, [roomCode, user, roomData]);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) { setErrorMsg("Bağlantı hatası oluştu."); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => { setUser(u); setLoadingAuth(false); });
    return () => unsubscribe();
  }, []);

  const leaveRoomLocal = () => {
    setRoomCode(''); setRoomData(null); setCurrentView('lobby');
    setDisconnectCountdown(null); setSpectatePrompt(null);
  };

  useEffect(() => {
    if (leftOverlayTimer === null) return;
    if (leftOverlayTimer <= 0) { setLeftOverlayTimer(null); return; }
    const t = setTimeout(() => setLeftOverlayTimer(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [leftOverlayTimer]);

  useEffect(() => {
    if (!user || !roomCode) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    const unsubscribe = onSnapshot(roomRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.status === 'closed') {
          if (currentView === 'room' && data.players.includes(user.uid)) setLeftOverlayTimer(5);
          else setErrorMsg("Oda kapatıldı.");
          leaveRoomLocal();
        } else if (data.status === 'abandoned') {
          setRoomData(data);
          if (data.players.includes(user.uid)) {
            if (data.abandonedBy !== user.uid && disconnectCountdown === null) setDisconnectCountdown(15);
          } else { setErrorMsg("Oyuncular oyundan ayrıldı."); leaveRoomLocal(); }
        } else {
          if (data.status === 'waiting' && data.players.length === 2 && data.host === user.uid) {
            updateDoc(roomRef, { status: 'playing' }).catch(() => {});
          }
          setRoomData(data);
          setDisconnectCountdown(null);
          setCurrentView('room');
        }
      } else { setErrorMsg("Oda bulunamadı veya kapandı."); leaveRoomLocal(); }
    }, () => { setErrorMsg("Oda verisi alınamadı."); });
    return () => unsubscribe();
  }, [user, roomCode, currentView]);

  useEffect(() => {
    if (disconnectCountdown === null || disconnectCountdown === 'paused') return;
    if (disconnectCountdown === 0) {
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
      updateDoc(roomRef, { status: 'closed' }).catch(() => {});
      setLeftOverlayTimer(5); leaveRoomLocal(); return;
    }
    const t = setTimeout(() => setDisconnectCountdown(p => typeof p === 'number' ? p - 1 : p), 1000);
    return () => clearTimeout(t);
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
      if (document.visibilityState === 'hidden' && data.status === 'playing' && data.players.includes(u.uid)) {
        updateDoc(roomRef, { status: 'abandoned', abandonedBy: u.uid }).catch(() => {});
      } else if (document.visibilityState === 'visible' && data.status === 'abandoned' && data.abandonedBy === u.uid) {
        updateDoc(roomRef, { status: 'playing', abandonedBy: null }).catch(() => {});
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
      gameId, host: user.uid, players: [user.uid], spectators: [],
      playerNames: { [user.uid]: nickname || 'Oyuncu 1' },
      scores: { [user.uid]: 0 }, status: 'waiting',
      // Tavla özel alanlar
      board: null, turn: null, startingPlayer: null,
      dice: [], usedDice: [], phase: 'rolling', // 'rolling' | 'moving'
      bar: {}, borneOff: {}, playerColors: {},
      winner: null, rematchRequestedBy: null, abandonedBy: null,
      createdAt: new Date().toISOString()
    };
    try { await setDoc(roomRef, initialState); setRoomCode(newCode); setDisconnectCountdown(null); }
    catch { setErrorMsg("Oda kurulamadı."); }
  };

  const joinRoom = async (code) => {
    if (!user || !code) return;
    const cleanCode = code.trim().toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', cleanCode);
    try {
      const snap = await getDoc(roomRef);
      if (!snap.exists()) { setErrorMsg("Böyle bir oda kodu yok."); return; }
      const data = snap.data();
      if (data.status === 'closed') { setErrorMsg("Bu oda kapalı."); return; }
      if (data.players.length >= 2 && !data.players.includes(user.uid)) {
        if (data.spectators?.includes(user.uid)) { setRoomCode(cleanCode); setJoinCodeInput(''); return; }
        setSpectatePrompt(cleanCode); return;
      }
      if (!data.players.includes(user.uid)) {
        const updatedPlayers = [...data.players, user.uid];
        const startingPlayer = updatedPlayers[Math.random() < 0.5 ? 0 : 1];
        // Renk ataması: host -> white, 2. oyuncu -> black (veya önceki oyundan ters)
        const hostColor = data.playerColors?.[data.players[0]] || 'white';
        const joinColor = hostColor === 'white' ? 'black' : 'white';
        await updateDoc(roomRef, {
          players: updatedPlayers,
          playerNames: { ...data.playerNames, [user.uid]: nickname || 'Oyuncu 2' },
          scores: { ...data.scores, [user.uid]: 0 },
          playerColors: { [data.players[0]]: hostColor, [user.uid]: joinColor },
          status: 'playing', turn: startingPlayer, startingPlayer,
          board: createInitialBoard(),
          bar: { white: 0, black: 0 },
          borneOff: { white: 0, black: 0 },
          dice: [], usedDice: [], phase: 'rolling', winner: null
        });
      }
      setRoomCode(cleanCode); setJoinCodeInput(''); setErrorMsg(''); setDisconnectCountdown(null);
    } catch { setErrorMsg("Odaya katılırken bir hata oluştu."); }
  };

  const acceptSpectate = async () => {
    if (!spectatePrompt || !user) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', spectatePrompt);
    try {
      const snap = await getDoc(roomRef);
      if (snap.exists()) {
        const data = snap.data();
        await updateDoc(roomRef, { spectators: [...(data.spectators || []), user.uid] });
        setRoomCode(spectatePrompt); setSpectatePrompt(null); setJoinCodeInput(''); setErrorMsg('');
      }
    } catch { setErrorMsg("Seyirci olarak bağlanılamadı."); }
  };

  const leaveRoom = async () => {
    const currentCode = roomCode;
    const isPlayer = roomData?.players?.includes(user?.uid);
    leaveRoomLocal();
    if (currentCode && user && isPlayer) {
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentCode);
      try { await updateDoc(roomRef, { status: 'closed' }); } catch {}
    }
  };

  const copyToClipboard = () => {
    const ta = document.createElement("textarea");
    ta.value = roomCode; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); setCopySuccess(true); setTimeout(() => setCopySuccess(false), 2000); } catch {}
    document.body.removeChild(ta);
  };

  if (loadingAuth) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
      <Loader2 className="animate-spin w-8 h-8" />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-4 md:p-8 relative">
      {leftOverlayTimer !== null && currentView === 'lobby' && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/80 flex flex-col items-center justify-center backdrop-blur-sm p-4 h-[100dvh]">
          <div className="bg-slate-800 p-8 rounded-2xl border border-slate-600 shadow-2xl flex flex-col items-center max-w-sm w-full relative">
            <button onClick={() => setLeftOverlayTimer(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white"><X className="w-6 h-6" /></button>
            <Users className="w-16 h-16 text-red-400 mb-4 opacity-80" />
            <h2 className="text-xl font-bold text-center mb-2">Rakibiniz Ayrıldı</h2>
            <p className="text-slate-400 text-center mb-6 text-sm">Oyun sonlandırıldı ve lobiye döndünüz.</p>
            <div className="w-12 h-12 rounded-full border-4 border-slate-700 flex items-center justify-center font-mono font-bold text-lg text-slate-300">{leftOverlayTimer}</div>
          </div>
        </div>
      )}
      {typeof disconnectCountdown === 'number' && roomData?.status === 'abandoned' && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/90 flex flex-col items-center justify-center backdrop-blur-sm p-4 h-[100dvh]">
          <AlertCircle className="w-16 h-16 text-yellow-500 mb-4 animate-pulse" />
          <h2 className="text-2xl font-bold text-center mb-2">Rakibin Bağlantısı Koptu!</h2>
          <p className="text-slate-300 text-center mb-8 max-w-md">Otomatik kapanmasına:</p>
          <div className="text-5xl font-mono font-bold text-yellow-400 mb-8">{disconnectCountdown}</div>
          <div className="flex flex-col sm:flex-row gap-4">
            <button onClick={() => setDisconnectCountdown('paused')} className="bg-indigo-600 hover:bg-indigo-500 border border-indigo-400 px-6 py-3 rounded-lg font-medium flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Bekle</button>
            <button onClick={leaveRoom} className="bg-slate-800 hover:bg-slate-700 border border-slate-600 px-6 py-3 rounded-lg font-medium">Hemen Lobiye Dön</button>
          </div>
        </div>
      )}
      {spectatePrompt && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/90 flex flex-col items-center justify-center backdrop-blur-sm p-4 h-[100dvh]">
          <Eye className="w-16 h-16 text-indigo-500 mb-4" />
          <h2 className="text-2xl font-bold text-center mb-2">Bu Oda Dolu</h2>
          <p className="text-slate-300 text-center mb-8 max-w-md">Maçı seyirci olarak izlemek ister misiniz?</p>
          <div className="flex gap-4">
            <button onClick={acceptSpectate} className="bg-indigo-600 hover:bg-indigo-500 px-6 py-3 rounded-lg font-bold">İzle</button>
            <button onClick={() => setSpectatePrompt(null)} className="bg-slate-800 hover:bg-slate-700 border border-slate-600 px-6 py-3 rounded-lg font-medium">Vazgeç</button>
          </div>
        </div>
      )}
      {errorMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 w-[90%] max-w-md z-[99999] bg-red-500/95 backdrop-blur-sm border border-red-400 text-white p-4 rounded-xl flex items-center gap-3 shadow-2xl">
          <AlertCircle className="w-6 h-6 shrink-0" />
          <span className="font-medium text-sm flex-grow text-center">{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="bg-black/20 hover:bg-black/40 p-1 rounded"><X className="w-5 h-5" /></button>
        </div>
      )}

      <header className="max-w-5xl mx-auto flex items-center justify-between mb-8 pb-4 border-b border-slate-700 mt-4 md:mt-0">
        <div className="flex items-center gap-3">
          <Gamepad2 className="w-8 h-8 text-indigo-400" />
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Masa Oyunları Portalı</h1>
        </div>
        <div className="text-xs text-slate-400 bg-slate-800 px-3 py-1 rounded-full truncate max-w-[120px]">{nickname || `Oyuncu: ${user?.uid.substring(0, 4)}`}</div>
      </header>

      {currentView === 'lobby' ? (
        <main className="max-w-5xl mx-auto">
          <div className="bg-slate-800 p-6 rounded-xl mb-6 shadow-lg border border-slate-700 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div><h2 className="text-xl font-semibold mb-1">Oyuncu İsmin</h2><p className="text-sm text-slate-400">Oyunlarda bu isimle görüneceksin.</p></div>
            <input type="text" placeholder="İsmini yaz..." value={nickname} onChange={(e) => { setNickname(e.target.value); localStorage.setItem('nickname', e.target.value); }} className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-center w-full md:w-64 focus:ring-2 focus:ring-indigo-500 outline-none" maxLength={15} />
          </div>
          <div className="bg-slate-800 p-6 rounded-xl mb-8 shadow-xl border border-slate-700 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div><h2 className="text-xl font-semibold mb-1">Davet Kodun Var Mı?</h2><p className="text-sm text-slate-400">Arkadaşının gönderdiği 6 haneli kodu gir ve masaya otur.</p></div>
            <div className="flex w-full md:w-auto gap-2">
              <input type="text" placeholder="Örn: AB12CD" value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())} className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 uppercase tracking-widest text-center w-full md:w-40 focus:ring-2 focus:ring-indigo-500 outline-none font-mono" maxLength={6} />
              <button onClick={() => joinRoom(joinCodeInput)} className="bg-indigo-500 hover:bg-indigo-600 px-6 py-2 rounded-lg font-medium">Katıl</button>
            </div>
          </div>
          <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2"><Users className="w-6 h-6 text-slate-400" /> Oda Kur & Oyun Seç</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {GAMES.map(game => (
              <div key={game.id} className={`p-6 rounded-xl border flex flex-col transition-all duration-300 relative overflow-hidden ${!game.available ? 'bg-slate-800/50 border-slate-700 opacity-70 grayscale' : 'bg-slate-800 border-indigo-500/30 hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/10 cursor-pointer'}`}>
                <div className="text-4xl mb-4">{game.icon}</div>
                <h3 className="text-xl font-bold mb-2">{game.name}</h3>
                <p className="text-sm text-slate-400 flex-grow mb-6">{game.desc}</p>
                {game.available ? (
                  <button onClick={() => createRoom(game.id)} className="w-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/50 hover:bg-indigo-500 hover:text-white py-2 rounded-lg font-medium transition-colors">Oda Kur</button>
                ) : (
                  <button disabled className="w-full bg-slate-700 text-slate-400 py-2 rounded-lg font-medium cursor-not-allowed">Çok Yakında</button>
                )}
              </div>
            ))}
          </div>
        </main>
      ) : (
        <main className="max-w-5xl mx-auto flex flex-col items-center">
          <div className="w-full flex items-center justify-between mb-6">
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
          <div className="w-full bg-slate-800 rounded-2xl p-4 md:p-6 shadow-2xl border border-slate-700 flex flex-col items-center">
            {roomData?.status === 'waiting' ? (
              <div className="text-center py-12">
                <Loader2 className="w-12 h-12 animate-spin text-indigo-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold mb-2">Rakip Bekleniyor...</h2>
                <p className="text-slate-400 max-w-sm mx-auto mb-6">Arkadaşına oda kodunu gönder.</p>
                <div className="text-3xl font-mono bg-slate-900 px-6 py-3 rounded-lg border border-slate-600 inline-block">{roomCode}</div>
              </div>
            ) : roomData?.gameId === 'xox' ? (
              <TicTacToeGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} />
            ) : roomData?.gameId === 'tavla' ? (
              <TavlaGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} />
            ) : null}
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

  // Seçili pul (from noktası)
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [rollingDice, setRollingDice] = useState(false);
  const [diceAnim, setDiceAnim] = useState([null, null]);

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

  // Kalan zarlar
  const remainingDice = (() => {
    const d = [...dice];
    const u = [...usedDice];
    for (const v of u) {
      const i = d.indexOf(v);
      if (i !== -1) d.splice(i, 1);
    }
    return d;
  })();

  // Seçili noktaya göre geçerli hamleler
  const validMoves = (isMyTurn && myPhase === 'moving' && remainingDice.length > 0)
    ? getValidMoves(board, myColor, remainingDice, bar[myColor] || 0, borneOff[myColor] || 0)
    : [];

  const validFromPoints = new Set(validMoves.map(m => m.from));
  const validToPoints = selectedPoint !== null
    ? new Set(validMoves.filter(m => m.from === selectedPoint).map(m => m.to))
    : new Set();

  // Zar atma
  const handleRollDice = async () => {
    if (!isMyTurn || myPhase !== 'rolling' || rollingDice) return;
    setRollingDice(true);

    // Animasyon: hızlıca değişen sayılar
    let steps = 0;
    const interval = setInterval(() => {
      setDiceAnim([rollDie(), rollDie()]);
      steps++;
      if (steps >= 8) {
        clearInterval(interval);
        const d1 = rollDie(), d2 = rollDie();
        const finalDice = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
        setDiceAnim([d1, d2]);
        setTimeout(async () => {
          const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
          // Geçerli hamle var mı kontrol et
          const moves = getValidMoves(board, myColor, finalDice, bar[myColor] || 0, borneOff[myColor] || 0);
          if (moves.length === 0) {
            // Hamle yok, sırayı geç
            const oppUid = roomData.players.find(id => id !== user.uid);
            await updateDoc(roomRef, {
              dice: finalDice, usedDice: finalDice, // hepsini kullanılmış say
              phase: 'rolling',
              turn: oppUid
            });
          } else {
            await updateDoc(roomRef, { dice: finalDice, usedDice: [], phase: 'moving' });
          }
          setRollingDice(false);
        }, 300);
      }
    }, 80);
  };

  // Pul hamlesi
  const handlePointClick = async (pointIdx) => {
    if (!isMyTurn || myPhase !== 'moving') return;

    // Bar'a tıklama simüle et (kendi barı)
    // pointIdx: 0-23 normal, -1 = bar (beyaz), 24 = bar (siyah) -- ama biz bar'ı ayrıca handle ediyoruz

    if (selectedPoint === null) {
      // Seçim yapılmamış: bu noktadan seçilebilir mi?
      const hasBar = (bar[myColor] || 0) > 0;
      if (hasBar && pointIdx !== 'bar') return; // bar varken başka yerden oynama
      if (pointIdx === 'bar') {
        if (validFromPoints.has(-1)) setSelectedPoint(-1);
        return;
      }
      if (validFromPoints.has(pointIdx)) {
        setSelectedPoint(pointIdx);
      }
    } else {
      // Hamle yap
      if (pointIdx === selectedPoint || (pointIdx === 'bar' && selectedPoint !== -1)) {
        setSelectedPoint(null);
        return;
      }

      // Bearing off için özel: pointIdx = 'bearoff'
      const targetIdx = pointIdx;
      const movesForFrom = validMoves.filter(m => m.from === selectedPoint && m.to === targetIdx);

      if (movesForFrom.length === 0) {
        // Geçersiz hamle, seçimi değiştir
        if (validFromPoints.has(pointIdx)) setSelectedPoint(pointIdx);
        else setSelectedPoint(null);
        return;
      }

      // En küçük zarı kullan (veya tam olan)
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

      // Oyun bitti mi?
      if (newBorneOff[myColor] >= 15) {
        const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
        const oppUid = roomData.players.find(id => id !== user.uid);
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
        // Tur bitti
        const oppUid = roomData.players.find(id => id !== user.uid);
        await updateDoc(roomRef, {
          board: newBoard, bar: newBar, borneOff: newBorneOff,
          dice, usedDice: newUsedDice, phase: 'rolling', turn: oppUid
        });
      } else {
        // Kalan zarlarla devam, geçerli hamle var mı?
        const oppColor = myColor === 'white' ? 'black' : 'white';
        const nextMoves = getValidMoves(newBoard, myColor, newRemainingDice, newBar[myColor] || 0, newBorneOff[myColor] || 0);
        if (nextMoves.length === 0) {
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

  const handleRematch = async () => {
    if (isSpectator) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    await updateDoc(roomRef, { rematchRequestedBy: user.uid });
  };

  const handleAcceptRematch = async () => {
    if (isSpectator) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    const nextStarter = roomData.players.find(id => id !== roomData.startingPlayer) || roomData.players[0];
    // Renkleri değiştir
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

  const handleRejectRematch = async () => {
    if (isSpectator) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    await updateDoc(roomRef, { status: 'closed' });
  };

  // Görüntü için: kendi bakış açısından bak
  // Beyaz oyuncu alt kısım (13-24 arası kendi evi), siyah üst
  // Tahtayı her zaman mevcut oyuncunun bakış açısından göster
  // Beyaz: 1-12 üstte (rakip ev), 13-24 altta (kendi ev)
  // Siyah: 24-13 üstte, 12-1 altta
  const isWhitePlayer = myColor === 'white' || (isSpectator && true);
  // Seyirciler beyaz perspektifinden görür

  const winnerName = roomData.winner ? (roomData.winner === p1Uid ? p1Name : p2Name) : null;
  const winnerColor = roomData.winner ? roomData.playerColors?.[roomData.winner] : null;

  const currentTurnName = roomData.turn === p1Uid ? p1Name : p2Name;

  // Pul rengi gösterimi
  const pieceColor = (color) => color === 'white'
    ? 'bg-slate-100 border-2 border-slate-300 shadow-md text-slate-800'
    : 'bg-slate-800 border-2 border-slate-600 shadow-md text-slate-100';

  const pieceColorDot = (color) => color === 'white' ? '#e2e8f0' : '#1e293b';

  // Bearing off için hamle var mı?
  const canBearOff = isMyTurn && myPhase === 'moving' && selectedPoint !== null &&
    validToPoints.has(myColor === 'white' ? 24 : -1);

  // Zarların görüntüsü
  const displayDice = rollingDice ? diceAnim : (remainingDice.length > 0 ? remainingDice : dice);
  const usedDiceDisplay = rollingDice ? [] : usedDice;

  // Nokta düzeni: üst sıra (sağdan sola: 13,14,...24) ve alt sıra (sağdan sola: 12,11,...1)
  // Beyaz perspektifinden:
  // Üst sıra: nokta 13-24 (index 12-23), soldan sağa gösterilir
  // Alt sıra: nokta 1-12 (index 0-11), sağdan sola gösterilir
  // Ama standart tavla tahtasında:
  //   Üst sol 13, üst sağ 24
  //   Alt sol 12, alt sağ 1
  // Siyah perspektifinden tam ters

  const getTopPoints = () => isWhitePlayer
    ? Array.from({ length: 12 }, (_, i) => 12 + i)   // index 12..23 (noktalar 13..24)
    : Array.from({ length: 12 }, (_, i) => 11 - i);  // index 11..0  (noktalar 12..1)

  const getBottomPoints = () => isWhitePlayer
    ? Array.from({ length: 12 }, (_, i) => 11 - i)   // index 11..0 (noktalar 12..1)
    : Array.from({ length: 12 }, (_, i) => 12 + i);  // index 12..23

  const topPoints = getTopPoints();
  const bottomPoints = getBottomPoints();

  const renderCheckers = (color, count, isTop, pointIdx) => {
    const isSelected = selectedPoint === pointIdx;
    const isValidFrom = validFromPoints.has(pointIdx) && isMyTurn && myPhase === 'moving';
    const isValidTo = validToPoints.has(pointIdx);
    const maxShow = 5;
    const extra = count > maxShow ? count - maxShow : 0;
    const showCount = Math.min(count, maxShow);

    return (
      <div className={`flex flex-col ${isTop ? '' : 'flex-col-reverse'} items-center gap-[1px] relative`}>
        {Array.from({ length: showCount }).map((_, i) => (
          <div key={i} className={`
            w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold select-none
            ${color === 'white' ? 'bg-slate-100 border-2 border-slate-400 text-slate-800' : 'bg-slate-700 border-2 border-slate-500 text-slate-100'}
            ${isSelected ? 'ring-2 ring-yellow-400 ring-offset-1 ring-offset-slate-800' : ''}
            ${i === (isTop ? showCount - 1 : 0) && extra > 0 ? 'relative' : ''}
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
    const visualIndex = isTop
      ? topPoints.indexOf(pointIdx)
      : bottomPoints.indexOf(pointIdx);
    const isDark = visualIndex % 2 === 0;

    const hasBar = (bar[myColor] || 0) > 0;
    const clickable = isMyTurn && myPhase === 'moving' && !hasBar;

    return (
      <div
        key={pointIdx}
        onClick={() => clickable && handlePointClick(pointIdx)}
        className={`
          relative flex flex-col ${isTop ? '' : 'flex-col-reverse'} items-center
          w-[52px] min-h-[130px] rounded-sm cursor-pointer select-none transition-all
          ${isDark ? 'bg-red-900/40' : 'bg-slate-600/30'}
          ${isSelected ? 'bg-yellow-500/20 ring-1 ring-yellow-400' : ''}
          ${isValidTo ? 'bg-emerald-500/20 ring-1 ring-emerald-400' : ''}
          ${isValidFrom ? 'ring-1 ring-indigo-400 ring-inset' : ''}
          ${(isValidFrom || isValidTo) ? 'cursor-pointer' : 'cursor-default'}
        `}
      >
        {/* Üçgen rengi */}
        <div className={`absolute inset-0 pointer-events-none rounded-sm ${isDark ? 'border-b-[80px] border-l-[26px] border-r-[26px] border-b-red-800/60 border-l-transparent border-r-transparent' : 'border-b-[80px] border-l-[26px] border-r-[26px] border-b-slate-500/40 border-l-transparent border-r-transparent'} ${isTop ? 'rotate-180' : ''}`} />

        {/* Pul numarası */}
        <div className={`absolute ${isTop ? 'bottom-1' : 'top-1'} text-[10px] text-slate-500 font-mono`}>
          {pointIdx + 1}
        </div>

        {/* Geçerli hamle noktası göstergesi (boş nokta için) */}
        {isValidTo && pt.count === 0 && (
          <div className={`${isTop ? 'mt-2' : 'mb-2'} w-5 h-5 rounded-full bg-emerald-400/50 border border-emerald-400`} />
        )}

        {/* Pullar */}
        {pt.count > 0 && renderCheckers(pt.color, pt.count, isTop, pointIdx)}
      </div>
    );
  };

  const renderDie = (value, used = false) => {
    const dots = {
      1: [[50, 50]],
      2: [[25, 25], [75, 75]],
      3: [[25, 25], [50, 50], [75, 75]],
      4: [[25, 25], [75, 25], [25, 75], [75, 75]],
      5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
      6: [[25, 20], [75, 20], [25, 50], [75, 50], [25, 80], [75, 80]],
    };
    const positions = value ? (dots[value] || []) : [];
    return (
      <div className={`w-10 h-10 rounded-lg relative border-2 transition-all ${used ? 'border-slate-600 bg-slate-700 opacity-40' : 'border-slate-300 bg-slate-100'}`}>
        <svg viewBox="0 0 100 100" className="w-full h-full">
          {positions.map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="10" fill={used ? '#64748b' : '#0f172a'} />
          ))}
        </svg>
      </div>
    );
  };

  return (
    <div className="w-full flex flex-col items-center gap-4">
      {/* BAŞLIK VE SKOR */}
      <div className="w-full flex items-center justify-between bg-slate-900/80 rounded-xl p-3 border border-slate-700">
        <div className="flex items-center gap-2">
          <div className={`w-4 h-4 rounded-full border-2 ${p1Color === 'white' ? 'bg-slate-100 border-slate-300' : 'bg-slate-800 border-slate-500'}`} />
          <div>
            <div className="text-sm font-bold text-slate-200">{p1Name} {p1Uid === user.uid && !isSpectator ? '(Sen)' : ''}</div>
            <div className="text-xs text-slate-400">{p1Color === 'white' ? 'Beyaz' : 'Siyah'} • {borneOff[p1Color] || 0}/15 çıktı</div>
          </div>
          {p1Score > p2Score && <Crown className="w-4 h-4 text-yellow-400" />}
        </div>

        <div className="flex flex-col items-center">
          <div className="text-lg font-mono font-bold">{p1Score} — {p2Score}</div>
          <div className="text-xs text-slate-500">SKOR</div>
        </div>

        <div className="flex items-center gap-2">
          {p2Score > p1Score && <Crown className="w-4 h-4 text-yellow-400" />}
          <div className="text-right">
            <div className="text-sm font-bold text-slate-200">{p2Name} {p2Uid === user.uid && !isSpectator ? '(Sen)' : ''}</div>
            <div className="text-xs text-slate-400">{p2Color === 'white' ? 'Beyaz' : 'Siyah'} • {borneOff[p2Color] || 0}/15 çıktı</div>
          </div>
          <div className={`w-4 h-4 rounded-full border-2 ${p2Color === 'white' ? 'bg-slate-100 border-slate-300' : 'bg-slate-800 border-slate-500'}`} />
        </div>
      </div>

      {/* DURUM MESAJI */}
      <div className={`text-center font-bold text-lg ${roomData.winner ? 'text-yellow-400' : isMyTurn ? 'text-indigo-400' : 'text-slate-400'}`}>
        {isSpectator && <span className="text-xs text-yellow-400 font-bold mr-2 uppercase flex items-center gap-1 justify-center"><Eye className="w-3 h-3" /> SEYİRCİ</span>}
        {roomData.winner
          ? `🏆 ${winnerName} Kazandı!`
          : isMyTurn
            ? myPhase === 'rolling' ? 'Zarları At!' : 'Hamle Yap'
            : `${currentTurnName} düşünüyor...`}
      </div>

      {/* ZAR ALANI */}
      <div className="flex items-center gap-4 bg-slate-900/60 rounded-xl px-6 py-3 border border-slate-700">
        <div className="flex gap-2">
          {(displayDice.length > 0 ? displayDice : [null, null]).map((val, i) => (
            <div key={i}>{renderDie(val, false)}</div>
          ))}
        </div>

        {isMyTurn && myPhase === 'rolling' && !roomData.winner && (
          <button
            onClick={handleRollDice}
            disabled={rollingDice}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 px-5 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-2"
          >
            {rollingDice ? <Loader2 className="w-4 h-4 animate-spin" /> : '🎲'} Zar At
          </button>
        )}

        {isMyTurn && myPhase === 'moving' && remainingDice.length > 0 && (
          <div className="text-xs text-slate-400">
            Kalan: <span className="font-mono text-indigo-300">{remainingDice.join(', ')}</span>
          </div>
        )}
      </div>

      {/* ANA TAHTA */}
      <div className="relative bg-amber-950/80 border-2 border-amber-800 rounded-xl overflow-hidden shadow-2xl p-1">
        {/* Üst nokta numaraları */}
        <div className="flex">
          {/* Sol kısım (6 nokta) */}
          <div className="flex gap-[2px] px-1">
            {topPoints.slice(0, 6).map(idx => renderPoint(idx, true))}
          </div>
          {/* Bar */}
          <div className="w-12 flex flex-col items-center justify-start pt-2 mx-1">
            {/* Bar siyah */}
            {bar.black > 0 && (
              <div
                onClick={() => isMyTurn && myPhase === 'moving' && myColor === 'black' && handlePointClick('bar')}
                className={`flex flex-col gap-[2px] cursor-pointer ${selectedPoint === -1 && myColor === 'black' ? 'ring-2 ring-yellow-400 rounded' : ''}`}
              >
                {Array.from({ length: Math.min(bar.black, 4) }).map((_, i) => (
                  <div key={i} className="w-9 h-7 rounded-full bg-slate-700 border-2 border-slate-500 flex items-center justify-center text-xs text-slate-100 font-bold">
                    {i === 3 && bar.black > 4 ? `+${bar.black - 3}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Sağ kısım (6 nokta) */}
          <div className="flex gap-[2px] px-1">
            {topPoints.slice(6, 12).map(idx => renderPoint(idx, true))}
          </div>
        </div>

        {/* Orta şerit */}
        <div className="flex items-center justify-center h-8 bg-amber-900/60">
          <div className="text-xs text-amber-700 font-bold tracking-wider uppercase">Tavla</div>
        </div>

        {/* Alt nokta numaraları */}
        <div className="flex">
          <div className="flex gap-[2px] px-1">
            {bottomPoints.slice(0, 6).map(idx => renderPoint(idx, false))}
          </div>
          {/* Bar */}
          <div className="w-12 flex flex-col items-center justify-end pb-2 mx-1">
            {bar.white > 0 && (
              <div
                onClick={() => isMyTurn && myPhase === 'moving' && myColor === 'white' && handlePointClick('bar')}
                className={`flex flex-col-reverse gap-[2px] cursor-pointer ${selectedPoint === -1 && myColor === 'white' ? 'ring-2 ring-yellow-400 rounded' : ''}`}
              >
                {Array.from({ length: Math.min(bar.white, 4) }).map((_, i) => (
                  <div key={i} className="w-9 h-7 rounded-full bg-slate-100 border-2 border-slate-400 flex items-center justify-center text-xs text-slate-800 font-bold">
                    {i === 3 && bar.white > 4 ? `+${bar.white - 3}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-[2px] px-1">
            {bottomPoints.slice(6, 12).map(idx => renderPoint(idx, false))}
          </div>
        </div>
      </div>

      {/* BEARING OFF + SEÇİLİ PUL */}
      <div className="flex gap-4 items-center">
        {/* Kendi bearing off alanı */}
        <div
          onClick={handleBearOffClick}
          className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all cursor-pointer
            ${canBearOff ? 'border-emerald-400 bg-emerald-500/20 shadow-[0_0_12px_rgba(52,211,153,0.3)]' : 'border-slate-700 bg-slate-800/40 cursor-default'}
          `}
        >
          <div className="text-xs text-slate-400 font-bold uppercase">Çıkma</div>
          <div className="flex gap-1">
            {['white', 'black'].map(color => (
              <div key={color} className="flex flex-col items-center">
                <div className={`w-3 h-3 rounded-full mb-1 ${color === 'white' ? 'bg-slate-100 border border-slate-400' : 'bg-slate-700 border border-slate-500'}`} />
                <div className="text-sm font-mono font-bold text-slate-300">{borneOff[color] || 0}</div>
              </div>
            ))}
          </div>
          {canBearOff && <div className="text-xs text-emerald-400 font-bold">Tıkla!</div>}
        </div>

        {selectedPoint !== null && (
          <div className="text-sm text-yellow-400 bg-yellow-400/10 border border-yellow-400/30 px-3 py-2 rounded-lg">
            Seçili: Nokta {selectedPoint === -1 ? 'BAR' : selectedPoint + 1} — hedef seç
            <button onClick={() => setSelectedPoint(null)} className="ml-2 text-slate-400 hover:text-white"><X className="w-3 h-3 inline" /></button>
          </div>
        )}
      </div>

      {/* RÖVANŞ */}
      {roomData.winner && (
        <div className="w-full bg-slate-900/80 rounded-xl p-4 border border-slate-700 flex flex-col items-center gap-3">
          {isSpectator ? (
            <div className="text-slate-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Oyuncuların kararı bekleniyor...</div>
          ) : !roomData.rematchRequestedBy ? (
            <button onClick={handleRematch} className="bg-indigo-600 hover:bg-indigo-500 w-full py-3 rounded-xl font-bold text-lg">Yeniden Oyna</button>
          ) : roomData.rematchRequestedBy === user.uid ? (
            <div className="flex items-center gap-3 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /> Rakibin cevabı bekleniyor...</div>
          ) : (
            <div className="flex flex-col items-center w-full gap-3">
              <span className="text-indigo-200 font-medium text-center">Rakibiniz rövanş istiyor!</span>
              <div className="flex gap-4 w-full">
                <button onClick={handleAcceptRematch} className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/40 text-green-400 border border-green-500/50 py-3 rounded-xl font-bold"><Check className="w-5 h-5" /> Kabul Et</button>
                <button onClick={handleRejectRematch} className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/50 py-3 rounded-xl font-bold"><X className="w-5 h-5" /> Reddet</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* BEKLEME EKRANI */}
      {roomData.status === 'abandoned' && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-[2px] flex flex-col items-center justify-center p-4 text-center">
          <Loader2 className="w-12 h-12 animate-spin text-indigo-500 mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">Rakip Bekleniyor...</h3>
          <p className="text-slate-400 text-sm mb-8">Bağlantısı kopan rakibiniz bekleniyor.</p>
          <button onClick={leaveRoom} className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50 px-6 py-2 rounded-lg font-medium">Lobiye Dön</button>
        </div>
      )}
    </div>
  );
}

// ==========================================
// XOX (TIC-TAC-TOE) - Değişmeden kaldı
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
      board: newBoard, turn: winnerInfo ? null : nextTurn,
      winner: winnerInfo ? winnerInfo.winner : (newBoard.every(cell => cell) ? 'Draw' : null),
      winningLine: winnerInfo ? winnerInfo.line : null
    };
    if (winnerInfo?.winner) {
      const winnerUid = winnerInfo.winner === 'X' ? p1Uid : p2Uid;
      updatePayload.scores = { ...roomData.scores, [winnerUid]: (roomData.scores?.[winnerUid] || 0) + 1 };
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
      board: Array(9).fill(null), turn: nextStarter, startingPlayer: nextStarter,
      winner: null, winningLine: null, rematchRequestedBy: null
    });
  };

  const rejectRematch = async () => {
    if (isSpectator) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    await updateDoc(roomRef, { status: 'closed' });
  };

  const calculateWinner = (squares) => {
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (const [a,b,c] of lines) {
      if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c])
        return { winner: squares[a], line: [a,b,c] };
    }
    return null;
  };

  let statusMsg = "", statusColor = "text-slate-300";
  if (roomData.winner) {
    if (roomData.winner === 'Draw') { statusMsg = "Oyun Berabere!"; statusColor = "text-yellow-400"; }
    else {
      const winnerUid = roomData.winner === 'X' ? p1Uid : p2Uid;
      if (isSpectator) { statusMsg = `${roomData.playerNames[winnerUid]} Kazandı! 🎉`; statusColor = "text-indigo-400"; }
      else if (roomData.winner === mySymbol) { statusMsg = "Kazandın! 🎉"; statusColor = "text-green-400"; }
      else { statusMsg = "Kaybettin! 😢"; statusColor = "text-red-400"; }
    }
  } else {
    if (isSpectator) { statusMsg = roomData.turn === p1Uid ? `${p1Name} Hamle Yapıyor...` : `${p2Name} Hamle Yapıyor...`; statusColor = "text-indigo-400"; }
    else { statusMsg = isMyTurn ? "Senin Sıran!" : "Rakibin Sırası..."; statusColor = isMyTurn ? "text-indigo-400" : "text-slate-400"; }
  }

  return (
    <div className="relative flex flex-col items-center w-full max-w-md bg-gradient-to-br from-indigo-900/60 via-slate-900/80 to-purple-900/60 p-4 md:p-8 rounded-[2rem] border border-indigo-500/40 shadow-[0_0_40px_rgba(99,102,241,0.25)] overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-20 -left-20 w-48 h-48 bg-indigo-500/30 blur-[80px] rounded-full" />
        <div className="absolute -bottom-20 -right-20 w-48 h-48 bg-purple-500/30 blur-[80px] rounded-full" />
      </div>
      <h2 className="text-2xl font-bold mb-6 text-slate-200 z-10 uppercase tracking-widest">Tic-Tac-Toe</h2>
      <div className="relative z-10 w-full flex flex-col items-center">
        <div className="flex flex-col w-full mb-6 bg-slate-900/80 backdrop-blur-md p-4 rounded-xl border border-indigo-500/30 shadow-lg">
          {isSpectator && <div className="text-center text-xs text-yellow-400 font-bold mb-3 tracking-widest uppercase flex items-center justify-center gap-1"><Eye className="w-4 h-4" /> SEYİRCİ MODU</div>}
          <div className={`text-center font-bold text-xl md:text-2xl mb-4 ${statusColor}`}>{statusMsg}</div>
          <div className="flex justify-between items-center w-full px-2">
            <div className="text-center flex flex-col items-center text-indigo-400 w-1/3">
              <div className="flex items-center gap-1 mb-1">{p1Score > p2Score && <Crown className="w-4 h-4 text-yellow-400" />}<span className="text-2xl font-bold">X</span></div>
              <div className="text-xs truncate w-full px-1 font-medium">{p1Name} {isPlayer1 ? '(Sen)' : ''}</div>
              <div className="text-xl font-mono font-bold text-white mt-1">{p1Score}</div>
            </div>
            <div className="text-slate-500 font-bold text-xl w-1/3 text-center opacity-50">VS</div>
            <div className="text-center flex flex-col items-center text-purple-400 w-1/3">
              <div className="flex items-center gap-1 mb-1">{p2Score > p1Score && <Crown className="w-4 h-4 text-yellow-400" />}<span className="text-2xl font-bold">O</span></div>
              <div className="text-xs truncate w-full px-1 font-medium">{p2Name} {isPlayer2 ? '(Sen)' : ''}</div>
              <div className="text-xl font-mono font-bold text-white mt-1">{p2Score}</div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3 w-fit mb-8 p-3 sm:p-4 bg-slate-800/90 backdrop-blur-md rounded-2xl shadow-inner border border-slate-600 mx-auto">
          {roomData.board.map((cell, index) => {
            const isWinningCell = roomData.winningLine?.includes(index);
            return (
              <button key={index} onClick={() => handleMove(index)}
                disabled={!isMyTurn || isSpectator || cell !== null || roomData.winner !== null || roomData.status === 'abandoned'}
                className={`w-[80px] h-[80px] sm:w-[90px] sm:h-[90px] flex-shrink-0 flex items-center justify-center rounded-xl transition-all m-0 p-0
                  ${cell === null && isMyTurn && !isSpectator && !roomData.winner && roomData.status !== 'abandoned' ? 'hover:bg-slate-700 bg-slate-900 cursor-pointer' : 'bg-slate-900'}
                  ${isWinningCell ? 'bg-indigo-500/40 border-2 border-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.6)]' : 'border border-slate-700'}
                  ${cell === 'X' ? 'text-indigo-400' : 'text-purple-400'}
                `}
              >
                <span className="leading-none text-6xl sm:text-7xl font-black select-none pointer-events-none mt-2">{cell}</span>
              </button>
            );
          })}
        </div>
        {roomData.winner && roomData.status !== 'abandoned' && (
          <div className="w-full flex flex-col items-center bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-indigo-500/30 shadow-lg">
            {isSpectator ? (
              <div className="text-slate-400 text-sm py-2 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Oyuncuların kararı bekleniyor...</div>
            ) : !roomData.rematchRequestedBy ? (
              <button onClick={requestRematch} className="bg-indigo-600 hover:bg-indigo-500 w-full py-3 rounded-xl font-bold text-lg">Yeniden Oyna</button>
            ) : roomData.rematchRequestedBy === user.uid ? (
              <div className="flex items-center gap-3 text-slate-400 py-2"><Loader2 className="w-5 h-5 animate-spin" /><span>Rakibin cevabı bekleniyor...</span></div>
            ) : (
              <div className="flex flex-col items-center w-full">
                <span className="text-indigo-200 font-medium mb-3 text-center">Rakibiniz rövanş istiyor!</span>
                <div className="flex gap-4 w-full">
                  <button onClick={acceptRematch} className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/40 text-green-400 border border-green-500/50 py-3 rounded-xl font-bold"><Check className="w-5 h-5" /> Kabul Et</button>
                  <button onClick={rejectRematch} className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/50 py-3 rounded-xl font-bold"><X className="w-5 h-5" /> Reddet</button>
                </div>
              </div>
            )}
          </div>
        )}
        {roomData.status === 'abandoned' && (
          <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-[2px] flex flex-col items-center justify-center rounded-[2rem] p-4 text-center">
            <Loader2 className="w-12 h-12 animate-spin text-indigo-500 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Rakip Bekleniyor...</h3>
            <p className="text-slate-400 text-sm mb-8">Bağlantısı kopan rakibiniz bekleniyor.</p>
            <button onClick={leaveRoom} className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50 px-6 py-2 rounded-lg font-medium">Lobiye Dön</button>
          </div>
        )}
      </div>
    </div>
  );
}