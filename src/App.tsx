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
  { id: 'tavla', name: 'Tavla', desc: 'Zar at, pulları topla.', available: false, icon: '🎲' },
  { id: 'okey101', name: '101 Okey', desc: 'Katlamalı, ceza puanlı efsane.', available: false, icon: '🀄' },
  { id: 'poker', name: 'Texas Hold\'em', desc: 'Blöf ve taktik zamanı.', available: false, icon: '🃏' },
  { id: 'blof', name: 'Blöf', desc: 'Yalan söyleyebilen kazanır.', available: false, icon: '🤫' },
  { id: 'dostkazigi', name: 'Dost Kazığı', desc: 'Arkadaşlıkları bitiren oyun.', available: false, icon: '🤝' },
];

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
              setDisconnectCountdown(10); 
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
    if (disconnectCountdown === null) return;
    if (disconnectCountdown === 0) {
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
      updateDoc(roomRef, { status: 'closed' }).catch(()=>{});
      setLeftOverlayTimer(5); 
      leaveRoomLocal();
      return;
    }
    const timer = setTimeout(() => {
      setDisconnectCountdown(prev => prev - 1);
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
      board: Array(9).fill(null),
      turn: null, 
      startingPlayer: null,
      winner: null,
      rematchRequestedBy: null,
      abandonedBy: null,
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(roomRef, initialState);
      setRoomCode(newCode);
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
           setJoinCodeInput('');
           return;
        }
        setSpectatePrompt(cleanCode);
        return;
      }

      if (!data.players.includes(user.uid)) {
        const updatedPlayers = [...data.players, user.uid];
        const startingPlayer = updatedPlayers[Math.random() < 0.5 ? 0 : 1];
        
        await updateDoc(roomRef, {
          players: updatedPlayers,
          playerNames: { ...data.playerNames, [user.uid]: nickname || 'Oyuncu 2' },
          scores: { ...data.scores, [user.uid]: 0 },
          status: 'playing', 
          turn: startingPlayer,
          startingPlayer: startingPlayer
        });
      }
      
      setRoomCode(cleanCode);
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
      
      {/* 5 Saniyelik ZARİF Ayrılma Mesajı (Lobi üzerinde) */}
      {leftOverlayTimer !== null && currentView === 'lobby' && (
        <div className="fixed inset-0 z-[100] bg-slate-900/80 flex flex-col items-center justify-center backdrop-blur-sm p-4 h-[100dvh]">
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

      {/* Bağlantı Kopma (10sn) Ekranı */}
      {disconnectCountdown !== null && (
        <div className="fixed inset-0 z-[100] bg-slate-900/90 flex flex-col items-center justify-center backdrop-blur-sm p-4 h-[100dvh]">
          <AlertCircle className="w-16 h-16 text-yellow-500 mb-4 animate-pulse" />
          <h2 className="text-2xl font-bold text-center mb-2">Rakibin Bağlantısı Koptu!</h2>
          <p className="text-slate-300 text-center mb-8 max-w-md">
            Rakibiniz oyunu alta almış veya interneti kopmuş olabilir. Geri dönmesi için bekliyoruz...
          </p>
          <div className="text-5xl font-mono font-bold text-yellow-400 mb-8">
            {disconnectCountdown}
          </div>
          <button 
            onClick={leaveRoom}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-600 px-6 py-3 rounded-lg font-medium transition-colors"
          >
            Hemen Lobiye Dön
          </button>
        </div>
      )}

      {/* Seyirci Modu Onay Ekranı */}
      {spectatePrompt && (
        <div className="fixed inset-0 z-[100] bg-slate-900/90 flex flex-col items-center justify-center backdrop-blur-sm p-4 h-[100dvh]">
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

      {/* EN ÜSTTE ÇIKAN SABİT HATA MESAJI (TOAST NOTIFICATION) */}
      {errorMsg && (
        <div className="fixed top-4 left-4 right-4 md:left-1/2 md:right-auto md:-translate-x-1/2 z-[100] bg-red-500/90 border border-red-400 text-white p-4 rounded-xl flex items-center gap-3 shadow-2xl animate-in slide-in-from-top-4">
          <AlertCircle className="w-6 h-6 shrink-0" />
          <span className="font-medium text-sm md:text-base">{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="ml-auto bg-black/20 hover:bg-black/40 p-1 rounded transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      <header className="max-w-4xl mx-auto flex items-center justify-between mb-8 pb-4 border-b border-slate-700 mt-4 md:mt-0">
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
        <main className="max-w-4xl mx-auto">
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
            {GAMES.map(game => (
              <div key={game.id} className={`p-6 rounded-xl border flex flex-col transition-all duration-300 ${game.available ? 'bg-slate-800 border-indigo-500/30 hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/10 cursor-pointer' : 'bg-slate-800/50 border-slate-700 opacity-70 grayscale'}`}>
                <div className="text-4xl mb-4">{game.icon}</div>
                <h3 className="text-xl font-bold mb-2">{game.name}</h3>
                <p className="text-sm text-slate-400 flex-grow mb-6">{game.desc}</p>
                {game.available ? (
                  <button onClick={() => createRoom(game.id)} className="w-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/50 hover:bg-indigo-500 hover:text-white py-2 rounded-lg font-medium transition-colors">
                    Oda Kur
                  </button>
                ) : (
                  <button disabled className="w-full bg-slate-700 text-slate-400 py-2 rounded-lg font-medium cursor-not-allowed">Çok Yakında</button>
                )}
              </div>
            ))}
          </div>
        </main>
      ) : (
        <main className="max-w-4xl mx-auto flex flex-col items-center">
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
                   <TicTacToeGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} />
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
// XOX (Tic-Tac-Toe) Game Implementation
// ==========================================
function TicTacToeGame({ roomData, roomCode, user, db, appId }) {
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
    if (!isMyTurn || isSpectator || roomData.board[index] || roomData.winner) return;

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
    await updateDoc(roomRef, { status: 'closed' });
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
        <div className="grid grid-cols-3 gap-3 w-fit mb-8 p-4 bg-slate-800/90 backdrop-blur-md rounded-2xl shadow-inner border border-slate-600 mx-auto">
          {roomData.board.map((cell, index) => {
            const isWinningCell = roomData.winningLine?.includes(index);
            return (
              <button
                key={index}
                onClick={() => handleMove(index)}
                disabled={!isMyTurn || isSpectator || cell !== null || roomData.winner !== null}
                className={`
                  w-20 h-20 sm:w-24 sm:h-24 flex items-center justify-center text-5xl md:text-7xl font-black rounded-xl transition-all overflow-hidden leading-none m-0 p-0 box-border
                  ${cell === null && isMyTurn && !isSpectator && !roomData.winner ? 'hover:bg-slate-700 bg-slate-900 cursor-pointer' : 'bg-slate-900'}
                  ${(cell !== null || !isMyTurn || isSpectator || roomData.winner) ? 'cursor-default' : ''}
                  ${isWinningCell ? 'bg-indigo-500/40 border-2 border-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.6)]' : 'border border-slate-700 shadow-sm'}
                  ${cell === 'X' ? 'text-indigo-400 drop-shadow-[0_4px_4px_rgba(0,0,0,0.6)]' : 'text-purple-400 drop-shadow-[0_4px_4px_rgba(0,0,0,0.6)]'}
                `}
              >
                {cell}
              </button>
            )
          })}
        </div>

        {/* RÖVANŞ EKRANI */}
        {roomData.winner && (
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