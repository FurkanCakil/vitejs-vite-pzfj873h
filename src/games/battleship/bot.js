// Amiral Battı bot yapay zekası. Diğer oyunlardaki (connect4/bot.js,
// checkers/bot.js) desene uygun: SADECE saf mantık (Firestore/React YOK).
//
// KULLANICI İSTEĞİ: Oyun tamamen ŞANSA dayalı olduğu için ZORLUK SEVİYESİ
// YOKTUR — tek, standart bir bot. İki bölüm içerir:
//   1) FAZ 1 (Auto-Setup): botun kendi filosunu rastgele/kurallara uygun
//      yerleştirmesi.
//   2) FAZ 2 (Hunt & Target): botun atış seçimi — Avlanma (rastgele) ve
//      Hedefleme (isabet aldığı geminin etrafında devam etme) durumları.
import { BOARD_SIZE, SHIP_DEFS, getShipCells, canPlaceShip, cellKey } from './logic.js';

export const BOT_UID = 'BOT_PLAYER';

// ============================================================
// FAZ 1: Otomatik filo yerleştirme
// ============================================================
// Her gemi için rastgele bir başlangıç hücresi + rastgele bir yön
// (yatay/dikey) dener; `canPlaceShip` (İNSAN oyuncuyla BİREBİR AYNI kural —
// taşmaz, çakışmaz) geçerli bulana kadar tekrar dener. 10x10 tahtada 5 gemi
// (toplam 17 hücre) için pratikte her zaman birkaç denemede bulunur.
export function generateBotFleet() {
  const ships = [];
  for (const def of SHIP_DEFS) {
    let placed = null;
    while (!placed) {
      const orientation = Math.random() < 0.5 ? 'H' : 'V';
      const origin = { row: Math.floor(Math.random() * BOARD_SIZE), col: Math.floor(Math.random() * BOARD_SIZE) };
      const cells = getShipCells(origin, orientation, def.length);
      const { valid } = canPlaceShip(ships, cells);
      if (valid) placed = { id: def.id, name: def.name, length: def.length, orientation, origin, cells };
    }
    ships.push(placed);
  }
  return ships;
}

// ============================================================
// FAZ 2: Hunt & Target atış algoritması
// ============================================================
// NOT: Botun "hafızası" ayrı bir state/ref olarak TAŞINMAZ — her çağrıda
// `botShots` (botun şimdiye kadarki TÜM atışları/sonuçları) ve `humanShips`
// (rakibin gemileri — SADECE hangi hücrenin hangi gemiye ait olduğunu, yani
// batma kontrolünü yapmak için kullanılır, henüz vurulmamış hücreleri
// "bilerek" seçmek için DEĞİL) üzerinden DURUM A/B yeniden türetilir. Bu,
// hafızanın oyunun gerçek durumuyla (shots) HER ZAMAN senkron kalmasını
// garanti eder.
const DIRECTIONS = [
  { dr: -1, dc: 0 }, // Kuzey
  { dr: 1, dc: 0 },  // Güney
  { dr: 0, dc: -1 }, // Batı
  { dr: 0, dc: 1 },  // Doğu
];

function findShipIdAt(humanShips, row, col) {
  const ship = humanShips.find((s) => s.cells.some((c) => c.row === row && c.col === col));
  return ship?.id ?? null;
}

function isShipSunkAt(humanShips, shotMap, shipId) {
  const ship = humanShips.find((s) => s.id === shipId);
  if (!ship) return false;
  return ship.cells.every((c) => shotMap[cellKey(c.row, c.col)]?.hit);
}

// Şimdiye kadarki isabetleri, ait oldukları (ve HENÜZ BATMAMIŞ) gemiye göre
// gruplar — "yarım kalmış gemi" tespiti tam olarak budur.
function groupWoundedByShip(botShots, humanShips, shotMap) {
  const groups = {};
  botShots.forEach((s) => {
    if (!s.hit) return;
    const shipId = findShipIdAt(humanShips, s.row, s.col);
    if (!shipId || isShipSunkAt(humanShips, shotMap, shipId)) return;
    (groups[shipId] ??= []).push(s);
  });
  return groups;
}

// Botun bir sonraki atış koordinatını seçer. `botShots`: botun kendi
// atışları (`{row, col, hit}`); `humanShips`: rakibin (insanın) yerleştirdiği
// gemileri (batma kontrolü için).
export function chooseBotShot(botShots, humanShips) {
  const shotMap = {};
  botShots.forEach((s) => { shotMap[cellKey(s.row, s.col)] = s; });
  const inBounds = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
  const isEmpty = (r, c) => inBounds(r, c) && !shotMap[cellKey(r, c)];

  // DURUM B (Hedefleme): en az bir "yarım kalmış" (vurulmuş ama batmamış)
  // gemi varsa, rastgele atmak YERİNE bu geminin etrafında devam edilir.
  const groups = groupWoundedByShip(botShots, humanShips, shotMap);
  const activeShipIds = Object.keys(groups);
  if (activeShipIds.length > 0) {
    // Birden fazla yarım kalmış gemi varsa (nadir), en çok isabet alan
    // (en "sıcak" ipucu) önceliklidir.
    const targetShipId = activeShipIds.sort((a, b) => groups[b].length - groups[a].length)[0];
    const hits = groups[targetShipId];

    const candidates = [];
    if (hits.length >= 2) {
      // İki+ isabet aynı satır/sütundaysa geminin EKSENİ bellidir — rastgele
      // dört yöne bakmak yerine doğrudan bu eksenin İKİ UCUNU dener (gemi
      // batana kadar bu doğrultuda ilerler).
      const sameRow = hits.every((h) => h.row === hits[0].row);
      const sameCol = hits.every((h) => h.col === hits[0].col);
      if (sameRow) {
        const cols = hits.map((h) => h.col);
        const minC = Math.min(...cols); const maxC = Math.max(...cols);
        [{ row: hits[0].row, col: minC - 1 }, { row: hits[0].row, col: maxC + 1 }]
          .forEach((p) => { if (isEmpty(p.row, p.col)) candidates.push(p); });
      } else if (sameCol) {
        const rows = hits.map((h) => h.row);
        const minR = Math.min(...rows); const maxR = Math.max(...rows);
        [{ row: minR - 1, col: hits[0].col }, { row: maxR + 1, col: hits[0].col }]
          .forEach((p) => { if (isEmpty(p.row, p.col)) candidates.push(p); });
      }
    }
    if (candidates.length === 0) {
      // Tek isabet (ya da eksen henüz belirsiz): TÜM yaralı hücrelerin
      // Kuzey/Güney/Doğu/Batı komşularını dene.
      hits.forEach((h) => {
        DIRECTIONS.forEach(({ dr, dc }) => {
          const nr = h.row + dr; const nc = h.col + dc;
          if (isEmpty(nr, nc)) candidates.push({ row: nr, col: nc });
        });
      });
    }
    if (candidates.length > 0) return candidates[Math.floor(Math.random() * candidates.length)];
    // Bu geminin etrafında hiç boş hücre kalmadıysa (köşeye sıkıştıysa)
    // DURUM A'ya (rastgele avlanma) düşülür.
  }

  // DURUM A (Avlanma): tahtadaki TÜM boş (atış yapılmamış) hücreler arasından
  // tamamen rastgele bir koordinat seçilir.
  const empties = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (isEmpty(r, c)) empties.push({ row: r, col: c });
    }
  }
  if (empties.length === 0) return null;
  return empties[Math.floor(Math.random() * empties.length)];
}
