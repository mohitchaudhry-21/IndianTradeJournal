import React, { useState, useRef, useEffect } from 'react';
import { useJournal } from '../context/JournalContext';
import { useTickerQuotes } from '../hooks/useTickerQuotes';
import { KNOWN_SYMBOLS } from '../utils/tickerSymbols';
import { isMarketOpen } from '../utils/marketHours';

export default function TickerBar() {
  const { settings, updateSettings } = useJournal();
  const selected = settings.tickerSymbols || [];
  const [paused, setPaused] = useState(false);
  const marketOpen = isMarketOpen();
  // No point polling every second for a price that isn't moving — back off
  // to a slow refresh after close (still useful in case the underlying
  // quote source corrects/updates its closing print shortly after the bell).
  const { quotes } = useTickerQuotes(selected, marketOpen ? 1000 : 60000, paused);
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
      padding: '0 20px', borderBottom: '1px solid var(--border)',
      background: 'var(--bg-secondary)', height: 56, width: '100%', boxSizing: 'border-box',
      WebkitFontSmoothing: 'antialiased',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, flex: 1, minWidth: 0, overflow: 'hidden', height: '100%' }}>
        {selected.length === 0 && (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No symbols selected — click ▾ to add some</span>
        )}
        {selected.map((name, i) => {
          const q = quoteFor(name);
          const up = q && q.change >= 0;
          return (
            <div key={name} style={{ display: 'flex', alignItems: 'center', height: '100%', flexShrink: 0 }}>
              {i > 0 && <div style={{ width: '0.5px', background: 'var(--border)', height: 28, margin: '0 20px' }} />}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.02em' }}>{name}</span>
                {q ? (
                  <>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                      {q.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 600, color: up ? 'var(--profit)' : 'var(--loss)' }}>
                      {up ? '+' : ''}{q.change.toFixed(2)}
                    </span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: up ? 'var(--profit)' : 'var(--loss)', opacity: 0.8 }}>
                      ({up ? '+' : ''}{q.changePct.toFixed(2)}%)
                    </span>
                    {!marketOpen && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 6px', letterSpacing: '0.04em' }}>
                        CLOSED
                      </span>
                    )}
                  </>
                ) : (
                  <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div ref={pickerRef} style={{ position: 'relative', flexShrink: 0, marginLeft: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        {paused && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            ⏸ paused
          </span>
        )}
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
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
              <button onClick={() => setPaused(p => !p)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '6px 8px', background: 'none', border: 'none', borderRadius: 5,
                  color: paused ? 'var(--profit)' : 'var(--text-primary)', cursor: 'pointer', fontSize: 13, textAlign: 'left',
                }}>
                <span>{paused ? '▶' : '⏸'}</span>
                <span>{paused ? 'Continue updates' : 'Pause updates'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
