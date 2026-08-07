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
// TASARIM KURALI (kullanıcı isteği — EN ÖNEMLİ MADDE):
// Bota "gemi battı" bildirimi YAPILMAZ. Bu fonksiyon rakibin gemi
// YERLEŞİMİNİ HİÇ GÖRMEZ; karar verirken kullandığı TEK veri, botun kendi
// atışlarının sonuçlarıdır (`{row, col, hit}`) — yani insan oyuncunun
// ekranında gördüğünün BİREBİR AYNISI.
//
// NEDEN: Oyunda batma bildirimi bilerek kaldırılmıştır (saldıran taraf,
// vurduğu geminin kaç hücrelik olduğunu bilemesin; 3 isabetten sonra "belki
// 4'lüktü" deyip fazladan atış yapmak zorunda kalsın). Bot rakibin filosunu
// okuyabilseydi bu kural SADECE insan için geçerli olur, bot 3'lük bir gemiyi
// batırdığı an denemeyi kesip haksız bir avantaj kazanırdı.
//
// Bu yüzden `chooseBotShot` ARTIK `humanShips` PARAMETRESİ ALMAZ — sızıntı
// yapısal olarak imkânsızdır. "Bu gemi bitti mi?" sorusunu bot da insan gibi
// ÇIKARIM YAPARAK yanıtlar: bir isabet dizisi, iki ucu da (tahta kenarı ya da
// ıska ile) kapandığında artık uzayamaz; ancak o zaman bırakılır.
//
// NOT: Botun "hafızası" ayrı bir state/ref olarak TAŞINMAZ — her çağrıda
// `botShots` üzerinden yeniden türetilir. Bu, hafızanın oyunun gerçek
// durumuyla HER ZAMAN senkron kalmasını garanti eder.
const DIRECTIONS = [
  { dr: -1, dc: 0 }, // Kuzey
  { dr: 1, dc: 0 },  // Güney
  { dr: 0, dc: -1 }, // Batı
  { dr: 0, dc: 1 },  // Doğu
];

// İsabetleri BİTİŞİKLİĞE göre kümeler (4 yönlü flood fill). Gemi kimliği
// KULLANILMAZ — kullanılamaz da, çünkü bot rakibin filosunu görmez.
//
// `canPlaceShip` yalnızca ÇAKIŞMAYI yasaklar, gemiler yan yana durabilir; bu
// yüzden bir küme bazen iki farklı gemiye ait olabilir. Bu bir kusur değil:
// insan oyuncu da tam olarak bu belirsizliği yaşar ve aşağıdaki "eksen belli
// değilse dört komşuyu da dene" dalı bu durumu doğru şekilde ele alır.
function clusterHits(botShots, shotMap) {
  const seen = new Set();
  const clusters = [];
  for (const shot of botShots) {
    if (!shot.hit) continue;
    const startKey = cellKey(shot.row, shot.col);
    if (seen.has(startKey)) continue;
    seen.add(startKey);
    const stack = [{ row: shot.row, col: shot.col }];
    const cluster = [];
    while (stack.length > 0) {
      const cur = stack.pop();
      cluster.push(cur);
      for (const { dr, dc } of DIRECTIONS) {
        const nr = cur.row + dr; const nc = cur.col + dc;
        const nKey = cellKey(nr, nc);
        if (seen.has(nKey)) continue;
        if (shotMap[nKey]?.hit) { seen.add(nKey); stack.push({ row: nr, col: nc }); }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

// Bir isabet kümesinin DEVAM EDİLEBİLECEK (henüz atış yapılmamış) komşuları.
// Boş dizi dönmesi "bu küme kapandı, buradan çıkarılacak bilgi kalmadı"
// demektir — botun elindeki veriyle yapabileceği tek "battı" çıkarımı budur.
function clusterCandidates(cluster, isEmpty) {
  if (cluster.length >= 2) {
    const sameRow = cluster.every((h) => h.row === cluster[0].row);
    const sameCol = cluster.every((h) => h.col === cluster[0].col);
    // Eksen belli: gemi ancak bu doğrultuda uzayabilir, o yüzden SADECE iki uç
    // denenir. İki uç da kapalıysa (kenar ya da ıska) dizi tamamlanmıştır ve
    // dizi boş döner — bot dikine/yanına gereksiz atış yapmaz.
    if (sameRow) {
      const cols = cluster.map((h) => h.col);
      const row = cluster[0].row;
      return [{ row, col: Math.min(...cols) - 1 }, { row, col: Math.max(...cols) + 1 }]
        .filter((p) => isEmpty(p.row, p.col));
    }
    if (sameCol) {
      const rows = cluster.map((h) => h.row);
      const col = cluster[0].col;
      return [{ row: Math.min(...rows) - 1, col }, { row: Math.max(...rows) + 1, col }]
        .filter((p) => isEmpty(p.row, p.col));
    }
  }
  // Tek isabet (eksen henüz bilinmiyor) ya da L şeklinde küme (yan yana duran
  // iki gemi): dört komşu da denenir.
  const out = [];
  for (const h of cluster) {
    for (const { dr, dc } of DIRECTIONS) {
      const nr = h.row + dr; const nc = h.col + dc;
      if (isEmpty(nr, nc)) out.push({ row: nr, col: nc });
    }
  }
  return out;
}

// Botun bir sonraki atış koordinatını seçer.
// `botShots`: botun kendi atışları (`{row, col, hit}`) — TEK bilgi kaynağı.
export function chooseBotShot(botShots) {
  const shots = botShots || [];
  const shotMap = {};
  shots.forEach((s) => { shotMap[cellKey(s.row, s.col)] = s; });
  const inBounds = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
  const isEmpty = (r, c) => inBounds(r, c) && !shotMap[cellKey(r, c)];

  // DURUM B (Hedefleme): hâlâ uzayabilecek bir isabet kümesi varsa, rastgele
  // atmak YERİNE o kümenin etrafında devam edilir.
  const open = clusterHits(shots, shotMap)
    .map((cluster) => ({ cluster, candidates: clusterCandidates(cluster, isEmpty) }))
    .filter((c) => c.candidates.length > 0);

  if (open.length > 0) {
    // Birden fazla açık küme varsa en çok isabet almış olan (en "sıcak" ipucu)
    // önceliklidir.
    open.sort((a, b) => b.cluster.length - a.cluster.length);
    const { candidates } = open[0];
    return candidates[Math.floor(Math.random() * candidates.length)];
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
