import React, { useState } from 'react';
import { Users, Bot, UserPlus, ArrowLeft } from 'lucide-react';

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

// Amiral Battı ZORLUK SEVİYESİ SUNMAZ (oyun tamamen şansa dayalı) — tek,
// standart bir bot. Bu yüzden diğer oyunlardaki gibi bir "Kolay/Orta/Zor"
// seçim ekranı GÖSTERİLMEZ, "Botla Oyna" butonu doğrudan oyunu başlatır.
const NO_DIFFICULTY_BOT_GAMES = ['amiralbatti'];

const DIFFICULTIES = [
  { id: 'easy', label: 'Kolay' },
  { id: 'medium', label: 'Orta' },
  { id: 'hard', label: 'Zor' },
];

export default function Lobby({ isCreatingRoom, nickname, setNickname, joinCodeInput, setJoinCodeInput, joinRoom, createRoom, startBotGame }) {
  const [botSelectGameId, setBotSelectGameId] = useState(null);

  return (
    <main className="max-w-5xl mx-auto">
      <div className="bg-slate-800 p-6 rounded-xl mb-6 shadow-lg border border-slate-700 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div><h2 className="text-xl font-semibold mb-1">Oyuncu İsmin</h2><p className="text-sm text-slate-400">Oyunlarda bu isimle görüneceksin.</p></div>
        <input type="text" placeholder="İsmini yaz..." value={nickname} onChange={(e) => { setNickname(e.target.value); try { localStorage.setItem('nickname', e.target.value); } catch { /* depolama engelliyse yok say */ } }} className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-center w-full md:w-64 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" maxLength={15} />
      </div>
      <div className="bg-slate-800 p-6 rounded-xl mb-8 shadow-xl border border-slate-700 flex flex-col md:flex-row gap-4 items-center justify-between">
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
      <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2"><Users className="w-6 h-6 text-slate-400" /> Oda Kur & Oyun Seç</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {GAMES.map(game => {
          const isPremium = game.available && (game.id === 'xox' || game.id === 'tavla' || game.id === 'satranc' || game.id === 'dama' || game.id === 'okey101' || game.id === 'connect4' || game.id === 'amiralbatti');
          const isBotSupported = BOT_SUPPORTED_GAMES.includes(game.id);
          const showingBotSelect = botSelectGameId === game.id;
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
                showingBotSelect ? (
                  <div className="relative z-10 flex flex-col gap-2">
                    <button onClick={() => setBotSelectGameId(null)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white mb-1 transition-colors">
                      <ArrowLeft className="w-3.5 h-3.5" /> Geri
                    </button>
                    {DIFFICULTIES.map(d => (
                      <button key={d.id} onClick={() => startBotGame(game.id, d.id)} className="w-full text-center font-bold text-base bg-slate-900/60 hover:bg-indigo-600/40 border border-slate-600 hover:border-indigo-400 rounded-lg px-3 py-3 transition-colors">
                        {d.label}
                      </button>
                    ))}
                  </div>
                ) : game.id === 'okey101' ? (
                  <div className="relative z-10">
                    <button disabled={isCreatingRoom} onClick={() => createRoom(game.id)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg font-bold text-sm transition-colors border bg-rose-600/20 text-rose-300 border-rose-500/50 hover:bg-rose-600 hover:text-white">
                      <UserPlus className="w-4 h-4" /> Özel Oda Kur
                    </button>
                  </div>
                ) : (
                  <div className="relative z-10 flex gap-2">
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
                      onClick={() => (NO_DIFFICULTY_BOT_GAMES.includes(game.id) ? startBotGame(game.id, null) : setBotSelectGameId(game.id))}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg font-bold text-sm transition-colors border ${isBotSupported ? 'bg-slate-900/60 text-slate-200 border-slate-600 hover:bg-slate-700 hover:border-indigo-400' : 'bg-slate-800/40 text-slate-500 border-slate-700 cursor-not-allowed'}`}
                    ><Bot className="w-4 h-4" /> Botla Oyna</button>
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
