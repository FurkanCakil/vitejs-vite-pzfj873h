import React, { useEffect, useState } from 'react';
import { doc, updateDoc, runTransaction } from 'firebase/firestore';
import { Users } from 'lucide-react';
import RulesPanel from './RulesPanel.jsx';
import TeamSelection from './TeamSelection.jsx';
import PlayerList from './PlayerList.jsx';
import { createBotPlayers, isBotUid } from './botPlayers.js';

export const MAX_PLAYERS = 4;
const COUNTDOWN_MS = 3000;

const DEFAULT_RULES = { gameType: 'ffa', foldingEnabled: false, foldToPartnerEnabled: false, botDifficulty: 'medium' };

export default function Okey101Lobby({ roomData, roomCode, user, db, appId, leaveRoom }) {
  const isHost = roomData.host === user.uid;
  const rules = roomData.rules || DEFAULT_RULES;
  const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);

  const players = (roomData.players || []).map((uid) => ({
    uid,
    name: roomData.playerNames?.[uid] || (isBotUid(uid) ? 'Bot' : 'Oyuncu'),
    isBot: !!roomData.isBotPlayer?.[uid] || isBotUid(uid),
  }));
  const emptySeats = Math.max(0, MAX_PLAYERS - players.length);

  // ---- Kural güncelleme (sadece host) ----
  const updateRule = async (key, value) => {
    if (!isHost) return;
    const nextRules = { ...rules, [key]: value };
    // Bağımlı kural: 2v2 + katlamalı değilse "eşe katlama" anlamsızlaşır, otomatik kapat.
    if (key === 'gameType' && value !== '2v2') nextRules.foldToPartnerEnabled = false;
    if (key === 'foldingEnabled' && !value) nextRules.foldToPartnerEnabled = false;
    await updateDoc(roomRef, { rules: nextRules }).catch((err) => console.error("Okey101 yazma hatası:", err));
  };

  // ---- Takım yönetimi (kendisi ya da host) ----
  const handleJoinTeam = async (targetUid, team) => {
    if (!(isHost || targetUid === user.uid)) return;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const nextTeams = { A: (data.teams?.A || []).filter((u) => u !== targetUid), B: (data.teams?.B || []).filter((u) => u !== targetUid) };
      nextTeams[team].push(targetUid);
      t.update(roomRef, { teams: nextTeams });
    }).catch((err) => console.error("Okey101 yazma hatası:", err));
  };

  const handleLeaveTeam = async (targetUid) => {
    if (!(isHost || targetUid === user.uid)) return;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const nextTeams = { A: (data.teams?.A || []).filter((u) => u !== targetUid), B: (data.teams?.B || []).filter((u) => u !== targetUid) };
      t.update(roomRef, { teams: nextTeams });
    }).catch((err) => console.error("Okey101 yazma hatası:", err));
  };

  const handleRandomDistribute = async () => {
    if (!isHost) return;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const nextTeams = { A: [...(data.teams?.A || [])], B: [...(data.teams?.B || [])] };
      const assigned = new Set([...nextTeams.A, ...nextTeams.B]);
      const pool = (data.players || []).filter((u) => !assigned.has(u));
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[pool[i], pool[j]] = [pool[j], pool[i]]; }
      for (const uid of pool) { (nextTeams.A.length <= nextTeams.B.length ? nextTeams.A : nextTeams.B).push(uid); }
      t.update(roomRef, { teams: nextTeams });
    }).catch((err) => console.error("Okey101 yazma hatası:", err));
  };

  // ---- Botlarla doldurma (sadece host): boş koltukları botlarla doldurur,
  // Eşli modda kalan (bot/insan fark etmeksizin) atanmamış oyuncuları otomatik
  // takımlara dağıtır ve oyunu (geri sayım beklemeden) doğrudan başlatır.
  const handleFillWithBots = async () => {
    if (!isHost) return;
    await runTransaction(db, async (t) => {
      const snap = await t.get(roomRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const currentPlayers = data.players || [];
      const missing = MAX_PLAYERS - currentPlayers.length;
      if (missing <= 0) return;

      const bots = createBotPlayers(missing, currentPlayers.length, data.rules?.botDifficulty || 'medium');
      const newNames = { ...data.playerNames }; const newIsBot = { ...(data.isBotPlayer || {}) }; const newScores = { ...data.scores };
      bots.forEach((b) => { newNames[b.uid] = b.name; newIsBot[b.uid] = true; newScores[b.uid] = 0; });
      const allPlayers = [...currentPlayers, ...bots.map((b) => b.uid)];

      const update = {
        players: allPlayers,
        playerNames: newNames, isBotPlayer: newIsBot, scores: newScores,
        countdownStartedAt: null,
        status: 'playing',
      };

      if (data.rules?.gameType === '2v2') {
        const nextTeams = { A: [...(data.teams?.A || [])], B: [...(data.teams?.B || [])] };
        const assigned = new Set([...nextTeams.A, ...nextTeams.B]);
        const pool = allPlayers.filter((u) => !assigned.has(u));
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[pool[i], pool[j]] = [pool[j], pool[i]]; }
        for (const uid of pool) { (nextTeams.A.length <= nextTeams.B.length ? nextTeams.A : nextTeams.B).push(uid); }
        update.teams = nextTeams;
      }

      t.update(roomRef, update);
    }).catch((err) => console.error("Okey101 yazma hatası:", err));
  };

  // ---- Geri sayım: 4 koltuk dolunca başlat, altına düşünce iptal et (sadece host yazar) ----
  useEffect(() => {
    if (!isHost || roomData.status !== 'waiting') return;
    const total = roomData.players?.length || 0;
    if (total >= MAX_PLAYERS && !roomData.countdownStartedAt) {
      updateDoc(roomRef, { countdownStartedAt: Date.now() }).catch((err) => console.error("Okey101 yazma hatası:", err));
    } else if (total < MAX_PLAYERS && roomData.countdownStartedAt) {
      updateDoc(roomRef, { countdownStartedAt: null }).catch((err) => console.error("Okey101 yazma hatası:", err));
    }
  }, [isHost, roomData.status, roomData.players?.length, roomData.countdownStartedAt]);

  // ---- Geri sayım süresi dolunca oyunu başlat (sadece host yazar) ----
  useEffect(() => {
    if (!isHost || !roomData.countdownStartedAt || roomData.status !== 'waiting') return;
    const remaining = COUNTDOWN_MS - (Date.now() - roomData.countdownStartedAt);
    const timer = setTimeout(() => {
      if ((roomData.players?.length || 0) >= MAX_PLAYERS) {
        updateDoc(roomRef, { status: 'playing' }).catch((err) => console.error("Okey101 yazma hatası:", err));
      }
    }, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [isHost, roomData.countdownStartedAt, roomData.status]);

  // ---- Ekranda gösterilecek geri sayım (tüm istemcilerde ortak countdownStartedAt'tan türetilir) ----
  const [countdownDisplay, setCountdownDisplay] = useState(null);
  useEffect(() => {
    if (!roomData.countdownStartedAt) { setCountdownDisplay(null); return; }
    const tick = () => setCountdownDisplay(Math.max(0, Math.ceil((roomData.countdownStartedAt + COUNTDOWN_MS - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [roomData.countdownStartedAt]);

  return (
    <div className="w-full max-w-3xl flex flex-col gap-4">
      {countdownDisplay !== null && (
        <div className="w-full bg-indigo-600/20 border border-indigo-500/50 rounded-xl p-4 text-center animate-pulse">
          <div className="text-sm text-indigo-300 font-bold uppercase tracking-widest mb-1">Oda Doldu, Başlıyor</div>
          <div className="text-4xl font-black text-white">{countdownDisplay}</div>
        </div>
      )}

      <div className="flex items-center justify-between bg-slate-800 rounded-xl border border-slate-700 px-4 py-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 text-slate-200 font-bold"><Users className="w-4 h-4" /> {players.length}/{MAX_PLAYERS} Oyuncu</div>
        {isHost && (
          <button
            type="button"
            onClick={handleFillWithBots}
            disabled={emptySeats === 0}
            className="text-xs font-bold bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-500/50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Kalanı Botlarla Doldur {emptySeats > 0 ? `(+${emptySeats})` : ''}
          </button>
        )}
      </div>

      <RulesPanel rules={rules} isHost={isHost} onChange={updateRule} />

      {rules.gameType === '2v2' ? (
        <TeamSelection
          players={players}
          teams={roomData.teams || { A: [], B: [] }}
          isHost={isHost}
          myUid={user.uid}
          hostUid={roomData.host}
          onJoinTeam={handleJoinTeam}
          onLeaveTeam={handleLeaveTeam}
          onRandomDistribute={handleRandomDistribute}
        />
      ) : (
        <PlayerList players={players} hostUid={roomData.host} maxPlayers={MAX_PLAYERS} />
      )}
    </div>
  );
}
