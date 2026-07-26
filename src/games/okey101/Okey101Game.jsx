import React, { useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import Okey101Lobby from './Okey101Lobby.jsx';
import PlayerRack from './PlayerRack.jsx';
import OpponentStrip from './OpponentStrip.jsx';
import SetupCountdown from './SetupCountdown.jsx';
import { TileBack } from './Tile.jsx';
import { dealTiles, SETUP_DURATION_MS } from './tiles.js';
import { isBotUid } from './botPlayers.js';

// 2. Faz: masa/taş/ıstaka altyapısı. Çekme/atma gibi tur mantığı bilinçli
// olarak burada YOKTUR — sadece dağıtım, 15sn hazırlık fazı ve per (grup)
// mekaniği kurulu.
export default function Okey101Game({ roomData, roomCode, user, db, appId, leaveRoom }) {
  const isHost = roomData.host === user.uid;
  const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);

  // Oyun 'playing' fazına yeni geçtiyse (henüz taş dağıtılmamışsa) host taşları dağıtır
  // ve 15 saniyelik hazırlık fazını başlatır.
  useEffect(() => {
    if (roomData.status !== 'playing' || roomData.racks || !isHost) return;
    const players = roomData.players || [];
    const { racks, drawPile } = dealTiles(players);
    const groups = {}; players.forEach((uid) => { groups[uid] = {}; });
    updateDoc(roomRef, { racks, drawPile, groups, setupPhase: true, setupEndsAt: Date.now() + SETUP_DURATION_MS })
      .catch((err) => console.error('Okey101 taş dağıtım hatası:', err));
  }, [roomData.status, roomData.racks, isHost]);

  // Hazırlık süresi dolunca host normal faza geçirir (henüz yeni bir hak açmıyor,
  // sadece bayrağı kapatıyor — çekme/atma bir sonraki aşamada eklenecek).
  useEffect(() => {
    if (!isHost || !roomData.setupPhase || !roomData.setupEndsAt) return;
    const remaining = roomData.setupEndsAt - Date.now();
    const timer = setTimeout(() => {
      updateDoc(roomRef, { setupPhase: false }).catch((err) => console.error('Okey101 faz geçiş hatası:', err));
    }, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [isHost, roomData.setupPhase, roomData.setupEndsAt]);

  if (roomData.status !== 'playing') {
    return <Okey101Lobby roomData={roomData} roomCode={roomCode} user={user} db={db} appId={appId} leaveRoom={leaveRoom} />;
  }

  if (!roomData.racks) {
    return (
      <div className="w-full max-w-3xl flex flex-col items-center gap-4 bg-slate-800 rounded-2xl border border-slate-700 p-8 text-center">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-400" />
        <h2 className="text-xl font-bold text-white">Taşlar Dağıtılıyor...</h2>
      </div>
    );
  }

  const players = (roomData.players || []).map((uid) => ({
    uid,
    name: roomData.playerNames?.[uid] || (isBotUid(uid) ? 'Bot' : 'Oyuncu'),
    isBot: !!roomData.isBotPlayer?.[uid] || isBotUid(uid),
  }));
  const myRack = roomData.racks?.[user.uid] || null;
  const myGroups = roomData.groups?.[user.uid] || {};
  const isPlayer = (roomData.players || []).includes(user.uid);

  const handleUpdateRack = (newRack, newGroups) => {
    updateDoc(roomRef, { [`racks.${user.uid}`]: newRack, [`groups.${user.uid}`]: newGroups })
      .catch((err) => console.error('Okey101 ıstaka güncelleme hatası:', err));
  };

  return (
    <div className="w-full max-w-4xl flex flex-col items-center gap-3">
      <SetupCountdown setupEndsAt={roomData.setupPhase ? roomData.setupEndsAt : null} />

      <OpponentStrip players={players} racks={roomData.racks} hostUid={roomData.host} myUid={user.uid} />

      <div className="flex items-center gap-2 bg-slate-900/70 border border-slate-700 rounded-lg px-4 py-2">
        <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Çekilecek Taşlar</span>
        <TileBack size="small" />
        <span className="text-sm font-mono font-bold text-slate-200">{roomData.drawPile?.length ?? 0}</span>
      </div>

      <div className="w-full bg-gradient-to-b from-emerald-900/40 to-emerald-950/60 border border-emerald-800/50 rounded-2xl p-3 sm:p-4">
        {isPlayer ? (
          <PlayerRack rack={myRack} groups={myGroups} isOwner={true} onUpdateRack={handleUpdateRack} />
        ) : (
          <div className="text-center text-slate-400 text-sm py-6">Bu odada oyuncu değilsin, ıstaka görüntülenemiyor.</div>
        )}
      </div>

      <button onClick={leaveRoom} className="text-xs text-red-400 hover:text-red-300 border border-red-500/40 hover:bg-red-500/10 px-4 py-2 rounded-lg font-medium transition-colors">Odadan Çık</button>
    </div>
  );
}
