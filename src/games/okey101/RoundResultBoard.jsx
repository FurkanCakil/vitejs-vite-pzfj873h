import React from 'react';
import { Trophy, Crown, Bot as BotIcon, User, Layers } from 'lucide-react';

// El (round) bittiğinde gösterilen tur sonucu / puan tablosu. Host'ta "Yeni
// Tura Başla" butonu bulunur. Eşli (2v2) modda takım üyeleri aynı satırda
// gruplanıp ortak puanları gösterilir.
export default function RoundResultBoard({ players, roundResult, scores, rules, teams, openedWithPairs, isHost, onStartNewRound }) {
  if (!roundResult) return null;
  const { winnerUid, wonByOkeyDiscard, wentOutFromHand, foldMultiplier, perPlayer } = roundResult;
  // Kapalı deste bitip el kimse bitiremeden sona erdiyse kazanan YOKTUR.
  const noWinner = !winnerUid;
  const winnerName = players.find((p) => p.uid === winnerUid)?.name || '???';
  const isTeamMode = rules?.gameType === '2v2' && teams;

  const findPlayer = (uid) => players.find((p) => p.uid === uid) || { uid, name: '???', isBot: false };

  const Row = ({ uid }) => {
    const p = findPlayer(uid);
    const pp = perPlayer[uid] || { total: 0 };
    const isWinner = uid === winnerUid;
    return (
      <div className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg ${isWinner ? 'bg-emerald-600/20 ring-1 ring-emerald-500/50' : 'bg-slate-900/60'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${p.isBot ? 'bg-amber-600/30 text-amber-300' : 'bg-indigo-600/30 text-indigo-300'}`}>
            {p.isBot ? <BotIcon className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
          </div>
          <span className="text-sm font-bold text-slate-100 truncate">{p.name}</span>
          {/* Çift ile açan oyuncu, elinde kalan taşların 2 KATI ceza yer. */}
          {openedWithPairs?.[uid] && !isWinner && (
            <span className="shrink-0 text-[9px] font-black text-fuchsia-300 bg-fuchsia-500/15 border border-fuchsia-500/40 px-1.5 py-0.5 rounded-full">ÇİFT ×2</span>
          )}
          {isWinner && <Crown className="w-4 h-4 text-yellow-400 shrink-0" />}
        </div>
        <div className="flex items-center gap-3 text-xs shrink-0">
          {/* Anlık (yandan-alma/açamama gibi tur İÇİ) ceza ile tur sonu
              (bitirme/kalan taş) cezası artık AYRI gösterilmiyor — oyuncuyu
              sadece "bu tur toplamda ne kadar yedi/kazandı" (pp.total) ve
              geçmiş turlarla birlikte kümülatif skor (scores[uid]) ilgilendiriyor. */}
          <span className={`font-mono font-bold ${pp.total > 0 ? 'text-emerald-400' : pp.total < 0 ? 'text-red-400' : 'text-slate-400'}`}>
            Bu Tur: {pp.total > 0 ? '+' : ''}{pp.total}
          </span>
          <span className="font-mono font-black text-white w-14 text-right">{scores?.[uid] ?? 0}</span>
        </div>
      </div>
    );
  };

  // EŞLİ (2v2) modda puan BİREYSEL DEĞİLDİR (kullanıcı isteği): tur içi anlık
  // cezalar da (bkz. gameLogic#addScoreDelta) tur sonu cezaları da doğrudan
  // TAKIM puanına yazılır ve takımın iki üyesi her zaman aynı sayıyı taşır.
  // Bu yüzden tabloda oyuncu başına satır YOKTUR — takım başına TEK satır
  // gösterilir, üyelerin isimleri satırın içinde listelenir.
  const TeamRow = ({ teamKey }) => {
    const teamUids = teams?.[teamKey] || [];
    if (teamUids.length === 0) return null;
    const pp = perPlayer[teamUids[0]] || { total: 0 };
    const teamScore = scores?.[teamUids[0]] ?? 0;
    const isWinnerTeam = teamUids.includes(winnerUid);
    const openedPairs = teamUids.some((uid) => openedWithPairs?.[uid]);
    return (
      <div className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg ${isWinnerTeam ? 'bg-emerald-600/20 ring-1 ring-emerald-500/50' : 'bg-slate-900/60'}`}>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-[11px] font-black uppercase tracking-widest ${teamKey === 'A' ? 'text-blue-400' : 'text-red-400'}`}>Takım {teamKey}</span>
            {isWinnerTeam && <Crown className="w-4 h-4 text-yellow-400 shrink-0" />}
            {openedPairs && !isWinnerTeam && (
              <span className="shrink-0 text-[9px] font-black text-fuchsia-300 bg-fuchsia-500/15 border border-fuchsia-500/40 px-1.5 py-0.5 rounded-full">ÇİFT ×2</span>
            )}
          </div>
          <span className="text-xs text-slate-300 truncate">
            {teamUids.map((uid) => findPlayer(uid).name).join(' & ')}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs shrink-0">
          <span className={`font-mono font-bold ${pp.total > 0 ? 'text-emerald-400' : pp.total < 0 ? 'text-red-400' : 'text-slate-400'}`}>
            Bu Tur: {pp.total > 0 ? '+' : ''}{pp.total}
          </span>
          <span className="font-mono font-black text-white w-14 text-right">{teamScore}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="absolute inset-0 z-[4500] bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4 rounded-[2rem]">
      <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-5 sm:p-6">
        <div className="flex flex-col items-center mb-4 text-center">
          <Trophy className={`w-10 h-10 mb-2 drop-shadow ${noWinner ? 'text-slate-500' : 'text-yellow-400'}`} />
          <h3 className="text-xl font-bold text-white">Tur Sonucu</h3>
          <p className="text-sm text-slate-300 mt-1">
            {noWinner ? (
              <span className="font-bold text-slate-300">Kapalı deste bitti — el kimse bitiremeden sona erdi.</span>
            ) : (
              <>
                <span className="font-bold text-emerald-400">{winnerName}</span> elini bitirdi!
                {wonByOkeyDiscard && <span className="block text-xs text-fuchsia-300 font-bold mt-1">Okey Atarak Bitirdi! (×2 Ceza Bonusu)</span>}
                {wentOutFromHand && <span className="block text-xs text-amber-300 font-bold mt-1">Elden Bitirdi! (×2 Ceza Bonusu)</span>}
              </>
            )}
          </p>
          {foldMultiplier > 1 && (
            <div className="flex items-center gap-1 mt-2 text-xs text-amber-300 font-bold bg-amber-500/10 px-2 py-1 rounded-full">
              <Layers className="w-3.5 h-3.5" /> Katlama ×{foldMultiplier}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {isTeamMode ? (
            <>
              {['A', 'B'].map((teamKey) => <TeamRow key={teamKey} teamKey={teamKey} />)}
              {players.filter((p) => !(teams.A || []).includes(p.uid) && !(teams.B || []).includes(p.uid)).map((p) => <Row key={p.uid} uid={p.uid} />)}
            </>
          ) : (
            players.map((p) => <Row key={p.uid} uid={p.uid} />)
          )}
        </div>

        {isHost ? (
          <button type="button" onClick={onStartNewRound} className="w-full mt-5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl shadow-lg transition-colors">
            Yeni Tura Başla
          </button>
        ) : (
          <p className="text-center text-xs text-slate-500 mt-5">Host'un yeni turu başlatması bekleniyor...</p>
        )}
      </div>
    </div>
  );
}
