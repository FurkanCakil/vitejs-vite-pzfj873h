import { useEffect, useRef, useState, useCallback } from 'react';

const WORKER_URL = '/stockfish/stockfish-18-lite-single.js';

// Stockfish'i bir Web Worker içinde çalıştırıp UCI protokolüyle konuşur.
// Hiçbir işlem ana thread'de yapılmaz; React arayüzü hesaplama sırasında donmaz.
export function useStockfish(enabled, skillLevel) {
  const workerRef = useRef(null);
  const pendingRef = useRef(null);
  // UCI'da isteklerin bir kimliği YOKTUR: motor her `go` için tek bir `bestmove`
  // satırı basar, "hangi arama için" bilgisi taşımaz. Bu yüzden hangi cevabın
  // hangi isteğe ait olduğunu İSTEMCİ TARAFINDA saymak zorundayız:
  //   searchingRef : bir `go` gönderildi ve karşılığı `bestmove` HENÜZ gelmedi.
  //   discardRef   : yok sayılacak (iptal edilmiş bir aramaya ait) bestmove sayısı.
  const searchingRef = useRef(false);
  const discardRef = useRef(0);
  const [isReady, setIsReady] = useState(false);

  // Bekleyen bir isteği KESİN OLARAK sonlandırır. `getBestMove`'un döndürdüğü
  // promise'in ASLA settle olmaması, çağıran taraftaki `await`'i (ve onun
  // `finally` bloğunu — bkz. ChessGame#botThinking) sonsuza dek asılı bırakır:
  // "Bot düşünüyor..." göstergesi hiç kapanmaz. `null` çözümü, çağıranın zaten
  // ele aldığı "hamle bulunamadı" durumudur (bkz. `if (cancelled || !uciMove)`).
  const settlePending = (value = null) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) pending.resolve(value);
  };

  useEffect(() => {
    if (!enabled) return;
    setIsReady(false);
    const worker = new Worker(WORKER_URL);
    workerRef.current = worker;
    searchingRef.current = false;
    discardRef.current = 0;
    let handshakeStep = 0; // 0: uciok bekleniyor, 1: ilk readyok, 2: ucinewgame sonrası readyok

    const handleMessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : '';
      if (line === 'uciok') {
        worker.postMessage(`setoption name Skill Level value ${skillLevel}`);
        worker.postMessage('isready');
      } else if (line === 'readyok') {
        if (handshakeStep === 0) {
          handshakeStep = 1;
          worker.postMessage('ucinewgame');
          worker.postMessage('isready');
        } else {
          handshakeStep = 2;
          setIsReady(true);
        }
      } else if (line.startsWith('bestmove')) {
        // İPTAL EDİLMİŞ bir aramanın cevabıysa yut. Bunu yapmazsak motorun
        // ÖNCEKİ pozisyon için bulduğu hamle, YENİ isteği çözerdi — yani bot
        // tahtada artık geçersiz olabilecek bayat bir hamle oynardı.
        if (discardRef.current > 0) { discardRef.current -= 1; return; }
        searchingRef.current = false;
        const move = line.split(' ')[1];
        settlePending(move && move !== '(none)' ? move : null);
      }
    };

    worker.addEventListener('message', handleMessage);
    worker.postMessage('uci');

    return () => {
      worker.removeEventListener('message', handleMessage);
      worker.postMessage('quit');
      worker.terminate();
      workerRef.current = null;
      searchingRef.current = false;
      discardRef.current = 0;
      // Motor kapatılırken bekleyen istek varsa ÖNCE çözülür (eskiden ref
      // doğrudan null'lanıyor, promise sonsuza dek asılı kalıyordu).
      settlePending(null);
      setIsReady(false);
    };
  }, [enabled, skillLevel]);

  const getBestMove = useCallback((fen, depth) => {
    const worker = workerRef.current;
    if (!worker) return Promise.resolve(null);

    // Bir önceki istek hâlâ cevap beklerken yenisi gelirse (bot efekti art arda
    // tetiklenebilir) eskisinin `resolve`'u ESKİDEN sessizce ÜZERİNE YAZILIYOR
    // ve o promise hiç settle olmuyordu. Artık önce kapatılır.
    settlePending(null);

    // Motor HÂLÂ arıyorsa durdurulur. UCI sözleşmesi: arama sürerken gelen
    // `stop`, o arama için BİR `bestmove` bastırır — onu yutmamız gerekir
    // (aşağıdaki discard sayacı). Arama çoktan bitmişse `searchingRef` false
    // olur; o durumda `stop` GÖNDERİLMEZ, çünkü Stockfish aramıyorken gelen
    // `stop`'a hiçbir çıktı üretmez ve sayacı boşuna artırmış olurduk (bu da
    // bir sonraki GEÇERLİ cevabın yutulmasına, yani promise'in asılı
    // kalmasına yol açardı).
    if (searchingRef.current) {
      worker.postMessage('stop');
      discardRef.current += 1;
    }

    return new Promise((resolve) => {
      pendingRef.current = { resolve };
      searchingRef.current = true;
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${depth}`);
    });
  }, []);

  return { isReady, getBestMove };
}
