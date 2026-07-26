import React from 'react';
import { Shuffle, LogOut, Bot as BotIcon, Crown, User } from 'lucide-react';

// Eşli (2v2) modda gösterilen takım seçim ekranı: Bekleyenler / Takım A / Takım B.
export default function TeamSelection({ players, teams, isHost, myUid, hostUid, onJoinTeam, onLeaveTeam, onRandomDistribute }) {
  const teamAUids = teams?.A || [];
  const teamBUids = teams?.B || [];
  const assigned = new Set([...teamAUids, ...teamBUids]);
  const unassigned = players.filter((p) => !assigned.has(p.uid));
  const findPlayer = (uid) => players.find((p) => p.uid === uid) || { uid, name: '???', isBot: false };

  // Bir oyuncunun takım durumunu değiştirme yetkisi: kendisi ya da host (botlar kendi
  // adına tıklayamayacağı için host'un onlar adına yönetebilmesi gerekiyor).
  const canManage = (uid) => isHost || uid === myUid;

  const Row = ({ p, inTeam }) => (
    <div className="flex items-center justify-between gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${p.isBot ? 'bg-amber-600/30 text-amber-300' : 'bg-indigo-600/30 text-indigo-300'}`}>
          {p.isBot ? <BotIcon className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
        </div>
        <span className="text-sm font-medium text-slate-200 truncate">{p.name}</span>
        {p.uid === hostUid && <Crown className="w-3.5 h-3.5 text-yellow-400 shrink-0" />}
      </div>
      {canManage(p.uid) && (
        inTeam ? (
          <button type="button" onClick={() => onLeaveTeam(p.uid)} title="Takımdan Ayrıl" className="text-slate-400 hover:text-red-400 transition-colors shrink-0">
            <LogOut className="w-4 h-4" />
          </button>
        ) : (
          <div className="flex gap-1 shrink-0">
            <button type="button" onClick={() => onJoinTeam(p.uid, 'A')} className="text-[10px] font-bold bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-500/50 px-2 py-1 rounded transition-colors">A'ya Katıl</button>
            <button type="button" onClick={() => onJoinTeam(p.uid, 'B')} className="text-[10px] font-bold bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/50 px-2 py-1 rounded transition-colors">B'ye Katıl</button>
          </div>
        )
      )}
    </div>
  );

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 md:p-5 w-full">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="text-lg font-bold text-slate-100">Takım Seçimi</h3>
        {isHost && (
          <button type="button" onClick={onRandomDistribute} className="flex items-center gap-1.5 text-xs font-bold bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/50 px-3 py-1.5 rounded-lg transition-colors">
            <Shuffle className="w-3.5 h-3.5" /> Rastgele Dağıt
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Bekleyenler ({unassigned.length})</div>
          <div className="flex flex-col gap-2 min-h-[60px]">
            {unassigned.map((p) => <Row key={p.uid} p={p} inTeam={false} />)}
            {unassigned.length === 0 && <div className="text-xs text-slate-600 italic px-1">Herkes bir takımda.</div>}
          </div>
        </div>
        <div>
          <div className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2">Takım A ({teamAUids.length})</div>
          <div className="flex flex-col gap-2 min-h-[60px]">
            {teamAUids.map((uid) => <Row key={uid} p={findPlayer(uid)} inTeam={true} />)}
          </div>
        </div>
        <div>
          <div className="text-xs font-bold text-red-400 uppercase tracking-widest mb-2">Takım B ({teamBUids.length})</div>
          <div className="flex flex-col gap-2 min-h-[60px]">
            {teamBUids.map((uid) => <Row key={uid} p={findPlayer(uid)} inTeam={true} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
