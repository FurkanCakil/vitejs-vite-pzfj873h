// @ts-nocheck
import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Gamepad2, AlertCircle, Loader2, X, WifiOff, Minimize, Maximize, RotateCcw } from 'lucide-react';
import { signInAnonymously, onAuthStateChanged, signInWithCustomToken, setPersistence, inMemoryPersistence } from 'firebase/auth';

// --- BİZİM OLUŞTURDUĞUMUZ MODÜLLERİ İÇE AKTARIYORUZ ---
import { auth, db, appId } from './firebase/config.js';
import { normalizeRoomCode } from './utils/roomCode.js';
import { createRoomSessionStorage } from './utils/roomSession.js';
import { SERVER_ROOMS_ENABLED, serverGameEnabled, serverCreateType, serverMatchType, gameErrorMessage } from './utils/gameApi.js';
import { subscribeXoxRoom, xoxApi, xoxSessionId } from './hooks/serverXoxRoom.js';
import useOnlineStatus from './hooks/useOnlineStatus.js';
import usePresence from './hooks/usePresence.js';
import { useGamePerformance } from './hooks/useGamePerformance.js';
import GamePerformancePanel from './components/GamePerformancePanel.jsx';

import useViewport from './hooks/useViewport.js';

import { getPlayerId, formatPlayerId } from './utils/playerId.js';

import ErrorBoundary from './components/ErrorBoundary.jsx';
import Lobby from './components/Lobby.jsx';
import RoomHeader from './components/RoomHeader.jsx';
import VolumeControl from './components/VolumeControl.jsx';
import DisconnectOverlay from './components/overlays/DisconnectOverlay.jsx';
import LeftOverlay from './components/overlays/LeftOverlay.jsx';
import SpectatePrompt from './components/overlays/SpectatePrompt.jsx';

// KOD BÖLME (code splitting) — oyun EKRANLARI ayrı paketlere ayrılır.
//
// NEDEN: Bu yedi bileşen STATİK import edildiğinde, lobiyi açan herkes
// hepsini (toplamda ~8.000 satır JSX) tek bir dosyada indirmek zorunda
// kalıyordu; oysa bir oturumda genelde tek bir oyun oynanır. `lazy` ile her
// oyun kendi parçasına iner ve YALNIZCA o oyuna girildiğinde indirilir —
// telefonda ilk açılış belirgin şekilde hızlanır.
//
// GÜVENLİK: Parça indirilemezse (mobil ağ kesintisi) `lazy` hata fırlatır;
// bu hata zaten var olan <ErrorBoundary>'ye düşer ve kullanıcı "Masaya Geri
// Dön" ile yeniden dener — sessiz bir boş ekran OLUŞMAZ. Oyun mantığı
// (logic.js / bot.js dosyaları) aşağıda hâlâ statik import edilir; oda kurmak
// için ana pakette gerekli oldukları için onlar bölünmez.
const TicTacToeGame = lazy(() => import('./games/xox/TicTacToeGame.jsx'));
const TavlaGame = lazy(() => import('./games/backgammon/TavlaGame.jsx'));
const ChessGame = lazy(() => import('./games/chess/ChessGame.jsx'));
const CheckersGame = lazy(() => import('./games/checkers/CheckersGame.jsx'));
const ServerOkey101Game = lazy(() => import('./games/okey101/ServerOkey101Game.jsx'));
const Connect4Game = lazy(() => import('./games/connect4/Connect4Game.jsx'));
const BattleshipGame = lazy(() => import('./games/battleship/BattleshipGame.jsx'));

import { createInitialBoard } from './games/backgammon/logic.js';
import { createInitialChessBoard, getBoardStateString } from './games/chess/logic.js';
import { createInitialCheckersBoard } from './games/checkers/logic.js';
import { createInitialConnect4Board } from './games/connect4/logic.js';
import { BOT_UID, DIFFICULTY_LABELS } from './games/xox/bot.js';
import { BOT_UID as CHECKERS_BOT_UID, DIFFICULTY_LABELS as CHECKERS_DIFFICULTY_LABELS } from './games/checkers/bot.js';
import { BOT_UID as CHESS_BOT_UID, DIFFICULTY_LABELS as CHESS_DIFFICULTY_LABELS } from './games/chess/bot.js';
import { BOT_UID as BACKGAMMON_BOT_UID, DIFFICULTY_LABELS as BACKGAMMON_DIFFICULTY_LABELS } from './games/backgammon/bot.js';
import { BOT_UID as CONNECT4_BOT_UID, DIFFICULTY_LABELS as CONNECT4_DIFFICULTY_LABELS } from './games/connect4/bot.js';
import { BOT_UID as BATTLESHIP_BOT_UID, generateBotFleet as generateBattleshipBotFleet } from './games/battleship/bot.js';

// Bazı telefon tarayıcılarında (çerez/site verisi tamamen engelliyken ya da
// depolama kotası dolduğunda) localStorage'a ERİŞMEK BİLE istisna fırlatır.
// Korumasız bir `localStorage.getItem` çağrısı tüm uygulamayı boş ekrana
// düşürdüğü için tüm erişimler bu güvenli sarmalayıcıdan geçirilir.
const safeStorage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* yok say */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* yok say */ } },
};

// KULLANICI İSTEĞİ: "aktif oda" kaydı eskiden `localStorage`'daydı — bu,
// TARAYICI KAPANIP AÇILSA/yeni bir sekmede site linkine TEKRAR tıklansa BİLE
// kalıcı kaldığı için, kullanıcı paylaşım linkine (ya da ana sayfa
// kısayoluna) sıfırdan her tıkladığında doğrudan lobiye değil, bu cihazda
// EN SON oynanan (bitmiş olsa bile) odaya geri düşürüyordu. `sessionStorage`
// ise sekme/oturum kapanınca kendiliğinden temizlenir ama AYNI sekmede
// (ör. kazara F5 ile) sayfa yenilendiğinde hâlâ hayatta kalır — yani "kazara
// yenilemede kaldığın odaya dön" (bağlantı kopması koruması) davranışı
// KORUNUR, sadece "linke/kısayola sıfırdan tıklayınca eski odaya düş" hatası
// giderilir.
const sessionRoomStorage = createRoomSessionStorage(() => sessionStorage);

export default function App() {
  // Görünen oyuncu numarasıdır; oda üyeliği ve skor yetkisi Firebase UID ile sunucuda doğrulanır.
  const myPlayerId = getPlayerId();
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
  // "Kaldığınız yerden devam ediyorsunuz" bildirimi (kullanan efekt çok daha
  // aşağıda). BURADA, diğer state'lerle birlikte tanımlanır çünkü
  // `leaveRoomLocal` (hemen aşağıda) `setResumeNoticeAt`'i çağırır: tanım
  // aşağıda kalırsa fonksiyon, henüz başlatılmamış bir `const`'a atıfta bulunmuş
  // olur (TDZ). Şu an yalnızca render sonrası çağrıldığı için patlamıyor, ama
  // ileride render sırasında çağrılan tek bir yol bile eklenirse uygulama
  // "Cannot access before initialization" ile komple boş ekrana düşerdi.
  const [resumeNoticeAt, setResumeNoticeAt] = useState(null);

  const [isBotGame, setIsBotGame] = useState(false);
  const [isServerRoom, setIsServerRoom] = useState(false);
  useGamePerformance(roomCode, isServerRoom && roomData?.gameId === 'xox' ? 'xox' : null, roomData?.version);
  // Matchmaking uses server queues; presence never advertises legacy room codes.
  usePresence(user?.uid);
  const [botDifficulty, setBotDifficulty] = useState('medium');

  const authInitiatedRef = useRef(false);
  const creatingRoomRef = useRef(false);
  const leavingRoomRef = useRef(null);
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
      if (currentUser) {
        const saved = sessionRoomStorage.restore(SERVER_ROOMS_ENABLED);
        if (saved.code) { setIsServerRoom(true); setRoomCode(saved.code); }
        else if (saved.reason === 'legacy') setErrorMsg('Eski oda oturumun kapatıldı. Yeni bir oda kurarak devam edebilirsin.');
        else if (saved.reason === 'unavailable') setErrorMsg('Bu ortamda çevrimiçi oyun açık değil. Canlı siteyi açıp tekrar dene.');
      }
    });
    return () => unsubscribe();
  }, []);


  const leaveRoomLocal = () => {
    setRoomCode(''); setRoomData(null); setCurrentView('lobby');
    setDisconnectCountdown(null); setSpectatePrompt(null); sessionRoomStorage.remove();
    setIsBotGame(false); setIsServerRoom(false); setResumeNoticeAt(null);
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(()=>{});
  };

  const enterServerRoom = (result) => {
    leavingRoomRef.current = null;
    setIsServerRoom(true); setIsBotGame(false); setRoomData(null);
    setRoomCode(result.roomId); sessionRoomStorage.set(result.roomId); sessionRoomStorage.protocol('v2');
    setCurrentView('room'); setJoinCodeInput(''); setErrorMsg(''); setDisconnectCountdown(null);
  };
  const sendXoxAction = (type, fields = {}, options) => xoxApi(user)({ type, roomId: roomCode, ...fields }, options);

  const waitForOpponent = async () => {
    if (!isServerRoom) { leaveRoomLocal(); return; }
    setDisconnectCountdown('paused');
    try { await sendXoxAction('room.wait', { expectedVersion: roomData.version }); }
    catch (error) { setErrorMsg(gameErrorMessage(error)); setDisconnectCountdown(15); }
  };

  useEffect(() => {
    if (leftOverlayTimer === null) return;
    if (leftOverlayTimer <= 0) { setLeftOverlayTimer(null); return; }
    const timer = setTimeout(() => setLeftOverlayTimer(prev => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [leftOverlayTimer]);

  useEffect(() => {
    if (!user || !roomCode || isBotGame) return;
    if (!isServerRoom) { leaveRoomLocal(); setErrorMsg('Bu oda eski sürümde açılmış. Yeni bir oda kurarak devam edebilirsin.'); return; }
    return subscribeXoxRoom({ db, appId, user, roomId: roomCode,
      onData: data => {
        if (!data || data.status === 'closed') {
          if (data?.closedBy !== user.uid) setLeftOverlayTimer(5);
          leaveRoomLocal(); return;
        }
        if (!serverGameEnabled(data.gameId)) {
          leaveRoomLocal(); setErrorMsg('Bu oyun için yeni sistem henüz açık değil. Sayfayı yenileyip tekrar dene.'); return;
        }
        setRoomData(data); setCurrentView('room');
        if (data.status === 'abandoned' && data.abandonedBy !== user.uid && data.players.includes(user.uid)) {
          setDisconnectCountdown(value => value === null ? (data.abandonReason === 'left' ? 5 : 15) : value);
        } else setDisconnectCountdown(null);
      },
      onError: error => {
        // Okey seat/spectator removal can revoke this listener before the
        // intentional leave response arrives. Finish leaving without a false
        // expired-session warning, and do not touch a subsequently joined room.
        if (leavingRoomRef.current === roomCode && ['permission-denied', 'not_a_player', 'room_closed', 'room_not_found'].includes(error.code)) {
          leaveRoomLocal(); return;
        }
        if (['permission-denied', 'not_a_player', 'room_closed', 'room_not_found'].includes(error.code)) leaveRoomLocal();
        setErrorMsg(gameErrorMessage(error));
      },
    });
  }, [user, roomCode, isBotGame, isServerRoom]);

  // "Kaldığınız yerden devam ediyorsunuz" bildirimi. `resumeNotice` odaya,
  // Sunucudan bir devam bildirimi geldiğinde masadaki herkeste gösterilir; yani
  // masadaki herkes bunu aynı anda görür. Bildirim kısa ömürlüdür.
  // (State'in kendisi yukarıda, diğer state'lerle birlikte tanımlıdır.)
  const shownResumeRef = useRef(null);
  const resumeNoticeStamp = roomData?.resumeNotice?.at || null;
  useEffect(() => {
    // Alan TEMİZLENDİĞİNDE hiçbir şey yapılmaz: görünen bir bildirimi erken
    // kapatmak yerine aşağıdaki 12sn'lik sayaç kapatsın.
    if (!resumeNoticeStamp) return undefined;
    // Her bildirim bir KEZ gösterilir (aynı snapshot birden çok kez gelebilir).
    if (shownResumeRef.current === resumeNoticeStamp) return undefined;
    // Odaya sonradan (ör. sayfa yenileyerek) girenlerde eski bir kayıt tekrar
    // tetiklenmesin: bildirim yalnızca TAZE bir devam işlemine aittir.
    if (Date.now() - new Date(resumeNoticeStamp).getTime() > 60_000) return undefined;
    shownResumeRef.current = resumeNoticeStamp;
    setResumeNoticeAt(resumeNoticeStamp);
    const t = setTimeout(() => setResumeNoticeAt(null), 12_000);
    return () => clearTimeout(t);
  }, [resumeNoticeStamp]);

  useEffect(() => {
    if (disconnectCountdown === null || disconnectCountdown === 'paused') return;
    if (disconnectCountdown === 0) {
      if (isServerRoom) {
        xoxApi(roomStateRef.current.user)({ type: 'room.close', roomId: roomCode, expectedVersion: roomStateRef.current.roomData.version }).then(() => leaveRoomLocal()).catch(error => {
          setDisconnectCountdown(null);
          if (!['stale_version', 'player_reconnected', 'cannot_close'].includes(error.code)) setErrorMsg(gameErrorMessage(error));
        });
        return;
      }
      leaveRoomLocal();
      return;
    }
    const timer = setTimeout(() => { setDisconnectCountdown(prev => typeof prev === 'number' ? prev - 1 : prev); }, 1000);
    return () => clearTimeout(timer);
  }, [disconnectCountdown, roomCode, isServerRoom]);

  const startBotGame = (gameId, difficulty) => {
    if (!user || (gameId !== 'xox' && gameId !== 'dama' && gameId !== 'satranc' && gameId !== 'tavla' && gameId !== 'connect4' && gameId !== 'amiralbatti')) return;
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
        chessMoves: [], notationStartFen: null,
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
    } else if (gameId === 'amiralbatti') {
      // Amiral Battı'da ZORLUK SEVİYESİ YOKTUR (oyun şansa dayalı) — tek,
      // standart bir bot (bkz. battleship/bot.js). Bot filosu ODA KURULUR
      // KURULMAZ (yerleştirme ekranı açılmadan ÖNCE) anında ve rastgele
      // yerleştirilip otomatik "hazır" işaretlenir; insan "Hazır"a basınca
      // (bkz. BattleshipGame.jsx#handleConfirmReady) savaş doğrudan başlar.
      initialState = {
        gameId, host: user.uid, players: [user.uid, BATTLESHIP_BOT_UID], spectators: [],
        playerNames: { [user.uid]: nickname || 'Sen', [BATTLESHIP_BOT_UID]: 'Bot' },
        scores: { [user.uid]: 0, [BATTLESHIP_BOT_UID]: 0 }, status: 'playing',
        setupPhase: true,
        ships: { [BATTLESHIP_BOT_UID]: generateBattleshipBotFleet() },
        readyPlayers: { [BATTLESHIP_BOT_UID]: true },
        shots: {}, turn: null, winner: null, rematchRequestedBy: null,
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
    sessionRoomStorage.remove();

    setBotDifficulty(difficulty);
    setIsBotGame(true);
    setRoomData(initialState);
    setRoomCode('BOT-LOCAL');
    setCurrentView('room');
    setDisconnectCountdown(null);
  };

  // Online rooms always use authenticated server actions. A disabled rollout
  // cannot silently fall back to the retired client-written collection.
  const createRoom = async (gameId, isPublic = false) => {
    if (!user || creatingRoomRef.current) return;
    if (!serverGameEnabled(gameId)) { setErrorMsg(gameErrorMessage({ code: 'server_not_enabled' })); return; }
    creatingRoomRef.current = true; setIsCreatingRoom(true);
    try {
      const api = xoxApi(user); let result;
      for (let attempt = 0; attempt < 4; attempt++) {
        try { result = await api({ type: serverCreateType(gameId), nickname: nickname.trim() || 'Oyuncu', isPublic, sessionId: xoxSessionId() }); break; }
        catch (error) { if (error.code !== 'room_code_collision' || attempt === 3) throw error; }
      }
      enterServerRoom(result);
    } catch (error) { setErrorMsg(gameErrorMessage(error)); }
    finally { creatingRoomRef.current = false; setIsCreatingRoom(false); }
  };

  const joinRoom = async (code) => {
    if (!user || !code) return;
    const cleanCode = normalizeRoomCode(code);
    if (!cleanCode) { setErrorMsg('Oda kodu 6 harf veya rakamdan oluşmalı.'); return; }
    if (!SERVER_ROOMS_ENABLED) { setErrorMsg(gameErrorMessage({ code: 'server_not_enabled' })); return; }
    try {
      const result = await xoxApi(user)({ type: 'room.join', roomId: cleanCode, nickname: nickname.trim() || 'Oyuncu', sessionId: xoxSessionId() });
      enterServerRoom(result);
    } catch (error) {
      if (error.code === 'room_full') setSpectatePrompt(cleanCode);
      else setErrorMsg(gameErrorMessage(error));
    }
  };

  const [matchmakingGameId, setMatchmakingGameId] = useState(null);
  const findMatch = async (gameId) => {
    if (!user || matchmakingGameId) return;
    if (!serverGameEnabled(gameId)) { setErrorMsg(gameErrorMessage({ code: 'server_not_enabled' })); return; }
    setMatchmakingGameId(gameId);
    try {
      const result = await xoxApi(user)({ type: serverMatchType(gameId), nickname: nickname.trim() || 'Oyuncu', sessionId: xoxSessionId() });
      enterServerRoom(result);
    } catch (error) { setErrorMsg(gameErrorMessage(error)); }
    finally { setMatchmakingGameId(null); }
  };

  const [isSpectateJoining, setIsSpectateJoining] = useState(false);
  const acceptSpectate = async () => {
    if (!spectatePrompt || !user || isSpectateJoining) return;
    setIsSpectateJoining(true);
    try {
      const result = await xoxApi(user)({ type: 'room.spectate', roomId: spectatePrompt, sessionId: xoxSessionId() });
      setSpectatePrompt(null); enterServerRoom(result);
    } catch (error) { setErrorMsg(gameErrorMessage(error)); }
    finally { setIsSpectateJoining(false); }
  };

  const leaveRoom = async () => {
    if (isBotGame || !isServerRoom) { leaveRoomLocal(); return; }
    if (leavingRoomRef.current === roomCode) return;
    const leavingCode = roomCode;
    leavingRoomRef.current = leavingCode;
    try {
      await sendXoxAction('room.leave', { sessionId: xoxSessionId() });
      if (roomStateRef.current.roomCode === leavingCode) leaveRoomLocal();
    } catch (error) {
      if (roomStateRef.current.roomCode === leavingCode) setErrorMsg(gameErrorMessage(error));
    } finally { if (leavingRoomRef.current === leavingCode) leavingRoomRef.current = null; }
  };

  // KULLANICI İSTEĞİ: lobiden bir oyuna/odaya girildiğinde tarayıcının GERİ
  // tuşu hiçbir şey yapmıyordu — bu sadece bir React state değişimi
  // (`currentView`), gerçek bir sayfa/URL geçişi (history girdisi) DEĞİL.
  // Aşağıdaki üç parça bunu düzeltir: odaya girilince tarayıcı geçmişine BİR
  // girdi eklenir (pushState); GERİ tuşuna basılınca (popstate) bu girdi
  // "Odadan Çık" butonuyla AYNI şekilde ele alınır (leaveRoom — sadece lobiyi
  // göstermek yetmez, rakibe/sunucuya doğru bildirim gitmesi gerekir);
  // odadan BUTONLA/otomatik (rakip odayı kapattı vb.) çıkıldığında ise geride
  // kalan o "oda" geçmiş girdisi kendiliğinden geri alınır — yoksa geri tuşu
  // kullanıcıyı zaten geçersiz/boş bir oda durumuna götürürdü.
  const leaveRoomRef = useRef(null);
  leaveRoomRef.current = leaveRoom;
  const historyRoomPushedRef = useRef(false);

  useEffect(() => {
    window.history.replaceState({ view: 'lobby' }, '');
  }, []);

  useEffect(() => {
    const onPopState = () => {
      if (roomStateRef.current.currentView === 'room') {
        historyRoomPushedRef.current = false;
        leaveRoomRef.current?.();
      } else {
        historyRoomPushedRef.current = false;
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (currentView === 'room' && !historyRoomPushedRef.current) {
      window.history.pushState({ view: 'room' }, '');
      historyRoomPushedRef.current = true;
    } else if (currentView === 'lobby' && historyRoomPushedRef.current) {
      historyRoomPushedRef.current = false;
      window.history.back();
    }
  }, [currentView]);

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
        <DisconnectOverlay disconnectCountdown={disconnectCountdown} roomData={roomData} leaveRoom={leaveRoom} waitForOpponent={waitForOpponent} />
      )}

      {spectatePrompt && (
        <SpectatePrompt spectatePrompt={spectatePrompt} acceptSpectate={acceptSpectate} setSpectatePrompt={setSpectatePrompt} isJoining={isSpectateJoining} />
      )}

      {errorMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 w-[90%] max-w-md z-[99999] bg-red-500/95 backdrop-blur-sm border border-red-400 text-white p-4 rounded-xl flex items-center gap-3 shadow-2xl transition-all duration-300 transform scale-100 opacity-100">
          <AlertCircle className="w-6 h-6 shrink-0" />
          <span className="font-medium text-sm md:text-base flex-grow text-center">{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="bg-black/20 hover:bg-black/40 p-1 rounded transition-colors shrink-0"><X className="w-5 h-5" /></button>
        </div>
      )}

      {!hideChrome && (
        <header className="max-w-5xl mx-auto flex items-center justify-between gap-2 mb-4 md:mb-8 pb-4 border-b border-slate-700 mt-4 md:mt-0">
          <div className="flex items-center gap-3 min-w-0">
            <Gamepad2 className="w-8 h-8 text-indigo-400 shrink-0" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent truncate">Oyun Portalı</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Ses seviyesi: lobide de, oyunların içinde de AYNI düğme
                (bkz. components/VolumeControl.jsx). */}
            <VolumeControl />
            {/* İsim yerine CİHAZA ÖZEL oyuncu kimliği gösterilir: skorların
                kaldığı yerden devam edip etmeyeceğini belirleyen şey isim
                değil, bu kimliktir (bkz. utils/playerId.js). */}
            <div
              className="text-[11px] sm:text-xs text-slate-400 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-full font-mono tracking-wider whitespace-nowrap"
              title={nickname ? `${nickname} — Oyuncu ID: ${myPlayerId}` : `Oyuncu ID: ${myPlayerId}`}
            >
              <span className="text-slate-500 mr-1">ID</span>{formatPlayerId(myPlayerId)}
            </div>
          </div>
        </header>
      )}

      {/* Başlığın gizlendiği modlarda (tam ekran / telefon yatay 101 Okey)
          ses kontrolü ekrana sabitlenir — bu modlarda da sese ulaşılabilsin.
          Konum, o modlardaki mevcut "Çık"/"Tam Ekran" düğmeleriyle çakışmayacak
          şekilde seçildi. */}
      {hideChrome && (
        <VolumeControl
          variant="floating"
          className={okeyCompact ? 'fixed top-1 right-[5.5rem] z-[6100]' : 'fixed top-3 right-14 sm:top-6 sm:right-[4.5rem] z-[6100]'}
        />
      )}

      {resumeNoticeAt && currentView === 'room' && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 w-[92%] max-w-md z-[99000] bg-emerald-600/95 backdrop-blur-sm border border-emerald-400 text-white px-4 py-3 rounded-xl flex items-center gap-3 shadow-2xl">
          <RotateCcw className="w-5 h-5 shrink-0" />
          <span className="font-medium text-sm flex-grow text-center">
            {(() => {
              const others = (roomData?.players || [])
                .filter((uid) => uid !== user?.uid)
                .map((uid) => roomData?.playerNames?.[uid] || 'Rakip');
              const who = others.length ? others.join(', ') : 'Eski rakibin';
              return `${who} oyuncusuyla kaldığınız yerden devam ediyorsunuz.`;
            })()}
          </span>
          <button onClick={() => setResumeNoticeAt(null)} className="bg-black/20 hover:bg-black/40 p-1 rounded transition-colors shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}

      <GamePerformancePanel />
      {currentView === 'lobby' ? (
        <Lobby isCreatingRoom={isCreatingRoom} nickname={nickname} setNickname={setNickname} joinCodeInput={joinCodeInput} setJoinCodeInput={setJoinCodeInput} joinRoom={joinRoom} createRoom={createRoom} startBotGame={startBotGame} findMatch={findMatch} matchmakingGameId={matchmakingGameId} userId={user?.uid} />
      ) : (
        // 101 Okey masası diğer oyunlardan DAHA GENİŞ bir kaba oturur: masanın
        // ortasındaki "Açılan Eller" alanına daha büyük (okunaklı) taşlar sığsın
        // ve yan koltuklar gerçekten kenarlara açılsın diye.
        <main className={`${isOkeyTable ? 'max-w-6xl' : 'max-w-5xl'} mx-auto flex flex-col items-center ${okeyCompact ? 'h-full w-full' : ''}`}>
          {!hideChrome && (
            <RoomHeader leaveRoom={leaveRoom} toggleFullscreen={toggleFullscreen} roomCode={roomCode} copyToClipboard={copyToClipboard} copySuccess={copySuccess} isBotGame={isBotGame} isPublicRoom={!!roomData?.isPublic} />
          )}

          {/* Tam ekranda içerik DİKEYDE ORTALANIR ama `justify-center` ile
              DEĞİL: flex'te justify-center, içerik kaba sığmadığında taşan
              kısmı kaydırmayla ULAŞILAMAZ hale getirir (üst taraf kesilir).
              Bunun yerine aşağıdaki içerik sarmalayıcısına `m-auto` verilir;
              yer varken ortalar, yokken otomatik kenar boşlukları 0'a düşüp
              normal kaydırma çalışmaya devam eder. */}
          <div className={isFullscreen
            ? `fixed inset-0 z-[5000] w-full h-[100dvh] bg-slate-900 overflow-y-auto overflow-x-hidden flex flex-col items-center ${isOkeyTable ? (isCompact ? 'p-0' : 'p-1 sm:p-3') : 'p-2 sm:p-4'}`
            : `w-full bg-slate-800 ${okeyCompact ? 'h-full rounded-none border-0' : 'rounded-2xl border border-slate-700 shadow-2xl'} ${cardPadding} flex flex-col items-center relative transition-all duration-300`}>
            {isFullscreen && (
                 <button onClick={toggleFullscreen} className="fixed top-3 right-3 sm:top-6 sm:right-6 z-[6000] bg-slate-800/80 hover:bg-slate-700 p-2 sm:p-3 rounded-full text-slate-300 transition-all shadow-[0_0_20px_rgba(0,0,0,0.5)] border border-slate-600 backdrop-blur-md" title="Tam Ekrandan Çık">
                    <Minimize className="w-5 h-5 sm:w-6 sm:h-6" />
                 </button>
            )}

            {/* Telefon YATAY (okeyCompact) modda üst başlık — dolayısıyla
                RoomHeader'daki "Tam Ekran Yap" butonu — tamamen gizleniyordu;
                yani telefon yatayken tam ekrana GEÇMEK imkânsızdı. Bu buton o
                boşluğu doldurur (Okey101Game'in kendi "Çık" butonunun solunda
                durur). Tam ekrandayken zaten yukarıdaki "Tam Ekrandan Çık"
                butonu görünüyor, o yüzden burada gösterilmez. */}
            {okeyCompact && !isFullscreen && (
              <button
                onClick={toggleFullscreen}
                title="Tam Ekran Yap"
                className="fixed top-1 right-12 z-[4600] text-slate-200 bg-slate-900/80 border border-slate-600 p-1.5 rounded-lg backdrop-blur-sm"
              >
                <Maximize className="w-4 h-4" />
              </button>
            )}

            {roomData?.status === 'waiting' && roomData?.gameId !== 'okey101' ? (
              /* HIZLI EŞLEŞME odasında davet kodu GÖSTERİLMEZ (kullanıcı
                 isteği): kod, yalnızca arkadaşını çağırmak içindir. Rastgele
                 eşleşme beklerken sadece "Oyuncu Bekleniyor" görünür. */
              <div className="text-center py-12">
                <Loader2 className="w-12 h-12 animate-spin text-indigo-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold mb-2">Oyuncu Bekleniyor...</h2>
                {roomData?.isPublic ? (
                  <p className="text-slate-400 max-w-sm mx-auto">Sana uygun bir rakip aranıyor. Biri katıldığı anda oyun başlayacak.</p>
                ) : (
                  <>
                    <p className="text-slate-400 max-w-sm mx-auto mb-6">Arkadaşına oda kodunu gönder. O da bu kodu yazarak masaya katılabilir.</p>
                    {!isFullscreen && <div className="text-3xl font-mono bg-slate-900 px-6 py-3 rounded-lg border border-slate-600 inline-block shadow-inner">{roomCode}</div>}
                  </>
                )}
              </div>
            ) : (
              <div className={`w-full flex flex-col items-center ${okeyCompact ? 'h-full' : ''} ${isFullscreen && !isOkeyTable ? 'm-auto' : ''}`}>
                 <ErrorBoundary>
                   {/* Oyun bileşenleri `lazy` olduğu için (bkz. yukarıdaki kod
                       bölme notu) ilk açılışta parçaları inerken bu kısa
                       yükleniyor göstergesi görünür. <ErrorBoundary> DIŞTA
                       durur ki indirme başarısız olursa hata onun tarafından
                       yakalansın. */}
                   <Suspense fallback={(
                     <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
                       <Loader2 className="w-10 h-10 animate-spin text-indigo-400" />
                       <span className="text-sm font-medium">Oyun yükleniyor...</span>
                     </div>
                   )}>
                   {roomData?.gameId === 'xox' && <TicTacToeGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} isBot={isBotGame} botDifficulty={botDifficulty} setLocalRoomData={setRoomData} sendAction={isServerRoom ? sendXoxAction : null} />}
                   {roomData?.gameId === 'tavla' && <TavlaGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} isBot={isBotGame} botDifficulty={botDifficulty} setLocalRoomData={setRoomData} sendAction={isServerRoom ? sendXoxAction : null} />}
                   {roomData?.gameId === 'satranc' && <ChessGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} isBot={isBotGame} botDifficulty={botDifficulty} setLocalRoomData={setRoomData} sendAction={isServerRoom ? sendXoxAction : null} />}
                   {roomData?.gameId === 'dama' && <CheckersGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} isBot={isBotGame} botDifficulty={botDifficulty} setLocalRoomData={setRoomData} sendAction={isServerRoom ? sendXoxAction : null} />}
                   {roomData?.gameId === 'okey101' && <ServerOkey101Game roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} sendAction={sendXoxAction} />}
                   {roomData?.gameId === 'connect4' && <Connect4Game roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} isBot={isBotGame} botDifficulty={botDifficulty} setLocalRoomData={setRoomData} sendAction={isServerRoom ? sendXoxAction : null} />}
                   {roomData?.gameId === 'amiralbatti' && <BattleshipGame roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} isBot={isBotGame} setLocalRoomData={setRoomData} sendAction={isServerRoom ? sendXoxAction : null} />}
                   </Suspense>
                 </ErrorBoundary>
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
