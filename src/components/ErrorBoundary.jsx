import React from 'react';
import { AlertCircle } from 'lucide-react';

// Bir oyun bileşeni çökerse tüm sayfayı beyaz ekrana düşürmek yerine burada
// yakalanır. HATANIN GERÇEK METNİ de gösterilir: telefonda konsola bakma imkânı
// olmadığı için "hata veriyor" şikâyetinin ne olduğunu ancak böyle görebiliyoruz.
export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }

  static getDerivedStateFromError(error) { return { hasError: true, error }; }

  componentDidCatch(error, errorInfo) { console.error("Kritik Oyun Hatası:", error, errorInfo); }

  // "Yerel Verileri Temizle": tarayıcıda kalmış eski oda kaydı / bozuk oturum
  // verisi yüzünden oyun açılmıyorsa (gizli sekmede sorun çıkmayıp normal
  // sekmede çıkmasının tipik sebebi) her şeyi sıfırlayıp yeniden başlatır.
  hardReset = () => {
    try { localStorage.removeItem('activeRoom'); } catch { /* yok say */ }
    try {
      if (window.indexedDB?.databases) {
        window.indexedDB.databases().then((dbs) => {
          dbs.forEach((d) => { if (d.name?.includes('firebase')) window.indexedDB.deleteDatabase(d.name); });
        }).catch(() => {}).finally(() => window.location.reload());
        return;
      }
    } catch { /* yok say */ }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const detail = this.state.error?.message || String(this.state.error || 'Bilinmeyen hata');
      return (
        <div className="flex flex-col items-center justify-center p-6 sm:p-8 bg-slate-900 rounded-2xl border-2 border-red-500/50 shadow-2xl w-full max-w-md mx-auto text-center mt-10 z-50">
          <AlertCircle className="w-14 h-14 text-red-500 mb-4 animate-pulse" />
          <h2 className="text-2xl font-bold text-white mb-2">Sistemde Pürüz Çıktı!</h2>
          <p className="text-slate-400 text-sm mb-3">Oyun motoru bir hata ile karşılaştı.</p>
          <pre className="w-full max-h-32 overflow-auto text-left text-[11px] text-red-300 bg-black/40 border border-red-500/30 rounded-lg p-2 mb-5 whitespace-pre-wrap break-words">{detail}</pre>
          <div className="flex flex-col sm:flex-row gap-2 w-full">
            <button onClick={() => window.location.reload()} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg">Masaya Geri Dön</button>
            <button onClick={this.hardReset} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 px-6 py-3 rounded-xl font-bold transition-all">Yerel Verileri Temizle</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
