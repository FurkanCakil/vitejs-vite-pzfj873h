import React from 'react';
import { Lock, Settings } from 'lucide-react';

const BOT_DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Kolay' },
  { value: 'medium', label: 'Orta' },
  { value: 'hard', label: 'Zor' },
];

function RuleRow({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap py-2">
      <div>
        <div className="text-sm font-medium text-slate-200">{label}</div>
        {hint && <div className="text-xs text-slate-500 mt-0.5 max-w-xs">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function SegmentedControl({ value, options, onChange, disabled }) {
  return (
    <div className="flex bg-slate-900 border border-slate-600 rounded-lg p-0.5 shrink-0">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${value === o.value ? 'bg-indigo-600 text-white' : 'text-slate-400'} ${disabled ? 'cursor-not-allowed' : 'hover:text-slate-100'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ToggleSwitch({ checked, onChange, onLabel, offLabel, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors shrink-0 ${checked ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/50' : 'bg-slate-900 text-slate-400 border-slate-600'} ${disabled ? 'cursor-not-allowed' : ''}`}
    >
      <span className={`w-8 h-4 rounded-full relative transition-colors ${checked ? 'bg-emerald-500' : 'bg-slate-600'}`}>
        <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${checked ? 'left-4' : 'left-0.5'}`} />
      </span>
      {checked ? onLabel : offLabel}
    </button>
  );
}

// `rules`: { gameType: 'ffa'|'2v2', assistedEnabled, foldingEnabled, foldToPartnerEnabled, botDifficulty }
// NOT: "yandan taş alma -> elini aç ya da geri koy" kuralı ve buna bağlı ceza
// (çekilen taşın 10/20 katı) artık koşulsuz uygulanır, bu yüzden burada ayrı
// bir "Ceza Kuralı" ayarı YOKTUR.
export default function RulesPanel({ rules, isHost, onChange }) {
  const showFoldToPartner = rules.gameType === '2v2' && rules.foldingEnabled;

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 md:p-5 w-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2"><Settings className="w-4 h-4 text-slate-400" /> Oda Kuralları</h3>
        {!isHost && (
          <div className="flex items-center gap-1 text-xs text-slate-400 bg-slate-900/60 px-2 py-1 rounded-full border border-slate-700">
            <Lock className="w-3.5 h-3.5" /> Sadece host değiştirebilir
          </div>
        )}
      </div>

      <div className="divide-y divide-slate-700/60">
        <RuleRow label="Oyun Türü">
          <SegmentedControl
            disabled={!isHost}
            value={rules.gameType}
            options={[{ value: 'ffa', label: 'Tekli' }, { value: '2v2', label: 'Eşli' }]}
            onChange={(v) => onChange('gameType', v)}
          />
        </RuleRow>

        {/* KULLANICI İSTEĞİ: "Yardımlı" mod — yeni/öğrenen oyuncular için
            arayüz destekleri (işlek taş işareti, per toplamı, otomatik
            seri/çift dizme, Okey'in otomatik ters çevrilmesi). Oyun
            KURALLARINI hiç değiştirmez, sadece bilgiyi görünür kılar; bu
            yüzden el de OTOMATİK dizili geldiği için ayrıca hazırlık süresi
            verilmez (bkz. Okey101Game). */}
        <RuleRow label="Yardımlı Mod" hint="İşlek taş işareti, per toplamı, otomatik seri/çift dizme ve Okey'in kendiliğinden ters dönmesi. El otomatik dizili geldiği için hazırlık süresi verilmez.">
          <ToggleSwitch disabled={!isHost} checked={!!rules.assistedEnabled} onChange={(v) => onChange('assistedEnabled', v)} onLabel="Yardımlı" offLabel="Klasik" />
        </RuleRow>

        <RuleRow label="Katlama Kuralı">
          <ToggleSwitch disabled={!isHost} checked={rules.foldingEnabled} onChange={(v) => onChange('foldingEnabled', v)} onLabel="Katlamalı" offLabel="Katlamasız" />
        </RuleRow>

        {showFoldToPartner && (
          <RuleRow label="Eşe Katlama">
            <ToggleSwitch disabled={!isHost} checked={rules.foldToPartnerEnabled} onChange={(v) => onChange('foldToPartnerEnabled', v)} onLabel="Var" offLabel="Yok" />
          </RuleRow>
        )}

        <RuleRow label="Bot Zorluk Seviyesi">
          <select
            disabled={!isHost}
            value={rules.botDifficulty}
            onChange={(e) => onChange('botDifficulty', e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
          >
            {BOT_DIFFICULTY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </RuleRow>
      </div>
    </div>
  );
}
