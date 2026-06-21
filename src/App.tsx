// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { Copy, Users, Gamepad2, AlertCircle, Loader2, ArrowLeft, Check, X, Crown } from 'lucide-react';
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
  
  // Yeni eklenen stateler: İsim ve Kopyalama bildirimi
  const [nickname, setNickname] = useState(localStorage.getItem('nickname') || '');
  const [copySuccess, setCopySuccess] = useState(false);

  const [currentView, setCurrentView] = useState('lobby'); 
  const [roomCode, setRoomCode] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [disconnectCountdown, setDisconnectCountdown] = useState(null);

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

  // 2. Sadece arayüzü lobiye döndüren fonksiyon
  const leaveRoomLocal = () => {
    setRoomCode('');
    setRoomData(null);
    setCurrentView('lobby');
    setDisconnectCountdown(null);
  };

  // 3. Room Listener & Disconnect Logic
  useEffect(() => {
    if (!user || !roomCode) return;

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        
        // Bilerek çıkıldıysa
        if (data.status === 'closed') {
          setErrorMsg("Rakibiniz oyundan ayrıldı. Oda kapatıldı.");
          leaveRoomLocal();
        } 
        // İnternet koptuysa veya sekme kapatıldıysa
        else if (data.status === 'abandoned') {
          setRoomData(data);
          if (disconnectCountdown === null) {
            setDisconnectCountdown(10); // 10 saniyelik sayacı başlat
          }
        } 
        // Normal oyun durumu
        else {
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
  }, [user, roomCode, disconnectCountdown]);

  // 4. 10 Saniyelik Geri Sayım Efekti
  useEffect(() => {
    if (disconnectCountdown === null) return;
    
    if (disconnectCountdown === 0) {
      setErrorMsg("Rakip geri dönmedi. Lobiye aktarıldınız.");
      leaveRoomLocal();
      return;
    }

    const timer = setTimeout(() => {
      setDisconnectCountdown(prev => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [disconnectCountdown]);

  // 5. Sekme Kapatma Yakalayıcı (Abandoned)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (roomCode && user) {
        const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
        // Sekme kapanırken status'ü abandoned yap ki karşı tarafta 10sn saysın
        updateDoc(roomRef, { status: 'abandoned' }).catch(() => {});
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [roomCode, user]);

  // Create Room
  const createRoom = async (gameId) => {
    if (!user) return;
    const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', newCode);
    
    const initialState = {
      gameId: gameId,
      host: user.uid,
      players: [user.uid],
      playerNames: { [user.uid]: nickname || 'Oyuncu 1' }, // İsim kaydı
      scores: { [user.uid]: 0 }, // Skor kaydı
      status: 'waiting', 
      board: Array(9).fill(null),
      turn: user.uid,
      winner: null,
      rematchRequestedBy: null,
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

      if (data.status === 'closed' || data.status === 'abandoned') {
        setErrorMsg("Bu oda kapalı veya terk edilmiş.");
        return;
      }

      if (data.players.length >= 2 && !data.players.includes(user.uid)) {
        setErrorMsg("Oda şu an dolu.");
        return;
      }

      if (!data.players.includes(user.uid)) {
        const updatedPlayers = [...data.players, user.uid];
        await updateDoc(roomRef, {
          players: updatedPlayers,
          playerNames: { ...data.playerNames, [user.uid]: nickname || 'Oyuncu 2' },
          scores: { ...data.scores, [user.uid]: 0 },
          status: updatedPlayers.length === 2 ? 'playing' : 'waiting'
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

  // Leave Room (Bilerek çıkış)
  const leaveRoom = async () => {
    const currentCode = roomCode;
    leaveRoomLocal(); // Önce hemen kendi ekranını lobiye at

    // Arkada odayı "closed" yap ki karşı taraf anında atılsın
    if (currentCode && user) {
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
      setTimeout(() => setCopySuccess(false), 2000); // 2 saniye sonra yazıyı sil
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
      
      {/* Bağlantı Kopma (Abandoned) Ekranı */}
      {disconnectCountdown !== null && (
        <div className="absolute inset-0 z-50 bg-slate-900/90 flex flex-col items-center justify-center backdrop-blur-sm p-4">
          <AlertCircle className="w-16 h-16 text-yellow-500 mb-4 animate-pulse" />
          <h2 className="text-2xl font-bold text-center mb-2">Rakibin Bağlantısı Koptu!</h2>
          <p className="text-slate-300 text-center mb-8 max-w-md">
            Rakibinizin interneti kesilmiş veya tarayıcıyı kapatmış olabilir. Geri dönmesi için bekliyoruz...
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

      {/* Header */}
      <header className="max-w-4xl mx-auto flex items-center justify-between mb-8 pb-4 border-b border-slate-700">
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

      {errorMsg && (
        <div className="max-w-4xl mx-auto mb-4 bg-red-500/20 border border-red-500 text-red-200 p-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="ml-auto text-sm underline shrink-0">Kapat</button>
        </div>
      )}

      {currentView === 'lobby' ? (
        <main className="max-w-4xl mx-auto">
          
          {/* İsim Belirleme Alanı */}
          <div className="bg-slate-800 p-6 rounded-xl mb-6 shadow-lg border border-slate-700 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold mb-1">Oyuncu İsmin</h2>
              <p className="text-sm text-slate-400">Oyunlarda bu isimle görüneceksin.</p>
            </div>
            <input 
              type="text" 
              placeholder="İsmini yaz..." 
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value);
                localStorage.setItem('nickname', e.target.value);
              }}
              className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-center w-full md:w-64 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              maxLength={15}
            />
          </div>

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
        <main className="max-w-4xl mx-auto flex flex-col items-center">
          <div className="w-full flex items-center justify-between mb-8">
            <button onClick={leaveRoom} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" /> Lobiden Çık
            </button>
            <div className="flex items-center gap-4 bg-slate-800 px-4 py-2 rounded-full border border-slate-700">
              <span className="text-sm text-slate-400">Oda Kodu:</span>
              <span className="font-mono font-bold tracking-wider text-indigo-300 text-lg">{roomCode}</span>
              <button onClick={copyToClipboard} className="text-slate-400 hover:text-white relative" title="Kodu Kopyala">
                {copySuccess ? <Check className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5" />}
                {copySuccess && <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-700 text-white text-xs px-2 py-1 rounded shadow-lg">Kopyalandı!</span>}
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
  const mySymbol = isPlayer1 ? 'X' : 'O';
  const isMyTurn = roomData.turn === user.uid;

  // İsim ve Skor Verileri
  const p1Uid = roomData.players[0];
  const p2Uid = roomData.players[1];
  
  const p1Name = roomData.playerNames?.[p1Uid] || 'Oyuncu 1';
  const p2Name = roomData.playerNames?.[p2Uid] || 'Oyuncu 2';

  const p1Score = roomData.scores?.[p1Uid] || 0;
  const p2Score = roomData.scores?.[p2Uid] || 0;

  const handleMove = async (index) => {
    if (!isMyTurn || roomData.board[index] || roomData.winner) return;

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

    // Eğer kazanan varsa, skoru artır
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

  // Rövanş İsteği Gönder
  const requestRematch = async () => {
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    await updateDoc(roomRef, { rematchRequestedBy: user.uid });
  };

  // Rövanşı Kabul Et (Tahtayı Sıfırla ama SKORU KORU)
  const acceptRematch = async () => {
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    await updateDoc(roomRef, {
      board: Array(9).fill(null),
      turn: roomData.players[0], 
      winner: null,
      winningLine: null,
      rematchRequestedBy: null 
    });
  };

  // Rövanşı Reddet (Odayı Kapat)
  const rejectRematch = async () => {
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
      
      {/* İSİM, SKOR ve TAÇ TABLOSU */}
      <div className="flex justify-between w-full mb-6 bg-slate-900 p-4 rounded-xl border border-slate-700">
        <div className={`text-center flex flex-col items-center ${isPlayer1 ? 'text-indigo-400 font-bold' : 'text-slate-500'}`}>
          <div className="flex items-center gap-1 mb-1">
            {p1Score > p2Score && <Crown className="w-4 h-4 text-yellow-400" />}
            <span className="text-2xl">X</span>
          </div>
          <div className="text-xs max-w-[80px] truncate">{p1Name} {isPlayer1 ? '(Sen)' : ''}</div>
          <div className="text-xl font-mono font-bold text-white mt-1">{p1Score}</div>
        </div>

        <div className={`text-center font-bold text-xl flex items-center px-4 ${statusColor}`}>
          {statusMsg}
        </div>

        <div className={`text-center flex flex-col items-center ${!isPlayer1 ? 'text-purple-400 font-bold' : 'text-slate-500'}`}>
          <div className="flex items-center gap-1 mb-1">
            {p2Score > p1Score && <Crown className="w-4 h-4 text-yellow-400" />}
            <span className="text-2xl">O</span>
          </div>
          <div className="text-xs max-w-[80px] truncate">{p2Name} {!isPlayer1 ? '(Sen)' : ''}</div>
          <div className="text-xl font-mono font-bold text-white mt-1">{p2Score}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 w-full aspect-square mb-8 p-3 bg-slate-700 rounded-xl">
        {roomData.board.map((cell, index) => {
          const isWinningCell = roomData.winningLine?.includes(index);
          return (
            <div key={index} className="w-full h-full aspect-square">
              <button
                onClick={() => handleMove(index)}
                disabled={!isMyTurn || cell !== null || roomData.winner !== null}
                // Kutunun büyüyüp küçülmemesi için "overflow-hidden" eklendi
                className={`
                  w-full h-full flex items-center justify-center text-6xl md:text-7xl font-bold rounded-lg transition-all overflow-hidden
                  ${cell === null && isMyTurn && !roomData.winner ? 'hover:bg-slate-600 bg-slate-800 cursor-pointer' : 'bg-slate-800'}
                  ${cell === null && (!isMyTurn || roomData.winner) ? 'cursor-default' : ''}
                  ${isWinningCell ? 'bg-indigo-500/30 border-2 border-indigo-400' : 'border border-slate-700'}
                  ${cell === 'X' ? 'text-indigo-400' : 'text-purple-400'}
                `}
              >
                {cell}
              </button>
            </div>
          )
        })}
      </div>

      {/* RÖVANŞ SİSTEMİ EKRANI */}
      {roomData.winner && (
        <div className="w-full flex flex-col items-center bg-slate-800 p-4 rounded-xl border border-slate-700">
          {!roomData.rematchRequestedBy ? (
            <button 
              onClick={requestRematch}
              className="bg-indigo-500 hover:bg-indigo-600 w-full py-3 rounded-xl font-bold text-lg shadow-lg transition-colors"
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
              <span className="text-slate-300 font-medium mb-3">Rakibiniz rövanş istiyor!</span>
              <div className="flex gap-4 w-full">
                <button 
                  onClick={acceptRematch}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/50 py-2 rounded-lg font-bold transition-colors"
                >
                  <Check className="w-5 h-5" /> Kabul Et
                </button>
                <button 
                  onClick={rejectRematch}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/50 py-2 rounded-lg font-bold transition-colors"
                >
                  <X className="w-5 h-5" /> Reddet
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}