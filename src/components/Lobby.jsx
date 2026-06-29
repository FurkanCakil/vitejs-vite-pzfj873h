import React from 'react';
import { Users } from 'lucide-react';

const GAMES = [
  { id: 'xox', name: 'XOX (Tic-Tac-Toe)', desc: 'Klasik 3x3 strateji oyunu.', available: true, icon: '❌⭕' },
  { id: 'tavla', name: 'Tavla', desc: 'Zar at, pulları topla.', available: true, icon: '🎲' },
  { id: 'satranc', name: 'Satranç', desc: 'Şah mat zamanı.', available: true, icon: '♟️' },
  { id: 'dama', name: 'Dama', desc: 'Çapraz zıpla, şah ol.', available: true, icon: '⚪⚫' },
  { id: 'okey101', name: '101 Okey', desc: 'Katlamalı, ceza puanlı.', available: false, icon: '🀄' },
];

export default function Lobby({ isCreatingRoom, nickname, setNickname, joinCodeInput, setJoinCodeInput, joinRoom, createRoom }) {
  return (
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
          const isPremium = game.available && (game.id === 'xox' || game.id === 'tavla' || game.id === 'satranc' || game.id === 'dama');
          return (
            <div key={game.id} className={`p-6 rounded-xl border-2 flex flex-col transition-all duration-300 relative overflow-hidden
                ${!game.available ? 'bg-slate-800/60 border-slate-700 opacity-70 grayscale' : ''}
                ${isPremium && game.id !== 'dama' ? 'bg-slate-800 border-indigo-500/40 hover:border-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.15)] cursor-pointer hover:-translate-y-1' : ''}
                ${game.id === 'dama' ? 'bg-slate-900 border-slate-700 hover:border-slate-400 shadow-[0_0_20px_rgba(255,255,255,0.07)] cursor-pointer hover:-translate-y-1' : ''}
                ${game.available && !isPremium ? 'bg-slate-800 border-slate-600 hover:border-indigo-400 hover:bg-slate-700 cursor-pointer' : ''}`}>
              
              {game.id === 'xox' && ( <><div className="absolute -top-10 -left-10 w-32 h-32 bg-indigo-500/20 blur-[40px] rounded-full pointer-events-none"></div><div className="absolute -bottom-10 -right-10 w-32 h-32 bg-purple-500/20 blur-[40px] rounded-full pointer-events-none"></div></> )}
              {game.id === 'tavla' && ( <><div className="absolute -top-10 -left-10 w-32 h-32 bg-amber-600/20 blur-[40px] rounded-full pointer-events-none"></div><div className="absolute -bottom-10 -right-10 w-32 h-32 bg-orange-700/20 blur-[40px] rounded-full pointer-events-none"></div></> )}
              {game.id === 'satranc' && ( <><div className="absolute -top-10 -left-10 w-32 h-32 bg-emerald-500/20 blur-[40px] rounded-full pointer-events-none"></div><div className="absolute -bottom-10 -right-10 w-32 h-32 bg-teal-500/20 blur-[40px] rounded-full pointer-events-none"></div></> )}
              {game.id === 'dama' && ( <><div className="absolute -top-10 -left-10 w-32 h-32 bg-white/10 blur-[40px] rounded-full pointer-events-none"></div><div className="absolute -bottom-10 -right-10 w-32 h-32 bg-slate-400/10 blur-[40px] rounded-full pointer-events-none"></div></> )}
              
              <div className="text-4xl mb-4 relative z-10 drop-shadow-md">{game.icon}</div><h3 className="text-xl font-bold mb-2 relative z-10">{game.name}</h3><p className="text-sm text-slate-400 flex-grow mb-6 relative z-10">{game.desc}</p>
              {game.available ? (
                <button disabled={isCreatingRoom} onClick={() => createRoom(game.id)} className={`w-full relative z-10 py-2.5 rounded-lg font-bold transition-colors border
                    ${game.id === 'xox' ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50 hover:bg-indigo-600 hover:text-white' : ''}
                    ${game.id === 'tavla' ? 'bg-amber-600/20 text-amber-300 border-amber-600/50 hover:bg-amber-600 hover:text-white' : ''}
                    ${game.id === 'satranc' ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/50 hover:bg-emerald-600 hover:text-white' : ''}
                    ${game.id === 'dama' ? 'bg-slate-800 text-slate-300 border-slate-600 hover:bg-black hover:text-white hover:border-slate-500' : ''}
                  `}>Oda Kur</button>
              ) : ( <button disabled className="w-full relative z-10 bg-slate-700 text-slate-400 py-2.5 rounded-lg font-medium cursor-not-allowed">Çok Yakında</button> )}
            </div>
          )
        })}
      </div>
    </main>
  );
}