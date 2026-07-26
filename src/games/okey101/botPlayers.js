// NOT: Bu dosya yalnızca oda/lobi altyapısı için "sahte oyuncu" (bot koltuğu)
// üretir. Botların 101 Okey oynama mantığı (taş çekme/atma/per hesaplama vb.)
// bilinçli olarak kapsam dışıdır ve burada YOKTUR.

export const OKEY_BOT_PREFIX = 'OKEY_BOT_';

const BOT_DISPLAY_NAMES = ['Ayşe', 'Mehmet', 'Zeynep', 'Ali', 'Fatma', 'Can', 'Elif', 'Burak'];

export const BOT_DIFFICULTY_LABELS = { easy: 'Kolay', medium: 'Orta', hard: 'Zor' };

export function isBotUid(uid) {
  return typeof uid === 'string' && uid.startsWith(OKEY_BOT_PREFIX);
}

// `count` adet, `startIndex`'ten devam eden benzersiz bot koltuğu üretir.
export function createBotPlayers(count, startIndex, difficulty) {
  const label = BOT_DIFFICULTY_LABELS[difficulty] || difficulty;
  const bots = [];
  for (let i = 0; i < count; i++) {
    const idx = startIndex + i;
    const uid = `${OKEY_BOT_PREFIX}${idx}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const name = `Bot ${BOT_DISPLAY_NAMES[idx % BOT_DISPLAY_NAMES.length]} (${label})`;
    bots.push({ uid, name });
  }
  return bots;
}
