// BİR MAÇIN TAM DURUMUNU arşivleme / geri yükleme / sıfırlama.
//
// NEDEN: Skorları oyuncu kimliğine bağlamak tek başına yetmedi. Kullanıcı
// raporu: "A ile B XOX oynarken B ilk hamlesini yapıp çıktı; sonra C girince
// oyun sıfırdan başlaması gerekirken B'nin hamlesiyle DOLU tahtadan başladı."
// Yani sıfırlanması/taşınması gereken şey yalnızca `scores` değil, MAÇA AİT
// HER ŞEY (tahta, sıra, renkler, kazanan, okey ıstakaları, gemiler...).
//
// TASARIM: Hangi alanların "maç" olduğunu oyun oyun saymak (beyaz liste) çok
// kırılgan — tek başına 101 Okey'in ~20 durum alanı var ve yeni bir alan
// eklendiğinde burayı güncellemeyi unutmak sessiz bir hataya yol açar. Bunun
// yerine TERSİ yapılır: odanın KİMLİK/ÜYELİK alanları sayılır (aşağıdaki kısa
// ve kararlı liste), geri kalan HER alan maç durumudur. Böylece oyunlara
// sonradan eklenen alanlar otomatik olarak doğru tarafa düşer.

import { createInitialBoard } from '../games/backgammon/logic.js';
import { createInitialChessBoard, getBoardStateString } from '../games/chess/logic.js';
import { createInitialCheckersBoard } from '../games/checkers/logic.js';
import { createInitialConnect4Board } from '../games/connect4/logic.js';

// Odaya ait, MAÇTAN MAÇA TAŞINAN alanlar. Bunlar ne arşivlenir ne sıfırlanır.
// (Buradaki her şey "bu oda kim tarafından, hangi oyun için, kimlerle kuruldu"
// sorusunun cevabıdır; masadaki maçın gidişatı değildir.)
const ROOM_FIELDS = new Set([
  'gameId', 'host', 'players', 'spectators', 'playerIds', 'playerNames',
  'isPublic', 'createdAt', 'maxPlayers', 'status', 'closedBy',
  'abandonedBy', 'abandonReason',
  'matchKey', 'matchHistory', 'resumeNotice',
  // 101 Okey: bot koltukları, seyirci koltuk talepleri ve oda kuralları
  // masanın kurulumudur — yeni bir dizilim için de aynen geçerli kalır.
  'isBotPlayer', 'seatRequests', 'rules',
]);

// Oda verisinden yalnızca MAÇA ait alanları çıkarır.
export function snapshotMatchState(data) {
  const out = {};
  Object.keys(data || {}).forEach((k) => { if (!ROOM_FIELDS.has(k)) out[k] = data[k]; });
  return out;
}

// --- uid <-> token dönüşümü -------------------------------------------------
// Maç durumu her yerde `uid` ile örülüdür: `turn` bir uid'dir, `scores` /
// `playerColors` / `racks` / `ships` uid ile ANAHTARLANIR. Oysa arşiv KALICI
// oyuncu kimliğine göre tutulmalı — çünkü aynı kişi geri döndüğünde Firebase
// anonim oturumu yenilenmiş, yani uid'i değişmiş olabilir.
//
// Bu yüzden arşive yazarken tüm uid'ler token'a ("p:123456789"), geri
// yüklerken token'lar o anki uid'lere çevrilir. Dönüşüm, nesnenin TAMAMINDA
// (hem değerlerde hem anahtarlarda) özyinelemeli çalışır: hangi alanın uid
// içerdiğini tek tek bilmek gerekmez.
//
// Çakışma riski yok: uid'ler 28 karakterlik rastgele dizelerdir, token'lar da
// "p:"/"u:" ile başlar — oyun verisindeki hiçbir dize ('X', 'wK', taş
// kimlikleri...) bunlarla eşleşmez.
function remap(value, mapping) {
  if (typeof value === 'string') return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value;
  if (Array.isArray(value)) return value.map((v) => remap(v, mapping));
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
      const key = Object.prototype.hasOwnProperty.call(mapping, k) ? mapping[k] : k;
      out[key] = remap(v, mapping);
    });
    return out;
  }
  return value;
}

const tokenFor = (uid, playerIds) => (playerIds?.[uid] ? `p:${playerIds[uid]}` : `u:${uid}`);

// Arşive yazmadan önce: uid -> token. Eşleme yalnızca masadaki oyunculardan
// değil, skoru/ismi hâlâ duran AYRILMIŞ oyunculardan da toplanır (asıl
// arşivlenmek istenen kişi çoğu zaman odadan yeni ayrılmış olandır).
export function encodeUids(state, data) {
  const playerIds = data?.playerIds || {};
  const uids = new Set([
    ...(data?.players || []),
    ...Object.keys(playerIds),
    ...Object.keys(data?.scores || {}),
    ...Object.keys(data?.playerNames || {}),
  ]);
  const mapping = {};
  uids.forEach((uid) => { mapping[uid] = tokenFor(uid, playerIds); });
  return remap(state, mapping);
}

// Arşivden geri yüklerken: token -> o anki uid.
export function decodeUids(state, players, playerIds) {
  const mapping = {};
  (players || []).forEach((uid) => { mapping[tokenFor(uid, playerIds)] = uid; });
  return remap(state, mapping);
}

// --- Sıfırdan maç -----------------------------------------------------------
// Yeni bir dizilim masaya oturduğunda uygulanacak TERTEMİZ maç durumu.
// `createRoom`/`attemptJoinRoom` içindeki başlangıç kurulumlarıyla aynı
// değerleri üretir — fark şu ki burada TAHTA DA açıkça sıfırlanır (hatanın
// kaynağı buydu: koltuk devri yolunda tahta hiç ellenmiyordu).
export function freshMatchState(gameId, players) {
  const zeros = Object.fromEntries((players || []).map((uid) => [uid, 0]));
  const base = {
    scores: zeros,
    turn: null, startingPlayer: null,
    winner: null, winningLine: null, lastMove: null,
    drawOffer: null, takebackOffer: null, rematchRequestedBy: null,
  };
  const [p1, p2] = players || [];
  const coinFlip = Math.random() < 0.5;

  if (gameId === 'xox') {
    const starter = players[coinFlip ? 0 : 1] ?? p1 ?? null;
    return { ...base, board: Array(9).fill(null), turn: starter, startingPlayer: starter };
  }
  if (gameId === 'connect4') {
    const starter = players[coinFlip ? 0 : 1] ?? p1 ?? null;
    return { ...base, board: createInitialConnect4Board(), turn: starter, startingPlayer: starter };
  }
  if (gameId === 'dama') {
    const whiteUid = coinFlip ? p1 : p2;
    return {
      ...base,
      board: createInitialCheckersBoard(),
      playerColors: { [p1]: coinFlip ? 'w' : 'b', [p2]: coinFlip ? 'b' : 'w' },
      multiJumpIdx: null,
      turn: whiteUid ?? null, startingPlayer: whiteUid ?? null,
    };
  }
  if (gameId === 'satranc') {
    const whiteUid = coinFlip ? p1 : p2;
    const initBoard = createInitialChessBoard();
    return {
      ...base,
      board: initBoard,
      playerColors: { [p1]: coinFlip ? 'w' : 'b', [p2]: coinFlip ? 'b' : 'w' },
      captured: { w: [], b: [] }, halfmoveClock: 0,
      positionHistory: [getBoardStateString(initBoard, null, 'w')],
      enPassantTarget: null, previousState: null,
      drawReason: null, winReason: null,
      turn: whiteUid ?? null, startingPlayer: whiteUid ?? null,
    };
  }
  if (gameId === 'tavla') {
    return {
      ...base,
      board: createInitialBoard(), bar: { white: 0, black: 0 }, borneOff: { white: 0, black: 0 },
      playerColors: { [p1]: coinFlip ? 'white' : 'black', [p2]: coinFlip ? 'black' : 'white' },
      dice: [], usedDice: [], phase: 'opening', openingRolls: { p1: null, p2: null },
      cubeValue: 1, cubeOwner: null, cubeOfferBy: null, initialTurnState: null,
    };
  }
  if (gameId === 'amiralbatti') {
    return { ...base, setupPhase: true, ships: {}, readyPlayers: {}, shots: {} };
  }
  if (gameId === 'okey101') {
    // Yeni dizilim masayı LOBİ aşamasından başlatır: dağıtılmış eller
    // (racks/drawPile/discards...) aşağıdaki "artık kullanılmayan alanları sil"
    // adımıyla temizlenir, takımlar boşalır.
    return { ...base, teams: { A: [], B: [] }, countdownStartedAt: null };
  }
  return { ...base, board: null };
}

// Yeni durumda YER ALMAYAN eski maç alanları odada asılı kalmasın diye
// silinmeleri gerekir (ör. 101 Okey'in `racks`/`drawPile`'ı, satrancın
// `enPassantTarget`'ı). Çağıran taraf `deleteField()` üreticisini verir.
export function staleFieldDeletions(currentData, nextState, deleteFieldFn) {
  const out = {};
  Object.keys(snapshotMatchState(currentData)).forEach((k) => {
    if (!Object.prototype.hasOwnProperty.call(nextState, k)) out[k] = deleteFieldFn();
  });
  return out;
}

// Arşiv sınırı: 101 Okey gibi oyunlarda tek bir maç durumu on binlerce bayt
// tutabilir. Oda dokümanı şişmesin diye yalnızca en son N dizilim saklanır
// (pratikte bir odada bundan fazla farklı dizilim geri dönmüyor).
const MAX_HISTORY = 6;

export function pruneHistory(history) {
  const keys = Object.keys(history);
  if (keys.length <= MAX_HISTORY) return history;
  const sorted = keys.sort((a, b) => String(history[b]?.at || '').localeCompare(String(history[a]?.at || '')));
  const kept = {};
  sorted.slice(0, MAX_HISTORY).forEach((k) => { kept[k] = history[k]; });
  return kept;
}
