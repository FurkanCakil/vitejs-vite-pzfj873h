import { useState } from 'react';
import { runEuropeAcceptance, runEuropeMeasurement } from './europeProbe.js';

export default function EuropePreviewQA() {
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState('Hazır');
  const [reports, setReports] = useState({});
  const config = { projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    appId: import.meta.env.VITE_FIREBASE_APP_ID };
  const run = async kind => {
    setBusy(true); setProgress('Yeni Avrupa test oturumları açılıyor…');
    try {
      const target = { config, projectId: config.projectId, base: location.origin };
      const report = await (kind === 'acceptance' ? runEuropeAcceptance : runEuropeMeasurement)(target, setProgress);
      setReports(previous => ({ ...previous, [kind]: report }));
      setProgress(report.failure ? 'Doğrulama başarısız; raporu inceleyin.' : 'Tamamlandı');
    } catch {
      setProgress('Test başlatılamadı.');
      setReports(previous => ({ ...previous, [kind]: { failure: 'probe_failed' } }));
    } finally { setBusy(false); }
  };
  const summary = reports.measurement?.summary?.filter(item => ['xox.move', 'okey.draw', 'okey.discard'].includes(item.action)) ?? [];
  return <main style={{ maxWidth: 1000, margin: '32px auto', padding: 24, color: '#f8fafc', background: '#172033', borderRadius: 12 }}>
    <h1 style={{ fontSize: 28 }}>Avrupa Preview doğrulaması</h1>
    <p>Proje: {config.projectId} · Yalnız yeni özel test masaları · Production değişmez</p>
    <p style={{ margin: '16px 0' }}>Bu ekran yalnız Avrupa Preview derlemesinde bulunur. Açık Vercel oturumunu kullanır.</p>
    <div style={{ display: 'flex', gap: 16, margin: '20px 0' }}>
      <button disabled={busy} onClick={() => run('acceptance')} style={{ padding: 12, border: '1px solid #94a3b8', borderRadius: 6 }}>Yedi oyunu doğrula</button>
      <button disabled={busy} onClick={() => run('measurement')} style={{ padding: 12, border: '1px solid #94a3b8', borderRadius: 6 }}>Aynı ölçüm senaryosunu çalıştır</button>
    </div>
    <p role="status">{progress}</p>
    {summary.length > 0 && <table style={{ width: '100%', margin: '16px 0' }}><thead><tr><th>İşlem</th><th>Örnek</th><th>p50 ms</th><th>p95 ms</th></tr></thead>
      <tbody>{summary.map(item => <tr key={item.action}><td>{item.action}</td><td>{item.n}</td><td>{Math.round(item.metrics.http_ms.p50)}</td><td>{Math.round(item.metrics.http_ms.p95)}</td></tr>)}</tbody></table>}
    <label htmlFor="europe-qa-report">Doğrulama raporu</label>
    <textarea id="europe-qa-report" aria-label="Doğrulama raporu" readOnly value={JSON.stringify(reports, null, 2)}
      style={{ width: '100%', minHeight: 340, marginTop: 8, padding: 12, background: '#0b1220', color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12 }} />
  </main>;
}
