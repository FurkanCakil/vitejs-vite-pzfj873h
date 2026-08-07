import { useEffect, useRef, useState, useCallback } from 'react';

const WORKER_URL = '/stockfish/stockfish-18-lite-single.js';

// Stockfish'i bir Web Worker içinde çalıştırıp UCI protokolüyle konuşur.
// Hiçbir işlem ana thread'de yapılmaz; React arayüzü hesaplama sırasında donmaz.
export function useStockfish(enabled, skillLevel) {
  const workerRef = useRef(null);
  const pendingRef = useRef(null);
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
    return new Promise((resolve) => {
      pendingRef.current = { resolve };
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${depth}`);
    });
  }, []);

  return { isReady, getBestMove };
}
