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
  const [error, setError] = useState(null);
  const [generation, setGeneration] = useState(0);
  const timeoutRef = useRef(null);
  const failRef = useRef(null);
  const restart = useCallback(() => setGeneration((value) => value + 1), []);

  // Bekleyen bir isteği KESİN OLARAK sonlandırır. `getBestMove`'un döndürdüğü
  // promise'in ASLA settle olmaması, çağıran taraftaki `await`'i (ve onun
  // `finally` bloğunu — bkz. ChessGame#botThinking) sonsuza dek asılı bırakır:
  // "Bot düşünüyor..." göstergesi hiç kapanmaz. `null` çözümü, çağıranın zaten
  // ele aldığı "hamle bulunamadı" durumudur (bkz. `if (cancelled || !uciMove)`).
  const settlePending = (value = null) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    clearTimeout(timeoutRef.current);
    if (pending) pending.resolve(value);
  };

  useEffect(() => {
    if (!enabled) return;
    setIsReady(false);
    setError(null);
    let worker;
    try { worker = new Worker(WORKER_URL); }
    catch { setError('Satranç motoru başlatılamadı.'); return; }
    workerRef.current = worker;
    searchingRef.current = false;
    discardRef.current = 0;
    let handshakeStep = 0; // 0: uciok bekleniyor, 1: ilk readyok, 2: ucinewgame sonrası readyok
    const fail = () => {
      clearTimeout(startupTimer);
      settlePending(null);
      searchingRef.current = false;
      worker.terminate();
      workerRef.current = null;
      setIsReady(false);
      setError('Satranç motoruna ulaşılamadı. Tekrar deneyebilirsin.');
    };
    const startupTimer = setTimeout(fail, 120_000);
    failRef.current = fail;

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
          clearTimeout(startupTimer);
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
    worker.addEventListener('error', fail);
    worker.addEventListener('messageerror', fail);
    worker.postMessage('uci');

    return () => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', fail);
      worker.removeEventListener('messageerror', fail);
      clearTimeout(startupTimer);
      failRef.current = null;
      worker.terminate();
      workerRef.current = null;
      searchingRef.current = false;
      discardRef.current = 0;
      // Motor kapatılırken bekleyen istek varsa ÖNCE çözülür (eskiden ref
      // doğrudan null'lanıyor, promise sonsuza dek asılı kalıyordu).
      settlePending(null);
      setIsReady(false);
    };
  }, [enabled, skillLevel, generation]);

  // UCI emits one final bestmove after stop. Settle the cancelled caller now,
  // but discard that response so it cannot complete the next search.
  const cancelSearch = useCallback(() => {
    const worker = workerRef.current;
    if (worker && searchingRef.current) {
      searchingRef.current = false;
      discardRef.current += 1;
      try { worker.postMessage('stop'); }
      catch { failRef.current?.(); }
    }
    settlePending(null);
  }, []);

  const getBestMove = useCallback((fen, depth) => {
    const worker = workerRef.current;
    if (!worker) return Promise.resolve(null);
    cancelSearch();
    if (workerRef.current !== worker) return Promise.resolve(null);

    return new Promise((resolve) => {
      pendingRef.current = { resolve };
      timeoutRef.current = setTimeout(() => failRef.current?.(), 90_000);
      searchingRef.current = true;
      try {
        worker.postMessage(`position fen ${fen}`);
        worker.postMessage(`go depth ${depth}`);
      } catch { failRef.current?.(); }
    });
  }, [cancelSearch]);

  return { isReady, getBestMove, cancelSearch, error, restart };
}
