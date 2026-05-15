import React, { useState, useMemo } from 'react';
import { useJournal } from '../context/JournalContext';

// ── Indian FY helpers ────────────────────────────────────────────────────────
// FY runs April 1 → March 31. FY 25-26 = Apr 1 2025 → Mar 31 2026.
function fyLabel(startYear) {
  return `FY ${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;
}
function fyRange(startYear) {
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

const QUARTERS = [
  { q: 1, label: 'Q1 (Apr–Jun)', sm: 4, em: 6, ed: 30 },
  { q: 2, label: 'Q2 (Jul–Sep)', sm: 7, em: 9, ed: 30 },
  { q: 3, label: 'Q3 (Oct–Dec)', sm: 10, em: 12, ed: 31 },
  { q: 4, label: 'Q4 (Jan–Mar)', sm: 1, em: 3, ed: 31 },
];

function pad(n) { return String(n).padStart(2, '0'); }

function buildOptions() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-based

  // Current FY start year: if April or later, current year, else last year
  const currFyStart = m >= 4 ? y : y - 1;

  // ── Financial Years (current + 2 prior) ──
  const fyOpts = [currFyStart, currFyStart - 1, currFyStart - 2].map(fy => ({
    value: `fy_${fy}`,
    label: fyLabel(fy),
    ...fyRange(fy),
  }));

  // ── Quarters for current FY and previous FY ──
  const qOpts = [];
  for (const fyStart of [currFyStart, currFyStart - 1]) {
    for (const { q, label, sm, em, ed } of QUARTERS) {
      // Q4 (Jan-Mar) belongs to the year AFTER fyStart
      const qYear = q === 4 ? fyStart + 1 : fyStart;
      qOpts.push({
        value: `q${q}_fy${fyStart}`,
        label: `${label}`,
        subLabel: fyLabel(fyStart),
        from: `${qYear}-${pad(sm)}-01`,
        to: `${qYear}-${pad(em)}-${ed}`,
        fyStart,
      });
    }
  }

  // ── Monthly (last 18 months) ──
  const mOpts = [];
  for (let i = 0; i < 18; i++) {
    const d = new Date(y, now.getMonth() - i, 1);
    const my = d.getFullYear();
    const mm = d.getMonth() + 1;
    const lastDay = new Date(my, mm, 0).getDate();
    mOpts.push({
      value: `month_${my}_${mm}`,
      label: d.toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
      from: `${my}-${pad(mm)}-01`,
      to: `${my}-${pad(mm)}-${lastDay}`,
    });
  }

  return { fyOpts, qOpts, mOpts, currFyStart };
}

// ── Component ────────────────────────────────────────────────────────────────
export default function DateRangeSelector({ compact = false }) {
  const { dateFilter, setDateFilter, settings } = useJournal();
  const customRanges = settings.customDateRanges || [];
  const { fyOpts, qOpts, mOpts, currFyStart } = useMemo(buildOptions, []);

  const [mode, setMode] = useState(() => {
    if (!dateFilter.from && !dateFilter.to) return 'all';
    return 'custom';
  });
  const [customFrom, setCustomFrom] = useState(dateFilter.from || '');
  const [customTo,   setCustomTo]   = useState(dateFilter.to   || '');
  const [showCustom, setShowCustom] = useState(false);

  const apply = (from, to, m) => {
    setMode(m);
    setDateFilter({ from: from || null, to: to || null });
    setShowCustom(false);
  };

  const applyCustom = () => {
    setDateFilter({ from: customFrom || null, to: customTo || null });
    setShowCustom(false);
    setMode('custom');
  };

  const currentLabel = useMemo(() => {
    if (!dateFilter.from && !dateFilter.to) return 'All Time';
    if (mode === 'custom') {
      const f = dateFilter.from ? new Date(dateFilter.from + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
      const t = dateFilter.to   ? new Date(dateFilter.to   + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
      return `${f} → ${t}`;
    }
    const all = [...fyOpts, ...qOpts, ...mOpts, ...customRanges.map(r => ({ value: `custom_saved_${r.id}`, label: r.name }))];
    return all.find(o => o.value === mode)?.label || 'Custom';
  }, [dateFilter, mode, fyOpts, qOpts, mOpts]);

  const isActive = !!(dateFilter.from || dateFilter.to);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {/* Main trigger */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        <select
          value={mode}
          onChange={e => {
            const val = e.target.value;
            if (val === 'all') { apply(null, null, 'all'); return; }
            if (val === 'custom') { setShowCustom(true); setMode('custom'); return; }
            if (val.startsWith('custom_saved_')) {
              const id = val.replace('custom_saved_', '');
              const r = customRanges.find(r => r.id === id);
              if (r) apply(r.from, r.to, val);
              return;
            }
            const all = [...fyOpts, ...qOpts, ...mOpts, ...customRanges.map(r => ({ value: `custom_saved_${r.id}`, label: r.name }))];
            const opt = all.find(o => o.value === val);
            if (opt) apply(opt.from, opt.to, val);
          }}
          style={{
            padding: '7px 12px',
            background: isActive ? 'var(--accent-dim)' : 'var(--bg-primary)',
            border: isActive ? '1px solid rgba(59,130,246,0.35)' : '1px solid var(--border-hover)',
            borderRadius: showCustom ? '7px 7px 0 0' : 7,
            color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
            fontFamily: "'Sora', sans-serif",
            fontSize: 13, fontWeight: 500,
            outline: 'none', cursor: 'pointer',
            minWidth: compact ? 140 : 180,
          }}
        >
          <option value="all">All Time</option>

          {/* Financial Years */}
          {/* Saved custom ranges */}
          {customRanges.length > 0 && (
            <optgroup label="── Saved Ranges ──">
              {customRanges.map(r => (
                <option key={r.id} value={`custom_saved_${r.id}`}>{r.name}</option>
              ))}
            </optgroup>
          )}

          <optgroup label="── Financial Year ──">
            {fyOpts.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </optgroup>

          {/* Quarters — current FY */}
          <optgroup label={`── Quarters: ${fyLabel(currFyStart)} ──`}>
            {qOpts.filter(o => o.fyStart === currFyStart).map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </optgroup>

          {/* Quarters — previous FY */}
          <optgroup label={`── Quarters: ${fyLabel(currFyStart - 1)} ──`}>
            {qOpts.filter(o => o.fyStart === currFyStart - 1).map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </optgroup>

          {/* Monthly */}
          <optgroup label="── Monthly ──">
            {mOpts.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </optgroup>

          <option value="custom">📅 Custom Range...</option>
        </select>

        {/* Clear button */}
        {isActive && (
          <button
            onClick={() => apply(null, null, 'all')}
            title="Clear date filter"
            style={{
              marginLeft: 4, background: 'none', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer',
              fontSize: 16, lineHeight: 1, padding: '4px 6px',
            }}
          >×</button>
        )}
      </div>

      {/* Custom range picker */}
      {showCustom && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 300,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-hover)',
          borderTop: 'none',
          borderRadius: '0 7px 7px 7px',
          padding: 14, minWidth: 280,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>
            Custom Date Range
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>From</div>
              <input
                type="date" className="form-input"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                style={{ padding: '7px 10px', fontSize: 12 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>To</div>
              <input
                type="date" className="form-input"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                style={{ padding: '7px 10px', fontSize: 12 }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" style={{ flex: 1 }}
              onClick={() => { setShowCustom(false); setMode(isActive ? mode : 'all'); }}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" style={{ flex: 2 }}
              onClick={applyCustom} disabled={!customFrom && !customTo}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
