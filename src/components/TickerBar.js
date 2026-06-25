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
  const { quotes } = useTickerQuotes(selected, marketOpen ? 1000 : 60000, paused);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => {
    const fn = (e) => { if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const toggleSymbol = (name) => {
    const next = selected.includes(name) ? selected.filter(s => s !== name) : [...selected, name];
    updateSettings({ tickerSymbols: next });
  };

  const quoteFor = (name) => quotes.find(q => q.name === name);

  return (
    <div style={{
      position: 'sticky',
      top: 0,
      zIndex: 40,
      display: 'flex',
      alignItems: 'center',
      height: 42,
      padding: '0 14px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      width: '100%',
      boxSizing: 'border-box',
      fontFamily: "'Nunito Sans', 'Inter', sans-serif",
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
    }}>

      {/* Ticker items */}
      <div style={{ display:'flex', alignItems:'center', flex:1, minWidth:0, overflow:'hidden', gap:0 }}>

        {selected.length === 0 && (
          <span style={{ fontSize:12, color:'var(--text-muted)' }}>No symbols — click ▾ Edit to add</span>
        )}

        {selected.map((name, idx) => {
          const q = quoteFor(name);
          const up = q ? q.change >= 0 : null;
          return (
            <div key={name} style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 5,
              padding: '0 14px',
              borderRight: idx < selected.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}>
              {/* Symbol label */}
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--text-muted)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                lineHeight: 1,
              }}>
                {name}
              </span>

              {q ? (
                <>
                  {/* Price */}
                  <span style={{
                    fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    letterSpacing: '-0.3px',
                    lineHeight: 1,
                  }}>
                    {q.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>

                  {/* ₹ change */}
                  <span style={{
                    fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
                    fontSize: 11,
                    fontWeight: 600,
                    color: up ? '#22c55e' : '#ef4444',
                    letterSpacing: '-0.2px',
                    lineHeight: 1,
                  }}>
                    {up ? '+' : ''}{q.change.toFixed(2)}
                  </span>

                  {/* % change */}
                  <span style={{
                    fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
                    fontSize: 10,
                    fontWeight: 500,
                    color: up ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)',
                    letterSpacing: '-0.1px',
                    lineHeight: 1,
                  }}>
                    ({up ? '+' : ''}{q.changePct.toFixed(2)}%)
                  </span>
                </>
              ) : (
                <span style={{ fontSize:12, color:'var(--text-muted)', fontFamily:'monospace' }}>—</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Market status + controls */}
      <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0, marginLeft:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: marketOpen ? '#22c55e' : '#6b7280',
            display: 'inline-block',
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: marketOpen ? '#22c55e' : 'var(--text-muted)',
          }}>
            {marketOpen ? 'Live' : 'Closed'}
          </span>
        </div>

        <div ref={pickerRef} style={{ position:'relative' }}>
          <button
            onClick={() => setPickerOpen(o => !o)}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 5,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '3px 9px',
              fontSize: 11,
              fontFamily: "'Nunito Sans', sans-serif",
              lineHeight: 1.5,
            }}>
            ▾ Edit
          </button>

          {pickerOpen && (
            <div style={{
              position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 100,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 9,
              padding: '6px 0',
              minWidth: 190,
              boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
              fontFamily: "'Nunito Sans', sans-serif",
              WebkitFontSmoothing: 'antialiased',
            }}>
              <div style={{ fontSize:10, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', padding:'4px 12px 8px' }}>
                Ticker symbols
              </div>
              <div style={{ maxHeight:260, overflowY:'auto' }}>
                {KNOWN_SYMBOLS.map(s => (
                  <label key={s.name} style={{
                    display:'flex', alignItems:'center', gap:9,
                    padding:'5px 12px', cursor:'pointer',
                    background: selected.includes(s.name) ? 'rgba(99,102,241,0.08)' : 'transparent',
                  }}>
                    <input type="checkbox" checked={selected.includes(s.name)} onChange={() => toggleSymbol(s.name)}
                      style={{ accentColor:'var(--accent)', width:13, height:13 }} />
                    <span style={{ fontSize:12, fontWeight: selected.includes(s.name) ? 700 : 400, color:'var(--text-primary)' }}>
                      {s.name}
                    </span>
                  </label>
                ))}
              </div>
              <div style={{ borderTop:'1px solid var(--border)', marginTop:4, padding:'4px 0' }}>
                <button onClick={() => setPaused(p => !p)} style={{
                  display:'flex', alignItems:'center', gap:8, width:'100%',
                  padding:'6px 12px', background:'none', border:'none',
                  color: paused ? '#22c55e' : 'var(--text-secondary)',
                  cursor:'pointer', fontSize:12, textAlign:'left',
                  fontFamily:"'Nunito Sans', sans-serif",
                }}>
                  {paused ? '▶ Resume updates' : '⏸ Pause updates'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
