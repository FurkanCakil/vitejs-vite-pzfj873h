// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { Copy, Users, Gamepad2, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
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
const appId = firebaseConfig.projectId; // App ID'yi projeden otomatik alır

// Games catalog
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
  
  const [currentView, setCurrentView] = useState('lobby'); // 'lobby', 'room'
  const [roomCode, setRoomCode] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // 1. Initialize Auth
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

  // 2. Room Listener
  useEffect(() => {
    if (!user || !roomCode) return;

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        setRoomData(docSnap.data());
        setCurrentView('room');
      } else {
        setErrorMsg("Oda bulunamadı veya kapandı.");
        setCurrentView('lobby');
        setRoomCode('');
      }
    }, (err) => {
      console.error("Listen Error:", err);
      setErrorMsg("Oda verisi alınamadı.");
    });

    return () => unsubscribe();
  }, [user, roomCode]);

  // Create Room
  const createRoom = async (gameId) => {
    if (!user) return;
    const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', newCode);
    
    // Initial State for XOX
    const initialState = {
      gameId: gameId,
      host: user.uid,
      players: [user.uid],
      status: 'waiting', // waiting, playing, finished
      board: Array(9).fill(null),
      turn: user.uid,
      winner: null,
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(roomRef, initialState);
      setRoomCode(newCode);
    } catch (err) {
      setErrorMsg("Oda kurulamadı.");
    }
  };

  // Join Room
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
      if (data.players.length >= 2 && !data.players.includes(user.uid)) {
        setErrorMsg("Oda şu an dolu.");
        return;
      }

      if (!data.players.includes(user.uid)) {
        const updatedPlayers = [...data.players, user.uid];
        await updateDoc(roomRef, {
          players: updatedPlayers,
          status: updatedPlayers.length === 2 ? 'playing' : 'waiting'
        });
      }
      setRoomCode(cleanCode);
      setJoinCodeInput('');
      setErrorMsg('');
    } catch (err) {
      setErrorMsg("Odaya katılırken bir hata oluştu.");
    }
  };

  // Leave Room
  const leaveRoom = () => {
    setRoomCode('');
    setRoomData(null);
    setCurrentView('lobby');
  };

  const copyToClipboard = () => {
    const textArea = document.createElement("textarea");
    textArea.value = roomCode;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      alert('Oda kodu kopyalandı! Arkadaşına gönderebilirsin.');
    } catch (err) {
      console.error('Kopyalama başarısız', err);
    }
    document.body.removeChild(textArea);
  };

  if (loadingAuth) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white"><Loader2 className="animate-spin w-8 h-8" /></div>;
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-4 md:p-8">
      {/* Header */}
      <header className="max-w-4xl mx-auto flex items-center justify-between mb-8 pb-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <Gamepad2 className="w-8 h-8 text-indigo-400" />
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            Masa Oyunları Portalı
          </h1>
        </div>
        <div className="text-xs text-slate-400 bg-slate-800 px-3 py-1 rounded-full">
          Oyuncu: {user?.uid.substring(0,6)}
        </div>
      </header>

      {errorMsg && (
        <div className="max-w-4xl mx-auto mb-4 bg-red-500/20 border border-red-500 text-red-200 p-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {errorMsg}
          <button onClick={() => setErrorMsg('')} className="ml-auto text-sm underline">Kapat</button>
        </div>
      )}

      {currentView === 'lobby' ? (
        <main className="max-w-4xl mx-auto">
          {/* Join existing room */}
          <div className="bg-slate-800 p-6 rounded-xl mb-8 shadow-xl border border-slate-700 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold mb-1">Davet Kodun Var Mı?</h2>
              <p className="text-sm text-slate-400">Arkadaşının sana gönderdiği 6 haneli kodu gir ve masaya otur.</p>
            </div>
            <div className="flex w-full md:w-auto gap-2">
              <input 
                type="text" 
                placeholder="Örn: AB12CD" 
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 uppercase tracking-widest text-center w-full md:w-40 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                maxLength={6}
              />
              <button 
                onClick={() => joinRoom(joinCodeInput)}
                className="bg-indigo-500 hover:bg-indigo-600 px-6 py-2 rounded-lg font-medium transition-colors"
              >
                Katıl
              </button>
            </div>
          </div>

          {/* Game Selection */}
          <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
            <Users className="w-6 h-6 text-slate-400" /> Oda Kur & Oyun Seç
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {GAMES.map(game => (
              <div 
                key={game.id} 
                className={`p-6 rounded-xl border flex flex-col transition-all duration-300 ${
                  game.available 
                    ? 'bg-slate-800 border-indigo-500/30 hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/10 cursor-pointer' 
                    : 'bg-slate-800/50 border-slate-700 opacity-70 grayscale'
                }`}
              >
                <div className="text-4xl mb-4">{game.icon}</div>
                <h3 className="text-xl font-bold mb-2">{game.name}</h3>
                <p className="text-sm text-slate-400 flex-grow mb-6">{game.desc}</p>
                
                {game.available ? (
                  <button 
                    onClick={() => createRoom(game.id)}
                    className="w-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/50 hover:bg-indigo-500 hover:text-white py-2 rounded-lg font-medium transition-colors"
                  >
                    Oda Kur
                  </button>
                ) : (
                  <button disabled className="w-full bg-slate-700 text-slate-400 py-2 rounded-lg font-medium cursor-not-allowed">
                    Çok Yakında
                  </button>
                )}
              </div>
            ))}
          </div>
        </main>
      ) : (
        // Room / Game View
        <main className="max-w-4xl mx-auto flex flex-col items-center">
          <div className="w-full flex items-center justify-between mb-8">
            <button onClick={leaveRoom} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" /> Lobiden Çık
            </button>
            <div className="flex items-center gap-4 bg-slate-800 px-4 py-2 rounded-full border border-slate-700">
              <span className="text-sm text-slate-400">Oda Kodu:</span>
              <span className="font-mono font-bold tracking-wider text-indigo-300 text-lg">{roomCode}</span>
              <button onClick={copyToClipboard} className="text-slate-400 hover:text-white" title="Kodu Kopyala">
                <Copy className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="w-full bg-slate-800 rounded-2xl p-8 shadow-2xl border border-slate-700 flex flex-col items-center">
            {roomData?.status === 'waiting' ? (
              <div className="text-center py-12">
                <Loader2 className="w-12 h-12 animate-spin text-indigo-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold mb-2">Rakip Bekleniyor...</h2>
                <p className="text-slate-400 max-w-sm mx-auto mb-6">
                  Arkadaşına oda kodunu gönder. O da "Davet Kodun Var Mı?" bölümüne bu kodu yazarak masaya katılabilir.
                </p>
                <div className="text-3xl font-mono bg-slate-900 px-6 py-3 rounded-lg border border-slate-600 inline-block">
                  {roomCode}
                </div>
              </div>
            ) : (
              <div className="w-full flex flex-col items-center">
                 <h2 className="text-2xl font-bold mb-6">
                   {GAMES.find(g => g.id === roomData.gameId)?.name}
                 </h2>
                 {roomData?.gameId === 'xox' && (
                   <TicTacToeGame roomData={roomData} roomCode={roomCode} user={user} />
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
function TicTacToeGame({ roomData, roomCode, user }) {
  const isPlayer1 = roomData.players[0] === user.uid;
  const mySymbol = isPlayer1 ? 'X' : 'O';
  const opponentSymbol = isPlayer1 ? 'O' : 'X';
  const isMyTurn = roomData.turn === user.uid;

  const handleMove = async (index) => {
    if (!isMyTurn || roomData.board[index] || roomData.winner) return;

    const newBoard = [...roomData.board];
    newBoard[index] = mySymbol;

    const winnerInfo = calculateWinner(newBoard);
    const nextTurn = roomData.players.find(id => id !== user.uid) || user.uid;

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    await updateDoc(roomRef, {
      board: newBoard,
      turn: winnerInfo ? null : nextTurn,
      winner: winnerInfo ? winnerInfo.winner : (newBoard.every(cell => cell) ? 'Draw' : null),
      winningLine: winnerInfo ? winnerInfo.line : null
    });
  };

  const resetGame = async () => {
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    await updateDoc(roomRef, {
      board: Array(9).fill(null),
      turn: roomData.players[0], // Player 1 starts
      winner: null,
      winningLine: null
    });
  };

  const calculateWinner = (squares) => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
      [0, 4, 8], [2, 4, 6]             // diagonals
    ];
    for (let i = 0; i < lines.length; i++) {
      const [a, b, c] = lines[i];
      if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
        return { winner: squares[a], line: lines[i] };
      }
    }
    return null;
  };

  // Status message
  let statusMsg = "";
  let statusColor = "text-slate-300";
  if (roomData.winner) {
    if (roomData.winner === 'Draw') {
      statusMsg = "Oyun Berabere!";
      statusColor = "text-yellow-400";
    } else if (roomData.winner === mySymbol) {
      statusMsg = "Kazandın! 🎉";
      statusColor = "text-green-400";
    } else {
      statusMsg = "Kaybettin! 😢";
      statusColor = "text-red-400";
    }
  } else {
    statusMsg = isMyTurn ? "Senin Sıran!" : "Rakibin Sırası...";
    statusColor = isMyTurn ? "text-indigo-400" : "text-slate-400";
  }

  return (
    <div className="flex flex-col items-center w-full max-w-md">
      <div className="flex justify-between w-full mb-6 bg-slate-900 p-4 rounded-xl border border-slate-700">
        <div className={`text-center ${isPlayer1 ? 'text-indigo-400 font-bold' : 'text-slate-500'}`}>
          <div className="text-2xl mb-1">X</div>
          <div className="text-xs">Oyuncu 1 {isPlayer1 ? '(Sen)' : ''}</div>
        </div>
        <div className={`text-center font-bold text-xl flex items-center ${statusColor}`}>
          {statusMsg}
        </div>
        <div className={`text-center ${!isPlayer1 ? 'text-purple-400 font-bold' : 'text-slate-500'}`}>
          <div className="text-2xl mb-1">O</div>
          <div className="text-xs">Oyuncu 2 {!isPlayer1 ? '(Sen)' : ''}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 w-full aspect-square mb-8 p-3 bg-slate-700 rounded-xl">
        {roomData.board.map((cell, index) => {
          const isWinningCell = roomData.winningLine?.includes(index);
          return (
            <button
              key={index}
              onClick={() => handleMove(index)}
              disabled={!isMyTurn || cell !== null || roomData.winner !== null}
              className={`
                flex items-center justify-center text-5xl font-bold rounded-lg transition-all
                ${cell === null && isMyTurn && !roomData.winner ? 'hover:bg-slate-600 bg-slate-800 cursor-pointer' : 'bg-slate-800'}
                ${cell === null && (!isMyTurn || roomData.winner) ? 'cursor-default' : ''}
                ${isWinningCell ? 'bg-indigo-500/30 border-2 border-indigo-400' : 'border border-slate-700'}
                ${cell === 'X' ? 'text-indigo-400' : 'text-purple-400'}
              `}
            >
              {cell}
            </button>
          )
        })}
      </div>

      {roomData.winner && (
        <button 
          onClick={resetGame}
          className="bg-indigo-500 hover:bg-indigo-600 px-8 py-3 rounded-xl font-bold text-lg shadow-lg transition-colors"
        >
          Yeniden Oyna
        </button>
      )}
    </div>
  );
}