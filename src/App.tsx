// @ts-nocheck
import React, { useState, useEffect } from 'react';
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
  
  // Seyirci Modu Sorusu İçin State
  const [spectatePrompt, setSpectatePrompt] = useState(null);

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
    if (!user || !roomCode) return;

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        
        if (data.status === 'closed') {
          setErrorMsg("Oda kapatıldı.");
          leaveRoomLocal();
        } 
        else if (data.status === 'abandoned') {
          setRoomData(data);
          // Eğer seyirci değilsek ve sayaç henüz başlamadıysa başlat
          if (data.players.includes(user.uid) && disconnectCountdown === null) {
            setDisconnectCountdown(10); 
          } else if (!data.players.includes(user.uid)) {
            // Seyirci ise direkt lobiye at
            setErrorMsg("Oyuncular oyundan ayrıldı. Oda kapandı.");
            leaveRoomLocal();
          }
        } 
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

  // Mobil cihazlar (pagehide) ve Masaüstü (beforeunload) kopma yakalayıcı
  useEffect(() => {
    const handleUnload = () => {
      if (roomCode && user && roomData && roomData.status === 'playing') {
        // Seyirciler çıkınca odayı abandoned yapmamalıyız, sadece oyuncular yapabilir
        if (roomData.players.includes(user.uid)) {
          const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
          updateDoc(roomRef, { status: 'abandoned' }).catch(() => {});
        }
      }
    };
    
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload); // Mobilde sekmeyi alta alınca/kapatınca daha iyi çalışır
    
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, [roomCode, user, roomData]);

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
      turn: null, // İkinci oyuncu gelince rastgele seçilecek
      startingPlayer: null,
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

      // Eğer oda doluysa (2 kişi varsa) ve biz içerde değilsek
      if (data.players.length >= 2 && !data.players.includes(user.uid)) {
        // Zaten seyirciysek odaya direkt gir
        if (data.spectators && data.spectators.includes(user.uid)) {
           setRoomCode(cleanCode);
           setJoinCodeInput('');
           return;
        }
        // Değilsek seyirci olmak istiyor musun diye sor
        setSpectatePrompt(cleanCode);
        return;
      }

      // İkinci oyuncu olarak katılıyorsak (veya ilk defa giriyoruz)
      if (!data.players.includes(user.uid)) {
        const updatedPlayers = [...data.players, user.uid];
        // RASTGELE BAŞLANGIÇ SEÇİMİ
        const startingPlayer = updatedPlayers[Math.random() < 0.5 ? 0 : 1];
        
        await updateDoc(roomRef, {
          players: updatedPlayers,
          playerNames: { ...data.playerNames, [user.uid]: nickname || 'Oyuncu 2' },
          scores: { ...data.scores, [user.uid]: 0 },
          status: updatedPlayers.length === 2 ? 'playing' : 'waiting',
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

  // Seyirci olarak katılmayı onaylama
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

    // Sadece asıl oyunculardan biri çıkarsa odayı kapat (Seyirci çıkarsa oda kapanmasın)
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
      
      {/* Bağlantı Kopma Ekranı */}
      {disconnectCountdown !== null && (
        <div className="absolute inset-0 z-50 bg-slate-900/90 flex flex-col items-center justify-center backdrop-blur-sm p-4">
          <AlertCircle className="w-16 h-16 text-yellow-500 mb-4 animate-pulse" />
          <h2 className="text-2xl font-bold text-center mb-2">Rakibin Bağlantısı Koptu!</h2>
          <p className="text-slate-300 text-center mb-8 max-w-md">
            Rakibinizin interneti kesilmiş veya sekmeyi kapatmış olabilir. Geri dönmesi için bekliyoruz...
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
        <div className="absolute inset-0 z-50 bg-slate-900/90 flex flex-col items-center justify-center backdrop-blur-sm p-4">
          <Eye className="w-16 h-16 text-indigo-500 mb-4" />
          <h2 className="text-2xl font-bold text-center mb-2">Bu Oda Dolu</h2>
          <p className="text-slate-300 text-center mb-8 max-w-md">
            Odaya zaten iki oyuncu bağlanmış durumda. Devam eden maçı seyirci olarak izlemek ister misiniz?
          </p>
          <div className="flex gap-4">
            <button 
              onClick={acceptSpectate}
              className="bg-indigo-600 hover:bg-indigo-500 px-6 py-3 rounded-lg font-bold transition-colors shadow-lg shadow-indigo-500/20"
            >
              Seyirci Olarak İzle
            </button>
            <button 
              onClick={() => setSpectatePrompt(null)}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-600 px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Vazgeç
            </button>
          </div>
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
        <div className="max-w-4xl mx-auto mb-4 bg-red-500/20 border border-red-500 text-red-200 p-3 rounded-lg flex items-center gap-2 shadow-lg">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="ml-auto text-sm underline shrink-0">Kapat</button>
        </div>
      )}

      {currentView === 'lobby' ? (
        <main className="max-w-4xl mx-auto">
          
          {/* İsim Belirleme */}
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
                className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 uppercase tracking-widest text-center w-full md:w-40 focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
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
                  Arkadaşına oda kodunu gönder. O da "Davet Kodun Var Mı?" bölümüne bu kodu yazarak masaya katılabilir.
                </p>
                <div className="text-3xl font-mono bg-slate-900 px-6 py-3 rounded-lg border border-slate-600 inline-block shadow-inner">
                  {roomCode}
                </div>
              </div>
            ) : (
              <div className="w-full flex flex-col items-center">
                 <h2 className="text-2xl font-bold mb-6 text-slate-200">
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
  const isPlayer2 = roomData.players[1] === user.uid;
  const isSpectator = !isPlayer1 && !isPlayer2; // Üçüncü kişiler seyirci
  
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
    // Sırayı diğer oyuncuya geçir (Dönüşümlü Sıra Sistemi)
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
    <div className="flex flex-col items-center w-full max-w-md">
      
      {/* İSİM ve SKOR TABLOSU (Mobil Uyumlu Yukarıdan Aşağı Düzen) */}
      <div className="flex flex-col w-full mb-6 bg-slate-900 p-4 rounded-xl border border-slate-700 shadow-md">
        
        {isSpectator && (
          <div className="text-center text-xs text-yellow-400 font-bold mb-3 tracking-widest uppercase flex items-center justify-center gap-1">
            <Eye className="w-4 h-4" /> SEYİRCİ MODU
          </div>
        )}

        {/* Oyun Durumu (Kazanma, Kaybetme, Sıra Kimde) */}
        <div className={`text-center font-bold text-xl md:text-2xl mb-4 ${statusColor}`}>
          {statusMsg}
        </div>
        
        <div className="flex justify-between items-center w-full px-2">
          {/* Oyuncu 1 Kısım */}
          <div className="text-center flex flex-col items-center text-indigo-400 w-1/3">
            <div className="flex items-center gap-1 mb-1">
              {p1Score > p2Score && <Crown className="w-4 h-4 text-yellow-400" />}
              <span className="text-2xl font-bold">X</span>
            </div>
            <div className="text-xs truncate w-full" title={p1Name}>{p1Name} {isPlayer1 ? '(Sen)' : ''}</div>
            <div className="text-xl font-mono font-bold text-white mt-1">{p1Score}</div>
          </div>

          <div className="text-slate-600 font-bold text-xl md:text-2xl w-1/3 text-center">
            VS
          </div>

          {/* Oyuncu 2 Kısım */}
          <div className="text-center flex flex-col items-center text-purple-400 w-1/3">
            <div className="flex items-center gap-1 mb-1">
              {p2Score > p1Score && <Crown className="w-4 h-4 text-yellow-400" />}
              <span className="text-2xl font-bold">O</span>
            </div>
            <div className="text-xs truncate w-full" title={p2Name}>{p2Name} {isPlayer2 ? '(Sen)' : ''}</div>
            <div className="text-xl font-mono font-bold text-white mt-1">{p2Score}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 md:gap-3 w-full aspect-square mb-8 p-3 bg-slate-700 rounded-xl shadow-inner">
        {roomData.board.map((cell, index) => {
          const isWinningCell = roomData.winningLine?.includes(index);
          return (
            <div key={index} className="w-full h-full aspect-square">
              <button
                onClick={() => handleMove(index)}
                disabled={!isMyTurn || isSpectator || cell !== null || roomData.winner !== null}
                className={`
                  w-full h-full flex items-center justify-center text-5xl md:text-7xl font-bold rounded-lg transition-all overflow-hidden
                  ${cell === null && isMyTurn && !isSpectator && !roomData.winner ? 'hover:bg-slate-600 bg-slate-800 cursor-pointer' : 'bg-slate-800'}
                  ${(cell !== null || !isMyTurn || isSpectator || roomData.winner) ? 'cursor-default' : ''}
                  ${isWinningCell ? 'bg-indigo-500/40 border-2 border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.5)]' : 'border border-slate-600 shadow-sm'}
                  ${cell === 'X' ? 'text-indigo-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]' : 'text-purple-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]'}
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
        <div className="w-full flex flex-col items-center bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-md">
          {isSpectator ? (
            <div className="text-slate-400 text-sm py-2 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Oyuncuların rövanş kararı bekleniyor...
            </div>
          ) : !roomData.rematchRequestedBy ? (
            <button 
              onClick={requestRematch}
              className="bg-indigo-600 hover:bg-indigo-500 w-full py-3 rounded-xl font-bold text-lg shadow-lg shadow-indigo-500/20 transition-all hover:scale-[1.02]"
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
              <span className="text-slate-300 font-medium mb-3 text-center">Rakibiniz rövanş istiyor!</span>
              <div className="flex gap-4 w-full">
                <button 
                  onClick={acceptRematch}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/50 py-3 rounded-lg font-bold transition-colors"
                >
                  <Check className="w-5 h-5" /> Kabul Et
                </button>
                <button 
                  onClick={rejectRematch}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/50 py-3 rounded-lg font-bold transition-colors"
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