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

// ── Nifty 100 symbols with sector mapping (Jun 2026) ─────────────────────────
// Source: NSE Indices Ltd — semi-annual rebalance Jan/Jul
const NIFTY100 = {
  // Banking & Finance
  HDFCBANK:'Banking', ICICIBANK:'Banking', SBIN:'Banking', AXISBANK:'Banking',
  KOTAKBANK:'Banking', INDUSINDBK:'Banking', BANDHANBNK:'Banking', FEDERALBNK:'Banking',
  IDFCFIRSTB:'Banking', BAJFINANCE:'Finance', BAJAJFINSV:'Finance', HDFCLIFE:'Insurance',
  SBILIFE:'Insurance', ICICIGI:'Insurance', LICI:'Insurance',
  // IT
  TCS:'IT', INFY:'IT', WIPRO:'IT', HCLTECH:'IT', TECHM:'IT', LTIM:'IT',
  MPHASIS:'IT', COFORGE:'IT', PERSISTENT:'IT',
  // Energy & Oil
  RELIANCE:'Energy', ONGC:'Energy', BPCL:'Energy', IOC:'Energy', COALINDIA:'Energy',
  ADANIGREEN:'Energy', ADANIPOWER:'Energy', TATAPOWER:'Energy', TORNTPOWER:'Energy', NTPC:'Energy',
  POWERGRID:'Energy', GAIL:'Energy',
  // Auto
  MARUTI:'Auto', TATAMOTORS:'Auto', BAJAJ_AUTO:'Auto', EICHERMOT:'Auto',
  HEROMOTOCO:'Auto', M_M:'Auto', TVSMOTOR:'Auto', ASHOKLEY:'Auto', TMPV:'Auto',
  // Consumer & FMCG
  HINDUNILVR:'FMCG', ITC:'FMCG', NESTLEIND:'FMCG', BRITANNIA:'FMCG',
  GODREJCP:'FMCG', MARICO:'FMCG', DABUR:'FMCG', COLPAL:'FMCG', TATACONSUM:'FMCG',
  // Pharma
  SUNPHARMA:'Pharma', DRREDDY:'Pharma', CIPLA:'Pharma', DIVISLAB:'Pharma',
  APOLLOHOSP:'Pharma', TORNTPHARM:'Pharma', BIOCON:'Pharma', ALKEM:'Pharma',
  // Metals & Mining
  TATASTEEL:'Metals', JSWSTEEL:'Metals', HINDALCO:'Metals', VEDL:'Metals',
  SAIL:'Metals', NMDC:'Metals', JINDALSTEL:'Metals',
  // Telecom
  BHARTIARTL:'Telecom', IDEA:'Telecom',
  // Infrastructure & Capital Goods
  LT:'Infra', ADANIPORTS:'Infra', ADANIENT:'Infra', ULTRACEMCO:'Infra',
  GRASIM:'Infra', AMBUJACEM:'Infra', ACC:'Infra', DALBHARAT:'Infra',
  ABB:'Capital Goods', SIEMENS:'Capital Goods', BEL:'Capital Goods',
  BHEL:'Capital Goods', CGPOWER:'Capital Goods',
  // Consumer Discretionary
  TITAN:'Cons. Disc.', ASIANPAINT:'Cons. Disc.', BERGERPAINTS:'Cons. Disc.',
  HAVELLS:'Cons. Disc.', VOLTAS:'Cons. Disc.', WHIRLPOOL:'Cons. Disc.',
  VBL:'Cons. Disc.', JUBLFOOD:'Cons. Disc.', DMART:'Cons. Disc.',
  TRENT:'Cons. Disc.', NYKAA:'Cons. Disc.',
  // Chemicals
  PIDILITIND:'Chemicals', SRF:'Chemicals', DEEPAKNITRITE:'Chemicals',
  // Others
  ZOMATO:'Internet', PAYTM:'Internet', INDIAMART:'Internet',
  IRCTC:'Transport', CONCOR:'Transport',
  BSE:'Finance', MUTHOOTFIN:'Finance', CHOLAFIN:'Finance', RECLTD:'Finance',
  PFC:'Finance', HUDCO:'Finance',
  POLYCAB:'Electricals', CUMMINSIND:'Industrials',
  SBICARD:'Finance', SHRIRAMFIN:'Finance', BAJAJHLDNG:'Finance', PIIND:'Chemicals',
  MOTHERSON:'Auto', EXIDEIND:'Auto', SUNDARMFIN:'Finance',
};

const SECTORS = ['All', ...Array.from(new Set(Object.values(NIFTY100))).sort()];

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
// Investing.com blocks server-side scraping with 403.
// Use their free embeddable widget (iframe) but wrap it in a dark container
// with CSS filter to invert/darken it to match our theme.
const INVESTING_WIDGET_URL =
  'https://sslecal2.investing.com?columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous&features=datepicker,timezone&countries=14,5,35&importance=2,3&defaultTab=0&calType=week&timeZone=23&lang=56';

function EconomicCalendar() {
  const today = new Date().toISOString().slice(0, 10);
  const nextEvent = RBI_EVENTS
    .filter(e => !e.done && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;

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

      {/* India key events table */}
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

      {/* Live global calendar — Investing.com widget with dark filter */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '11px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Live global calendar</span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 99,
              background: 'rgba(16,185,129,0.12)', color: '#10B981' }}>Investing.com</span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>India · USA · China · Medium + High · IST</span>
        </div>
        {/* Dark filter: invert colours then hue-rotate 180° brings blues/greens back */}
        <div style={{ filter: 'invert(1) hue-rotate(180deg)', background: '#fff' }}>
          <iframe
            src={INVESTING_WIDGET_URL}
            width="100%"
            height="600"
            frameBorder="0"
            allowTransparency="true"
            marginWidth="0"
            marginHeight="0"
            title="Economic Calendar"
            style={{ display: 'block' }}
          />
        </div>
        <div style={{ padding: '7px 18px', borderTop: '1px solid var(--border)',
          fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
          Data by{' '}
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
  // Use YYYY-MM-DD internally for date inputs (native date picker)
  const [fromDate, setFromDate] = useState(() => addDays(new Date(), -7).toISOString().slice(0,10));
  const [toDate, setToDate]     = useState(() => addDays(new Date(),  60).toISOString().slice(0,10));
  const [filterType, setFilterType] = useState('All');
  const [filterSector, setFilterSector] = useState('All');
  const [nifty100Only, setNifty100Only] = useState(true);
  const [search, setSearch] = useState('');
  const [liquidOnly, setLiquidOnly] = useState(false);

  const EVENT_TYPES = ['All', 'Dividend', 'Bonus', 'Split', 'Rights', 'AGM/EGM'];

  // Convert YYYY-MM-DD → DD-MM-YYYY for NSE API
  function toNseDate(iso) {
    const [y,m,d] = iso.split('-');
    return `${d}-${m}-${y}`;
  }

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${SERVER}/calendar/corporate-actions?from_date=${toNseDate(fromDate)}&to_date=${toNseDate(toDate)}`);
      const text = await r.text();
      let d;
      try { d = JSON.parse(text); } catch { setError(`NSE returned unexpected response — ${text.slice(0,120)}`); setLoading(false); return; }
      if (d.success) setActions(d.actions || []);
      else setError(d.error || 'Failed to load');
    } catch (e) { setError('Server not running — start server.py'); }
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  function normaliseAction(a) {
    const purposeRaw = a.purpose || a.subject || '';
    const p = purposeRaw.toLowerCase();
    // Convert NSE ex-date from DD-MMM-YYYY or DD-MM-YYYY to YYYY-MM-DD for sorting
    // NSE API returns record date; ex-date = record date - 1 calendar day
    const rawDate = a.exDate || a.exdate || a.ex_date || a['Ex Date'] || '';
    let exDate = rawDate;
    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d)) {
        // Subtract 1 day (record → ex-date)
        d.setDate(d.getDate() - 1);
        exDate = d.toISOString().slice(0,10);
      } else {
        const parts = rawDate.split('-');
        if (parts.length === 3 && parts[0].length === 2) {
          const d2 = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
          d2.setDate(d2.getDate() - 1);
          exDate = d2.toISOString().slice(0,10);
        }
      }
    }
    return {
      symbol:  a.symbol || a.sym || '',
      company: a.comp || a.companyName || a.company || '',
      series:  a.series || 'EQ',
      exDate,
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
  if (nifty100Only) filtered = filtered.filter(a => NIFTY100[a.symbol] !== undefined);
  if (filterType !== 'All') filtered = filtered.filter(a => a.type === filterType);
  if (filterSector !== 'All') filtered = filtered.filter(a => NIFTY100[a.symbol] === filterSector);
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
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            style={{ ...inputStyle, width: 140 }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>To</div>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            style={{ ...inputStyle, width: 140 }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Event type</div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} style={inputStyle}>
            {EVENT_TYPES.map(t => (
              <option key={t} value={t}>{t}{t !== 'All' && typeCounts[t] !== undefined ? ` (${typeCounts[t]})` : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Sector</div>
          <select value={filterSector} onChange={e => setFilterSector(e.target.value)} style={inputStyle}>
            {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', paddingBottom: 6 }}>
          <input type="checkbox" checked={nifty100Only} onChange={e => setNifty100Only(e.target.checked)} />
          Nifty 100 only
        </label>
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
            <strong style={{ color: 'var(--text-primary)' }}>{filtered.length} events</strong> · {fmtDate(fromDate)} to {fmtDate(toDate)}
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
                      <div style={{ fontWeight: 700, display:'flex', alignItems:'center', gap:6 }}>
                        {a.symbol}
                        {NIFTY100[a.symbol] && (
                          <span style={{ fontSize:10, fontWeight:600, padding:'1px 5px', borderRadius:4,
                            background:'rgba(59,130,246,0.12)', color:'var(--accent)' }}>
                            {NIFTY100[a.symbol]}
                          </span>
                        )}
                      </div>
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
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>NSE Trading Holidays 2026</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(16,185,129,0.3)', display: 'inline-block' }}/>
              NSE India
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(59,130,246,0.4)', display: 'inline-block' }}/>
              NYSE US
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={showUS} onChange={e => setShowUS(e.target.checked)} />
              Show NYSE holidays
            </label>
          </div>
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
              background: isNext ? 'rgba(59,130,246,0.05)'
                : h.exchange === 'NYSE' ? 'rgba(59,130,246,0.02)'
                : isPast ? 'transparent' : 'rgba(16,185,129,0.02)',
              opacity: isPast ? 0.4 : 1, fontSize: 13, fontWeight: isNext ? 700 : 400,
              borderLeft: isNext ? '3px solid var(--accent)'
                : h.exchange === 'NYSE' ? '3px solid rgba(59,130,246,0.4)'
                : '3px solid rgba(16,185,129,0.3)' }}>
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
