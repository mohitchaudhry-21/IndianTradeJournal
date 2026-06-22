import React, { useState, useEffect, useCallback, useRef } from 'react';

const SERVER = 'http://localhost:5001';

// ── Module-level cache — survives navigation (lives as long as the app is open) ──
const _cache = { stocks: [], indices: [], lastUpdated: null };
// ── Market hours helper (IST = UTC+5:30) ─────────────────────────────────────
function getISTTime() {
  const now = new Date();
  // IST offset: UTC+5:30 = 330 minutes
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
  return ist;
}

function isMarketOpen() {
  const ist = getISTTime();
  const day = ist.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const h = ist.getHours(), m = ist.getMinutes();
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 15 && mins < 15 * 60 + 30;
}

function marketStatusLabel() {
  const ist = getISTTime();
  const day = ist.getDay();
  if (day === 0 || day === 6) return { open: false, label: 'Weekend — showing last close' };
  const h = ist.getHours(), m = ist.getMinutes();
  const mins = h * 60 + m;
  if (mins < 9 * 60 + 15) return { open: false, label: 'Pre-market — showing prev close' };
  if (mins >= 15 * 60 + 30) return { open: false, label: 'Market closed — showing last LTP' };
  return { open: true, label: 'Market live' };
}

const SECTORS = ['All','Banking','IT','Energy','Finance','Auto','FMCG','Pharma',
                 'Infra','Metals','Telecom','Insurance','Cons. Disc.','Defence'];

function getColor(pct) {
  const abs = Math.abs(pct);
  if (pct > 0) {
    if (abs >= 3)   return { bg:'#1a4a1a', border:'#3a8a3a', text:'#a5d6a7', textBright:'#fff', textMid:'#c8e6c9' };
    if (abs >= 2)   return { bg:'#1e4d1e', border:'#3a7a3a', text:'#a5d6a7', textBright:'#fff', textMid:'#c8e6c9' };
    if (abs >= 1)   return { bg:'#1b3d1b', border:'#3a6a3a', text:'#a5d6a7', textBright:'#fff', textMid:'#c8e6c9' };
    if (abs >= 0.5) return { bg:'#1a351a', border:'#356535', text:'#a5d6a7', textBright:'#fff', textMid:'#c8e6c9' };
    return              { bg:'#1a2d1a', border:'#2d4f2d', text:'#a5d6a7', textBright:'#fff', textMid:'#c8e6c9' };
  } else if (pct < 0) {
    if (abs >= 3)   return { bg:'#4a1a1a', border:'#9a3a3a', text:'#ef9a9a', textBright:'#fff', textMid:'#ffcdd2' };
    if (abs >= 2)   return { bg:'#4d1e1e', border:'#8a3a3a', text:'#ef9a9a', textBright:'#fff', textMid:'#ffcdd2' };
    if (abs >= 1)   return { bg:'#3d1b1b', border:'#7a3a3a', text:'#ef9a9a', textBright:'#fff', textMid:'#ffcdd2' };
    if (abs >= 0.5) return { bg:'#351a1a', border:'#6a3535', text:'#ef9a9a', textBright:'#fff', textMid:'#ffcdd2' };
    return              { bg:'#2d1a1a', border:'#4f2d2d', text:'#ef9a9a', textBright:'#fff', textMid:'#ffcdd2' };
  }
  return { bg:'#1e1e2e', border:'#444', text:'#aaa', textBright:'#fff', textMid:'#ccc' };
}

// Display name overrides for symbols with special characters
const DISPLAY_NAMES = {
  'M_M': 'M&M',
  'BAJAJ_AUTO': 'BAJAJ-AUTO',
};

function displaySymbol(sym) {
  return DISPLAY_NAMES[sym] || sym;
}

function fmt(n, decimals=2) {
  if (!n && n !== 0) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export default function Heatmap() {
  const [stocks, setStocks]     = useState(_cache.stocks);
  const [indices, setIndices]   = useState(_cache.indices);
  const [loading, setLoading]   = useState(_cache.stocks.length === 0); // only show spinner on first load
  const [error, setError]       = useState('');
  const [lastUpdated, setLastUpdated] = useState(_cache.lastUpdated);
  const [sector, setSector]     = useState('All');
  const [sortBy, setSortBy]     = useState('changePct');
  const [groupBySector, setGroupBySector] = useState(false);
  const [marketStatus, setMarketStatus]   = useState(marketStatusLabel());
  const intervalRef = useRef(null);

  const load = useCallback(async (silent=false) => {
    if (!silent) setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${SERVER}/heatmap/nifty50`),
        fetch(`${SERVER}/heatmap/indices`),
      ]);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
      if (d1.success) {
        _cache.stocks = d1.stocks;
        setStocks(d1.stocks);
      } else setError(d1.error || 'Failed to load stocks');
      if (d2.success) {
        _cache.indices = d2.indices;
        setIndices(d2.indices);
      }
      const now = new Date();
      _cache.lastUpdated = now;
      setLastUpdated(now);
      if (d1.success) setError('');
    } catch { setError('Server not running — start server.py'); }
    setLoading(false);
  }, []);

  // Smart refresh: every 30s during market hours, stop when closed
  useEffect(() => {
    // If cache is fresh (< 60s old), skip the initial fetch
    const cacheAge = _cache.lastUpdated ? (Date.now() - _cache.lastUpdated.getTime()) : Infinity;
    if (cacheAge < 60000 && _cache.stocks.length > 0) {
      setLoading(false);
    } else {
      load();
    }

    function scheduleRefresh() {
      const status = marketStatusLabel();
      setMarketStatus(status);
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (status.open) {
        intervalRef.current = setInterval(() => {
          load(true);
          const s = marketStatusLabel();
          setMarketStatus(s);
          if (!s.open && intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }, 30000);
      }
    }
    scheduleRefresh();
    const checkId = setInterval(scheduleRefresh, 60000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearInterval(checkId);
    };
  }, [load]);

  const filtered = stocks
    .filter(s => sector === 'All' || s.sector === sector)
    .sort((a, b) => {
      if (sortBy === 'changePct') return b.changePct - a.changePct;
      if (sortBy === 'alpha') return a.symbol.localeCompare(b.symbol);
      if (sortBy === 'ltp') return b.ltp - a.ltp;
      return 0;
    });

  // Sector summary for group view
  const sectorGroups = {};
  filtered.forEach(s => {
    if (!sectorGroups[s.sector]) sectorGroups[s.sector] = [];
    sectorGroups[s.sector].push(s);
  });

  const advances = stocks.filter(s => s.changePct > 0).length;
  const declines = stocks.filter(s => s.changePct < 0).length;
  const unchanged = stocks.filter(s => s.changePct === 0).length;

  const StockCard = ({ s }) => {
    const c = getColor(s.changePct);
    const sign = s.changePct >= 0 ? '+' : '';
    const lbl = { fontSize:10, color:c.textMid, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:2 };
    return (
      <div style={{ background:c.bg, border:`1px solid ${c.border}`, borderRadius:12,
        padding:'12px 13px', cursor:'default', transition:'transform 0.1s', minWidth:0, overflow:'hidden' }}
        onMouseEnter={e => e.currentTarget.style.transform='scale(1.02)'}
        onMouseLeave={e => e.currentTarget.style.transform='scale(1)'}
      >
        {/* Header: Symbol left, % right — both on one line, symbol truncates if needed */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:4, gap:4 }}>
          <span style={{ fontSize:14, fontWeight:700, color:'#fff', minWidth:0,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {displaySymbol(s.symbol)}
          </span>
          <span style={{ fontSize:15, fontWeight:700, color:c.text, flexShrink:0 }}>
            {sign}{s.changePct.toFixed(2)}%
          </span>
        </div>

        {/* Divider */}
        <div style={{ height:1, background:'rgba(255,255,255,0.18)', margin:'8px 0' }}/>

        {/* Row 1: Open / LTP / Chg ₹ — equal 3 columns */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0 4px', marginBottom:8 }}>
          <div>
            <div style={lbl}>Open</div>
            <div style={{ fontSize:11, color:c.textMid, fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {fmt(s.prevClose, 2)}
            </div>
          </div>
          <div>
            <div style={lbl}>LTP</div>
            <div style={{ fontSize:11, fontWeight:700, color:c.textBright, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {fmt(s.ltp, 2)}
            </div>
          </div>
          <div>
            <div style={lbl}>Chg ₹</div>
            <div style={{ fontSize:11, fontWeight:700, color:c.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {sign}{fmt(s.change, 2)}
            </div>
          </div>
        </div>

        {/* Row 2: Fut. Price / ATM IV */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 4px' }}>
          <div>
            <div style={lbl}>Fut. Price</div>
            <div style={{ fontSize:11, fontWeight:500, color:c.textMid }}>{fmt(s.ltp, 2)}</div>
          </div>
          <div>
            <div style={lbl}>ATM IV</div>
            <div style={{ fontSize:11, fontWeight:700, color:c.textBright }}>—</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth:1400, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom:14, display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
        <div>
          <div className="page-title">Market Heatmap</div>
          <div className="page-subtitle">Nifty 50 stocks · colour by % change</div>
        </div>
        <div style={{ display:'flex', gap:16, fontSize:13, alignItems:'center' }}>
          <span style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ width:8, height:8, borderRadius:'50%', display:'inline-block',
              background: marketStatus.open ? '#4caf50' : '#888',
              boxShadow: marketStatus.open ? '0 0 6px #4caf50' : 'none' }}/>
            <span style={{ fontSize:12, color: marketStatus.open ? '#81c784' : 'var(--text-muted)' }}>
              {marketStatus.label}
            </span>
          </span>
          <span style={{ color:'#81c784' }}>▲ {advances} up</span>
          <span style={{ color:'#e57373' }}>▼ {declines} down</span>
          {unchanged > 0 && <span style={{ color:'var(--text-muted)' }}>● {unchanged} flat</span>}
          {/* Controls inline in header */}
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
            style={{ fontSize:12, background:'var(--bg-card2)', border:'1px solid var(--border)',
              borderRadius:8, color:'var(--text-primary)', padding:'5px 10px' }}>
            <option value="changePct">Sort: % Change</option>
            <option value="alpha">Sort: A–Z</option>
            <option value="ltp">Sort: Price</option>
          </select>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, cursor:'pointer', color:'var(--text-muted)' }}>
            <input type="checkbox" checked={groupBySector} onChange={e=>setGroupBySector(e.target.checked)}/>
            Group
          </label>
          <button onClick={()=>load()}
            style={{ fontSize:12, fontWeight:700, padding:'5px 14px', borderRadius:8,
              background:'var(--accent)', border:'none', color:'#fff', cursor:'pointer' }}>
            {loading ? '…' : 'Refresh'}
          </button>
          {lastUpdated && (
            <span style={{ fontSize:11, color:'var(--text-muted)' }}>
              {lastUpdated.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}
              {marketStatus.open && <span style={{ color:'#81c784', marginLeft:4 }}>· 30s</span>}
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding:'10px 16px', background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.2)',
          borderRadius:10, fontSize:13, color:'var(--loss)', marginBottom:12 }}>
          {error}
        </div>
      )}

      {/* Indices strip */}
      {indices.length > 0 && (
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'12px 14px', marginBottom:12 }}>
          <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:8 }}>Major Indices</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
            {indices.filter(i=>i.group==='Major').map(idx => {
              const c = getColor(idx.changePct);
              const sign = idx.changePct >= 0 ? '+' : '';
              return (
                <div key={idx.key} style={{ background:c.bg, border:`1px solid ${c.border}`,
                  borderRadius:10, padding:'10px 16px', minWidth:130, flex:'1 1 130px', maxWidth:200 }}>
                  <div style={{ fontSize:11, color:c.text, opacity:0.7, marginBottom:2 }}>{idx.label}</div>
                  <div style={{ fontSize:16, fontWeight:800, color:c.text }}>{idx.ltp.toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
                  <div style={{ fontSize:12, fontWeight:700, color:c.text, marginTop:2 }}>
                    {sign}{idx.changePct.toFixed(2)}% <span style={{ opacity:0.7, fontWeight:400 }}>({sign}{idx.change.toFixed(2)})</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ height:1, background:'var(--border)', margin:'0 0 10px 0' }}/>
          <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:8 }}>Sector Indices</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {indices.filter(i=>i.group==='Sector').map(idx => {
              const c = getColor(idx.changePct);
              const sign = idx.changePct >= 0 ? '+' : '';
              return (
                <div key={idx.key} style={{ background:c.bg, border:`1px solid ${c.border}`,
                  borderRadius:8, padding:'6px 12px', minWidth:100, flex:'1 1 100px', maxWidth:160 }}>
                  <div style={{ fontSize:10, color:c.text, opacity:0.7 }}>{idx.label}</div>
                  <div style={{ fontSize:13, fontWeight:700, color:c.text }}>{sign}{idx.changePct.toFixed(2)}%</div>
                  <div style={{ fontSize:11, color:c.text, opacity:0.7 }}>{idx.ltp.toLocaleString('en-IN', {maximumFractionDigits:0})}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main: left sidebar + right content */}
      <div style={{ display:'flex', gap:0, alignItems:'flex-start' }}>

        {/* Left sidebar — sector tabs */}
        <div style={{ width:130, flexShrink:0, background:'var(--bg-card)', border:'1px solid var(--border)',
          borderRadius:'12px 0 0 12px', overflow:'hidden', marginRight:0 }}>
          <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)',
            fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)' }}>
            Sector
          </div>
          {SECTORS.map(s => (
            <button key={s} onClick={()=>setSector(s)}
              style={{
                display:'block', width:'100%', textAlign:'left',
                padding:'9px 14px', border:'none', borderBottom:'1px solid var(--border)',
                cursor:'pointer', fontSize:12, fontWeight: sector===s ? 700 : 400,
                background: sector===s ? 'var(--accent)' : 'transparent',
                color: sector===s ? '#fff' : 'var(--text-muted)',
                transition:'background 0.12s',
              }}>
              {s}
            </button>
          ))}
        </div>

        {/* Right content */}
        <div style={{ flex:1, minWidth:0, background:'var(--bg-card)', border:'1px solid var(--border)',
          borderLeft:'none', borderRadius:'0 12px 12px 0', padding:'12px 14px' }}>

          {/* Nifty 50 label */}
          <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em',
            color:'var(--text-muted)', marginBottom:10 }}>
            Nifty 50 Stocks {sector !== 'All' && `· ${sector}`}
            <span style={{ marginLeft:8, fontWeight:400, color:'var(--text-muted)' }}>({filtered.length})</span>
          </div>

          {loading && !stocks.length ? (
            <div style={{ textAlign:'center', padding:60, color:'var(--text-muted)', fontSize:14 }}>
              Loading Nifty 50 data from Yahoo Finance…
            </div>
          ) : groupBySector ? (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {Object.entries(sectorGroups).sort(([a],[b])=>a.localeCompare(b)).map(([sec, secStocks]) => (
                <div key={sec}>
                  <div style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', marginBottom:6,
                    textTransform:'uppercase', letterSpacing:'0.06em' }}>
                    {sec} ({secStocks.length})
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(170px, 1fr))', gap:6 }}>
                    {secStocks.map(s => <StockCard key={s.symbol} s={s}/>)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(170px, 1fr))', gap:6 }}>
              {filtered.map(s => <StockCard key={s.symbol} s={s}/>)}
            </div>
          )}

          {filtered.length === 0 && !loading && (
            <div style={{ textAlign:'center', padding:40, color:'var(--text-muted)', fontSize:13 }}>
              No stocks in this sector.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
