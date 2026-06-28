import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';

export default function DisconnectOverlay({ disconnectCountdown, roomData, user, roomCode, db, appId, leaveRoom, setDisconnectCountdown }) {
  return (
    <div className="fixed inset-0 z-[99999] bg-slate-900/95 flex flex-col items-center justify-center backdrop-blur-md p-4 h-[100dvh]">
      <AlertCircle className="w-16 h-16 text-yellow-500 mb-4 animate-pulse" />
      <h2 className="text-2xl font-bold text-center mb-2">{roomData.abandonReason === 'left' ? 'Rakip Odadan Ayrıldı!' : 'Rakibin Bağlantısı Koptu!'}</h2>
      <p className="text-slate-300 text-center mb-8 max-w-md">{roomData.abandonReason === 'left' ? 'Bekle derseniz oda yeni oyunculara açılır. Aksi halde oda kapanmasına:' : 'Rakibiniz oyunu alta almış veya interneti kopmuş olabilir. Otomatik kapanmasına:'}</p>
      <div className="text-5xl font-mono font-bold text-yellow-400 mb-8">{disconnectCountdown}</div>
      <div className="flex flex-col sm:flex-row gap-4">
        <button onClick={async () => {
            setDisconnectCountdown('paused'); const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', roomCode);
            if (roomData.abandonReason === 'left') { const newPlayers = roomData.players.filter(id => id === user.uid); await updateDoc(roomRef, { status: 'waiting', players: newPlayers, abandonedBy: null, abandonReason: null }); } 
            else { await updateDoc(roomRef, { status: 'waiting', abandonedBy: null, abandonReason: null }); }
          }} className="bg-indigo-600 hover:bg-indigo-500 border border-indigo-400 px-6 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Bekle
        </button>
        <button onClick={leaveRoom} className="bg-slate-800 hover:bg-slate-700 border border-slate-600 px-6 py-3 rounded-lg font-medium transition-colors">Hemen Lobiye Dön</button>
      </div>
    </div>
  );
}