import { useEffect, useRef, useCallback, useState } from 'react';

let requestCounter = 0;

// Tavla botunu kendi (Stockfish gerektirmeyen) Worker'ımızda çalıştırır.
// Hesaplama tamamen Worker içinde yapılır; ana thread sadece istek atıp
// sonucu bekler, bu yüzden UI hiçbir zaman donmaz.
export function useBackgammonBot(enabled) {
  const workerRef = useRef(null);
  const pendingRef = useRef(new Map());
  const [error, setError] = useState(null);
  const [generation, setGeneration] = useState(0);
  const restart = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    setError(null);
    let worker;
    try { worker = new Worker(new URL('./botWorker.js', import.meta.url), { type: 'module' }); }
    catch { setError('Tavla botu başlatılamadı.'); return; }
    workerRef.current = worker;
    const fail = () => {
      worker.terminate();
      workerRef.current = null;
      setError('Tavla botuna ulaşılamadı.');
      pendingRef.current.forEach((pending) => {
        clearTimeout(pending.timer);
        pending.reject(new Error('Tavla botu yanıt vermedi.'));
      });
      pendingRef.current.clear();
    };

    const handleMessage = (e) => {
      const { requestId, path, error } = e.data;
      const pending = pendingRef.current.get(requestId);
      if (!pending) return;
      pendingRef.current.delete(requestId);
      clearTimeout(pending.timer);
      if (error) { setError('Tavla botu hamleyi hesaplayamadı.'); pending.reject(new Error(error)); }
      else pending.resolve(path);
    };
    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', fail);
    worker.addEventListener('messageerror', fail);
    workerRef.current.fail = fail;

    return () => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', fail);
      worker.removeEventListener('messageerror', fail);
      worker.terminate();
      workerRef.current = null;
      // Worker kapatılırken bekleyen istekler ÖNCE sonlandırılır. Eskiden Map
      // doğrudan boşaltılıyordu; yani o promise'ler ASLA settle olmuyor ve
      // çağıran taraftaki `await getBotTurn(...)` (bkz. TavlaGame'in bot
      // efekti) sonsuza dek asılı kalıyordu. `null`, çağıranın zaten ele aldığı
      // "oynanabilir hamle yok" durumudur (`if (!path || path.length === 0)`).
      pendingRef.current.forEach((pending) => { clearTimeout(pending.timer); pending.resolve(null); });
      pendingRef.current.clear();
    };
  }, [enabled, generation]);

  // path: [{ from, to, die }, ...] ya da oynanabilir hamle yoksa null.
  const getBotTurn = useCallback((board, color, dice, bar, borneOff, difficulty) => {
    const worker = workerRef.current;
    if (!worker) return Promise.reject(new Error('Tavla botu hazır değil.'));
    const requestId = ++requestCounter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => worker.fail(), 60_000);
      pendingRef.current.set(requestId, { resolve, reject, timer });
      worker.postMessage({ requestId, board, color, dice, bar, borneOff, difficulty });
    });
  }, []);

  return { getBotTurn, error, restart, generation };
}
