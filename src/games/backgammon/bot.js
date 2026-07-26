import { getBaseValidMoves, getStrictValidMoves, applyMove } from './logic.js';

export const BOT_UID = 'BOT_PLAYER';

// Şu an sadece Kolay/Orta uygulanıyor; Zor (1-ply expectiminimax) sonraki aşamada eklenecek.
export const DIFFICULTY_LABELS = { easy: 'Kolay', medium: 'Orta' };

// ============================================================
// 1) TAM-EL (FULL TURN) ÜRETİCİSİ
// ============================================================
// Bir zar atışı (örn. [4,2] veya çift için [3,3,3,3]) için, zorunlu maksimum
// zar kullanımı kuralına (bkz. logic.js: getStrictValidMoves) uyan tüm tam
// hamle dizilerini üretir. Her sonuç, o dizinin bittiği nihai tahta/bar/
// borneOff durumunu ve oraya varan hamle listesini (path) içerir.
//
// Optimizasyon: Farklı zar sıralamaları çoğu zaman AYNI ara duruma varır
// (örn. çift zarda 4 taşı farklı sırayla oynamak). Hem ziyaret edilen ara
// durumları (recursion'ı budamak için) hem de nihai sonuçları (aynı tahtayı
// birden fazla kez değerlendirmemek için) anahtarlayıp tekilleştiriyoruz.
export function getAllFullTurns(board, color, dice, bar, borneOff) {
  const results = [];
  const seenResults = new Set();
  const visitedStates = new Set();

  const boardKey = (b) => b.map(p => (p && p.color ? p.color[0] + p.count : '-')).join('');
  const stateKey = (b, barState, borneState, remainingDice) =>
    `${boardKey(b)}|${barState.white},${barState.black}|${borneState.white},${borneState.black}|${[...remainingDice].sort().join('')}`;

  function recurse(currentBoard, remainingDice, barState, borneState, path) {
    const key = stateKey(currentBoard, barState, borneState, remainingDice);
    if (visitedStates.has(key)) return;
    visitedStates.add(key);

    const moves = remainingDice.length > 0
      ? getStrictValidMoves(currentBoard, color, remainingDice, barState, borneState)
      : [];

    if (moves.length === 0) {
      const finalKey = stateKey(currentBoard, barState, borneState, []);
      if (!seenResults.has(finalKey)) {
        seenResults.add(finalKey);
        results.push({ board: currentBoard, bar: barState, borneOff: borneState, path });
      }
      return;
    }

    for (const move of moves) {
      const { board: nb, bar: nbar, borneOff: nboff } = applyMove(currentBoard, barState, borneState, color, move.from, move.to);
      const nextDice = [...remainingDice];
      nextDice.splice(nextDice.indexOf(move.die), 1);
      recurse(nb, nextDice, nbar, nboff, [...path, move]);
    }
  }

  recurse(
    board,
    dice,
    { white: bar?.white || 0, black: bar?.black || 0 },
    { white: borneOff?.white || 0, black: borneOff?.black || 0 },
    []
  );
  return results;
}

// ============================================================
// 2) STATİK DEĞERLENDİRME FONKSİYONU (0-ply)
// ============================================================
// Ağırlıklar tek yerde toplanıyor ki ileride (rollout verisiyle) ayrı ayrı
// ayarlanabilsin. Birim ölçek "pip" üzerinden: 1 pip fark = 1 puan.
const WEIGHTS = {
  pip: 1,           // pip farkı başına puan
  bar: 8,           // pas'taki her taş için EK ceza (pip'e zaten 25 olarak yansıyor, bu ek "sırası gelmiyor" cezası)
  borneOff: 2,       // toplanmış (bear off) her taş için ek ödül
  madePoint: 3,      // 2+ taşla yapılmış (güvenli) her nokta
  homeBoardPoint: 2, // yapılmış nokta ev tahtasındaysa ek ödül
  prime: 5,          // ardışık yapılmış nokta zinciri uzunluğu başına ödül
  blotFlat: 8,        // bir taş vurulursa sabit "tempo/pas riski" cezası
};

function pipCount(board, color, barCount) {
  let pips = barCount * 25;
  for (let i = 0; i < 24; i++) {
    const pt = board[i];
    if (!pt || pt.color !== color || !pt.count) continue;
    pips += pt.count * (color === 'white' ? 24 - i : i + 1);
  }
  return pips;
}

// Bir taşın (belirli bir renk ve zar seti ile) hedef kareye ulaşıp
// ulaşamayacağını, gerçek hamle kurallarını (logic.js) tekrar kullanarak
// kontrol eder. Tek zarla doğrudan, kalan zar(lar)la da zincirleme
// (dolaylı) atışları kapsar.
function canReachWithDice(board, color, barCount, dice, targetIdx) {
  if (dice.length === 0) return false;
  const uniqueDice = [...new Set(dice)];

  for (const die of uniqueDice) {
    const moves = getBaseValidMoves(board, color, [die], barCount, 0);
    for (const m of moves) {
      if (m.to === targetIdx) return true;

      const remaining = [...dice];
      remaining.splice(remaining.indexOf(die), 1);
      if (remaining.length === 0) continue;

      const barObj = { white: color === 'white' ? barCount : 0, black: color === 'black' ? barCount : 0 };
      const { board: nb } = applyMove(board, barObj, { white: 0, black: 0 }, color, m.from, m.to);
      const nextBar = m.from === -1 ? barCount - 1 : barCount;
      if (canReachWithDice(nb, color, nextBar, remaining, targetIdx)) return true;
    }
  }
  return false;
}

// Bir blota (tek taşlı noktaya), rakibin bir sonraki atışında kaç adet
// (36 üzerinden, ağırlıklı) zar kombinasyonuyla vurabileceğini sayar.
// d1<=d2 taranıp çiftler 1, çift-olmayanlar 2 ağırlığıyla sayılır — bu,
// (d1,d2) ve (d2,d1) için aynı canReachWithDice hesabını tekrarlamaktan
// kaçınan bir optimizasyondur (36 yerine 21 çağrı).
function countHittingRolls(board, blotIdx, hitterColor, hitterBar) {
  let count = 0;
  for (let d1 = 1; d1 <= 6; d1++) {
    for (let d2 = d1; d2 <= 6; d2++) {
      const dice = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
      if (canReachWithDice(board, hitterColor, hitterBar, dice, blotIdx)) {
        count += d1 === d2 ? 1 : 2;
      }
    }
  }
  return count;
}

export function evaluateBoard(board, bar, borneOff, color) {
  const opp = color === 'white' ? 'black' : 'white';
  const myBar = bar?.[color] || 0; const oppBar = bar?.[opp] || 0;
  const myBorne = borneOff?.[color] || 0; const oppBorne = borneOff?.[opp] || 0;

  const myPips = pipCount(board, color, myBar);
  const oppPips = pipCount(board, opp, oppBar);

  let score = (oppPips - myPips) * WEIGHTS.pip;
  score += (oppBar - myBar) * WEIGHTS.bar;
  score += (myBorne - oppBorne) * WEIGHTS.borneOff;

  const homeStart = color === 'white' ? 18 : 0;
  const homeEnd = color === 'white' ? 23 : 5;
  const orderedIndices = color === 'white' ? Array.from({ length: 24 }, (_, i) => i) : Array.from({ length: 24 }, (_, i) => 23 - i);

  let consecutiveMade = 0; let bestPrime = 0;
  for (const i of orderedIndices) {
    const pt = board[i];
    if (pt && pt.color === color && pt.count >= 2) {
      score += WEIGHTS.madePoint;
      if (i >= homeStart && i <= homeEnd) score += WEIGHTS.homeBoardPoint;
      consecutiveMade++;
      if (consecutiveMade > bestPrime) bestPrime = consecutiveMade;
    } else {
      consecutiveMade = 0;
    }

    if (pt && pt.color === color && pt.count === 1) {
      const hits = countHittingRolls(board, i, opp, oppBar);
      const pipLoss = color === 'white' ? 24 - i : i + 1;
      score -= (hits / 36) * (pipLoss * WEIGHTS.pip + WEIGHTS.blotFlat);
    }
  }
  score += bestPrime * WEIGHTS.prime;

  return score;
}

// ============================================================
// Dispatcher: Kolay = rastgele tam-el, Orta = 0-ply en iyi tam-el.
// 'hard' henüz uygulanmadı; şimdilik 'medium' davranışına düşer.
// ============================================================
export function getBotFullTurn(board, color, dice, bar, borneOff, difficulty) {
  const turns = getAllFullTurns(board, color, dice, bar, borneOff);
  if (turns.length === 0) return null; // Bu zarla oynanabilir hamle yok.

  if (difficulty === 'easy') {
    return turns[Math.floor(Math.random() * turns.length)];
  }

  let best = null; let bestScore = -Infinity;
  for (const t of turns) {
    const score = evaluateBoard(t.board, t.bar, t.borneOff, color);
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}
