import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, X, Layers, Rows3, RefreshCw, Wand2 } from 'lucide-react';
import Tile, { TILE_ASPECT } from './Tile.jsx';
import { RACK_ROW_LENGTH, RACK_SLOTS, normalizeRack, moveTileToSlot, moveGroupBlockToSlot, isContiguousSelection, isOkeyTile } from './tiles.js';
import { validateGroup, isValidPairTiles, isSequentiallyOrderedGroup, formatFoldBarrier, tekLabel, OPEN_THRESHOLD } from './gameLogic.js';
import { buildSeriesArrangement, buildPairsArrangement, confirmedMeldTotal } from './assist.js';
import useViewport from '../../hooks/useViewport.js';
import { playOkeySound } from '../../utils/okeySound.js';

const DRAG_THRESHOLD_PX = 6;
const TACK_HOVER_COLOR = 'rgba(251,191,36,0.55)';

// 3. madde: Okey artık hiçbir çerçeve/rozetle belli edilmediği için oyuncu onu
// kendisi fark etmek zorunda. Fark ettiği taşı unutmamak adına (gerçek hayatta
// okeyi ters çevirip masaya koymak gibi) SADECE GERÇEK OKEY taşına 1sn basılı
// tutarak taşı TERS ÇEVİREBİLİR; 1sn daha basılı tutunca taş normale döner.
// Diğer taşlar ters çevrilemez (kullanıcı isteği: yanlışlıkla her taşı
// çevirip karıştırmasın). Tamamen yerel/kişisel bir işarettir, sunucuya
// yazılmaz ve kimse göremez.
const LONG_PRESS_MS = 1000;

// Istaka, 15 sütunu HER ZAMAN kullanılabilir genişliğe sığdırır: taş genişliği
// konteynerden ölçülerek hesaplanır (bkz. useRackMetrics). Böylece ne telefonda
// (dikey/yatay) ne de tam ekranda alta yatay kaydırma çubuğu çıkar.
const GAP_RATIO = 0.13;      // taş genişliğine oranla slotlar arası boşluk
const ROW_PADDING_PX = 4;    // satır kutusunun kendi iç boşluğu (tek yan)
const MIN_TILE_W = 14;       // çok dar telefonlarda bile okunur alt sınır
const MAX_TILE_W = 60;       // çok geniş ekranlarda absürt büyümeyi engeller

// "Soldan Çek" / "Sağa At" bölmesinin taş genişliğine oranı (kompakt modda bu
// bölmeler ıstakanın ÜSTÜNDE değil YANINDA durduğu için genişlik hesabına girer).
const SIDE_SLOT_RATIO = 1.25;
const SIDE_COL_RATIO = SIDE_SLOT_RATIO + 0.22; // + aradaki boşluk payı

// Istakanın kaplayabileceği en fazla dikey oran. Kalan yükseklik masaya
// (rakipler + açılan eller) kalır.
//
// ÖNEMLİ: Bu pay, ıstakanın EKRANDAKİ KONUMU ölçülerek bulunamaz — ıstaka esnek
// bir sütunun altına yaslandığı için kendi yüksekliği kendi konumunu belirler ve
// ölçüm sonsuz bir geri beslemeye girip taşları en küçük boyuta çökertir. Bu
// yüzden pay doğrudan görüntü alanı YÜKSEKLİĞİNDEN türetilir.
const RACK_HEIGHT_RATIO = 0.5;

// DAR ekranlarda (telefon DİKEY) 15 sütunluk tek satır, taşları 19px gibi
// okunamayacak bir boyuta düşürüyordu — oysa dikeyde bol bol boş yer vardı.
// Bu yüzden aynı 30 slot, 15x2 yerine 10x3 olarak dizilir: slot SIRASI (ve
// dolayısıyla per bitişikliği/sürükleme mantığı) hiç değişmez, sadece satır
// kırılma noktası değişir — taşlar ~%45 büyür.
const NARROW_SCREEN_PX = 520;
const NARROW_ROW_LENGTH = 10;

const rackColumns = (compact, viewportWidth) => (
  (!compact && viewportWidth > 0 && viewportWidth < NARROW_SCREEN_PX) ? NARROW_ROW_LENGTH : RACK_ROW_LENGTH
);

// Istakanın taş koyulabilen ALANININ ulaşabileceği en büyük genişlik (px).
// Taşlar MAX_TILE_W'de doyduğu için, bundan daha geniş bir ekranda satırlar
// büyümez; eskiden satır kutusu yine de `w-full` olduğu için iki yanda taş
// SÜRÜKLENEMEYEN ama yeşil görünen ölü alanlar açılıyordu. Istaka paneline
// bu değer üst sınır olarak verilir, böylece yeşil çerçeve tam da taş
// koyulabilen yerde biter (bkz. Okey101Game — ıstaka sarmalayıcısı).
export const maxRackContentWidth = () => {
  const gap = Math.max(2, Math.floor(MAX_TILE_W * GAP_RATIO));
  return RACK_ROW_LENGTH * MAX_TILE_W + (RACK_ROW_LENGTH - 1) * gap + ROW_PADDING_PX * 2;
};

// PERFORMANS (taş sürüklerken hissedilen takılmanın ikinci büyük kaynağı):
// Bir ıstaka slotu. Sürükleme sırasında imleç her yeni slotun üstüne geldiğinde
// `hoverIndex` değişip PlayerRack yeniden render oluyor; eskiden bu, 30 slotun
// (ve içlerindeki 22 taşın) TAMAMINI yeniden çiziyordu. `React.memo` + aşağıdaki
// ÖZEL karşılaştırıcı sayesinde artık yalnızca durumu GERÇEKTEN değişen slotlar
// (imlecin ayrıldığı ve girdiği slot) yeniden çizilir.
//
// Karşılaştırıcı `tile`'ı REFERANSLA değil ALANLARIYLA kıyaslar: Firestore
// `onSnapshot` her pakette (ilgisiz bir alan değişse bile) tüm iç içe nesneleri
// yeniden ürettiği için taş nesnelerinin referansı sürekli değişir, oysa taşın
// kendisi aynıdır.
const RackSlot = React.memo(function RackSlot({
  index, tile, tileW, tileH, isHover, hidden, isPending, selected, grouped, faceDown, dragging, revealing, tackable, okeyInfo, handlers,
}) {
  return (
    <div
      data-slot-index={index}
      style={{ width: `${tileW}px`, height: `${tileH}px` }}
      className={`rounded-md flex items-center justify-center shrink-0 transition-colors ${isHover ? 'bg-yellow-400/30 ring-2 ring-yellow-400' : 'bg-black/10'}`}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerUp}
    >
      {tile && !hidden && (
        <Tile
          tile={tile}
          width={tileW}
          okeyInfo={okeyInfo}
          selected={selected}
          grouped={grouped}
          faceDown={faceDown}
          dragging={dragging}
          tackable={tackable}
          className={revealing ? 'okey101-tile-reveal' : ''}
          onPointerDown={isPending ? undefined : (e) => handlers.onPointerDown(e, index, tile)}
        />
      )}
    </div>
  );
}, (a, b) => (
  a.index === b.index
  && a.tileW === b.tileW && a.tileH === b.tileH
  && a.isHover === b.isHover && a.hidden === b.hidden && a.isPending === b.isPending
  && a.selected === b.selected && a.grouped === b.grouped && a.faceDown === b.faceDown
  && a.dragging === b.dragging && a.revealing === b.revealing && a.tackable === b.tackable
  && a.handlers === b.handlers && a.okeyInfo === b.okeyInfo
  && (a.tile?.id ?? null) === (b.tile?.id ?? null)
  && (a.tile?.color ?? null) === (b.tile?.color ?? null)
  && (a.tile?.number ?? null) === (b.tile?.number ?? null)
  && !!a.tile?.isJoker === !!b.tile?.isJoker
));

function useRackMetrics({ compact, viewportHeight, cols, rows }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth((prev) => (Math.abs(prev - el.clientWidth) < 2 ? prev : el.clientWidth));
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [compact]);

  const metrics = useMemo(() => {
    // usable = N*w + (N-1)*(w*GAP_RATIO) [+ kompakt modda iki yan bölme]
    const columns = cols + (cols - 1) * GAP_RATIO + (compact ? SIDE_COL_RATIO * 2 : 0);
    const usable = Math.max(0, width - ROW_PADDING_PX * 2 - 4);
    let tileW = Math.floor(usable / columns) || MIN_TILE_W;

    if (viewportHeight > 0) {
      // Tüm satırlar + satır araları + satırların iç boşlukları bu paya sığmalı.
      const budget = viewportHeight * RACK_HEIGHT_RATIO - (ROW_PADDING_PX * 2 * rows + 10);
      tileW = Math.min(tileW, Math.floor(budget / (rows * TILE_ASPECT + GAP_RATIO * 1.4 * (rows - 1))));
    }

    tileW = Math.max(MIN_TILE_W, Math.min(MAX_TILE_W, tileW));
    return { tileW, tileH: Math.round(tileW * TILE_ASPECT), gap: Math.max(2, Math.floor(tileW * GAP_RATIO)) };
  }, [width, compact, viewportHeight, cols, rows]);

  return { ref, ready: width > 0, ...metrics };
}

// Oyuncunun kendi ıstakası: taş seçimi (per onaylamak / seri-çift açmak için),
// SABİT SLOTLU sürükle-bırak (bir taş boş bir slota bırakılırsa SADECE o taş
// oraya gider, doluysa iki taş yer değiştirir — diğer taşlar ASLA kaymaz),
// gruplanmış (per) taşların bir blok halinde birlikte hareket etmesi, (canAct
// açıkken) taşı ıstaka dışına sürükleyip atma (discard), ve (hasOpened + canAct
// iken) masadaki açık perlere tek taş işleme (tacking) burada yönetilir.
// Sadece sahibi (isOwner) etkileşime girebilir.
export default function PlayerRack({
  rack, groups, isOwner, onUpdateRack, okeyInfo,
  canAct = false, canDiscard = false, hasOpenedAlready = false, lastDiscardTile = null,
  incomingDiscard = null, canTakeIncoming = false, incomingDragHandlers = null,
  canOpenPairsRule = true, pairsButtonLabel = 'Çift Aç', canOpenMeldsRule = true, minPairsToOpen = 5,
  seriesTarget = OPEN_THRESHOLD,
  assisted = false, tackableTileIds = null, sideTakeTileId = null, onCancelSideTake = null,
  pendingDraw = null, flipTileId = null, compact = false,
  flippedTileIds = null, onToggleFlippedTile = null, indicator = null,
  onDiscardTile, onOpenSeries, onOpenPairs, onTackTile, showToast,
}) {
  const safeRack = useMemo(() => normalizeRack(rack), [rack]);
  const safeGroups = groups || {}; // SUNUCU-onaylı groups — sadece iyimser kopyanın "yakalandığını" tespit etmek için kullanılır.
  const { height: viewportHeight, width: viewportWidth } = useViewport();
  const cols = rackColumns(compact, viewportWidth);
  const rows = Math.ceil(RACK_SLOTS / cols);
  const { ref: rackWrapRef, ready, tileW, tileH, gap } = useRackMetrics({ compact, viewportHeight, cols, rows });
  // Satırın GERÇEK içerik genişliği. Ölçüm sarmalayıcısı (rackWrapRef) tam
  // genişlikte kalır — ölçüm buna göre yapılmalı, aksi halde kendi kendini
  // besleyen bir daralma döngüsü oluşur — ama GÖRÜNEN satır kutuları bu
  // genişliğe sabitlenip ortalanır: yeşil zemin artık taşların bittiği yerde
  // biter, iki yanda "sürüklenemeyen boşluk" kalmaz.
  const rowWidth = cols * tileW + (cols - 1) * gap + ROW_PADDING_PX * 2;
  const contentWidthStyle = ready ? { maxWidth: `${rowWidth}px` } : undefined;

  const [selected, setSelected] = useState(() => new Set());
  const [hoverIndex, setHoverIndex] = useState(null);
  const [hoverDiscard, setHoverDiscard] = useState(false);
  // PERFORMANS: `ghost` artık SADECE sürüklenen taşların KİMLİĞİNİ tutar
  // (mount/unmount), POZİSYONU DEĞİL. Eskiden fare/parmak her piksel
  // hareket ettiğinde `setGhost({x,y,...})` ile YENİ bir obje verilip TÜM
  // PlayerRack (30 taş slotu dahil) yeniden render ediliyordu — bu da özellikle
  // per yaparken/taş taşırken hissedilen donma/takılmaların ASIL sebebiydi.
  // Pozisyon artık `ghostElRef` üzerinden DOĞRUDAN DOM'a (style.transform)
  // yazılır; React re-render'ı TETİKLEMEZ (bkz. handlePointerMove).
  const [ghost, setGhost] = useState(null); // { tiles, grabOffset }
  const ghostElRef = useRef(null);
  const setGhostElRef = (el) => {
    ghostElRef.current = el;
    // Node YENİ mount olduysa (drag zaten başlamışsa) son bilinen imleç
    // konumunu HEMEN uygula — aksi halde bir kare boyunca (0,0)'da yanıp
    // sönme (flaş) görülür.
    const d = dragRef.current;
    if (el && d && d.lastX !== undefined) applyGhostTransform(el, d.lastX, d.lastY, d.grabOffset);
  };
  const applyGhostTransform = (el, x, y, grabOffset) => {
    el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(calc(-50% - ${grabOffset * (tileW + gap)}px), -50%)`;
  };
  // Uzun basılarak ters çevrilmiş taşların id'leri (sadece bu tarayıcıda).
  // 6. madde: bu state artık PlayerRack'in KENDİSİNDE değil, Okey101Game'de
  // tutulur ve prop olarak verilir — PlayerRack alt-tab sonrası kısa bir
  // unmount/remount yaşayabildiği için (bkz. Okey101Game#flippedTileIds
  // yorumu), state burada olsaydı her seferinde sıfırlanırdı. Prop
  // verilmezse (beklenmeyen bir kullanım) yerel bir yedek state'e düşer.
  const [localFlippedIds, setLocalFlippedIds] = useState(() => new Set());
  const flippedIds = flippedTileIds ?? localFlippedIds;
  const toggleFlipped = onToggleFlippedTile ?? ((tileId) => setLocalFlippedIds((prev) => {
    const next = new Set(prev);
    if (next.has(tileId)) next.delete(tileId); else next.add(tileId);
    return next;
  }));
  const longPressTimerRef = useRef(null);
  // Bir taş ıstakadan AYRILDIĞINDA (atılırken YA DA bir pere İŞLENİRKEN —
  // tacking) Firestore turu tamamlanana kadar taşı ıstakadan İYİMSER
  // (optimistic) olarak gizler — algılanan gecikmeyi azaltır.
  //
  // KULLANICI RAPORU ("taş işleme ... her zaman bi gecikme oluyo, taş
  // ıstakaya geri dönüp sonra yaptığım işlem sayılıyo"): bu katman eskiden
  // SADECE ATMADA (performDiscardDrop) vardı — İŞLEMEDE (bkz. finishDrag'in
  // `tackEl` dalı) HİÇ optimistik gizleme YOKTU. Sonuç: taş işlenirken
  // sunucu round-trip'i (~1sn+) boyunca taş ıstakada GÖRÜNMEYE DEVAM
  // EDİYORDU (hiç ayrılmamış gibi), sonra sunucu onayı gelince ANİDEN
  // kayboluyordu — kullanıcıya "taş ıstakaya geri döndü, sonra işlendi" gibi
  // hissettiren TAM OLARAK buydu. Aşağıdaki tek mekanizma artık HER İKİ
  // eylem için de kullanılır (bkz. finishDrag).
  //
  // ÖNEMLİ: eskiden bu, `rack` PROP REFERANSI her değiştiğinde temizleniyordu
  // (`useEffect(() => setOptimisticGoneId(null), [rack])`). Ama Firestore
  // `onSnapshot`, belge içindeki İLGİSİZ bir alan değişse bile (ör. botun
  // sırası, rakibin hamlesi, geri sayım) `data()` çağrısında TÜM iç içe
  // nesneleri (dolayısıyla `racks[user.uid]` dizisini) YENİDEN oluşturur —
  // yani `rack` referansı, taş HÂLÂ ıstakada dururken bile sık sık değişir.
  // Bu yüzden atılan/işlenen taş bir anlığına geri (ıstakaya) görünüyor, sonra
  // asıl onay gelince tekrar kayboluyordu (görünür bir titreme/gecikme) —
  // bazen de (yavaş/asılı bir transaction'da) taş hiç kaybolmadan ıstakada
  // kalıyordu. Artık İÇERİĞE bakılır: taş GERÇEKTEN ıstakadan gitmişse temizlenir.
  const [optimisticGoneId, setOptimisticGoneId] = useState(null);
  const optimisticGoneTimerRef = useRef(null);
  useEffect(() => () => { if (optimisticGoneTimerRef.current) clearTimeout(optimisticGoneTimerRef.current); }, []);
  useEffect(() => {
    if (!optimisticGoneId) return;
    const stillThere = safeRack.some((t) => t && t.id === optimisticGoneId);
    if (!stillThere) setOptimisticGoneId(null);
  }, [safeRack, optimisticGoneId]);
  const dragRef = useRef(null);
  const tackHoverElRef = useRef(null);
  const centerFinishHoverElRef = useRef(null);
  const returnHoverElRef = useRef(null);
  // Sürükleme hedefinin (slot indeksi / atma bölmesi) en güncel hâli. bkz.
  // updateDropTarget — hedef tespiti animasyon karesine ertelendiği için
  // bırakma anında state yerine bu ref okunur.
  const dropTargetRef = useRef({ index: null, discard: false });
  const moveRafRef = useRef(0);
  useEffect(() => () => { if (moveRafRef.current) cancelAnimationFrame(moveRafRef.current); }, []);

  // --- Sunucuya yazım hattı (aşağıdaki iyimser-katman efektleri buna bakar,
  //     bu yüzden BİLEREK en üstte tanımlanır; detaylı açıklama için bkz.
  //     `flushRackWrite` ve `applyRack`). ---
  const pendingWriteRef = useRef(null); // { rack, groups } — henüz gönderilmemiş en son istenen durum
  const writeChainRef = useRef(Promise.resolve());
  const writeDebounceRef = useRef(null);
  const inFlightRef = useRef(0);        // sunucuda ŞU AN işlenen yazım sayısı
  const settleTimerRef = useRef(null);
  const [writeSettleTick, setWriteSettleTick] = useState(0);
  useEffect(() => () => {
    if (writeDebounceRef.current) clearTimeout(writeDebounceRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
  }, []);

  // Yazım hattı tamamen boş mu? (bekleyen debounce YOK, gönderilmemiş
  // değişiklik YOK, uçuşta transaction YOK)
  const isWriteIdle = () => !writeDebounceRef.current && !pendingWriteRef.current && inFlightRef.current === 0;

  // Istaka düzenlemesi artık sunucuda transaction ile birleştirilerek yazılıyor
  // (taş kaybını önlemek için — bkz. tiles.js#mergeRackLayout). Bu fazladan bir
  // sunucu gidiş-dönüşü demek; sürükle-bırak'ın anlık hissettirmesi için taşın
  // yeni yeri ekranda HEMEN gösterilir, sunucu onayı gelince iyimser kopya düşer.
  const [optimisticRack, setOptimisticRack] = useState(null);

  const baseRack = optimisticRack || safeRack;

  // KRİTİK: `baseRack` bir React state DEĞİŞKENİDİR — `setOptimisticRack`
  // çağrısı bir sonraki render'a kadar (React state güncellemeleri asenkron
  // olduğu için) YANSIMAZ. Telefonda (özellikle dar dikey 3 satırlı düzende,
  // taşlar küçük olduğu için çok daha sık sürükleme yapılıyor) oyuncu bir
  // taşı bırakır bırakmaz HEMEN bir sonrakini sürüklemeye başlarsa, ikinci
  // sürüklemenin `handlePointerDown`'ı henüz BAYAT olan `baseRack` state'ini
  // görüyor (ilk sürüklemenin sonucunu yansıtmıyor) — bu da taşların rastgele
  // yer değiştirmiş/geri sıçramış gibi görünmesine yol açıyordu. `baseRackRef`
  // her sürüklemenin BAŞINDA ve applyRack'te SENKRON güncellenir, böylece her
  // yeni sürükleme render beklemeden her zaman en güncel yerleşimi görür.
  const baseRackRef = useRef(baseRack);
  useEffect(() => { baseRackRef.current = baseRack; }, [baseRack]);

  // Iyimser kopya NE ZAMAN bırakılır?
  //
  // KÖK NEDEN ("6-7 kez üst üste sürükleyince son 2 sürükleme geri alınıp
  // sonra tekrar uygulanıyor"): Eskiden iyimser katman, yazım hattı boşaldıktan
  // 500ms sonra KÖR bir zamanlayıcıyla bırakılıyordu. Ama `runTransaction`'ın
  // resolve olması "sunucu yazdı" demektir — "o veri onSnapshot ile BİZE geri
  // döndü" DEMEK DEĞİLDİR. Snapshot henüz gelmemişken zamanlayıcı tetiklenince
  // ekran, elimizdeki EN SON sunucu verisine (yani birkaç sürükleme ÖNCEKİ ara
  // duruma) düşüyor; asıl snapshot gelince de yeniden son hâle sıçrıyordu.
  // Kullanıcının gördüğü "geri alıp tekrar yapma" tam olarak buydu.
  //
  // Artık zamanlayıcı YOK. Karar tamamen İÇERİĞE bakar:
  //   1. Sunucu bizim yerleşimimize ulaştıysa -> bırak (görsel değişiklik olmaz).
  //   2. Sunucudaki TAŞ KÜMESİ bizimkinden farklıysa (taş çekildi/atıldı/açıldı)
  //      -> sunucuda BİZİM BİLMEDİĞİMİZ bir içerik değişikliği var, hemen bırak.
  //   3. Küme aynı ama konumlar farklıysa -> bizim yerleşimimiz DAHA YENİdir
  //      (mergeRackLayout sunucuda konumlarımızı korur), iyimser katman KALIR.
  // Böylece ara snapshot'lar ekranı asla geri sıçratmaz.
  const rackIdSet = (rows) => {
    const s = new Set();
    (rows || []).forEach((t) => { if (t) s.add(t.id); });
    return s;
  };
  const sameIdSet = (a, b) => a.size === b.size && [...a].every((id) => b.has(id));

  useEffect(() => {
    if (!optimisticRack) return;
    // (2) Sunucudaki TAŞ KÜMESİ değiştiyse yerleşimimiz geçersizdir -> hemen bırak.
    if (!sameIdSet(rackIdSet(safeRack), rackIdSet(optimisticRack))) { setOptimisticRack(null); return; }
    // (1) Konumlar eşleşse BİLE, gönderilecek/uçuşta yazım VARKEN bırakma.
    //
    // KRİTİK: Aynı taşı iki slot arasında ileri-geri sürüklerken ara durumlar
    // BİRBİRİNE EŞİT olur (0->22->0->22... dizisinde 1., 3., 5. hamleler aynı
    // görünür). Sunucudan gelen ESKİ bir ara snapshot, o an elimizdeki EN SON
    // iyimser durumla tesadüfen eşleşiyor diye katmanı bırakırsak, hemen
    // ardından gelen bir sonraki (yine eski) snapshot taşı geri götürüyor —
    // kullanıcının gördüğü "son 2 sürükleme geri alınıyor, sonra tekrar
    // yapılıyor" salınımı TAM OLARAK BUYDU. Yazım hattı tamamen boşalmadan
    // hiçbir eşleşmeye güvenmiyoruz.
    if (!isWriteIdle()) return;
    const samePositions = safeRack.every((t, i) => (t?.id ?? null) === (optimisticRack[i]?.id ?? null));
    if (samePositions) setOptimisticRack(null);
  }, [safeRack, optimisticRack, writeSettleTick]);

  // KÖK NEDEN (3. madde — "per ışınlanıyor" + "Per Onayla'da gecikme"):
  // `rack`'ın aksine `groups` (perler) hiç iyimser katmana sahip değildi —
  // "Per Onayla"ya basınca grup SADECE sunucu round-trip'i tamamlanınca
  // (groupOf/allSelectedAreCompleteGroups üzerinden) "grup" olarak
  // TANINIYORDU. Bu, HEM buton tıklandığında görsel tepkinin gecikmeli
  // hissetmesine HEM DE — daha kötüsü — kullanıcı onayladıktan HEMEN sonra
  // (server round-trip bitmeden) o per'i SÜRÜKLEMEYE çalışırsa `groupOf`
  // grubu henüz tanımadığı için sürüklemenin per'in TÜMÜ yerine SADECE
  // dokunulan tek taşı taşımasına (yani per'in "parçalanmasına/ışınlanmasına")
  // yol açıyordu. `optimisticGroups`, `optimisticRack` ile BİREBİR aynı
  // desende, aynı sorunu aynı şekilde çözer.
  const [optimisticGroups, setOptimisticGroups] = useState(null);

  const baseGroups = optimisticGroups || safeGroups;
  const baseGroupsRef = useRef(baseGroups);
  useEffect(() => { baseGroupsRef.current = baseGroups; }, [baseGroups]);

  // Sunucu aynı gruplara ulaştıysa iyimser kopya kendiliğinden düşer.
  // NOT: `groups` (ham prop) bağımlılık olarak kullanılır, `safeGroups`
  // (`groups || {}`) DEĞİL — ikincisi her render'da yeni bir referans
  // sayılabildiği için (lint bunu doğru tespit ediyor) gereksiz tetiklenirdi.
  useEffect(() => {
    if (!optimisticGroups) return;
    if (!isWriteIdle()) return; // bkz. rack'teki aynı gerekçe (eşit görünen ara durumlar)
    const serverGroups = groups || {};
    const serverKeys = Object.keys(serverGroups);
    const optKeys = Object.keys(optimisticGroups);
    const same = serverKeys.length === optKeys.length
      && optKeys.every((gid) => (serverGroups[gid] || []).join(',') === (optimisticGroups[gid] || []).join(','));
    if (same) setOptimisticGroups(null);
  }, [groups, optimisticGroups, writeSettleTick]);

  // Iyimser katman, ıstakadaki TAŞ KÜMESİ değiştiğinde (yukarıdaki 2. kural)
  // rack ile BİRLİKTE bırakılır — perler ıstakadan bağımsız yaşayamaz.
  useEffect(() => {
    if (optimisticRack === null && optimisticGroups !== null) setOptimisticGroups(null);
  }, [optimisticRack, optimisticGroups]);

  // PERFORMANS/DOĞRULUK: `handleUpdateRack` (Okey101Game.jsx) her çağrıldığında
  // sunucudan OKUYUP birleştirip (mergeRackLayout) YAZAN bir transaction'dır.
  // Eskiden HER taş/per hareketinde (applyRack her çağrıldığında) YENİ bir
  // transaction ateşleniyordu. Per düzenlerken/taş taşırken art arda birkaç
  // hareket yapıldığında (çok sık olur) bu transaction'lar BİRBİRİYLE
  // ÇAKIŞIYOR, Firestore'un otomatik "en son yazan kazanır" yeniden deneme
  // mekanizması ise ARADAKİ bir hareketi bazen sunucudaki ESKİ hale göre
  // birleştirip görsel olarak "per eski yerine ışınlanıyor" gibi bir etki
  // yaratıyordu (ayrıca donma/takılma hissine de katkıda bulunuyordu — CPU/ağ
  // art arda birçok transaction'ı aynı anda işliyordu).
  //
  // Çözüm: EKRANDAKİ (iyimser) görünüm HER hareket için ANINDA güncellenir
  // (gecikme YOK), ama sunucuya asıl YAZIM kısa bir süre DEBOUNCE edilip TEK
  // BİR yazım zinciri (writeChainRef) üzerinden SIRAYLA gönderilir — asla iki
  // transaction aynı anda uçuşmaz. `flushRackWrite`, bir aksiyonun (ör. "Seri
  // Aç") sunucudaki GÜNCEL `groups`'a ihtiyaç duyduğu anlarda debounce'u
  // atlayıp hemen (ve varsa önceki yazımların ardından) göndermek için
  // kullanılır. (Hattın ref/state tanımları, iyimser-katman efektlerinin
  // onlara erişebilmesi için bu dosyada DAHA YUKARIDA yapılır.)

  // AYNI ANDA EN FAZLA BİR yazım uçuşta olur. Uçuşta bir yazım varken gelen
  // yeni hareketler `pendingWriteRef` içinde BİRİKİR (eskisinin üzerine yazar)
  // ve uçuştaki bitince SADECE EN GÜNCEL hali gönderilir.
  //
  // Eskiden her hareket zincire AYRI bir transaction ekliyordu: 7 sürükleme =
  // 7 sunucu gidiş-dönüşü = saniyelerce süren bir "ara durum snapshot'ı yağmuru".
  // Artık 7 sürükleme en fazla 2 gidiş-dönüşe (1 uçuştaki + 1 birleştirilmiş
  // son hâl) iner.
  const flushRackWrite = () => {
    if (writeDebounceRef.current) { clearTimeout(writeDebounceRef.current); writeDebounceRef.current = null; }
    if (inFlightRef.current > 0) return writeChainRef.current; // biriksin, bitince gönderilir
    const pending = pendingWriteRef.current;
    if (pending) {
      pendingWriteRef.current = null;
      inFlightRef.current += 1;
      writeChainRef.current = writeChainRef.current
        .then(() => onUpdateRack(pending.rack, pending.groups))
        .catch((err) => console.error('Okey101 ıstaka senkron hatası:', err))
        .finally(() => {
          inFlightRef.current = Math.max(0, inFlightRef.current - 1);
          // Bu arada biriken daha güncel bir hâl varsa onu şimdi gönder.
          if (pendingWriteRef.current) { flushRackWrite(); return; }
          // Hat tamamen boşaldıysa "artık sunucu otoritedir" sinyalini ver
          // (bkz. aşağıdaki iyimser-katman bırakma efekti).
          if (isWriteIdle()) setWriteSettleTick((n) => n + 1);
        });
    }
    return writeChainRef.current;
  };

  // Taşları/perleri yeni düzene taşırken EKRANDA (rack VE groups) hemen
  // göster, sunucuya yazımı debounce et. `immediate` true ise (buton
  // tıklamaları — Per Onayla/Onayı Kaldır/Peri Güncelle gibi seyrek/kasıtlı
  // aksiyonlar) debounce beklenmez, hemen (ve varsa önceki yazımların
  // sırasını koruyarak) gönderilir; SÜRÜKLEME kaynaklı yeniden konumlamalar
  // (sık olabilir) her zaman debounce'lu kalır.
  const applyRack = (newRack, newGroups, { immediate = false } = {}) => {
    baseRackRef.current = newRack; // bir sonraki sürükleme render'ı BEKLEMEDEN bunu görsün
    setOptimisticRack(newRack);
    baseGroupsRef.current = newGroups;
    setOptimisticGroups(newGroups);
    // Yeni bir hareket geldi: bekleyen "iyimser katmanı bırak" planı iptal.
    if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }

    pendingWriteRef.current = { rack: newRack, groups: newGroups };
    if (immediate) { flushRackWrite(); return; }
    if (writeDebounceRef.current) clearTimeout(writeDebounceRef.current);
    // 300ms -> 140ms: ekrandaki görüntü zaten ANINDA güncelleniyor, ama yazımı
    // geciktirmek "sunucu bizim düzenimize ulaşana kadar geçen süreyi" uzatıyor
    // ve iyimser katmanın açık kaldığı pencereyi büyütüyordu. 140ms art arda
    // sürüklemeleri hâlâ tek yazıma birleştirmeye yetiyor.
    writeDebounceRef.current = setTimeout(flushRackWrite, 140);
  };

  // 7. madde — "taş bir anlığına eski yerine ışınlanıp geri geliyor" ARTIĞI:
  // Iyimser katman eskiden SABİT 2500ms'lik kör bir zamanlayıcıyla
  // bırakılıyordu. Yavaş/çakışan bir yazım 2500ms'yi aşarsa, zamanlayıcı
  // yazım DAHA UÇUŞTAYKEN tetikleniyor, ekran o an sunucudaki ESKİ yerleşime
  // düşüyor (taş geri ışınlanıyor), yazım gelince tekrar yeni yerine
  // sıçrıyordu — kullanıcının tarif ettiği çift sıçrama TAM OLARAK buydu.
  //
  // Artık iyimser katman SADECE yazım hattı tamamen boşaldıktan (`isWriteIdle`)
  // KISA bir süre sonra bırakılır. Normal durumda zaten sunucu bizim
  // yerleşimimize ulaştığı an yukarıdaki eşitlik kontrolleri katmanı sessizce
  // düşürür (hiçbir görsel değişiklik olmaz); bu zamanlayıcı yalnızca sunucu
  // GERÇEKTEN farklı bir şey yazdıysa (ör. araya giren bir çekme) devreye
  // girer — ve o zaman da düzeltme DOĞRUdur, üstelik yazım bittikten sonra
  // yalnızca BİR KEZ olur.
  // EMNİYET AĞI (normalde HİÇ tetiklenmez): iyimser katmanın asıl bırakılma
  // yolu yukarıdaki İÇERİK karşılaştırmalarıdır. Bu zamanlayıcı sadece patolojik
  // bir durumda (yazım kalıcı olarak başarısız oldu ve sunucu bizim yerleşimimize
  // HİÇ ulaşmayacak) ekranın sonsuza dek kaydedilmemiş bir düzeni göstermesini
  // engeller. Süre bilerek UZUN (4sn) tutulur — eski 500ms'lik sürüm, son yazımın
  // snapshot'ı gelmeden tetiklenip ekranı ara duruma geri sıçratıyordu.
  useEffect(() => {
    if (!optimisticRack && !optimisticGroups) return;
    if (!isWriteIdle()) return;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      if (!isWriteIdle()) return; // bu arada yeni bir hareket geldiyse dokunma
      setOptimisticRack(null);
      setOptimisticGroups(null);
    }, 4000);
    return () => { if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; } };
  }, [optimisticRack, optimisticGroups, writeSettleTick]);

  const clearLongPress = () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  };
  useEffect(() => clearLongPress, []);

  // NOT: Istakadan çıkan (atılan/işlenen/açılan) bir taşın ters-çevrilme
  // işareti artık burada TEK TEK temizlenmiyor — bu state Okey101Game'e
  // taşındığı için (bkz. flippedTileIds prop yorumu) orada EL (round)
  // sınırında topluca sıfırlanıyor. Aradaki (aynı el içinde) birkaç
  // "kullanılmış" id'nin Set'te kalması zararsızdır (görsel bir etkisi yoktur,
  // asla büyük bir listeye dönüşmez).

  // Çekilen taş, sunucu cevabı beklenmeden bırakıldığı slotta gösterilir
  // (bkz. Okey101Game#performDraw). Gerçek veri gelince prop kendiliğinden
  // düşer ve aşağıdaki birleştirme etkisiz kalır.
  // Taş gerçek ıstakada (hangi slotta olursa olsun) göründüğü an iyimser
  // kopya devre dışı kalır — aksi halde sunucu taşı farklı bir slota yazarsa
  // bir kare boyunca çift görünürdü.
  const pendingVisible = !!pendingDraw
    && !baseRack[pendingDraw.index]
    && !baseRack.some((t) => t && t.id === pendingDraw.tile.id);
  const displayRack = useMemo(() => {
    if (!pendingVisible) return baseRack;
    const next = [...baseRack];
    next[pendingDraw.index] = pendingDraw.tile;
    return next;
  }, [baseRack, pendingDraw, pendingVisible]);
  const pendingTileId = pendingVisible ? pendingDraw.tile.id : null;

  const groupOf = useMemo(() => {
    const map = {};
    Object.entries(baseGroups).forEach(([gid, tileIds]) => tileIds.forEach((tid) => { map[tid] = gid; }));
    return map;
  }, [baseGroups]);

  // BUG DÜZELTMESİ — "görünmeyen ama seçili kalan taş":
  // `selected` sadece taş ID'si tutar. Seçili bir taş ıstakadan ÇIKTIĞINDA
  // (elle atıldığında, 30sn dolunca OTOMATİK atıldığında, masaya per olarak
  // sürüldüğünde ya da işlendiğinde) ID'si bu kümede KALIYORDU. O taş artık
  // çizilmediği için ekranda hiçbir seçim görünmüyor, ama:
  //   - `selectedIds.length` bir fazla sayılıyor,
  //   - tek bir taşa tıklamak `canAttemptConfirm` (>=2 seçili) şartını
  //     sağlayıp "Per Onayla" butonunu ORTAYA ÇIKARIYOR,
  //   - onaya basınca hayalet taş ıstakada bulunamadığı için bitişiklik
  //     kontrolü "taşların yan yana olması gerekir" hatası veriyordu.
  // Çözüm: ıstakada artık var olmayan ID'ler her yerleşim değişiminde temizlenir.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set();
      baseRack.forEach((t) => { if (t) live.add(t.id); });
      const next = new Set();
      prev.forEach((id) => { if (live.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }, [baseRack]);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const allUngrouped = selectedIds.length > 0 && selectedIds.every((id) => !groupOf[id]);
  const contiguous = allUngrouped && isContiguousSelection(selectedIds, baseRack);
  const canAttemptConfirm = allUngrouped && selectedIds.length >= 2;

  // Seçimdeki her taş bir gruba ait VE o grupların TÜM taşları seçili mi?
  const selectedGroupIds = useMemo(() => {
    const gids = new Set();
    selectedIds.forEach((id) => { const g = groupOf[id]; if (g) gids.add(g); });
    return [...gids];
  }, [selectedIds, groupOf]);
  const allSelectedAreCompleteGroups = selectedIds.length > 0
    && selectedIds.every((id) => groupOf[id])
    && selectedGroupIds.every((gid) => (baseGroups[gid] || []).every((id) => selected.has(id)));
  const canRemoveGroup = allSelectedAreCompleteGroups && selectedGroupIds.length === 1;
  // "Peri Güncelle" (2. madde): TAM BİR mevcut per (tümüyle seçili) + ona
  // bitişik getirilmiş TEK bir grupsuz taş seçiliyse, peri bozup baştan
  // seçmek yerine doğrudan büyütülmüş per olarak güncellenebilir.
  const ungroupedSelectedIds = useMemo(() => selectedIds.filter((id) => !groupOf[id]), [selectedIds, groupOf]);
  const canAttemptUpdateGroup = selectedGroupIds.length === 1
    && ungroupedSelectedIds.length === 1
    && selectedIds.length === (baseGroups[selectedGroupIds[0]] || []).length + 1;
  const canOpenSeries = allSelectedAreCompleteGroups && selectedGroupIds.length >= 1 && canAct && canOpenMeldsRule;
  // İlk açılışta EN AZ `minPairsToOpen` (normalde 5; katlamalı modda masadaki
  // çift barajının bir fazlası) çift gerekir — ÜST SINIR YOKTUR: elinde 6-7
  // çift olan oyuncu hepsini tek seferde açabilir (ve katlamalı modda barajı
  // doğrudan o sayıya kurar). Eskiden burada `=== 5` yazdığı için 6. çift
  // seçilince "Çift Aç" butonu kayboluyordu.
  // Zaten açmış (ve kural gereği çift sürebilen) bir oyuncu için 1+ yeterlidir.
  const pairCountOk = hasOpenedAlready ? selectedGroupIds.length >= 1 : selectedGroupIds.length >= minPairsToOpen;
  const canOpenPairs = allSelectedAreCompleteGroups && pairCountOk && canAct && canOpenPairsRule;

  // `immediate`: Per Onayla/Onayı Kaldır/Peri Güncelle gibi SEYREK, KASITLI
  // buton tıklamaları debounce'u atlayıp hemen yazar (bkz. applyRack).
  const commit = (newRack, newGroups, { immediate = false } = {}) => {
    setSelected(new Set());
    applyRack(newRack, newGroups ?? baseGroups, { immediate });
  };

  // Gruplu bir taşa tıklamak artık o grubu seçimden EKLER/ÇIKARIR (diğer seçili
  // gruplar korunur) — böylece "Seri Aç"/"Çift Aç" için birden fazla per aynı anda seçilebilir.
  const handleTileTap = (tile) => {
    if (!isOwner) return;
    // Taşa dokunma sesi SADECE yereldir (oyunu ilgilendiren bir hamle değil,
    // sadece seçim) — bkz. Okey101Game'deki masa çapında sesler.
    playOkeySound('tile');
    const gid = groupOf[tile.id];
    if (gid) {
      const groupTileIds = baseGroups[gid] || [];
      const fullyIncluded = groupTileIds.length > 0 && groupTileIds.every((id) => selected.has(id));
      setSelected((prev) => {
        const next = new Set(prev);
        groupTileIds.forEach((id) => { if (fullyIncluded) next.delete(id); else next.add(id); });
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(tile.id)) next.delete(tile.id); else next.add(tile.id);
        return next;
      });
    }
  };

  // "Per Onayla": 1) seçili taşlar ıstakada yan yana mı? 2) seçim gerçekten
  // geçerli mi — 3+ taşta geçerli bir per (set/seri) VE seri ise doğru sırada,
  // TAM 2 taşta ise geçerli bir ÇİFT. Sağlanmıyorsa toast ile net bir hata
  // gösterilir ve hiçbir şey gruplanmaz.
  //
  // 1. madde: 2 taşlık seçimler eskiden HİÇ doğrulanmıyordu — "sarı 7 + sarı 8"
  // gibi çift OLMAYAN ikililer de per olarak onaylanabiliyordu. Artık aynı
  // renk+sayı (ya da joker) şartı aranıyor. Jokerler için bkz. isPairWildcard:
  // gerçek Okey, Sahte Okey ve (2. madde) Gösterge taşı çift kurabilir.
  const confirmGroup = () => {
    if (!contiguous) { showToast?.('Taşlar yan yana olmalı!', 'red'); return; }
    const orderedTiles = baseRack.filter((t) => t && selected.has(t.id));
    if (selectedIds.length === 2) {
      if (!isValidPairTiles(orderedTiles[0], orderedTiles[1], okeyInfo, indicator)) {
        showToast?.('Bu iki sayı per oluşturmaz! Çift için aynı renk ve aynı sayı gerekir.', 'red');
        return;
      }
    } else if (selectedIds.length >= 3) {
      // KULLANICI İSTEĞİ: seri, ıstakada KÜÇÜKTEN BÜYÜĞE (7-8-9) ya da
      // BÜYÜKTEN KÜÇÜĞE (9-8-7) dizilmiş olabilir — ikisi de onaylanır. Ama
      // KARIŞIK bir sıra (ör. 9-7-8) kabul EDİLMEZ (bkz.
      // gameLogic#isSequentiallyOrderedGroup). Masaya açılırken diziliş her
      // koşulda artan sıraya normalize edilir (Okey101Game#orderGroupTiles).
      const result = validateGroup(orderedTiles, okeyInfo);
      if (!result.valid) { showToast?.('Geçersiz Per Dizilimi!', 'red'); return; }
      if (!isSequentiallyOrderedGroup(orderedTiles, result.type, okeyInfo)) {
        showToast?.('Perinizi sırayla diziniz (küçükten büyüğe ya da büyükten küçüğe)!', 'red');
        return;
      }
    }
    const gid = `G${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const ordered = orderedTiles.map((t) => t.id);
    commit(baseRack, { ...baseGroups, [gid]: ordered }, { immediate: true });
  };

  const removeGroup = () => {
    const gid = groupOf[selectedIds[0]];
    const nextGroups = { ...baseGroups };
    delete nextGroups[gid];
    commit(baseRack, nextGroups, { immediate: true });
  };

  // "Peri Güncelle": mevcut peri bozup taşları tek tek yeniden seçmek yerine,
  // perin YANINA getirilmiş uygun bir taşı doğrudan pere katar. Aynı
  // confirmGroup'taki katı doğrulama (dizilim + sıra) burada da uygulanır —
  // tek fark, per'in KENDİSİ zaten var olduğu için "Onayı Kaldır + Per
  // Onayla" iki adımını tek adıma indirmesi.
  const updateGroup = () => {
    if (!canAttemptUpdateGroup) return;
    if (!isContiguousSelection(selectedIds, baseRack)) { showToast?.('Taş, perin hemen yanına gelmeli!', 'red'); return; }
    const orderedTiles = baseRack.filter((t) => t && selected.has(t.id));
    const result = validateGroup(orderedTiles, okeyInfo);
    if (!result.valid) { showToast?.('Bu taşla per güncellenemez — geçersiz dizilim!', 'red'); return; }
    if (!isSequentiallyOrderedGroup(orderedTiles, result.type, okeyInfo)) {
      showToast?.('Perinizi sırayla diziniz (küçükten büyüğe ya da büyükten küçüğe)!', 'red');
      return;
    }
    const oldGid = selectedGroupIds[0];
    const newGid = `G${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const nextGroups = { ...baseGroups };
    delete nextGroups[oldGid];
    nextGroups[newGid] = orderedTiles.map((t) => t.id);
    commit(baseRack, nextGroups, { immediate: true });
  };

  // ============================================================
  // YARDIMLI MOD (rules.assistedEnabled) — otomatik dizme
  // ============================================================
  // KULLANICI İSTEĞİ: "Seri Diz" elindeki en değerli seri/set kombinasyonunu,
  // "Çift Diz" ise elindeki TÜM çiftleri per olarak ONAYLAYIP ıstakayı en sol
  // üstten sağa doğru yeniden dizer (bkz. assist.js). Perler oyuncunun elle
  // kurabileceğiyle aynı doğrulayıcılardan geçer — kural avantajı YOKTUR.
  //
  // `cols` (ekrandaki gerçek satır uzunluğu) verilir: bir per satır sonunda
  // BÖLÜNMEZ, sığmıyorsa bütün halinde bir alt satıra iner.
  const assistedTotal = useMemo(
    () => (assisted ? confirmedMeldTotal(baseGroups, baseRack, okeyInfo) : 0),
    [assisted, baseGroups, baseRack, okeyInfo],
  );

  const applyArrangement = (result, emptyMsg) => {
    if (!result) { showToast?.(emptyMsg, 'red'); return; }
    playOkeySound('tile');
    // `immediate`: kasıtlı bir buton tıklaması — debounce beklenmez.
    commit(result.rack, result.groups, { immediate: true });
  };

  const arrangeSeries = () => applyArrangement(
    buildSeriesArrangement(baseRackRef.current, okeyInfo, cols),
    'Elinde per yapılabilecek bir seri/set yok.',
  );

  const arrangePairs = () => applyArrangement(
    buildPairsArrangement(baseRackRef.current, okeyInfo, indicator, cols),
    'Elinde çift yapılabilecek taş yok.',
  );

  // KULLANICI İSTEĞİ: "Seri Aç"/"Çift Aç" — manuel seçim gerektiren
  // (allSelectedAreCompleteGroups'a bağlı) genel butonların aksine, bunlar
  // ONAYLI (baseGroups) perlerin/tam çiftlerin HEPSİNİ tek tıkla sunucuya
  // gönderir. Sınırı geçip geçmediği yine SUNUCUDA (handleOpenSeries/
  // handleOpenPairs) doğrulanır — burada sadece "gönderilecek bir şey var
  // mı" ve mevcut buton kuralları (sıra/kural) kontrol edilir.
  const assistedMeldGroupIds = useMemo(
    () => Object.keys(baseGroups).filter((gid) => (baseGroups[gid] || []).length >= 3),
    [baseGroups],
  );
  const assistedPairGroupIds = useMemo(
    () => Object.keys(baseGroups).filter((gid) => (baseGroups[gid] || []).length === 2),
    [baseGroups],
  );
  const assistedPairsRequired = hasOpenedAlready ? 1 : minPairsToOpen;

  const assistedOpenSeries = async () => {
    if (assistedMeldGroupIds.length === 0 || !canAct || !canOpenMeldsRule || !onOpenSeries) return;
    await flushRackWrite();
    await onOpenSeries(assistedMeldGroupIds);
  };

  const assistedOpenPairs = async () => {
    if (assistedPairGroupIds.length === 0 || !canAct || !canOpenPairsRule || !onOpenPairs) return;
    await flushRackWrite();
    await onOpenPairs(assistedPairGroupIds);
  };

  // NOT: `onOpenSeries`/`onOpenPairs`, sunucudaki (debounce'lanmış olabilecek)
  // `groups` alanını okuyup seçili grup id'lerini ORADA arar. Debounce henüz
  // gönderilmemiş bir per varsa, açmadan ÖNCE `flushRackWrite` ile hemen (ve
  // varsa önceki yazımların sırasını koruyarak) sunucuya yazdırılır — aksi
  // halde sunucu o per'i henüz bilmediği için açma sessizce başarısız olurdu.
  const openSeries = async () => {
    if (!canOpenSeries || !onOpenSeries) return;
    setSelected(new Set());
    await flushRackWrite();
    await onOpenSeries(selectedGroupIds);
  };

  const openPairs = async () => {
    if (!canOpenPairs || !onOpenPairs) return;
    setSelected(new Set());
    await flushRackWrite();
    await onOpenPairs(selectedGroupIds);
  };

  const clearTackHover = () => {
    if (tackHoverElRef.current) { tackHoverElRef.current.style.backgroundColor = ''; tackHoverElRef.current = null; }
  };

  const clearCenterFinishHover = () => {
    if (centerFinishHoverElRef.current) {
      centerFinishHoverElRef.current.style.transform = '';
      centerFinishHoverElRef.current.style.filter = '';
      centerFinishHoverElRef.current = null;
    }
  };

  const clearReturnHover = () => {
    if (returnHoverElRef.current) {
      returnHoverElRef.current.style.transform = '';
      returnHoverElRef.current.style.filter = '';
      returnHoverElRef.current = null;
    }
  };

  // ---- Pointer tabanlı sürükle-bırak (mouse + dokunmatik ortak) ----
  const handlePointerDown = (e, index, tile) => {
    if (!isOwner || !tile) return;
    if (tile.id === pendingTileId) return; // sunucu onayı beklenen taş henüz taşınamaz
    // Tarayıcının kendi metin-seçimi + HTML5 sürüklemesi devreye girerse imleç
    // "yasak" (kırmızı çarpı) olur ve seçili DOM parçaları hayalet resim olarak
    // birlikte sürüklenir; bunu baştan engelliyoruz.
    e.preventDefault();
    window.getSelection?.()?.removeAllRanges?.();

    // `index` (render closure'undan gelen prop) BAYAT olabilir — bkz. baseRackRef
    // yorumu yukarıda. Taşın GERÇEK/GÜNCEL slotu her zaman ref'ten yeniden
    // bulunur; render henüz yetişmediyse bile bu doğru sonucu verir.
    const rackNow = baseRackRef.current;
    const freshIndex = rackNow.findIndex((t) => t && t.id === tile.id);
    const fromIndex = freshIndex !== -1 ? freshIndex : index;

    // `groupOf` (useMemo) render'a bağlıdır ve art arda hızlı sürüklemelerde
    // (bkz. baseRackRef yorumu) BAYAT olabilir; grup burada doğrudan
    // `baseGroupsRef`'ten (senkron güncellenen) taranarak bulunur.
    const gid = Object.keys(baseGroupsRef.current).find((g) => baseGroupsRef.current[g].includes(tile.id)) || null;
    const tileIds = gid ? (baseGroupsRef.current[gid] || [tile.id]) : [tile.id];
    // Grup içinde TUTULAN taşın kaçıncı sırada olduğu: bırakırken blok, imlecin
    // altındaki slot bu taşa denk gelecek şekilde konumlanır. Böylece per'i
    // ortasından tutup boş alanın ortasına bırakmak da doğru çalışır.
    const grabOffset = Math.max(0, tileIds.indexOf(tile.id));
    const tiles = tileIds.map((id) => rackNow.find((t) => t && t.id === id)).filter(Boolean);
    dragRef.current = { fromIndex, tileIds, grabOffset, startX: e.clientX, startY: e.clientY, moved: false, longPressed: false, tile, tiles };
    dropTargetRef.current = { index: null, discard: false }; // önceki sürüklemeden kalan hedef temizlenir
    e.currentTarget.setPointerCapture?.(e.pointerId);

    // 1sn basılı tutma -> taşı ters çevir / düzelt (bkz. LONG_PRESS_MS).
    // SADECE gerçek Okey taşında çalışır — diğer taşlar ters çevrilemez.
    clearLongPress();
    if (isOkeyTile(tile, okeyInfo)) {
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        const d = dragRef.current;
        if (!d || d.moved || d.tile.id !== tile.id) return;
        d.longPressed = true;
        playOkeySound('flip'); // taşın arkası dönerken kısık çevirme sesi
        toggleFlipped(tile.id);
      }, LONG_PRESS_MS);
    }
  };

  const handlePointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX; const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      d.moved = true;
      clearLongPress();
      // Ghost'u sadece BİR KEZ (hareket başladığında) mount ediyoruz — bundan
      // sonraki pozisyon güncellemeleri state DEĞİL, doğrudan DOM yazımı
      // (bkz. applyGhostTransform). Bu, sürükleme sırasında PlayerRack'in
      // (ve 30 taş slotunun) her piksel için yeniden render olmasını önler.
      setGhost({ tiles: d.tiles, grabOffset: d.grabOffset });
    }
    if (!d.moved) return;

    d.lastX = e.clientX; d.lastY = e.clientY;
    if (ghostElRef.current) applyGhostTransform(ghostElRef.current, e.clientX, e.clientY, d.grabOffset);

    // PERFORMANS: Hedef tespiti (elementFromPoint + birkaç `closest` taraması)
    // pahalıdır, `pointermove` ise saniyede 100+ kez tetiklenebilir. Hayalet
    // taşın imleci takip etmesi her olayda ANINDA yapılır (yukarıda), ama
    // hedef tespiti her ANİMASYON KARESİNDE en fazla bir kez çalışır.
    if (moveRafRef.current) return;
    moveRafRef.current = requestAnimationFrame(() => {
      moveRafRef.current = 0;
      if (dragRef.current === d) updateDropTarget(d.lastX, d.lastY);
    });
  };

  const updateDropTarget = (clientX, clientY) => {
    const d = dragRef.current;
    if (!d) return;
    const el = document.elementFromPoint(clientX, clientY);
    const slotEl = el?.closest('[data-slot-index]');
    const discardEl = el?.closest('[data-discard-zone]');
    // 4. madde: elini bitirecek son taş, Okey101Game'in Gösterge yanına
    // koyduğu (bu bileşenin DIŞINDaki) "Bitir" hedefine de bırakılabilir.
    // `document.elementFromPoint` sayfadaki HERHANGİ bir elementi bulabildiği
    // için PlayerRack sınırlarının dışındaki bu hedefi de aynı sürükleme
    // jestiyle yakalayabiliyoruz.
    const centerFinishEl = canDiscard ? el?.closest('[data-center-finish-zone]') : null;
    const tackEl = (canAct && hasOpenedAlready && d.tileIds.length === 1) ? el?.closest('[data-tack-uid]') : null;
    // KULLANICI İSTEĞİ: yandan alınan (henüz kullanılmamış) taş, ortadaki
    // "Taşı Geri Koy" butonuna ek olarak SOLDAN ÇEK bölmesine sürüklenerek de
    // iade edilebilsin. Sadece TAM O taş (tek başına, gruplanmamış) sürüklenirken
    // ve o taş gerçekten bekleyen sideTake ise geçerlidir.
    const returnEl = (sideTakeTileId && d.tileIds.length === 1 && d.tile.id === sideTakeTileId)
      ? el?.closest('[data-return-zone]') : null;

    if (tackEl !== tackHoverElRef.current) { clearTackHover(); if (tackEl) { tackEl.style.backgroundColor = TACK_HOVER_COLOR; tackHoverElRef.current = tackEl; } }
    if (centerFinishEl !== centerFinishHoverElRef.current) {
      clearCenterFinishHover();
      if (centerFinishEl) { centerFinishEl.style.transform = 'scale(1.15)'; centerFinishEl.style.filter = 'brightness(1.3)'; centerFinishHoverElRef.current = centerFinishEl; }
    }
    if (returnEl !== returnHoverElRef.current) {
      clearReturnHover();
      if (returnEl) { returnEl.style.transform = 'scale(1.15)'; returnEl.style.filter = 'brightness(1.3)'; returnHoverElRef.current = returnEl; }
    }

    let index = null; let discard = false;
    if (tackEl || centerFinishEl || returnEl) { /* hedef zaten işleme/bitirme/iade alanı */ }
    else if (slotEl) index = Number(slotEl.dataset.slotIndex);
    else if (discardEl) discard = true;

    // Bırakma kararı REF'ten okunur (bkz. finishDrag): hedef tespiti animasyon
    // karesine ertelendiği için, parmak kaldırıldığı anda React state'i bir
    // kare geride kalabiliyor — ref her zaman en son hesaplanan hedefi tutar.
    dropTargetRef.current = { index, discard };
    setHoverIndex(index);
    setHoverDiscard(discard);
  };

  // Bir taşı ıstakadan İYİMSER olarak hemen gizler (bkz. optimisticGoneId
  // yorumu), sonra `action`'ı çağırır; sonuç başarısızsa (ya da hiç
  // sonuçlanmazsa — bkz. emniyet zaman aşımı) taş geri getirilir. Hem atma
  // (performDiscardDrop) HEM DE işleme (finishDrag'in `tackEl` dalı) bu ORTAK
  // mekanizmayı kullanır — ikisi de kullanıcı açısından "bu taş ıstakamdan
  // AYRILDI" anlamına gelir.
  const optimisticallyRemoveTile = (tileId, action) => {
    setOptimisticGoneId(tileId);
    if (optimisticGoneTimerRef.current) clearTimeout(optimisticGoneTimerRef.current);
    optimisticGoneTimerRef.current = setTimeout(() => {
      setOptimisticGoneId((cur) => (cur === tileId ? null : cur));
    }, 4000);
    Promise.resolve(action())
      .then((result) => { if (!result || result.success === false) setOptimisticGoneId((cur) => (cur === tileId ? null : cur)); })
      .catch(() => setOptimisticGoneId((cur) => (cur === tileId ? null : cur)));
  };

  // Bir taşı (son bitiriş taşı ya da normal atış) sunucuya atma isteği gönderir.
  // Hem alt "Sağa At" bölmesi hem de Gösterge yanındaki "Bitir" hedefi bunu kullanır.
  const performDiscardDrop = (tile) => {
    if (!canDiscard || !onDiscardTile) return;
    optimisticallyRemoveTile(tile.id, () => onDiscardTile(tile));
  };

  const finishDrag = () => {
    const d = dragRef.current;
    // Bekleyen bir hedef-tespiti karesi varsa (parmak, son hareketten sonraki
    // animasyon karesi gelmeden kaldırıldıysa) hedef BURADA senkron olarak
    // hesaplanır — taşın bir kare eski slota bırakılması ihtimali kalmaz.
    if (moveRafRef.current) {
      cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = 0;
      if (d?.moved && d.lastX !== undefined) updateDropTarget(d.lastX, d.lastY);
    }
    dragRef.current = null;
    clearLongPress();
    setGhost(null);
    const { index: dropIndex, discard: droppedOnDiscard } = dropTargetRef.current;
    dropTargetRef.current = { index: null, discard: false };
    const tackEl = tackHoverElRef.current;
    const centerFinishEl = centerFinishHoverElRef.current;
    const returnEl = returnHoverElRef.current;
    clearTackHover();
    clearCenterFinishHover();
    clearReturnHover();
    setHoverIndex(null);
    setHoverDiscard(false);
    if (!d) return;

    if (!d.moved) {
      // Uzun basma zaten taşı ters çevirdi; ayrıca seçim yapılmaz.
      if (!d.longPressed) handleTileTap(d.tile);
      return;
    }

    if (returnEl) {
      if (onCancelSideTake) optimisticallyRemoveTile(d.tile.id, () => onCancelSideTake());
      return;
    }

    if (tackEl) {
      if (onTackTile) {
        const target = { uid: tackEl.dataset.tackUid, groupIndex: Number(tackEl.dataset.tackIndex) };
        if (tackEl.dataset.tackReplaceTileId) target.replaceTileId = tackEl.dataset.tackReplaceTileId;
        else target.side = tackEl.dataset.tackSide;
        // bkz. optimisticGoneId yorumu: işleme de atma gibi taşı ANINDA
        // (sunucu round-trip'i beklemeden) ıstakadan gizler.
        optimisticallyRemoveTile(d.tile.id, () => onTackTile(d.tile, target));
      }
      return;
    }

    if (centerFinishEl) { performDiscardDrop(d.tile); return; }

    if (droppedOnDiscard) {
      // Bir per'e ait olsa bile atarken sadece TEK taş atılır (grup bölünür).
      performDiscardDrop(d.tile);
      return;
    }

    if (dropIndex === null) return;

    // Yine BAYAT `baseRack` closure'u yerine ref'teki en güncel yerleşim
    // kullanılır (bkz. handlePointerDown'daki aynı gerekçe).
    const rackNow = baseRackRef.current;

    if (d.tileIds.length > 1) {
      // Blok, TUTULAN taş imlecin altındaki slota gelecek şekilde hizalanır.
      const start = Math.max(0, Math.min(dropIndex - d.grabOffset, RACK_SLOTS - d.tileIds.length));
      const newRack = moveGroupBlockToSlot(rackNow, d.tileIds, start);
      if (newRack !== rackNow) { playOkeySound('tile'); applyRack(newRack, baseGroupsRef.current); }
      return;
    }

    if (dropIndex === d.fromIndex) return;
    // Hedef, taşınmayan BAŞKA bir grubun taşıysa reddet (grup bölünmesin).
    const targetTile = rackNow[dropIndex];
    if (targetTile && Object.keys(baseGroupsRef.current).some((g) => baseGroupsRef.current[g].includes(targetTile.id))) return;

    // Sabit slot fiziği: sadece hedef slot etkilenir, diğer taşlar ASLA kaymaz
    // (boşsa taş oraya gider, doluysa yer değiştirir).
    playOkeySound('tile'); // taş bırakıldı — dokunma sesiyle aynı tahta tıkırtısı
    applyRack(moveTileToSlot(rackNow, d.fromIndex, dropIndex), baseGroupsRef.current);
  };

  // bkz. RackSlot: memoize edilmiş slotların gereksiz yere yeniden çizilmemesi
  // için işleyiciler SABİT KİMLİKLİ sarmalayıcılar üzerinden verilir. Gerçek
  // işleyiciler (güncel state'i gören closure'lar) her render'da tazelenir ama
  // slotların gördüğü `handlers` nesnesi hiç değişmez.
  const liveHandlersRef = useRef({});
  liveHandlersRef.current.pointerDown = handlePointerDown;
  liveHandlersRef.current.pointerMove = handlePointerMove;
  liveHandlersRef.current.finishDrag = finishDrag;
  const slotHandlers = useMemo(() => ({
    onPointerDown: (e, index, tile) => liveHandlersRef.current.pointerDown(e, index, tile),
    onPointerMove: (e) => liveHandlersRef.current.pointerMove(e),
    onPointerUp: () => liveHandlersRef.current.finishDrag(),
  }), []);

  // Okey bilgisi ({color, number}) her Firestore paketinde YENİ bir nesne olarak
  // gelir ama içeriği el boyunca sabittir; slot memoizasyonunun her snapshot'ta
  // boşa düşmemesi için sabitlenir.
  const stableOkeyInfo = useMemo(
    () => (okeyInfo ? { color: okeyInfo.color, number: okeyInfo.number } : null),
    [okeyInfo?.color, okeyInfo?.number],
  );

  // Sürüklenen taşların id'leri (soluk çizilirler). `ghost` bir state olduğu
  // için render sırasında güvenle okunur — `dragRef` (ref) okumak memoize
  // slotlarla birlikte güvenilir çalışmazdı.
  const draggingIds = useMemo(() => (ghost ? new Set(ghost.tiles.map((t) => t.id)) : null), [ghost]);

  const renderRow = (rowIndex) => {
    const start = rowIndex * cols;
    const slots = displayRack.slice(start, start + cols);
    return (
      <div
        key={rowIndex}
        style={{ gap: `${gap}px`, padding: `${ROW_PADDING_PX}px` }}
        className="flex justify-center bg-emerald-950/40 rounded-lg border border-emerald-900/60"
      >
        {slots.map((tile, i) => {
          const index = start + i;
          return (
            <RackSlot
              key={index}
              index={index}
              tile={tile}
              tileW={tileW}
              tileH={tileH}
              isHover={hoverIndex === index && !!ghost}
              hidden={!!tile && tile.id === optimisticGoneId}
              isPending={!!tile && tile.id === pendingTileId}
              selected={!!tile && selected.has(tile.id)}
              grouped={!!tile && !!groupOf[tile.id]}
              faceDown={!!tile && flippedIds.has(tile.id)}
              dragging={!!tile && !!draggingIds?.has(tile.id)}
              revealing={!!tile && flipTileId === tile.id}
              tackable={assisted && !!tile && !!tackableTileIds?.has(tile.id)}
              okeyInfo={stableOkeyInfo}
              handlers={slotHandlers}
            />
          );
        })}
      </div>
    );
  };

  // SOL/AT bölmeleri: geniş ekranda ıstakanın ÜSTÜNDE ayrı bir satırda durur.
  // KOMPAKT (telefon yatay) modda ise dikey alan çok kıymetli olduğu ve yatayda
  // bol yer bulunduğu için ıstakanın SOLUNA ve SAĞINA alınır — böylece taşlar
  // belirgin şekilde büyüyebilir.
  const sideSlotW = Math.round(tileW * SIDE_SLOT_RATIO);
  const sideSlotH = Math.round(sideSlotW * TILE_ASPECT);
  const sideTileW = Math.round(tileW * 1.05);

  // KULLANICI İSTEĞİ: yandan aldığın (henüz kullanmadığın) taşı iade etmek
  // için ortadaki "Taşı Geri Koy" butonu tek yol OLMASIN — aynı bölme
  // (taşın buradan geldiği yer) bu taşı GERİ SÜRÜKLEYİP bırakmak için de bir
  // hedef olur. `sideTakeTileId` doluyken bu bölme normal "yandan çek"
  // rolünden ayrılır — görünümü (kırmızımsı) ve davranışı buna göre değişir.
  // KÖK NEDEN DÜZELTMESİ: `onPointerMove`/`onPointerUp` gibi JSX prop'ları
  // `sideTakeTileId` yokken `undefined` DEĞERİYLE veriliyordu — spread'den
  // SONRA geldikleri için (JSX'te sonraki prop kazanır) `incomingDragHandlers`
  // içindeki GERÇEK işleyicileri `undefined` ile EZİP normal "yandan çek"
  // akışını komple bozuyordu (tıklama/sürükleme hiçbir şey yapmıyordu). İki
  // mod KARŞILIKLI DIŞLAYICI olduğu için (`canTakeIncoming` ve
  // `sideTakeTileId` asla aynı anda doğru olmaz) artık aktif OLMAYAN taraf
  // BOŞ bir nesne ({}), `undefined` değerli anahtarlar İÇEREN bir nesne
  // DEĞİL — böylece hangisi aktifse onun işleyicileri ayakta kalır.
  const takeHandlers = (canTakeIncoming && incomingDragHandlers) ? incomingDragHandlers : {};
  const returnHandlers = sideTakeTileId ? { onPointerMove: handlePointerMove, onPointerUp: finishDrag, onPointerCancel: finishDrag } : {};
  const incomingSlot = (
    <div className="flex flex-col items-center gap-1">
      <div
        {...takeHandlers}
        {...returnHandlers}
        data-return-zone={sideTakeTileId ? 'true' : undefined}
        title={sideTakeTileId
          ? 'Yandan aldığın taşı geri koymak için buraya sürükle'
          : (canTakeIncoming ? 'Solundaki oyuncunun attığı taşı çek (tıkla ya da ıstakaya sürükle)' : 'Solundaki oyuncunun son attığı taş')}
        style={{ width: `${sideSlotW}px`, height: `${sideSlotH}px` }}
        className={`rounded-lg border-2 border-dashed flex items-center justify-center transition-colors touch-none
          ${sideTakeTileId ? 'border-rose-400 bg-rose-500/10 animate-pulse' : (canTakeIncoming ? 'border-amber-400 bg-amber-400/10 animate-pulse cursor-grab active:cursor-grabbing' : 'border-slate-600/70 bg-slate-900/40')}`}
      >
        {incomingDiscard
          ? <Tile tile={incomingDiscard} width={sideTileW} okeyInfo={okeyInfo} dimmed={!canTakeIncoming} />
          : <span className="text-[8px] font-bold text-slate-500 text-center leading-tight px-0.5">BOŞ</span>}
      </div>
      <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">Soldan Çek</span>
    </div>
  );

  // NOT: elde tam 1 taş kalıp eli bitirecek atış söz konusu olduğunda, ASIL
  // bitiriş hedefi artık göstergenin yanındaki YENİ
  // "Bitir" bölgesidir (bkz. Okey101Game#data-center-finish-zone). Bu alt
  // bölme her zaman sade "Sağa At" olarak kalır — buraya bırakılan bitiriş
  // taşı da (sunucu tarafında) yine doğru şekilde ortaya (centerDiscard)
  // yazılır, sadece burası artık "önerilen"/öne çıkan hedef DEĞİLDİR.
  const discardSlot = (
    <div className="flex flex-col items-center gap-1">
      <div
        data-discard-zone={canDiscard ? 'true' : undefined}
        onPointerMove={canDiscard ? handlePointerMove : undefined}
        onPointerUp={canDiscard ? finishDrag : undefined}
        onPointerCancel={canDiscard ? finishDrag : undefined}
        title={canDiscard ? 'Turu bitirmek için bir taşı buraya sürükle' : 'Son attığın taş'}
        style={{ width: `${sideSlotW}px`, height: `${sideSlotH}px` }}
        className={`rounded-lg border-2 border-dashed flex items-center justify-center transition-colors touch-none
          ${canDiscard ? (hoverDiscard ? 'border-red-400 bg-red-500/30 scale-110' : 'border-amber-400 bg-amber-400/10 animate-pulse') : 'border-slate-600/70 bg-slate-900/40'}`}
      >
        {lastDiscardTile
          ? <Tile tile={lastDiscardTile} width={sideTileW} okeyInfo={okeyInfo} dimmed={!canDiscard} />
          : canDiscard
            ? <span className="text-[8px] font-bold text-amber-300/90 text-center leading-tight px-0.5">AT</span>
            : null}
      </div>
      <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">Sağa At</span>
    </div>
  );

  const rackRows = (
    <div
      className="flex flex-col w-full mx-auto"
      style={{ gap: `${Math.max(3, Math.round(gap * 1.4))}px`, maxWidth: `${rowWidth}px` }}
    >
      {Array.from({ length: rows }, (_, i) => renderRow(i))}
    </div>
  );

  return (
    <div
      className={`w-full flex flex-col items-center select-none ${compact ? 'gap-1' : 'gap-2'}`}
      onDragStart={(e) => e.preventDefault()}
    >
      {isOwner && (
        <div
          style={compact ? undefined : contentWidthStyle}
          className={`w-full mx-auto flex items-center justify-between gap-2 flex-wrap ${compact ? 'min-h-0' : 'min-h-8'}`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {canAttemptConfirm && (
              <button type="button" onClick={confirmGroup} className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/50 px-2.5 py-1 rounded-lg transition-colors">
                <Check className="w-3.5 h-3.5" /> Per Onayla
              </button>
            )}
            {canRemoveGroup && (
              <button type="button" onClick={removeGroup} className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/50 px-2.5 py-1 rounded-lg transition-colors">
                <X className="w-3.5 h-3.5" /> Onayı Kaldır
              </button>
            )}
            {canAttemptUpdateGroup && (
              <button type="button" onClick={updateGroup} title="Seçili taşı mevcut perin yanına ekleyerek büyüt" className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-sky-600/20 hover:bg-sky-600/40 text-sky-300 border border-sky-500/50 px-2.5 py-1 rounded-lg transition-colors">
                <RefreshCw className="w-3.5 h-3.5" /> Peri Güncelle
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* YARDIMLI MOD: onaylanmış per toplamı (+ hedefi), çift ilerlemesi
                ve otomatik dizme/açma butonları. Rozetler, ilgili eşiğe
                ULAŞILDIĞINDA yeşile döner — öğrenen oyuncu "açabilir miyim?"
                sorusunu kafadan toplamadan görür. */}
            {assisted && (
              <>
                {!hasOpenedAlready && (
                  <span
                    title={`Seri/Set ile açman için ulaşman GEREKEN toplam ${seriesTarget}${seriesTarget !== OPEN_THRESHOLD ? ' (masadaki baraj nedeniyle 101\'den yüksek)' : ''}`}
                    className={`text-[11px] sm:text-xs font-mono font-bold px-2 py-1 rounded-lg border whitespace-nowrap ${
                      assistedTotal > 0 && assistedTotal >= seriesTarget
                        ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/50'
                        : 'bg-slate-900/60 text-slate-300 border-slate-600'
                    }`}
                  >
                    {assistedTotal === 0
                      ? '—'
                      : `${assistedTotal}/${seriesTarget} (${tekLabel(assistedTotal)} / ${tekLabel(seriesTarget)})`}
                  </span>
                )}
                <span
                  title={`Çift ile açman için gereken çift sayısı: ${assistedPairsRequired}`}
                  className={`text-[11px] sm:text-xs font-mono font-bold px-2 py-1 rounded-lg border whitespace-nowrap ${
                    assistedPairGroupIds.length > 0 && assistedPairGroupIds.length >= assistedPairsRequired
                      ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/50'
                      : 'bg-slate-900/60 text-slate-300 border-slate-600'
                  }`}
                >
                  {assistedPairGroupIds.length}/{assistedPairsRequired}
                </span>
                <button
                  type="button"
                  onClick={arrangeSeries}
                  title="Elindeki en değerli seri/setleri bulup per olarak onayla ve ıstakayı yeniden diz"
                  className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/50 px-2.5 py-1 rounded-lg transition-colors"
                >
                  <Wand2 className="w-3.5 h-3.5" /> Seri Diz
                </button>
                <button
                  type="button"
                  onClick={arrangePairs}
                  title="Elindeki tüm çiftleri per olarak onayla ve ıstakayı yeniden diz"
                  className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/50 px-2.5 py-1 rounded-lg transition-colors"
                >
                  <Wand2 className="w-3.5 h-3.5" /> Çift Diz
                </button>
                <button
                  type="button"
                  onClick={assistedOpenSeries}
                  disabled={!canAct || !canOpenMeldsRule || assistedMeldGroupIds.length === 0}
                  title="Onayladığın TÜM seri/setleri (sınırı geçiyorsa) masaya indir"
                  className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-500/50 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Rows3 className="w-3.5 h-3.5" /> Seri Aç
                </button>
                <button
                  type="button"
                  onClick={assistedOpenPairs}
                  disabled={!canAct || !canOpenPairsRule || assistedPairGroupIds.length === 0}
                  title="Onayladığın TÜM çiftleri (yeterliyse) masaya indir"
                  className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-fuchsia-600/20 hover:bg-fuchsia-600/40 text-fuchsia-300 border border-fuchsia-500/50 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Layers className="w-3.5 h-3.5" /> {pairsButtonLabel}
                </button>
              </>
            )}

            {!assisted && allSelectedAreCompleteGroups && (
              <>
              <button
                type="button"
                onClick={openSeries}
                disabled={!canOpenSeries}
                title={!canOpenMeldsRule ? 'Çift açtığın için per (seri/set) açamazsın' : (!canAct ? 'Sadece kendi sıranda, taş çektikten sonra' : undefined)}
                className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-500/50 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Rows3 className="w-3.5 h-3.5" /> Seri Aç
              </button>
              <button
                type="button"
                onClick={openPairs}
                disabled={!canOpenPairs}
                title={!canOpenPairsRule ? 'Masada çift açan biri olmadan çift işleyemezsin' : (!canAct ? 'Sadece kendi sıranda, taş çektikten sonra' : (hasOpenedAlready ? 'Seçili çiftleri masaya sür' : `En az ${minPairsToOpen} çift seçmelisin (daha fazlasıyla da açabilirsin)`))}
                className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold bg-fuchsia-600/20 hover:bg-fuchsia-600/40 text-fuchsia-300 border border-fuchsia-500/50 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Layers className="w-3.5 h-3.5" /> {pairsButtonLabel}
              </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* SOL: solumdaki oyuncunun bana attığı taş (buradan çekerim) — SAĞ: sağımdaki
          oyuncuya atacağım taş (buraya sürüklerim). */}
      {isOwner && ready && !compact && (
        <div style={contentWidthStyle} className="w-full mx-auto flex items-end justify-between gap-2">
          {incomingSlot}
          {discardSlot}
        </div>
      )}

      {compact && isOwner ? (
        <div ref={rackWrapRef} className="w-full flex items-center justify-center gap-1.5">
          {ready && incomingSlot}
          <div className="flex-1 min-w-0">{ready && rackRows}</div>
          {ready && discardSlot}
        </div>
      ) : (
        <div ref={rackWrapRef} className="w-full">
          {ready && rackRows}
        </div>
      )}

      {/* Sürükleme hayaleti: bir per taşınıyorsa TÜM per soluk şekilde imleci takip
          eder, tutulan taş tam imlecin altında kalacak biçimde hizalanır.
          POZİSYON React state'i DEĞİL, `ghostElRef` üzerinden doğrudan DOM
          yazımıyla güncellenir (bkz. handlePointerMove) — performans için. */}
      {ghost && (
        <div ref={setGhostElRef} className="fixed left-0 top-0 z-[4000] pointer-events-none opacity-80">
          <div className="flex items-center" style={{ gap: `${gap}px` }}>
            {ghost.tiles.map((tl) => (
              <Tile key={tl.id} tile={tl} okeyInfo={okeyInfo} width={tileW} faceDown={flippedIds.has(tl.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
