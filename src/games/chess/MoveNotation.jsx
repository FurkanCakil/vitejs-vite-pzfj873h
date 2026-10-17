import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { gameToPGN, moveRows } from './notation.js';

export default function MoveNotation({ moves, startFen, white, black, result }) {
  const listRef = useRef(null);
  const followRef = useRef(true);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const rows = useMemo(() => moveRows(moves, startFen), [moves, startFen]);
  const pgn = useMemo(() => gameToPGN({ moves, startFen, white, black, result }), [moves, startFen, white, black, result]);
  useEffect(() => {
    if (listRef.current && (followRef.current || !moves.length)) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [moves.length]);
  useEffect(() => {
    if (!copied) return undefined;
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(pgn); setCopied(true); setCopyFailed(false); }
    catch { setCopyFailed(true); }
  };

  return (
    <aside aria-label="Satranç notasyonu" className="w-full min-w-0 max-w-[440px] sm:max-w-[520px] md:max-w-[600px] lg:max-w-[680px] min-[1100px]:max-w-none rounded-xl border border-slate-700 bg-slate-950/50 overflow-hidden self-start justify-self-center">
      <div className="flex items-center justify-between gap-2 p-3 border-b border-slate-700">
        <h3 className="text-sm font-bold text-slate-200">Hamleler</h3>
        <button onClick={copy} disabled={!moves.length} className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300 hover:text-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed py-1.5" aria-label="Oyunu PGN olarak kopyala">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span aria-live="polite">{copied ? 'Kopyalandı' : 'PGN Kopyala'}</span>
        </button>
      </div>
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-1 px-3 py-2 text-xs font-semibold text-slate-400 border-b border-slate-800" aria-hidden="true">
        <span>No</span><span>Beyaz</span><span>Siyah</span>
      </div>
      <div ref={listRef} tabIndex={0} role="region" aria-label="Kaydırılabilir hamle listesi"
        onScroll={e => { const el = e.currentTarget; followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32; }}
        className="h-48 min-[1100px]:h-80 overflow-y-auto overscroll-contain focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
        style={{ scrollbarGutter: 'stable', touchAction: 'pan-y' }}>
        {rows.length ? rows.map((row, index) => (
          <div key={row.number} className={`grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-1 px-3 py-2 text-sm font-mono tabular-nums ${index % 2 ? 'bg-slate-800/40' : ''}`}>
            <span className="text-slate-500">{row.number}.</span>
            <span className="text-slate-100 break-all">{row.white || '…'}</span>
            <span className="text-slate-300 break-all">{row.black || '—'}</span>
          </div>
        )) : <p className="p-4 text-sm text-slate-500">İlk hamleden sonra notasyon burada görünecek.</p>}
      </div>
      {(result !== '*' || copyFailed) && <div className="p-3 border-t border-slate-700 text-xs text-slate-400 space-y-2">
        {result !== '*' && <p className="font-mono text-center text-slate-200">{result}</p>}
        {copyFailed && <textarea aria-label="Kopyalanabilir PGN" readOnly value={pgn} onFocus={e => e.currentTarget.select()} className="w-full h-28 resize-none rounded-md bg-slate-900 p-2 text-xs font-mono text-slate-200 border border-slate-600" />}
      </div>}
    </aside>
  );
}
