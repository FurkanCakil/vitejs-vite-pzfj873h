import { useEffect, useRef, useCallback } from 'react';

let requestCounter = 0;

// Tavla botunu kendi (Stockfish gerektirmeyen) Worker'ımızda çalıştırır.
// Hesaplama tamamen Worker içinde yapılır; ana thread sadece istek atıp
// sonucu bekler, bu yüzden UI hiçbir zaman donmaz.
export function useBackgammonBot(enabled) {
  const workerRef = useRef(null);
  const pendingRef = useRef(new Map());

  useEffect(() => {
    if (!enabled) return;
    const worker = new Worker(new URL('./botWorker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    const handleMessage = (e) => {
      const { requestId, path, error } = e.data;
      const pending = pendingRef.current.get(requestId);
      if (!pending) return;
      pendingRef.current.delete(requestId);
      if (error) pending.reject(new Error(error));
      else pending.resolve(path);
    };
    worker.addEventListener('message', handleMessage);

    return () => {
      worker.removeEventListener('message', handleMessage);
      worker.terminate();
      workerRef.current = null;
      // Worker kapatılırken bekleyen istekler ÖNCE sonlandırılır. Eskiden Map
      // doğrudan boşaltılıyordu; yani o promise'ler ASLA settle olmuyor ve
      // çağıran taraftaki `await getBotTurn(...)` (bkz. TavlaGame'in bot
      // efekti) sonsuza dek asılı kalıyordu. `null`, çağıranın zaten ele aldığı
      // "oynanabilir hamle yok" durumudur (`if (!path || path.length === 0)`).
      pendingRef.current.forEach((pending) => pending.resolve(null));
      pendingRef.current.clear();
    };
  }, [enabled]);

  // path: [{ from, to, die }, ...] ya da oynanabilir hamle yoksa null.
  const getBotTurn = useCallback((board, color, dice, bar, borneOff, difficulty) => {
    const worker = workerRef.current;
    if (!worker) return Promise.resolve(null);
    const requestId = ++requestCounter;
    return new Promise((resolve, reject) => {
      pendingRef.current.set(requestId, { resolve, reject });
      worker.postMessage({ requestId, board, color, dice, bar, borneOff, difficulty });
    });
  }, []);

  return { getBotTurn };
}
