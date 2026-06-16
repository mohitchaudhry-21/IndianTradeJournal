import React, { useState, useRef, useEffect } from 'react';
import { useJournal } from '../context/JournalContext';
import { useTickerQuotes } from '../hooks/useTickerQuotes';
import { KNOWN_SYMBOLS } from '../utils/tickerSymbols';

export default function TickerBar() {
  const { settings, updateSettings } = useJournal();
  const selected = settings.tickerSymbols || [];
  const { quotes } = useTickerQuotes(selected, 1000);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const toggleSymbol = (name) => {
    const next = selected.includes(name)
      ? selected.filter(s => s !== name)
      : [...selected, name];
    updateSettings({ tickerSymbols: next });
  };

  const quoteFor = (name) => quotes.find(q => q.name === name);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 16px', borderBottom: '1px solid var(--border)',
      background: 'var(--bg-secondary)', minHeight: 44, width: '100%', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', flex: 1, minWidth: 0, overflow: 'hidden' }}>
        {selected.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No symbols selected — click the arrow to add some</span>
        )}
        {selected.map(name => {
          const q = quoteFor(name);
          const up = q && q.change >= 0;
          return (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap', flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{name}</span>
              {q ? (
                <>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {q.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: up ? 'var(--profit)' : 'var(--loss)' }}>
                    {up ? '▲' : '▼'} {up ? '+' : ''}{q.change.toFixed(2)} ({up ? '+' : ''}{q.changePct.toFixed(2)}%)
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
              )}
            </div>
          );
        })}
      </div>

      <div ref={pickerRef} style={{ position: 'relative', flexShrink: 0, marginLeft: 12 }}>
        <button onClick={() => setPickerOpen(o => !o)}
          style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer', padding: '5px 9px', fontSize: 12 }}
          title="Select symbols to display">
          ▾
        </button>
        {pickerOpen && (
          <div style={{
            position: 'absolute', right: 0, top: '100%', marginTop: 6, zIndex: 50,
            background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8,
            padding: 8, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 8px 8px' }}>
              Show in ticker bar
            </div>
            {KNOWN_SYMBOLS.map(s => (
              <label key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', borderRadius: 5 }}>
                <input type="checkbox" checked={selected.includes(s.name)} onChange={() => toggleSymbol(s.name)} />
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{s.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
