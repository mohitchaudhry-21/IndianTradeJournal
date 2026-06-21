import React, { useState, useEffect, useCallback } from 'react';

const SERVER = 'http://localhost:5001';

function fmtDate(str) {
  if (!str) return '—';
  const d = new Date(str.includes('-') && str.length === 10 ? str + 'T00:00:00' : str);
  return isNaN(d) ? str : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysFromNow(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr.includes('-') && dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr);
  return Math.round((d - Date.now()) / 86400000);
}

function ddmmyyyy(date) {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${d}-${m}-${date.getFullYear()}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

const EVENT_COLORS = {
  Dividend:       { bg: 'rgba(59,130,246,0.1)',  color: '#3B82F6', border: 'rgba(59,130,246,0.3)' },
  Bonus:          { bg: 'rgba(16,185,129,0.1)',  color: '#10B981', border: 'rgba(16,185,129,0.3)' },
  Split:          { bg: 'rgba(245,158,11,0.1)',  color: '#F59E0B', border: 'rgba(245,158,11,0.3)' },
  'Stock Results':{ bg: 'rgba(139,92,246,0.1)',  color: '#8B5CF6', border: 'rgba(139,92,246,0.3)' },
  'AGM/EGM':      { bg: 'rgba(236,72,153,0.1)',  color: '#EC4899', border: 'rgba(236,72,153,0.3)' },
  Rights:         { bg: 'rgba(251,146,60,0.1)',  color: '#FB923C', border: 'rgba(251,146,60,0.3)' },
  Default:        { bg: 'rgba(107,114,128,0.1)', color: '#6B7280', border: 'rgba(107,114,128,0.3)' },
};

function EventBadge({ type }) {
  const c = EVENT_COLORS[type] || EVENT_COLORS.Default;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`, whiteSpace: 'nowrap' }}>
      {type}
    </span>
  );
}

function ImpactBadge({ impact }) {
  const map = {
    High:   { bg: 'rgba(239,68,68,0.12)',  color: '#EF4444' },
    Medium: { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B' },
    Low:    { bg: 'rgba(107,114,128,0.1)', color: '#6B7280' },
  };
  const c = map[impact] || map.Low;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5,
      background: c.bg, color: c.color }}>{impact}</span>
  );
}

// ── Confirmed RBI FY27 dates ──────────────────────────────────────────────────
const RBI_EVENTS = [
  { date: '2026-04-08', time: '10:00 AM', event: 'RBI MPC Rate Decision', detail: 'Meeting: Apr 6–8', impact: 'High', done: true,  actual: '5.25%' },
  { date: '2026-06-05', time: '10:00 AM', event: 'RBI MPC Rate Decision', detail: 'Meeting: Jun 3–5', impact: 'High', done: false, actual: '' },
  { date: '2026-08-07', time: '10:00 AM', event: 'RBI MPC Rate Decision', detail: 'Meeting: Aug (exact TBA)', impact: 'High', done: false, actual: '' },
  { date: '2026-10-09', time: '10:00 AM', event: 'RBI MPC Rate Decision', detail: 'Meeting: Oct (exact TBA)', impact: 'High', done: false, actual: '' },
  { date: '2026-12-04', time: '10:00 AM', event: 'RBI MPC Rate Decision', detail: 'Meeting: Dec (exact TBA)', impact: 'High', done: false, actual: '' },
  { date: '2027-02-05', time: '10:00 AM', event: 'RBI MPC Rate Decision', detail: 'Meeting: Feb 2027 (exact TBA)', impact: 'High', done: false, actual: '' },
  { date: '2026-06-12', time: '05:30 PM', event: 'India CPI Inflation — May 2026', detail: 'MoSPI release', impact: 'Medium', done: false, actual: '' },
  { date: '2026-06-28', time: '05:30 PM', event: 'India GDP Q4 FY26',             detail: 'MoSPI first advance estimate', impact: 'High', done: false, actual: '' },
  { date: '2026-07-14', time: '05:30 PM', event: 'India CPI Inflation — Jun 2026', detail: 'MoSPI release', impact: 'Medium', done: false, actual: '' },
  { date: '2026-07-15', time: '11:00 AM', event: 'India WPI — Jun 2026',           detail: 'DPIIT release', impact: 'Low',    done: false, actual: '' },
  { date: '2026-08-12', time: '05:30 PM', event: 'India CPI Inflation — Jul 2026', detail: 'MoSPI release', impact: 'Medium', done: false, actual: '' },
];


const NSE_HOLIDAYS_2026 = [
  { date: '2026-01-26', weekday: 'Monday',   holiday: 'Republic Day' },
  { date: '2026-03-03', weekday: 'Tuesday',  holiday: 'Holi' },
  { date: '2026-03-26', weekday: 'Thursday', holiday: 'Shri Ram Navami' },
  { date: '2026-03-31', weekday: 'Tuesday',  holiday: 'Shri Mahavir Jayanti' },
  { date: '2026-04-03', weekday: 'Friday',   holiday: 'Good Friday' },
  { date: '2026-04-14', weekday: 'Tuesday',  holiday: 'Dr. Baba Saheb Ambedkar Jayanti' },
  { date: '2026-05-01', weekday: 'Friday',   holiday: 'Maharashtra Day' },
  { date: '2026-05-28', weekday: 'Thursday', holiday: 'Bakri Id' },
  { date: '2026-06-26', weekday: 'Friday',   holiday: 'Muharram' },
  { date: '2026-09-14', weekday: 'Monday',   holiday: 'Ganesh Chaturthi' },
  { date: '2026-10-02', weekday: 'Friday',   holiday: 'Mahatma Gandhi Jayanti' },
  { date: '2026-10-20', weekday: 'Tuesday',  holiday: 'Dussehra' },
  { date: '2026-11-10', weekday: 'Tuesday',  holiday: 'Diwali - Balipratipada' },
  { date: '2026-11-24', weekday: 'Tuesday',  holiday: 'Prakash Gurpurb Sri Guru Nanak Dev' },
  { date: '2026-12-25', weekday: 'Friday',   holiday: 'Christmas' },
];

const NYSE_HOLIDAYS_2026 = [
  { date: '2026-01-01', weekday: 'Thursday', holiday: "New Year's Day" },
  { date: '2026-01-19', weekday: 'Monday',   holiday: 'Martin Luther King, Jr. Day' },
  { date: '2026-02-16', weekday: 'Monday',   holiday: "Washington's Birthday" },
  { date: '2026-04-03', weekday: 'Friday',   holiday: 'Good Friday' },
  { date: '2026-05-25', weekday: 'Monday',   holiday: 'Memorial Day' },
  { date: '2026-06-19', weekday: 'Friday',   holiday: 'Juneteenth National Independence Day' },
  { date: '2026-07-03', weekday: 'Friday',   holiday: 'Independence Day Observed' },
  { date: '2026-09-07', weekday: 'Monday',   holiday: 'Labor Day' },
  { date: '2026-11-26', weekday: 'Thursday', holiday: 'Thanksgiving Day' },
  { date: '2026-12-25', weekday: 'Friday',   holiday: 'Christmas Day' },
];

const inputStyle = {
  background: 'var(--bg-card2)', border: '1px solid var(--border-hover)',
  borderRadius: 8, color: 'var(--text-primary)', fontSize: 13,
  padding: '8px 12px', outline: 'none',
};
const btnStyle = {
  background: 'var(--accent)', border: 'none', borderRadius: 8,
  color: '#fff', fontSize: 13, fontWeight: 700, padding: '8px 20px', cursor: 'pointer',
};

// ── 1. Economic Calendar ──────────────────────────────────────────────────────
function EconomicCalendar() {
  const today = new Date().toISOString().slice(0, 10);
  const nextEvent = RBI_EVENTS
    .filter(e => !e.done && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;

  // Live global calendar state
  const [events, setEvents] = useState([]);
  const [loadingEcon, setLoadingEcon] = useState(false);
  const [econErr, setEconErr] = useState('');
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo]     = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [filterCountry, setFilterCountry] = useState('All');
  const [filterImpact, setFilterImpact]   = useState('All');

  const loadEcon = useCallback(async () => {
    setLoadingEcon(true); setEconErr('');
    try {
      const r = await fetch(
        `${SERVER}/calendar/economic?date_from=${dateFrom}&date_to=${dateTo}&countries=14,5,35&importance=1,2,3`
      );
      const d = await r.json();
      if (d.success) setEvents(d.events || []);
      else setEconErr(d.error || 'Failed to load');
    } catch { setEconErr('Server not running — start server.py'); }
    setLoadingEcon(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { loadEcon(); }, [loadEcon]);

  const IMPACT_COLORS = {
    High:   { color: '#EF4444', dot: '●●●' },
    Medium: { color: '#F59E0B', dot: '●●○' },
    Low:    { color: '#6B7280', dot: '●○○' },
  };

  // Group by date
  const filtered = events.filter(e =>
    (filterCountry === 'All' || e.country === filterCountry) &&
    (filterImpact  === 'All' || e.impact  === filterImpact)
  );
  const grouped = {};
  filtered.forEach(e => {
    if (!grouped[e.date]) grouped[e.date] = [];
    grouped[e.date].push(e);
  });

  return (
    <div>
      {/* Next high impact alert */}
      {nextEvent && (
        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 12, padding: '11px 18px', marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
            background: 'rgba(239,68,68,0.12)', color: '#EF4444', whiteSpace: 'nowrap' }}>NEXT HIGH IMPACT</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>🇮🇳 {nextEvent.event}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {fmtDate(nextEvent.date)} · {nextEvent.time} IST · {nextEvent.detail}
          </span>
          {(() => { const d = daysFromNow(nextEvent.date); return d !== null
            ? <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700,
                color: d <= 5 ? '#EF4444' : '#F59E0B' }}>{d === 0 ? 'Today' : `${d} days away`}</span>
            : null; })()}
        </div>
      )}

      {/* India key events */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
        overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: '11px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>🇮🇳 India key events — FY 2026-27</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>RBI official calendar · MoSPI dates</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 90px 80px 80px',
          padding: '7px 18px', background: 'var(--bg-card2)', borderBottom: '1px solid var(--border)',
          fontSize: 11, color: 'var(--text-muted)', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <span>Date</span><span>Event</span><span>Time IST</span><span>Impact</span><span>Actual</span>
        </div>
        {RBI_EVENTS.sort((a, b) => a.date.localeCompare(b.date)).map((ev, i) => {
          const days = daysFromNow(ev.date);
          const isPast = ev.done || ev.date < today;
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 90px 80px 80px',
              padding: '9px 18px', alignItems: 'center', gap: 8,
              borderBottom: '1px solid var(--border)', opacity: isPast ? 0.4 : 1,
              background: !isPast && days !== null && days <= 5 ? 'rgba(239,68,68,0.03)' : 'transparent' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{fmtDate(ev.date)}</div>
                {!isPast && days !== null && days <= 7 && (
                  <div style={{ fontSize: 10, fontWeight: 700, color: days <= 2 ? '#EF4444' : '#F59E0B' }}>
                    {days === 0 ? 'Today' : `${days}d`}
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 13 }}>{ev.event}</div>
                {ev.detail && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{ev.detail}</div>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ev.time}</div>
              <ImpactBadge impact={ev.impact} />
              <div style={{ fontSize: 12, fontWeight: ev.actual ? 700 : 400,
                color: ev.actual ? 'var(--profit)' : 'var(--text-muted)' }}>{ev.actual || '—'}</div>
            </div>
          );
        })}
      </div>

      {/* Live global calendar */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '11px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Live global calendar</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>India · USA · China · IST</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }} />
            <select value={filterCountry} onChange={e => setFilterCountry(e.target.value)}
              style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}>
              {['All','India','USA','China','Japan'].map(c => <option key={c}>{c}</option>)}
            </select>
            <select value={filterImpact} onChange={e => setFilterImpact(e.target.value)}
              style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}>
              {['All','High','Medium','Low'].map(i => <option key={i}>{i}</option>)}
            </select>
            <button onClick={loadEcon} style={{ ...btnStyle, padding: '5px 14px', fontSize: 12 }}>
              {loadingEcon ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {econErr ? (
          <div style={{ padding: '16px 18px', fontSize: 13, color: 'var(--loss)',
            background: 'rgba(239,68,68,0.05)', borderBottom: '1px solid var(--border)' }}>
            {econErr}
            {econErr.includes('beautifulsoup') && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                Run in terminal: <code style={{ background: 'var(--bg-card2)', padding: '1px 6px', borderRadius: 4 }}>
                  pip install beautifulsoup4
                </code>
              </div>
            )}
          </div>
        ) : null}

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '80px 32px 80px 1fr 80px 80px 80px',
          padding: '7px 18px', background: 'var(--bg-card2)', borderBottom: '1px solid var(--border)',
          fontSize: 11, color: 'var(--text-muted)', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <span>Date</span><span></span><span>Time IST</span><span>Event</span>
          <span style={{ textAlign: 'right' }}>Actual</span>
          <span style={{ textAlign: 'right' }}>Forecast</span>
          <span style={{ textAlign: 'right' }}>Previous</span>
        </div>

        {loadingEcon ? (
          <div style={{ padding: '40px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Loading from Investing.com…
          </div>
        ) : Object.keys(grouped).length === 0 ? (
          <div style={{ padding: '40px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No events found for this period.{econErr ? '' : ' Try a wider date range.'}
          </div>
        ) : Object.entries(grouped).map(([date, evs]) => (
          <div key={date}>
            <div style={{ padding: '7px 18px', background: 'rgba(59,130,246,0.05)',
              borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
              fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
              {date}
            </div>
            {evs.map((ev, i) => {
              const ic = IMPACT_COLORS[ev.impact] || IMPACT_COLORS.Low;
              const hasActual = ev.actual && ev.actual !== '';
              const actualColor = hasActual
                ? (ev.forecast && parseFloat(ev.actual) >= parseFloat(ev.forecast) ? 'var(--profit)' : 'var(--loss)')
                : 'var(--text-muted)';
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 32px 80px 1fr 80px 80px 80px',
                  padding: '9px 18px', alignItems: 'center', gap: 8,
                  borderBottom: '1px solid var(--border)', fontSize: 13,
                  background: ev.impact === 'High' ? 'rgba(239,68,68,0.02)' : 'transparent' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}></div>
                  <div style={{ fontSize: 18 }} title={ev.country}>{ev.flag}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{ev.time}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: ic.color, letterSpacing: -2 }} title={ev.impact}>{ic.dot}</span>
                    <span style={{ fontSize: 13 }}>{ev.event}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ev.currency}</span>
                  </div>
                  <div style={{ textAlign: 'right', fontWeight: hasActual ? 700 : 400,
                    color: hasActual ? actualColor : 'var(--text-muted)', fontSize: 12 }}>
                    {ev.actual || '—'}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>{ev.forecast || '—'}</div>
                  <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>{ev.previous || '—'}</div>
                </div>
              );
            })}
          </div>
        ))}
        <div style={{ padding: '8px 18px', borderTop: '1px solid var(--border)',
          fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
          {filtered.length} events · Data sourced from{' '}
          <a href="https://www.investing.com/economic-calendar/" target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--accent)' }}>Investing.com</a>
        </div>
      </div>
    </div>
  );
}

// ── 2. Stock Results Calendar ─────────────────────────────────────────────────
function StockResultsCalendar() {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fromDate, setFromDate] = useState(() => ddmmyyyy(new Date()));
  const [toDate, setToDate] = useState(() => ddmmyyyy(addDays(new Date(), 30)));
  const [filterType, setFilterType] = useState('All');
  const [search, setSearch] = useState('');
  const [liquidOnly, setLiquidOnly] = useState(false);

  const EVENT_TYPES = ['All', 'Dividend', 'Bonus', 'Split', 'Rights', 'AGM/EGM'];

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${SERVER}/calendar/corporate-actions?from_date=${fromDate}&to_date=${toDate}`);
      const d = await r.json();
      if (d.success) setActions(d.actions || []);
      else setError(d.error || 'Failed to load');
    } catch { setError('Server not running — start server.py'); }
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  function normaliseAction(a) {
    const purposeRaw = a.purpose || a.subject || '';
    const p = purposeRaw.toLowerCase();
    return {
      symbol:  a.symbol || a.sym || '',
      company: a.comp || a.companyName || a.company || '',
      series:  a.series || 'EQ',
      exDate:  a.exDate || a.exdate || a.ex_date || '',
      purpose: purposeRaw,
      type: p.includes('dividend') ? 'Dividend'
          : p.includes('bonus')    ? 'Bonus'
          : p.includes('split') || p.includes('sub-division') ? 'Split'
          : p.includes('rights')   ? 'Rights'
          : p.includes('agm') || p.includes('egm') ? 'AGM/EGM'
          : 'Other',
    };
  }

  let filtered = actions.map(normaliseAction);
  if (filterType !== 'All') filtered = filtered.filter(a => a.type === filterType);
  if (liquidOnly) filtered = filtered.filter(a => a.series === 'EQ');
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(a => a.symbol.toLowerCase().includes(q) || a.company.toLowerCase().includes(q));
  }

  const grouped = {};
  filtered.forEach(a => { const k = a.exDate || 'TBA'; if (!grouped[k]) grouped[k] = []; grouped[k].push(a); });
  const sortedDates = Object.keys(grouped).sort();

  const typeCounts = {};
  EVENT_TYPES.slice(1).forEach(t => { typeCounts[t] = filtered.filter(a => a.type === t).length; });

  return (
    <div>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
        padding: '14px 18px', marginBottom: 14,
        display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>From</div>
          <input type="text" value={fromDate} onChange={e => setFromDate(e.target.value)}
            placeholder="DD-MM-YYYY" style={{ ...inputStyle, width: 120 }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>To</div>
          <input type="text" value={toDate} onChange={e => setToDate(e.target.value)}
            placeholder="DD-MM-YYYY" style={{ ...inputStyle, width: 120 }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Event type</div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} style={inputStyle}>
            {EVENT_TYPES.map(t => (
              <option key={t} value={t}>{t}{t !== 'All' && typeCounts[t] !== undefined ? ` (${typeCounts[t]})` : ''}</option>
            ))}
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', paddingBottom: 6 }}>
          <input type="checkbox" checked={liquidOnly} onChange={e => setLiquidOnly(e.target.checked)} />
          EQ series only
        </label>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Search</div>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Company / ticker…" style={{ ...inputStyle, width: '100%' }} />
        </div>
        <button onClick={load} style={btnStyle}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      {error && (
        <div style={{ color: 'var(--loss)', fontSize: 13, marginBottom: 12, padding: '10px 16px',
          background: 'rgba(239,68,68,0.06)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Loading from NSE…</div>
      ) : sortedDates.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)',
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12 }}>
          No corporate actions found for this period.
        </div>
      ) : (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{filtered.length} events</strong> · {fromDate} to {toDate}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 120px 1fr',
            padding: '8px 18px', background: 'var(--bg-card2)', borderBottom: '1px solid var(--border)',
            fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <span>Ex-date</span><span>Stock</span><span>Event</span><span>Details</span>
          </div>
          {sortedDates.map(dateKey => {
            const days = daysFromNow(dateKey);
            return (
              <div key={dateKey}>
                <div style={{ padding: '7px 18px', background: 'rgba(59,130,246,0.04)',
                  borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)',
                  fontSize: 12, fontWeight: 700, color: 'var(--accent)',
                  display: 'flex', alignItems: 'center', gap: 10 }}>
                  {fmtDate(dateKey)}
                  {days !== null && days >= 0 && days <= 7 && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99,
                      background: days <= 2 ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
                      color: days <= 2 ? '#EF4444' : '#F59E0B' }}>{days === 0 ? 'Today' : `${days}d`}</span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                    {grouped[dateKey].length} event{grouped[dateKey].length > 1 ? 's' : ''}
                  </span>
                </div>
                {grouped[dateKey].map((a, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 120px 1fr',
                    padding: '10px 18px', alignItems: 'center', gap: 12,
                    borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.series}</div>
                    <div>
                      <div style={{ fontWeight: 700 }}>{a.symbol}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{a.company}</div>
                    </div>
                    <EventBadge type={a.type} />
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.purpose}</div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 3. Holiday Calendar ───────────────────────────────────────────────────────
function HolidayCalendar() {
  const [showUS, setShowUS] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const holidays = showUS
    ? [...NSE_HOLIDAYS_2026.map(h => ({ ...h, exchange: 'NSE' })),
       ...NYSE_HOLIDAYS_2026.map(h => ({ ...h, exchange: 'NYSE' }))]
        .sort((a, b) => a.date.localeCompare(b.date))
    : NSE_HOLIDAYS_2026.map(h => ({ ...h, exchange: 'NSE' }));

  const upcoming = holidays.find(h => h.date >= today) || null;

  return (
    <div>
      {upcoming && (
        <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.25)',
          borderRadius: 12, padding: '12px 18px', marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, display: 'inline-block' }} />
          <span style={{ fontSize: 13 }}>
            Upcoming holiday: <strong>{fmtDate(upcoming.date)}, {upcoming.weekday}</strong>
            {daysFromNow(upcoming.date) !== null && (
              <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--accent)' }}>
                ({daysFromNow(upcoming.date)} days)
              </span>
            )}
            {' — '}{upcoming.holiday}
          </span>
        </div>
      )}

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>NSE Trading Holidays 2026</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={showUS} onChange={e => setShowUS(e.target.checked)} />
            Show NYSE holidays
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '44px 120px 100px 1fr 56px',
          padding: '8px 18px', background: 'var(--bg-card2)', borderBottom: '1px solid var(--border)',
          fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <span>#</span><span>Date</span><span>Weekday</span><span>Holiday</span><span>Exch</span>
        </div>
        {holidays.map((h, i) => {
          const isPast = h.date < today;
          const isNext = upcoming && h.date === upcoming.date;
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '44px 120px 100px 1fr 56px',
              padding: '10px 18px', alignItems: 'center', gap: 12,
              borderBottom: '1px solid var(--border)',
              background: isNext ? 'rgba(59,130,246,0.05)' : 'transparent',
              opacity: isPast ? 0.4 : 1, fontSize: 13, fontWeight: isNext ? 700 : 400 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{i + 1}</span>
              <span>{fmtDate(h.date)}</span>
              <span style={{ color: 'var(--text-muted)' }}>{h.weekday}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{h.exchange === 'NYSE' ? '🇺🇸' : '🇮🇳'}</span>
                <span>{h.holiday}</span>
                {isNext && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99,
                  background: 'rgba(59,130,246,0.12)', color: 'var(--accent)' }}>Next</span>}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.exchange}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'economic',  label: 'Economic Calendar' },
  { id: 'corporate', label: 'Stock Results Calendar' },
  { id: 'holiday',   label: 'Holiday Calendar' },
];

export default function StockMarketCalendar() {
  const [tab, setTab] = useState('economic');
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <div className="page-title">Stock Market Calendar</div>
        <div className="page-subtitle">Economic events, corporate actions and market holidays</div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20,
        background: 'var(--bg-card2)', borderRadius: 10, padding: 4,
        width: 'fit-content', border: '1px solid var(--border)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ background: tab === t.id ? 'var(--accent)' : 'transparent',
              border: 'none', borderRadius: 7,
              color: tab === t.id ? '#fff' : 'var(--text-muted)',
              fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
              padding: '8px 18px', cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'economic'  && <EconomicCalendar />}
      {tab === 'corporate' && <StockResultsCalendar />}
      {tab === 'holiday'   && <HolidayCalendar />}
    </div>
  );
}
