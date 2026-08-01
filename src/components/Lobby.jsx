import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Users, Bot, UserPlus, Zap, Loader2, X } from 'lucide-react';
import { db, appId } from '../firebase/config.js';
import { presenceCounterRef, countActiveSessions } from '../hooks/usePresence.js';

const GAMES = [
  { id: 'xox', name: 'XOX (Tic-Tac-Toe)', available: true, icon: '❌⭕' },
  { id: 'tavla', name: 'Tavla', available: true, icon: '🎲' },
  { id: 'satranc', name: 'Satranç', available: true, icon: '♟️' },
  { id: 'dama', name: 'Dama', available: true, icon: '⚪⚫' },
  { id: 'okey101', name: '101 Okey', available: true, icon: '🀄' },
  { id: 'connect4', name: 'Connect 4', available: true, icon: '🔴🔵' },
  { id: 'amiralbatti', name: 'Amiral Battı', available: true, icon: '🚢' },
];

const BOT_SUPPORTED_GAMES = ['xox', 'dama', 'satranc', 'tavla', 'connect4', 'amiralbatti'];

// KULLANICI İSTEĞİ: bot zorluk seçimi 101 Okey'den KALDIRILDI (orada üç
// seviyenin karar mantığı birebir aynıydı, bkz. okey101/botPlayers.js) — bu
// TEK oyuna özel bir düzeltmeydi. Diğer beş oyunun botu zorluğa göre GERÇEKTEN
// farklı davranıyor (bkz. ilgili bot.js dosyaları: xox/checkers/backgammon
// easy->rastgele/medium->arama/hard->daha derin arama, chess Stockfish beceri
// seviyesi, connect4 Minimax+Alpha-Beta derinliği) — bu beşinde seçim KALIR.
const DIFFICULTY_GAMES = ['xox', 'tavla', 'satranc', 'dama', 'connect4'];
const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Kolay' },
  { value: 'medium', label: 'Orta' },
  { value: 'hard', label: 'Zor' },
];

export default function Lobby({ isCreatingRoom, nickname, setNickname, joinCodeInput, setJoinCodeInput, joinRoom, createRoom, startBotGame, findMatch, matchmakingGameId, userId }) {
  // ---- Aktif Kullanıcı Sayacı --------------------------------------------
  // SADECE bu tekil doküman dinlenir (kullanıcı başına ayrı dinleyici YOK) ve
  // dinleyici yalnızca Lobby EKRANDAYKEN kuruludur — bir odaya girildiğinde
  // (Lobby unmount) otomatik kapanır, oyun içinde hiç okuma maliyeti olmaz.
  const [sessions, setSessions] = useState(null);
  const [presenceError, setPresenceError] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  // Dinleyici, ANONİM GİRİŞ tamamlanmadan (userId gelmeden) kurulmaz:
  // güvenlik kuralı `request.auth != null` istediği için, auth'tan önce açılan
  // bir dinleyici kalıcı olarak "permission denied" alıp bir daha kendini
  // toparlamıyordu (sayaç sonsuza dek "—" kalıyordu).
  useEffect(() => {
    if (!userId) return undefined;
    const unsub = onSnapshot(presenceCounterRef, (snap) => {
      setPresenceError(false);
      setSessions(snap.data()?.sessions || {});
    }, (err) => {
      console.error('Aktif kullanıcı sayacı okunamadı:', err);
      setPresenceError(true);
    });
    return unsub;
  }, [userId]);
  // Oturumlar ZAMANLA bayatlar (bkz. usePresence#FRESH_MS): yeni bir snapshot
  // gelmese bile sayının düşebilmesi için periyodik olarak yeniden hesaplanır.
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const activeUsers = useMemo(
    () => (sessions === null ? null : countActiveSessions(sessions, nowTick)),
    [sessions, nowTick],
  );

  // ---- Hızlı Eşleşme: oyun seçim ekranı ----------------------------------
  const [pickerOpen, setPickerOpen] = useState(false);
  const [waitingCounts, setWaitingCounts] = useState({});
  // Bekleyen oyuncu sayıları SADECE seçim ekranı açıkken dinlenir — kapalıyken
  // hiçbir okuma yapılmaz. Tek bir sorgu tüm oyunları kapsar (oyun başına ayrı
  // sorgu YOK); sayım istemcide `gameId`'ye göre gruplanır.
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const q = query(
      collection(db, 'artifacts', appId, 'public', 'data', 'rooms'),
      where('status', '==', 'waiting'),
      where('isPublic', '==', true),
    );
    const unsub = onSnapshot(q, (snap) => {
      const counts = {};
      snap.forEach((d) => {
        const data = d.data();
        if (!data?.gameId) return;
        counts[data.gameId] = (counts[data.gameId] || 0) + ((data.players || []).length);
      });
      setWaitingCounts(counts);
    }, (err) => { console.error('Bekleyen oyuncu sayısı okunamadı:', err); setWaitingCounts({}); });
    return unsub;
  }, [pickerOpen]);

  const isMatching = !!matchmakingGameId;
  const chooseMatchGame = (gameId) => { setPickerOpen(false); findMatch(gameId); };

  // ---- Bota karşı: zorluk seçimi (yalnızca DIFFICULTY_GAMES) --------------
  const [botPickerGameId, setBotPickerGameId] = useState(null);
  const startBot = (gameId, difficulty) => { setBotPickerGameId(null); startBotGame(gameId, difficulty); };
  const onBotClick = (gameId) => {
    if (DIFFICULTY_GAMES.includes(gameId)) { setBotPickerGameId((cur) => (cur === gameId ? null : gameId)); return; }
    startBotGame(gameId, 'medium');
  };

  return (
    <main className="max-w-5xl mx-auto">
      <div className="flex justify-end mb-4">
        <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700 rounded-full pl-2.5 pr-3.5 py-1.5 shadow-lg backdrop-blur-sm">
          <span
            className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"
            style={{ boxShadow: '0 0 6px 2px rgba(34,197,94,0.65)' }}
          />
          <span className="text-xs sm:text-sm font-medium text-slate-300">
            Aktif Oyuncu: <span className="font-bold text-white tabular-nums">{activeUsers === null ? (presenceError ? '—' : '…') : activeUsers}</span>
          </span>
        </div>
      </div>

      <div className="bg-slate-800 p-6 rounded-xl mb-6 shadow-lg border border-slate-700 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div><h2 className="text-xl font-semibold mb-1">Oyuncu İsmin</h2><p className="text-sm text-slate-400">Oyunlarda bu isimle görüneceksin.</p></div>
        <input type="text" placeholder="İsmini yaz..." value={nickname} onChange={(e) => { setNickname(e.target.value); try { localStorage.setItem('nickname', e.target.value); } catch { /* depolama engelliyse yok say */ } }} className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-center w-full md:w-64 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" maxLength={15} />
      </div>

      <div className="bg-slate-800 p-6 rounded-xl mb-6 shadow-xl border border-slate-700 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div><h2 className="text-xl font-semibold mb-1">Davet Kodun Var Mı?</h2><p className="text-sm text-slate-400">Arkadaşının gönderdiği 6 haneli kodu gir ve masaya otur.</p></div>
        <div className="flex w-full md:w-auto gap-2">
          {/* NOT: Değer JS ile .toUpperCase()'e ZORLANMAZ — bazı Android
              klavyelerinde (küçük harfle yazıp arada rakam girince) controlled
              input'un değeri her tuşta büyük harfe dönüştürülmesi klavyenin
              kendi otomatik-düzeltme/tahmin motorunu şaşırtıp TÜM alanı
              siliyordu. Büyük harf görünümü sadece CSS `uppercase` ile
              sağlanır; gerçek normalize işlemi (trim + toUpperCase) zaten
              `joinRoom` içinde odaya katılırken yapılıyor. */}
          <input type="text" placeholder="Örn: AB12CD" value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value)} className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 uppercase tracking-widest text-center w-full md:w-40 focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono" maxLength={6} />
          <button onClick={() => joinRoom(joinCodeInput)} className="bg-indigo-500 hover:bg-indigo-600 px-6 py-2 rounded-lg font-medium transition-colors">Katıl</button>
        </div>
      </div>

      {/* HIZLI EŞLEŞME — "Davet Kodun Var Mı?" ile AYNI şablon. Oyun kartlarının
          içindeki eski "Hızlı Eşleş" butonları kaldırıldı; artık tek bir giriş
          noktası var ve oyun seçimi ayrı bir ekranda yapılıyor. */}
      <div className="bg-slate-800 p-6 rounded-xl mb-8 shadow-xl border border-fuchsia-500/30 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold mb-1 flex items-center gap-2"><Zap className="w-5 h-5 text-fuchsia-400" /> Hızlı Eşleş</h2>
          <p className="text-sm text-slate-400">Arkadaşın yoksa dert değil — rastgele bir rakiple hemen oyna.</p>
        </div>
        <button
          onClick={() => setPickerOpen(true)}
          disabled={isCreatingRoom || isMatching}
          className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-bold transition-all border border-transparent bg-gradient-to-r from-fuchsia-600 to-indigo-600 text-white shadow-[0_0_18px_rgba(217,70,239,0.35)] hover:shadow-[0_0_24px_rgba(217,70,239,0.55)] hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0 disabled:cursor-not-allowed"
        >
          {isMatching ? (<><Loader2 className="w-4 h-4 animate-spin" /> Rakip Aranıyor...</>) : (<><Zap className="w-4 h-4" /> Rakip Bul</>)}
        </button>
      </div>

      {/* Oyun seçim ekranı — her oyunun altında o an kaç kişinin hızlı eşleşme
          için beklediği görünür. */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-[3000] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-5 sm:p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-1">
              <h3 className="text-lg sm:text-xl font-bold text-slate-100 flex items-center gap-2"><Zap className="w-5 h-5 text-fuchsia-400" /> Hangi oyunda eşleşelim?</h3>
              <button onClick={() => setPickerOpen(false)} className="text-slate-400 hover:text-white transition-colors shrink-0" title="Kapat"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-slate-400 mb-5">Bir oyun seç; seni bekleyen bir masaya oturtalım. Kimse yoksa senin için masa açılır.</p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {GAMES.filter((g) => g.available).map((game) => {
                const waiting = waitingCounts[game.id] || 0;
                return (
                  <button
                    key={game.id}
                    onClick={() => chooseMatchGame(game.id)}
                    className="flex flex-col items-center text-center gap-1.5 p-4 rounded-xl border-2 border-slate-600 bg-slate-900/60 hover:border-fuchsia-400 hover:bg-slate-900 hover:-translate-y-0.5 transition-all"
                  >
                    <span className="text-4xl drop-shadow-md">{game.icon}</span>
                    <span className="text-sm font-bold text-slate-100 leading-tight">{game.name}</span>
                    <span className={`text-[11px] font-medium mt-0.5 px-2 py-0.5 rounded-full border ${waiting > 0 ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-slate-500 border-slate-700 bg-slate-800/60'}`}>
                      {waiting > 0 ? `${waiting} kişi bekliyor` : 'Bekleyen yok'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2"><Users className="w-6 h-6 text-slate-400" /> Oda Kur & Oyun Seç</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {GAMES.map(game => {
          const isPremium = game.available && (game.id === 'xox' || game.id === 'tavla' || game.id === 'satranc' || game.id === 'dama' || game.id === 'okey101' || game.id === 'connect4' || game.id === 'amiralbatti');
          const isBotSupported = BOT_SUPPORTED_GAMES.includes(game.id);
          return (
            <div key={game.id} className={`p-6 rounded-xl border-2 flex flex-col transition-all duration-300 relative overflow-hidden
                ${!game.available ? 'bg-slate-800/60 border-slate-700 opacity-70 grayscale' : ''}
                ${isPremium && game.id !== 'dama' && game.id !== 'connect4' ? 'bg-slate-800 border-indigo-500/40 hover:border-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.15)] cursor-pointer hover:-translate-y-1' : ''}
                ${game.id === 'dama' ? 'bg-slate-900 border-slate-700 hover:border-slate-400 shadow-[0_0_20px_rgba(255,255,255,0.07)] cursor-pointer hover:-translate-y-1' : ''}
                ${game.id === 'connect4' ? 'bg-slate-900 border-blue-600/40 hover:border-blue-400 shadow-[0_0_20px_rgba(37,99,235,0.15)] cursor-pointer hover:-translate-y-1' : ''}
                ${game.id === 'amiralbatti' ? 'bg-slate-900 border-sky-600/40 hover:border-sky-400 shadow-[0_0_20px_rgba(2,132,199,0.15)] cursor-pointer hover:-translate-y-1' : ''}
                ${game.available && !isPremium ? 'bg-slate-800 border-slate-600 hover:border-indigo-400 hover:bg-slate-700 cursor-pointer' : ''}`}>

              {game.id === 'xox' && ( <><div className="absolute -top-10 -left-10 w-32 h-32 bg-indigo-500/20 blur-[40px] rounded-full pointer-events-none"></div><div className="absolute -bottom-10 -right-10 w-32 h-32 bg-purple-500/20 blur-[40px] rounded-full pointer-events-none"></div></> )}
              {game.id === 'tavla' && ( <><div className="absolute -top-10 -left-10 w-32 h-32 bg-amber-600/20 blur-[40px] rounded-full pointer-events-none"></div><div className="absolute -bottom-10 -right-10 w-32 h-32 bg-orange-700/20 blur-[40px] rounded-full pointer-events-none"></div></> )}
              {game.id === 'satranc' && ( <><div className="absolute -top-10 -left-10 w-32 h-32 bg-emerald-500/20 blur-[40px] rounded-full pointer-events-none"></div><div className="absolute -bottom-10 -right-10 w-32 h-32 bg-teal-500/20 blur-[40px] rounded-full pointer-events-none"></div></> )}
              {game.id === 'dama' && ( <><div className="absolute -top-10 -left-10 w-32 h-32 bg-white/10 blur-[40px] rounded-full pointer-events-none"></div><div className="absolute -bottom-10 -right-10 w-32 h-32 bg-slate-400/10 blur-[40px] rounded-full pointer-events-none"></div></> )}
              {game.id === 'okey101' && ( <><div className="absolute -top-10 -left-10 w-32 h-32 bg-rose-500/20 blur-[40px] rounded-full pointer-events-none"></div><div className="absolute -bottom-10 -right-10 w-32 h-32 bg-cyan-500/20 blur-[40px] rounded-full pointer-events-none"></div></> )}
              {game.id === 'connect4' && ( <><div className="absolute -top-10 -left-10 w-32 h-32 bg-red-500/20 blur-[40px] rounded-full pointer-events-none"></div><div className="absolute -bottom-10 -right-10 w-32 h-32 bg-blue-500/20 blur-[40px] rounded-full pointer-events-none"></div></> )}
              {game.id === 'amiralbatti' && ( <><div className="absolute -top-10 -left-10 w-32 h-32 bg-sky-500/20 blur-[40px] rounded-full pointer-events-none"></div><div className="absolute -bottom-10 -right-10 w-32 h-32 bg-slate-500/20 blur-[40px] rounded-full pointer-events-none"></div></> )}

              <div className="flex-grow flex flex-col items-center justify-center text-center py-4 relative z-10">
                <div className="text-6xl mb-3 drop-shadow-md">{game.icon}</div>
                <h3 className="text-2xl font-bold">{game.name}</h3>
              </div>
              {game.available ? (
                game.id === 'okey101' ? (
                  <div className="relative z-10">
                    <button disabled={isCreatingRoom} onClick={() => createRoom(game.id)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg font-bold text-sm transition-colors border bg-rose-600/20 text-rose-300 border-rose-500/50 hover:bg-rose-600 hover:text-white">
                      <UserPlus className="w-4 h-4" /> Özel Oda Kur
                    </button>
                  </div>
                ) : (
                  <div className="relative z-10 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <button disabled={isCreatingRoom} onClick={() => createRoom(game.id)} className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg font-bold text-sm transition-colors border
                          ${game.id === 'xox' ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50 hover:bg-indigo-600 hover:text-white' : ''}
                          ${game.id === 'tavla' ? 'bg-amber-600/20 text-amber-300 border-amber-600/50 hover:bg-amber-600 hover:text-white' : ''}
                          ${game.id === 'satranc' ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/50 hover:bg-emerald-600 hover:text-white' : ''}
                          ${game.id === 'dama' ? 'bg-slate-800 text-slate-300 border-slate-600 hover:bg-black hover:text-white hover:border-slate-500' : ''}
                          ${game.id === 'connect4' ? 'bg-blue-600/20 text-blue-300 border-blue-500/50 hover:bg-blue-600 hover:text-white' : ''}
                          ${game.id === 'amiralbatti' ? 'bg-sky-600/20 text-sky-300 border-sky-500/50 hover:bg-sky-600 hover:text-white' : ''}
                        `}><UserPlus className="w-4 h-4" /> Arkadaşla Oyna</button>
                      <button
                        disabled={!isBotSupported}
                        title={!isBotSupported ? 'Yakında' : undefined}
                        onClick={() => onBotClick(game.id)}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg font-bold text-sm transition-colors border ${isBotSupported ? 'bg-slate-900/60 text-slate-200 border-slate-600 hover:bg-slate-700 hover:border-indigo-400' : 'bg-slate-800/40 text-slate-500 border-slate-700 cursor-not-allowed'} ${botPickerGameId === game.id ? 'border-indigo-400 bg-slate-700' : ''}`}
                      ><Bot className="w-4 h-4" /> Botla Oyna</button>
                    </div>

                    {/* Zorluk seçimi (şu an sadece Connect 4): "Botla Oyna"ya
                        basınca açılır, seviye seçilince oyun başlar. */}
                    {botPickerGameId === game.id && (
                      <div className="flex gap-2">
                        {DIFFICULTY_OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            onClick={() => startBot(game.id, o.value)}
                            className="flex-1 py-2 rounded-lg text-xs font-bold border border-slate-600 bg-slate-900/80 text-slate-200 hover:border-indigo-400 hover:bg-indigo-600 hover:text-white transition-colors"
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              ) : ( <button disabled className="w-full relative z-10 bg-slate-700 text-slate-400 py-2.5 rounded-lg font-medium cursor-not-allowed">Çok Yakında</button> )}
            </div>
          )
        })}
      </div>
    </main>
  );
}
