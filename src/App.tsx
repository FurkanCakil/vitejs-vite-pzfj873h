// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { Gamepad2, AlertCircle, Loader2, X, WifiOff, Minimize } from 'lucide-react';
import { signInAnonymously, onAuthStateChanged, signInWithCustomToken, setPersistence, inMemoryPersistence } from 'firebase/auth';
import { doc, onSnapshot, getDoc, updateDoc, runTransaction } from 'firebase/firestore';

// --- BİZİM OLUŞTURDUĞUMUZ MODÜLLERİ İÇE AKTARIYORUZ ---
import { auth, db, appId } from './firebase/config.js';
import { generateRoomCode } from './utils/roomCode.js';
import useOnlineStatus from './hooks/useOnlineStatus.js';

import useViewport from './hooks/useViewport.js';

import ErrorBoundary from './components/ErrorBoundary.jsx';
import Lobby from './components/Lobby.jsx';
import RoomHeader from './components/RoomHeader.jsx';
import DisconnectOverlay from './components/overlays/DisconnectOverlay.jsx';
import LeftOverlay from './components/overlays/LeftOverlay.jsx';
import SpectatePrompt from './components/overlays/SpectatePrompt.jsx';

import TicTacToeGame from './games/xox/TicTacToeGame.jsx';
import TavlaGame from './games/backgammon/TavlaGame.jsx';
import ChessGame from './games/chess/ChessGame.jsx';
import CheckersGame from './games/checkers/CheckersGame.jsx';
import Okey101Game from './games/okey101/Okey101Game.jsx';
import Connect4Game from './games/connect4/Connect4Game.jsx';

import { createInitialBoard } from './games/backgammon/logic.js';
import { createInitialChessBoard, getBoardStateString } from './games/chess/logic.js';
import { createInitialCheckersBoard } from './games/checkers/logic.js';
import { createInitialConnect4Board } from './games/connect4/logic.js';
import { BOT_UID, DIFFICULTY_LABELS } from './games/xox/bot.js';
import { BOT_UID as CHECKERS_BOT_UID, DIFFICULTY_LABELS as CHECKERS_DIFFICULTY_LABELS } from './games/checkers/bot.js';
import { BOT_UID as CHESS_BOT_UID, DIFFICULTY_LABELS as CHESS_DIFFICULTY_LABELS } from './games/chess/bot.js';
import { BOT_UID as BACKGAMMON_BOT_UID, DIFFICULTY_LABELS as BACKGAMMON_DIFFICULTY_LABELS } from './games/backgammon/bot.js';
import { isBotUid as isOkeyBotUid } from './games/okey101/botPlayers.js';
import { BOT_UID as CONNECT4_BOT_UID, DIFFICULTY_LABELS as CONNECT4_DIFFICULTY_LABELS } from './games/connect4/bot.js';

// Bazı telefon tarayıcılarında (çerez/site verisi tamamen engelliyken ya da
// depolama kotası dolduğunda) localStorage'a ERİŞMEK BİLE istisna fırlatır.
// Korumasız bir `localStorage.getItem` çağrısı tüm uygulamayı boş ekrana
// düşürdüğü için tüm erişimler bu güvenli sarmalayıcıdan geçirilir.
const safeStorage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* yok say */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* yok say */ } },
};

export default function App() {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const isOnline = useOnlineStatus(); // Custom Hook'umuzu kullanıyoruz
  const { isCompact } = useViewport();
  const [nickname, setNickname] = useState(safeStorage.get('nickname') || '');
  const [copySuccess, setCopySuccess] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  const [currentView, setCurrentView] = useState('lobby'); 
  const [roomCode, setRoomCode] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  
  const [disconnectCountdown, setDisconnectCountdown] = useState(null);
  const [spectatePrompt, setSpectatePrompt] = useState(null);
  const [leftOverlayTimer, setLeftOverlayTimer] = useState(null);

  const [isBotGame, setIsBotGame] = useState(false);
  const [botDifficulty, setBotDifficulty] = useState('medium');

  const authInitiatedRef = useRef(false);
  // localStorage'dan geri yüklenen (yani kullanıcının bu oturumda bilerek
  // girmediği) oda kodu. Bkz. aşağıdaki onSnapshot içindeki "bayat oda" koruması.
  const restoredRoomRef = useRef(null);
  const roomStateRef = useRef({ roomCode, user, roomData, currentView, disconnectCountdown, isBotGame });
  roomStateRef.current = { roomCode, user, roomData, currentView, disconnectCountdown, isBotGame };

  // Yakalanmamış hataları sessizce yutmak yerine ekranda göster. Telefonda
  // (özellikle normal sekmede) çıkan hataların ne olduğunu görebilmek için
  // gerekli; aksi halde kullanıcı sadece boş/bozuk bir ekran görüyor.
  useEffect(() => {
    const describe = (value) => {
      if (!value) return '';
      if (typeof value === 'string') return value;
      return value.message || value.toString?.() || '';
    };
    const onError = (e) => {
      const msg = describe(e?.error) || describe(e?.message);
      if (msg) setErrorMsg(`Beklenmeyen hata: ${msg}`);
    };
    const onRejection = (e) => {
      const msg = describe(e?.reason);
      if (msg) setErrorMsg(`Beklenmeyen hata: ${msg}`);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => { setIsFullscreen(!!document.fullscreenElement); };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
        } else {
            setErrorMsg("Tam ekran modu bu tarayıcıda (iOS/Safari) desteklenmiyor.");
        }
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
      }
    } catch (e) { console.error("Fullscreen error:", e); }
  };

  useEffect(() => {
    // StrictMode bu effect'i (dev modunda) mount->cleanup->mount şeklinde iki kez çalıştırır.
    // Ref senkron ve aynı component instance'ında kalıcı olduğu için, ikinci çalıştırmada
    // signInAnonymously'nin TEKRAR çağrılıp farklı bir anonim hesap açmasını (ve dolayısıyla
    // sonradan "host"/"players" gibi Firestore alanlarına yazılan uid ile gerçek user.uid'nin
    // birbirini tutmamasını) engelliyoruz.
    const signIn = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) await signInWithCustomToken(auth, __initial_auth_token);
      else await signInAnonymously(auth);
    };
    const initAuth = async () => {
      if (authInitiatedRef.current) return;
      authInitiatedRef.current = true;
      try { await signIn(); }
      catch (err) {
        // Telefon tarayıcılarında (özellikle NORMAL sekmede; gizli sekmede zaten
        // bellek-içi depolama kullanıldığı için görülmez) Firebase Auth'un kalıcı
        // depolaması (IndexedDB/localStorage) yer baskısı ya da bozuk bir kayıt
        // yüzünden açılamayabilir ve giriş komple başarısız olur. Bu durumda
        // bellek-içi kalıcılığa düşüp tekrar deniyoruz: oturum sekme kapanınca
        // kaybolur ama oyun çalışır.
        console.error('Kalıcı oturum açılamadı, bellek-içi moda geçiliyor:', err);
        try {
          await setPersistence(auth, inMemoryPersistence);
          await signIn();
        } catch (fallbackErr) {
          authInitiatedRef.current = false;
          setErrorMsg(`Bağlantı hatası oluştu: ${fallbackErr?.message || fallbackErr}`);
          setLoadingAuth(false);
        }
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoadingAuth(false);
      let savedCode = null;
      savedCode = safeStorage.get('activeRoom');
      if (savedCode && currentUser) { restoredRoomRef.current = savedCode; setRoomCode(savedCode); }

      // Firestore BAĞLANTISINI ERKENDEN ISITIR: SDK'nın gerçek ağ kanalını
      // (WebChannel/gRPC el sıkışması) kurması, o oturumdaki İLK okuma/yazma
      // isteğinde ekstra bir gecikme olarak hissediliyordu — özellikle
      // "Özel Oda Kur" butonuna basıldığında (o an henüz hiçbir Firestore
      // isteği yapılmamışsa) oda oluşturma transaction'ı bu soğuk başlangıç
      // gecikmesini üstleniyordu. Kullanıcı lobide oyun seçerken (birkaç
      // saniye insan etkileşim süresi) bu ucuz, sonucu önemsenmeyen okuma
      // arka planda bağlantıyı ısıtır; buton basıldığında kanal çoktan
      // hazırdır.
      if (currentUser) {
        getDoc(doc(db, 'artifacts', appId, 'public', 'data', '__warmup__')).catch(() => { /* sonuç önemsiz, sadece bağlantıyı ısıtır */ });
      }
    });
    return () => unsubscribe();
  }, []);


  const leaveRoomLocal = () => {
    setRoomCode(''); setRoomData(null); setCurrentView('lobby');
    setDisconnectCountdown(null); setSpectatePrompt(null); safeStorage.remove('activeRoom');
    setIsBotGame(false);
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(()=>{});
  };

  useEffect(() => {
    if (leftOverlayTimer === null) return;
    if (leftOverlayTimer <= 0) { setLeftOverlayTimer(null); return; }
    const timer = setTimeout(() => setLeftOverlayTimer(prev => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [leftOverlayTimer]);

  useEffect(() => {
    if (!user || !roomCode || isBotGame) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.status === 'closed') {
          if (roomStateRef.current.currentView === 'room' && data.players?.includes(user.uid)) { if (data.closedBy !== user.uid) setLeftOverlayTimer(5); } 
          else { setErrorMsg("Oda kapatıldı."); }
          leaveRoomLocal();
        } 
        else if (data.status === 'abandoned') {
          setRoomData(data); setCurrentView('room'); 
          if (data.players?.includes(user.uid)) {
            if (data.abandonedBy === user.uid) {
               if (data.abandonReason !== 'left') { updateDoc(roomRef, { status: 'playing', abandonedBy: null, abandonReason: null }).catch(()=>{}); }
            } else { 
               setDisconnectCountdown(prev => prev === null ? (data.abandonReason === 'left' ? 5 : 15) : prev); 
            }
          } 
        } 
        else {
          // BAYAT ODA KORUMASI: localStorage'da kalmış eski bir oda kodu yüzünden
          // (gizli sekmede localStorage boş olduğu için bu hiç yaşanmaz) oyuncu,
          // artık üyesi olmadığı yabancı bir masaya otomatik sokuluyordu. Geri
          // yüklenen bir odaya ancak gerçekten oyuncusu/seyircisiysek gireriz.
          const isParticipant = data.players?.includes(user.uid) || data.spectators?.includes(user.uid);
          if (restoredRoomRef.current === roomCode && !isParticipant) {
            restoredRoomRef.current = null;
            leaveRoomLocal();
            return;
          }
          restoredRoomRef.current = null;
          if (data.status === 'waiting' && data.gameId !== 'okey101' && data.players?.length === 2 && data.host === user.uid) { updateDoc(roomRef, { status: 'playing' }).catch(()=>{}); }
          setRoomData(data); setDisconnectCountdown(null); setCurrentView('room'); safeStorage.set('activeRoom', roomCode);
        }
      } else { leaveRoomLocal(); }
    });
    return () => unsubscribe();
  }, [user, roomCode, isBotGame]);

  useEffect(() => {
    if (disconnectCountdown === null || disconnectCountdown === 'paused') return;
    if (disconnectCountdown === 0) {
      updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode), { status: 'closed' }).catch(()=>{});
      setLeftOverlayTimer(5); leaveRoomLocal(); return;
    }
    const timer = setTimeout(() => { setDisconnectCountdown(prev => typeof prev === 'number' ? prev - 1 : prev); }, 1000);
    return () => clearTimeout(timer);
  }, [disconnectCountdown, roomCode]);

  useEffect(() => {
    const handleDisconnect = () => {
      const { roomCode: code, user: u, roomData: data, isBotGame: isBot } = roomStateRef.current;
      if (isBot) return;
      if (code && u && data && data.status === 'playing' && data.players?.includes(u.uid)) { updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', code), { status: 'abandoned', abandonedBy: u.uid }).catch(() => {}); }
    };
    const handleVisibility = () => {
      const { roomCode: code, user: u, roomData: data, isBotGame: isBot } = roomStateRef.current;
      if (isBot) return;
      if (!code || !u || !data) return;
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', code);
      if (document.visibilityState === 'hidden') { 
         if (data.status === 'playing' && data.players?.includes(u.uid)) { updateDoc(roomRef, { status: 'abandoned', abandonedBy: u.uid }).catch(() => {}); } 
      } 
      else if (document.visibilityState === 'visible') { 
         getDoc(roomRef).then(snap => {
            if (snap.exists() && snap.data().status === 'abandoned' && snap.data().abandonedBy === u.uid && snap.data().abandonReason !== 'left') {
                updateDoc(roomRef, { status: 'playing', abandonedBy: null, abandonReason: null }).catch(() => {});
            }
         }).catch(()=>{});
      }
    };
    window.addEventListener('beforeunload', handleDisconnect); window.addEventListener('pagehide', handleDisconnect); window.addEventListener('visibilitychange', handleVisibility); 
    return () => { window.removeEventListener('beforeunload', handleDisconnect); window.removeEventListener('pagehide', handleDisconnect); window.removeEventListener('visibilitychange', handleVisibility); };
  }, []);

  const startBotGame = (gameId, difficulty) => {
    if (!user || (gameId !== 'xox' && gameId !== 'dama' && gameId !== 'satranc' && gameId !== 'tavla' && gameId !== 'connect4')) return;
    let initialState;

    if (gameId === 'tavla') {
      const isWhite = Math.random() > 0.5;
      const playerColors = { [user.uid]: isWhite ? 'white' : 'black', [BACKGAMMON_BOT_UID]: isWhite ? 'black' : 'white' };
      initialState = {
        gameId, host: user.uid, players: [user.uid, BACKGAMMON_BOT_UID], spectators: [],
        playerNames: { [user.uid]: nickname || 'Sen', [BACKGAMMON_BOT_UID]: `Bot (${BACKGAMMON_DIFFICULTY_LABELS[difficulty] || difficulty})` },
        scores: { [user.uid]: 0, [BACKGAMMON_BOT_UID]: 0 }, status: 'playing',
        board: createInitialBoard(), bar: { white: 0, black: 0 }, borneOff: { white: 0, black: 0 }, playerColors,
        dice: [], usedDice: [], phase: 'opening', openingRolls: { p1: null, p2: null },
        turn: null, startingPlayer: null, winner: null, rematchRequestedBy: null,
        cubeValue: 1, cubeOwner: null, cubeOfferBy: null, initialTurnState: null,
        abandonedBy: null, abandonReason: null, createdAt: new Date().toISOString(),
      };
    } else if (gameId === 'dama') {
      const isWhite = Math.random() > 0.5;
      const playerColors = { [user.uid]: isWhite ? 'w' : 'b', [CHECKERS_BOT_UID]: isWhite ? 'b' : 'w' };
      const whiteUid = isWhite ? user.uid : CHECKERS_BOT_UID;
      initialState = {
        gameId, host: user.uid, players: [user.uid, CHECKERS_BOT_UID], spectators: [],
        playerNames: { [user.uid]: nickname || 'Sen', [CHECKERS_BOT_UID]: `Bot (${CHECKERS_DIFFICULTY_LABELS[difficulty] || difficulty})` },
        scores: { [user.uid]: 0, [CHECKERS_BOT_UID]: 0 }, status: 'playing',
        board: createInitialCheckersBoard(), playerColors, multiJumpIdx: null,
        turn: whiteUid, startingPlayer: whiteUid, winner: null, rematchRequestedBy: null,
        abandonedBy: null, abandonReason: null, createdAt: new Date().toISOString(),
      };
    } else if (gameId === 'satranc') {
      const isWhite = Math.random() > 0.5;
      const playerColors = { [user.uid]: isWhite ? 'w' : 'b', [CHESS_BOT_UID]: isWhite ? 'b' : 'w' };
      const whiteUid = isWhite ? user.uid : CHESS_BOT_UID;
      const initBoard = createInitialChessBoard();
      initialState = {
        gameId, host: user.uid, players: [user.uid, CHESS_BOT_UID], spectators: [],
        playerNames: { [user.uid]: nickname || 'Sen', [CHESS_BOT_UID]: `Bot (${CHESS_DIFFICULTY_LABELS[difficulty] || difficulty})` },
        scores: { [user.uid]: 0, [CHESS_BOT_UID]: 0 }, status: 'playing',
        board: initBoard, playerColors, captured: { w: [], b: [] }, halfmoveClock: 0,
        positionHistory: [getBoardStateString(initBoard, null, 'w')], enPassantTarget: null, lastMove: null, previousState: null,
        drawOffer: null, takebackOffer: null, winner: null, drawReason: null, winReason: null,
        turn: whiteUid, startingPlayer: whiteUid, rematchRequestedBy: null,
        abandonedBy: null, abandonReason: null, createdAt: new Date().toISOString(),
      };
    } else if (gameId === 'connect4') {
      initialState = {
        gameId, host: user.uid, players: [user.uid, CONNECT4_BOT_UID], spectators: [],
        playerNames: { [user.uid]: nickname || 'Sen', [CONNECT4_BOT_UID]: `Bot (${CONNECT4_DIFFICULTY_LABELS[difficulty] || difficulty})` },
        scores: { [user.uid]: 0, [CONNECT4_BOT_UID]: 0 }, status: 'playing', board: createInitialConnect4Board(),
        turn: user.uid, startingPlayer: user.uid, winner: null, winningLine: null, lastMove: null, rematchRequestedBy: null,
        abandonedBy: null, abandonReason: null, createdAt: new Date().toISOString(),
      };
    } else {
      initialState = {
        gameId, host: user.uid, players: [user.uid, BOT_UID], spectators: [],
        playerNames: { [user.uid]: nickname || 'Sen', [BOT_UID]: `Bot (${DIFFICULTY_LABELS[difficulty] || difficulty})` },
        scores: { [user.uid]: 0, [BOT_UID]: 0 }, status: 'playing', board: Array(9).fill(null),
        turn: user.uid, startingPlayer: user.uid, winner: null, winningLine: null, rematchRequestedBy: null,
        abandonedBy: null, abandonReason: null, createdAt: new Date().toISOString(),
      };
    }

    // Bot oyunu tamamen YEREL çalışır (Firestore odası yoktur). Tarayıcıda
    // kalmış eski bir oda kodu, bot masası açılırken devreye girip oyunu
    // ezmesin diye burada kesin olarak temizlenir.
    restoredRoomRef.current = null;
    safeStorage.remove('activeRoom');

    setBotDifficulty(difficulty);
    setIsBotGame(true);
    setRoomData(initialState);
    setRoomCode('BOT-LOCAL');
    setCurrentView('room');
    setDisconnectCountdown(null);
  };

  const createRoom = async (gameId) => {
    setIsCreatingRoom(true);
    if (!user) return;
    let newCode = ''; let success = false; let attempts = 0; const MAX_RETRIES = 10;
    
    while (!success && attempts < MAX_RETRIES) {
       attempts++;
       newCode = generateRoomCode();
       const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', newCode);
       
       const initialState = {
         gameId: gameId, host: user.uid, players: [user.uid], spectators: [], playerNames: { [user.uid]: nickname || 'Oyuncu 1' }, 
         scores: { [user.uid]: 0 }, status: 'waiting', board: gameId === 'xox' ? Array(9).fill(null) : (gameId === 'connect4' ? createInitialConnect4Board() : null),
         turn: null, startingPlayer: null, winner: null, drawOffer: null, takebackOffer: null, rematchRequestedBy: null, abandonedBy: null, abandonReason: null, createdAt: new Date().toISOString()
       };
       
       if (gameId === 'tavla') { Object.assign(initialState, { dice: [], usedDice: [], phase: 'opening', openingRolls: { p1: null, p2: null }, bar: {white:0, black:0}, borneOff: {white:0, black:0}, playerColors: {}, cubeValue: 1, cubeOwner: null, cubeOfferBy: null, initialTurnState: null }); }
       else if (gameId === 'satranc') { const initBoard = createInitialChessBoard(); Object.assign(initialState, { board: initBoard, playerColors: {}, captured: { w: [], b: [] }, halfmoveClock: 0, positionHistory: [getBoardStateString(initBoard, null, 'w')], enPassantTarget: null, lastMove: null, previousState: null }); }
       else if (gameId === 'dama') {
        const isWhite = Math.random() > 0.5;
        Object.assign(initialState, {
          board: createInitialCheckersBoard(),
          playerColors: { [user.uid]: isWhite ? 'w' : 'b' },
          turn: null, // İkinci oyuncu katılana kadar kesinlikle boş kalmalı
          startingPlayer: null
        });
      }
      else if (gameId === 'okey101') {
        // NOT: Sadece oda/lobi altyapısı — oyun mantığı (taşlar, per vb.) burada YOK.
        Object.assign(initialState, {
          maxPlayers: 4,
          isBotPlayer: {},
          rules: { gameType: 'ffa', foldingEnabled: false, foldToPartnerEnabled: false, botDifficulty: 'medium' },
          teams: { A: [], B: [] },
          countdownStartedAt: null,
        });
      }

       try {
         await runTransaction(db, async (t) => {
            const snap = await t.get(roomRef);
            if (snap.exists()) throw new Error("exists");
            t.set(roomRef, initialState);
         });
         success = true;
         // Sunucudan onSnapshot ile aynı veriyi tekrar bekletmeden, az önce yazdığımız veriyi
         // hemen yerelde gösteriyoruz; onSnapshot geldiğinde zaten aynı veriyle sessizce senkronlanır.
         setRoomData(initialState); setCurrentView('room');
         setRoomCode(newCode); safeStorage.set('activeRoom', newCode); setDisconnectCountdown(null);
       } catch (err) {
         if (err.message !== "exists") { setErrorMsg("Oda kurulamadı."); break; }
       }
    }
    if (!success) setErrorMsg("Sunucu yoğun, oda açılamadı. Lütfen tekrar dene.");
    setIsCreatingRoom(false);
  };

  const joinRoom = async (code) => {
    if (!user || !code) return;
    const cleanCode = code.trim().toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', cleanCode);
    let optimisticData = null;

    try {
      await runTransaction(db, async (transaction) => {
        const roomSnap = await transaction.get(roomRef);
        if (!roomSnap.exists()) throw new Error("not-found");
        
        const data = roomSnap.data();
        if (data.status === 'closed') throw new Error("closed");

        const maxPlayers = data.maxPlayers || 2;
        if (data.players?.length >= maxPlayers && !data.players.includes(user.uid)) {
          if (data.spectators && data.spectators.includes(user.uid)) {
             throw new Error("already-spectator");
          }
          throw new Error("full");
        }

        if (!data.players?.includes(user.uid)) {
          const missingUid = data.scores ? Object.keys(data.scores).find(uid => !data.players.includes(uid)) : null;
          const isResume = !!missingUid;
          const updatedPlayers = [...(data.players || []), user.uid];
          let updatePayload = { players: updatedPlayers, status: data.gameId === 'okey101' ? 'waiting' : 'playing', abandonedBy: null, abandonReason: null };

          if (!isResume) {
            updatePayload.playerNames = { ...data.playerNames, [user.uid]: nickname || 'Oyuncu 2' }; 
            updatePayload.scores = { ...data.scores, [user.uid]: 0 }; 
            
            if (data.gameId === 'tavla') {
              const isHostWhite = Math.random() < 0.5; const hostColor = isHostWhite ? 'white' : 'black';
              updatePayload.playerColors = { [data.players[0]]: hostColor, [user.uid]: isHostWhite ? 'black' : 'white' };
              updatePayload.board = createInitialBoard(); updatePayload.bar = { white: 0, black: 0 }; updatePayload.borneOff = { white: 0, black: 0 }; 
              updatePayload.phase = 'opening'; updatePayload.openingRolls = { p1: null, p2: null }; updatePayload.turn = null; updatePayload.cubeValue = 1; updatePayload.cubeOwner = null; updatePayload.cubeOfferBy = null; updatePayload.initialTurnState = null;
            } else if (data.gameId === 'satranc') {
              const isHostWhite = Math.random() < 0.5; const hostColor = isHostWhite ? 'w' : 'b'; const whitePlayerUid = isHostWhite ? data.players[0] : user.uid;
              const initBoard = createInitialChessBoard();
              updatePayload.playerColors = { [data.players[0]]: hostColor, [user.uid]: isHostWhite ? 'b' : 'w' }; updatePayload.board = initBoard; updatePayload.captured = { w: [], b: [] }; 
              updatePayload.halfmoveClock = 0; updatePayload.positionHistory = [getBoardStateString(initBoard, null, 'w')]; updatePayload.enPassantTarget = null; updatePayload.lastMove = null; updatePayload.turn = whitePlayerUid; updatePayload.startingPlayer = whitePlayerUid; updatePayload.previousState = null;
            } else if (data.gameId === 'dama') {
              const hostColor = data.playerColors[data.players[0]];
              const myColor = hostColor === 'w' ? 'b' : 'w';
              const whitePlayerUid = hostColor === 'w' ? data.players[0] : user.uid;
              updatePayload.playerColors = { ...data.playerColors, [user.uid]: myColor };
              updatePayload.turn = whitePlayerUid;
              updatePayload.startingPlayer = whitePlayerUid;
            } else if (data.gameId === 'okey101') {
              // Yeni oyuncu takımsız (Bekleyenler havuzunda) katılır; status zaten yukarıda
              // 'waiting' tutuldu — Okey101Lobby'nin geri sayım efekti eşiğe ulaşınca 'playing'e çevirecek.
            } else {
              const startingPlayer = updatedPlayers[Math.random() < 0.5 ? 0 : 1];
              updatePayload.turn = startingPlayer; updatePayload.startingPlayer = startingPlayer;
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
          transaction.update(roomRef, updatePayload);
          optimisticData = { ...data, ...updatePayload };
        } else {
          optimisticData = data;
        }
      });

      // Az önce transaction'da okuduğumuz/yazdığımız veriyi onSnapshot'ın ilk paketini
      // beklemeden hemen gösteriyoruz; onSnapshot geldiğinde sessizce senkronlanır.
      if (optimisticData) { setRoomData(optimisticData); setCurrentView('room'); }
      setRoomCode(cleanCode); safeStorage.set('activeRoom', cleanCode); setJoinCodeInput(''); setErrorMsg(''); setDisconnectCountdown(null);
      
    } catch (err) { 
      if (err.message === "not-found") setErrorMsg("Böyle bir oda kodu yok.");
      else if (err.message === "closed") setErrorMsg("Bu oda kapalı.");
      else if (err.message === "full") setSpectatePrompt(cleanCode);
      else if (err.message === "already-spectator") { setRoomCode(cleanCode); safeStorage.set('activeRoom', cleanCode); setJoinCodeInput(''); }
      else setErrorMsg("Odaya katılırken bir hata oluştu.");
    }
  };

  const acceptSpectate = async () => {
    if (!spectatePrompt || !user) return; 
    const cleanCode = spectatePrompt;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', cleanCode);
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(roomRef);
        if (!snap.exists()) throw new Error("not-found");
        const data = snap.data();
        const newSpectators = data.spectators ? [...data.spectators, user.uid] : [user.uid];
        transaction.update(roomRef, { spectators: newSpectators });
      });
      setRoomCode(cleanCode); safeStorage.set('activeRoom', cleanCode); 
      setSpectatePrompt(null); setJoinCodeInput(''); setErrorMsg('');
    } catch (err) { setErrorMsg("Seyirci olarak bağlanılamadı."); }
  };

  const leaveRoom = async () => {
    if (isBotGame) { leaveRoomLocal(); return; }
    const currentCode = roomCode;
    const isPlayer = roomData?.players?.includes(user?.uid);
    const isSpec = roomData?.spectators?.includes(user?.uid);
    if (currentCode && user && (isPlayer || isSpec)) {
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentCode);
      try {
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(roomRef); if (!snap.exists()) return;
          const data = snap.data();

          // Okey101 lobi aşamasında (henüz oyun başlamadıysa) ayrılma, tüm odayı
          // kapatmak yerine sadece o oyuncuyu koltuktan kaldırır; host ayrılırsa
          // kalan bir gerçek oyuncuya (yoksa herhangi birine) host devredilir.
          // Bu, geri sayımın "biri ayrılırsa iptal olsun" kuralını da doğal olarak sağlar.
          if (isPlayer && data.gameId === 'okey101' && data.status === 'waiting') {
            const remainingPlayers = (data.players || []).filter(uid => uid !== user.uid);
            if (remainingPlayers.length === 0) {
              transaction.update(roomRef, { status: 'closed', closedBy: user.uid });
              return;
            }
            const newTeams = { A: (data.teams?.A || []).filter(uid => uid !== user.uid), B: (data.teams?.B || []).filter(uid => uid !== user.uid) };
            const newScores = { ...data.scores }; delete newScores[user.uid];
            const newNames = { ...data.playerNames }; delete newNames[user.uid];
            const newIsBot = { ...(data.isBotPlayer || {}) }; delete newIsBot[user.uid];
            const newHost = data.host === user.uid
              ? (remainingPlayers.find(uid => !isOkeyBotUid(uid)) || remainingPlayers[0])
              : data.host;
            transaction.update(roomRef, {
              players: remainingPlayers, host: newHost, teams: newTeams,
              scores: newScores, playerNames: newNames, isBotPlayer: newIsBot,
              countdownStartedAt: null,
            });
            return;
          }

          if (isPlayer) {
             if (data.players.length <= 1 || (data.status === 'abandoned' && data.abandonedBy !== user.uid)) {
                 transaction.update(roomRef, { status: 'closed', closedBy: user.uid });
             } else {
                 transaction.update(roomRef, { status: 'abandoned', abandonedBy: user.uid, abandonReason: 'left' });
             }
          } else if (isSpec) {
             const newSpectators = (data.spectators || []).filter(id => id !== user.uid);
             transaction.update(roomRef, { spectators: newSpectators });
          }
        });
      } catch (err) { console.error("Oda kapatılamadı:", err); }
    }
    leaveRoomLocal();
  };

  const copyToClipboard = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(roomCode);
      } else {
        // Fallback: Eski tarayıcılar için
        const textArea = document.createElement("textarea"); 
        textArea.value = roomCode; 
        document.body.appendChild(textArea); 
        textArea.select();
        document.execCommand('copy'); 
        document.body.removeChild(textArea);
      }
      setCopySuccess(true); setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) { console.error("Kopyalama hatası:", err); }
  };

  if (loadingAuth) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white"><Loader2 className="animate-spin w-8 h-8" /></div>;

  // 101 Okey ıstakası 15 sütunluk iki sıradan oluşuyor ve telefonda her piksel
  // kritik; bu yüzden bu oyunda dış/iç boşluklar dar ekranda belirgin şekilde
  // kısılır (sm ve üstünde eski görünüm korunur).
  const isOkeyTable = roomData?.gameId === 'okey101' && currentView === 'room';
  // Telefon YATAY (compact) modda 101 Okey MASASI tüm ekranı kullanır: dış/iç
  // boşluklar ve üst başlık tamamen kaldırılır, sayfa hiç kaydırılmaz. Aksi
  // halde ıstaka ekranın altından taşıyordu.
  // Sadece oyun BAŞLADIĞINDA devreye girer — lobi/kural ekranı normal akışta
  // kalmalı, yoksa sayfa kaydırılamadığı için alt kısmına ulaşılamaz.
  const okeyCompact = isOkeyTable && isCompact && roomData?.status === 'playing';
  const pagePadding = okeyCompact ? 'p-0' : (isOkeyTable ? 'p-1 sm:p-4 md:p-8' : 'p-4 md:p-8');
  const cardPadding = okeyCompact ? 'p-0' : (isOkeyTable ? 'p-1 sm:p-4 md:p-8' : 'p-4 md:p-8');
  const hideChrome = isFullscreen || okeyCompact;

  return (
    <div className={`bg-slate-900 text-slate-100 font-sans relative overflow-x-hidden ${okeyCompact ? 'h-[100dvh] overflow-y-hidden' : 'min-h-screen'} ${pagePadding}`}>
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 bg-red-600 text-white text-center py-2 font-bold z-[100000] flex justify-center items-center gap-2 shadow-md">
          <WifiOff className="w-5 h-5" /> İnternet bağlantınız koptu. Yeniden bağlanılıyor...
        </div>
      )}

      {leftOverlayTimer !== null && currentView === 'lobby' && (
        <LeftOverlay leftOverlayTimer={leftOverlayTimer} setLeftOverlayTimer={setLeftOverlayTimer} />
      )}

      {typeof disconnectCountdown === 'number' && roomData?.status === 'abandoned' && (
        <DisconnectOverlay disconnectCountdown={disconnectCountdown} roomData={roomData} user={user} roomCode={roomCode} db={db} appId={appId} leaveRoom={leaveRoom} setDisconnectCountdown={setDisconnectCountdown} />
      )}

      {spectatePrompt && (
        <SpectatePrompt spectatePrompt={spectatePrompt} acceptSpectate={acceptSpectate} setSpectatePrompt={setSpectatePrompt} />
      )}

      {errorMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 w-[90%] max-w-md z-[99999] bg-red-500/95 backdrop-blur-sm border border-red-400 text-white p-4 rounded-xl flex items-center gap-3 shadow-2xl transition-all duration-300 transform scale-100 opacity-100">
          <AlertCircle className="w-6 h-6 shrink-0" />
          <span className="font-medium text-sm md:text-base flex-grow text-center">{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="bg-black/20 hover:bg-black/40 p-1 rounded transition-colors shrink-0"><X className="w-5 h-5" /></button>
        </div>
      )}

      {!hideChrome && (
        <header className="max-w-5xl mx-auto flex items-center justify-between mb-4 md:mb-8 pb-4 border-b border-slate-700 mt-4 md:mt-0">
          <div className="flex items-center gap-3">
            <Gamepad2 className="w-8 h-8 text-indigo-400" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Masa Oyunları Portalı</h1>
          </div>
          <div className="text-xs text-slate-400 bg-slate-800 px-3 py-1 rounded-full truncate max-w-[120px]">{nickname || `Oyuncu: ${user?.uid.substring(0,4)}`}</div>
        </header>
      )}

      {currentView === 'lobby' ? (
        <Lobby isCreatingRoom={isCreatingRoom} nickname={nickname} setNickname={setNickname} joinCodeInput={joinCodeInput} setJoinCodeInput={setJoinCodeInput} joinRoom={joinRoom} createRoom={createRoom} startBotGame={startBotGame} />
      ) : (
        <main className={`max-w-5xl mx-auto flex flex-col items-center ${okeyCompact ? 'h-full w-full' : ''}`}>
          {!hideChrome && (
            <RoomHeader leaveRoom={leaveRoom} toggleFullscreen={toggleFullscreen} roomCode={roomCode} copyToClipboard={copyToClipboard} copySuccess={copySuccess} isBotGame={isBotGame} />
          )}

          <div className={isFullscreen
            ? `fixed inset-0 z-[5000] w-full h-[100dvh] bg-slate-900 ${isCompact ? 'overflow-hidden' : 'overflow-y-auto'} overflow-x-hidden flex flex-col items-center justify-center ${isOkeyTable ? (isCompact ? 'p-0' : 'p-1 sm:p-3') : 'p-2 sm:p-4'}`
            : `w-full bg-slate-800 ${okeyCompact ? 'h-full rounded-none border-0' : 'rounded-2xl border border-slate-700 shadow-2xl'} ${cardPadding} flex flex-col items-center relative transition-all duration-300`}>
            {isFullscreen && (
               <>
                 <div className="fixed top-3 left-3 sm:top-6 sm:left-6 z-[6000] flex items-center gap-2 bg-slate-800/80 px-4 py-2 rounded-full border border-slate-600 shadow-lg backdrop-blur-md">
                    {isBotGame ? (
                      <span className="text-xs font-bold text-indigo-300">Bot Modu</span>
                    ) : (
                      <><span className="text-xs text-slate-400">Kod:</span><span className="font-mono font-bold text-indigo-300">{roomCode}</span></>
                    )}
                 </div>
                 <button onClick={toggleFullscreen} className="fixed top-3 right-3 sm:top-6 sm:right-6 z-[6000] bg-slate-800/80 hover:bg-slate-700 p-2 sm:p-3 rounded-full text-slate-300 transition-all shadow-[0_0_20px_rgba(0,0,0,0.5)] border border-slate-600 backdrop-blur-md" title="Tam Ekrandan Çık">
                    <Minimize className="w-5 h-5 sm:w-6 sm:h-6" />
                 </button>
               </>
            )}

            {roomData?.status === 'waiting' && roomData?.gameId !== 'okey101' ? (
              <div className="text-center py-12">
                <Loader2 className="w-12 h-12 animate-spin text-indigo-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold mb-2">Rakip Bekleniyor...</h2>
                <p className="text-slate-400 max-w-sm mx-auto mb-6">Arkadaşına oda kodunu gönder. O da bu kodu yazarak masaya katılabilir.</p>
                {!isFullscreen && <div className="text-3xl font-mono bg-slate-900 px-6 py-3 rounded-lg border border-slate-600 inline-block shadow-inner">{roomCode}</div>}
              </div>
            ) : (
              <div className={`w-full flex flex-col items-center ${okeyCompact ? 'h-full' : ''}`}>
                 <ErrorBoundary>
                   {roomData?.gameId === 'xox' && <TicTacToeGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} isBot={isBotGame} botDifficulty={botDifficulty} setLocalRoomData={setRoomData} />}
                   {roomData?.gameId === 'tavla' && <TavlaGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} isBot={isBotGame} botDifficulty={botDifficulty} setLocalRoomData={setRoomData} />}
                   {roomData?.gameId === 'satranc' && <ChessGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} isBot={isBotGame} botDifficulty={botDifficulty} setLocalRoomData={setRoomData} />}
                   {roomData?.gameId === 'dama' && <CheckersGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} isBot={isBotGame} botDifficulty={botDifficulty} setLocalRoomData={setRoomData} />}
                   {roomData?.gameId === 'okey101' && <Okey101Game roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} />}
                   {roomData?.gameId === 'connect4' && <Connect4Game roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} isBot={isBotGame} botDifficulty={botDifficulty} setLocalRoomData={setRoomData} />}
                 </ErrorBoundary>
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}