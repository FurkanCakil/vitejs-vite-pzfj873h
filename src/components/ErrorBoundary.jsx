import React from 'react';
import { AlertCircle } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  
  componentDidCatch(error, errorInfo) { console.error("Kritik Oyun Hatası:", error, errorInfo); }
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-slate-900 rounded-2xl border-2 border-red-500/50 shadow-2xl w-full max-w-md mx-auto text-center mt-10 z-50">
          <AlertCircle className="w-16 h-16 text-red-500 mb-4 animate-pulse" />
          <h2 className="text-2xl font-bold text-white mb-2">Sistemde Pürüz Çıktı!</h2>
          <p className="text-slate-400 text-sm mb-6">Oyun motoru geçici bir hata ile karşılaştı.</p>
          <button onClick={() => window.location.reload()} className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg">Masaya Geri Dön</button>
        </div>
      );
    }
    return this.props.children;
  }
}