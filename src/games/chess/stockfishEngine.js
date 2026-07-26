import { useEffect, useRef, useState, useCallback } from 'react';

const WORKER_URL = '/stockfish/stockfish-18-lite-single.js';

// Stockfish'i bir Web Worker içinde çalıştırıp UCI protokolüyle konuşur.
// Hiçbir işlem ana thread'de yapılmaz; React arayüzü hesaplama sırasında donmaz.
export function useStockfish(enabled, skillLevel) {
  const workerRef = useRef(null);
  const pendingRef = useRef(null);
  const [isReady, setIsReady] = useState(false);

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
        if (pendingRef.current) {
          const { resolve } = pendingRef.current;
          pendingRef.current = null;
          resolve(move && move !== '(none)' ? move : null);
        }
      }
    };

    worker.addEventListener('message', handleMessage);
    worker.postMessage('uci');

    return () => {
      worker.removeEventListener('message', handleMessage);
      worker.postMessage('quit');
      worker.terminate();
      workerRef.current = null;
      pendingRef.current = null;
      setIsReady(false);
    };
  }, [enabled, skillLevel]);

  const getBestMove = useCallback((fen, depth) => {
    const worker = workerRef.current;
    if (!worker) return Promise.resolve(null);
    return new Promise((resolve) => {
      pendingRef.current = { resolve };
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${depth}`);
    });
  }, []);

  return { isReady, getBestMove };
}
