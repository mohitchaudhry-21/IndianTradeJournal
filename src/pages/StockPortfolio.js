import React, { useState, useEffect, useCallback, useMemo } from 'react';

const SYNC_SERVER = 'http://localhost:5001';
const STOCK_KEY = 'itj_stock_data';

const SECTORS = ['Banking','IT','Energy','Auto','Pharma','FMCG','Finance','Infra','Metals','Telecom','Cons. Disc.','Insurance','Defence','Real Estate','Media','Other'];

const SECTOR_COLORS = ['#6366f1','#22c55e','#f59e0b','#3b82f6','#ec4899','#14b8a6','#f97316','#8b5cf6','#06b6d4','#84cc16','#ef4444','#a855f7','#10b981','#f43f5e','#0ea5e9','#94a3b8'];

// Auto-detect sector from symbol
const SYMBOL_SECTOR_MAP = {
  HDFCBANK:'Banking', ICICIBANK:'Banking', SBIN:'Banking', AXISBANK:'Banking', KOTAKBANK:'Banking',
  INDUSINDBK:'Banking', BANKBARODA:'Banking', PNB:'Banking', RBLBANK:'Banking', UNIONBANK:'Banking',
  FEDERALBNK:'Banking', IDFCFIRSTB:'Banking', YESBANK:'Banking', CANBK:'Banking',
  TCS:'IT', INFY:'IT', HCLTECH:'IT', WIPRO:'IT', TECHM:'IT', LTIM:'IT', PERSISTENT:'IT',
  MPHASIS:'IT', COFORGE:'IT', KPITTECH:'IT', LTTS:'IT', HEXAWARE:'IT',
  RELIANCE:'Energy', ONGC:'Energy', NTPC:'Energy', POWERGRID:'Energy', BPCL:'Energy',
  COALINDIA:'Energy', ADANIGREEN:'Energy', ADANIPOWER:'Energy', ADANIPORTS:'Energy',
  TATAPOWER:'Energy', GAIL:'Energy', IOC:'Energy', HINDPETRO:'Energy',
  MARUTI:'Auto', TATAMOTORS:'Auto', BAJAJ_AUTO:'Auto', HEROMOTOCO:'Auto', EICHERMOT:'Auto',
  MOTHERSON:'Auto', BHARATFORG:'Auto', BOSCHLTD:'Auto', BALKRISHNA:'Auto', TMPV:'Auto', TMCV:'Auto',
  SUNPHARMA:'Pharma', DRREDDY:'Pharma', CIPLA:'Pharma', DIVISLAB:'Pharma', AUROPHARMA:'Pharma',
  BIOCON:'Pharma', LUPIN:'Pharma', TORNTPHARM:'Pharma', ALKEM:'Pharma', IPCALAB:'Pharma',
  HINDUNILVR:'FMCG', ITC:'FMCG', NESTLEIND:'FMCG', BRITANNIA:'FMCG', MARICO:'FMCG',
  DABUR:'FMCG', GODREJCP:'FMCG', COLPAL:'FMCG', EMAMILTD:'FMCG', TATACONSUM:'FMCG',
  BAJFINANCE:'Finance', BAJAJFINSV:'Finance', HDFCLIFE:'Finance', SBILIFE:'Finance',
  ICICIPRULI:'Finance', MUTHOOTFIN:'Finance', CHOLAFIN:'Finance', MANAPPURAM:'Finance',
  TATASTEEL:'Metals', JSWSTEEL:'Metals', HINDALCO:'Metals', VEDL:'Metals', SAIL:'Metals',
  NATIONALUM:'Metals', NMDC:'Metals',
  LT:'Infra', ADANIENT:'Infra', ULTRACEMCO:'Infra', GRASIM:'Infra', SHREECEM:'Infra',
  BHARTIARTL:'Telecom', IDEA:'Telecom', TATACOMM:'Telecom',
  TITAN:'Cons. Disc.', TRENT:'Cons. Disc.', DMART:'Cons. Disc.', NYKAA:'Cons. Disc.',
  ZOMATO:'Cons. Disc.', PAYTM:'Cons. Disc.', IRCTC:'Cons. Disc.',
  APOLLOHOSP:'Pharma', MAXHEALTH:'Pharma', FORTIS:'Pharma', NARAYANHRU:'Pharma',
  STARHEALTH:'Insurance', ICICIGI:'Insurance', NIACL:'Insurance',
  HAL:'Defence', BEL:'Defence', BHEL:'Defence', BEML:'Defence', COCHINSHIP:'Defence',
  DLF:'Real Estate', GODREJPROP:'Real Estate', OBEROIRLTY:'Real Estate', PHOENIXLTD:'Real Estate',
  BSE:'Finance', NSE:'Finance', MCX:'Finance', CAMS:'Finance', CDSL:'Finance',
  DIXON:'Cons. Disc.', AMBER:'Cons. Disc.',
  ITBEES:'IT', GOLDBEES:'Metals', NIFTYBEES:'Other', JUNIORBEES:'Other',
  AAVAS:'Finance', HDBFS:'Finance', BELRISE:'Auto', HUDCO:'Infra',
  ANTHEM:'Pharma', HYUNDAI:'Auto', UNITDSPR:'FMCG', EUREKAFORB:'Cons. Disc.',
  NIVABUPA:'Insurance', GROWW:'Finance', VOLTAS:'Cons. Disc.', TATACAP:'Finance',
};

function getSector(symbol) {
  return SYMBOL_SECTOR_MAP[symbol.toUpperCase()] || 'Other';
}

function loadData() {
  try { return JSON.parse(localStorage.getItem(STOCK_KEY) || '{}'); } catch { return {}; }
}
function saveData(d) { localStorage.setItem(STOCK_KEY, JSON.stringify(d)); }

// Indian number formatting — manual to avoid browser locale issues
function fmtINR(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  const fixed = abs.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  // Indian grouping: last 3 digits, then groups of 2
  let result = intPart;
  if (intPart.length > 3) {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    const groups = [];
    for (let i = rest.length; i > 0; i -= 2) {
      groups.unshift(rest.slice(Math.max(0, i - 2), i));
    }
    result = groups.join(',') + ',' + last3;
  }
  return sign + '₹' + result + (decPart ? '.' + decPart : '');
}

function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return sign + n.toFixed(2) + '%';
}

function fmtChange(n) {
  if (n === null || n === undefined || isNaN(n)) return null;
  const sign = n >= 0 ? '+' : '';
  return sign + n.toFixed(2) + '%';
}

function daysBetween(d1) {
  if (!d1 || d1 === 'today') return 0;
  const parsed = new Date(d1);
  if (isNaN(parsed.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - parsed) / 86400000));
}

const inputStyle = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  borderRadius: 'var(--radius)', border: '0.5px solid var(--border)',
  background: 'var(--surface-2)', color: 'var(--text-primary)',
  fontFamily: 'var(--font-sans)', outline: 'none', boxSizing: 'border-box',
};

// ─── Add Transaction Modal ────────────────────────────────────────────────────
function AddTransactionModal({ onClose, onSave, prefill = null }) {
  const [form, setForm] = useState({
    type: 'BUY', exchange: 'NSE', symbol: '', date: new Date().toISOString().slice(0,10),
    qty: '', price: '', brokerage: '20', notes: '', sector: '',
    ...prefill,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Auto-detect sector when symbol changes
  useEffect(() => {
    if (form.symbol && !prefill?.sector) {
      const detected = getSector(form.symbol);
      set('sector', detected);
    }
  }, [form.symbol]);

  const total = parseFloat(form.qty || 0) * parseFloat(form.price || 0);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'var(--surface-1)', border:'0.5px solid var(--border)', borderRadius:14, padding:24, width:500, maxHeight:'92vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <span style={{ fontSize:16, fontWeight:500, color:'var(--text-primary)' }}>Add transaction</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:20, lineHeight:1 }}>✕</button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Type</div>
            <div style={{ display:'flex', gap:6 }}>
              {['BUY','SELL'].map(t => (
                <div key={t} onClick={() => set('type', t)} style={{ flex:1, textAlign:'center', padding:'8px 0', borderRadius:'var(--radius)', cursor:'pointer', fontSize:12, fontWeight:600, border:`0.5px solid ${form.type===t?(t==='BUY'?'var(--border-success)':'var(--border-danger)'):'var(--border)'}`, background:form.type===t?(t==='BUY'?'var(--bg-success)':'var(--bg-danger)'):'var(--surface-2)', color:form.type===t?(t==='BUY'?'var(--text-success)':'var(--text-danger)'):'var(--text-muted)' }}>{t}</div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Exchange</div>
            <div style={{ display:'flex', gap:6 }}>
              {['NSE','BSE'].map(e => (
                <div key={e} onClick={() => set('exchange', e)} style={{ flex:1, textAlign:'center', padding:'8px 0', borderRadius:'var(--radius)', cursor:'pointer', fontSize:12, fontWeight:600, border:`0.5px solid ${form.exchange===e?'rgba(99,102,241,0.5)':'var(--border)'}`, background:form.exchange===e?'rgba(99,102,241,0.12)':'var(--surface-2)', color:form.exchange===e?'#818cf8':'var(--text-muted)' }}>{e}</div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Symbol</div>
            <input value={form.symbol} onChange={e => set('symbol', e.target.value.toUpperCase())} placeholder="RELIANCE" style={{ ...inputStyle, fontFamily:'var(--font-mono)', fontWeight:600 }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Date</div>
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:14 }}>
          {[['Qty','qty','10'],['Price (₹)','price','2812.40'],['Brokerage (₹)','brokerage','20']].map(([lbl,key,ph]) => (
            <div key={key}>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>{lbl}</div>
              <input value={form[key]} onChange={e => set(key, e.target.value)} placeholder={ph} style={{ ...inputStyle, fontFamily:'var(--font-mono)' }} />
            </div>
          ))}
        </div>

        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Sector</div>
          <select value={form.sector} onChange={e => set('sector', e.target.value)} style={inputStyle}>
            {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Notes (optional)</div>
          <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Reason for trade..." style={inputStyle} />
        </div>

        {total > 0 && (
          <div style={{ background:'var(--surface-2)', borderRadius:'var(--radius)', padding:'10px 14px', marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:12, color:'var(--text-muted)' }}>Total value</span>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:14, fontWeight:600, color:'var(--text-primary)' }}>{fmtINR(total)}</span>
          </div>
        )}

        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onClose} style={{ flex:1, padding:'10px 0', borderRadius:'var(--radius)', border:'0.5px solid var(--border-strong)', background:'none', color:'var(--text-secondary)', cursor:'pointer', fontSize:13 }}>Cancel</button>
          <button onClick={() => {
            if (!form.symbol || !form.qty || !form.price) return alert('Symbol, qty and price are required');
            onSave({ ...form, qty: parseFloat(form.qty), price: parseFloat(form.price), brokerage: parseFloat(form.brokerage || 0), id: Date.now().toString(), sector: form.sector || getSector(form.symbol) });
            onClose();
          }} style={{ flex:2, padding:'10px 0', borderRadius:'var(--radius)', border:'none', background:'var(--fill-accent)', color:'var(--on-accent)', cursor:'pointer', fontSize:13, fontWeight:600 }}>
            Add transaction
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Dividend Modal ───────────────────────────────────────────────────────
function AddDividendModal({ onClose, onSave, holdings = [] }) {
  const [form, setForm] = useState({ symbol: holdings[0]?.symbol || '', exDate: new Date().toISOString().slice(0,10), perShare: '', qtyHeld: '', notes: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const total = parseFloat(form.perShare || 0) * parseFloat(form.qtyHeld || 0);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'var(--surface-1)', border:'0.5px solid var(--border)', borderRadius:14, padding:24, width:420 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <span style={{ fontSize:16, fontWeight:500, color:'var(--text-primary)' }}>Log dividend</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:20, lineHeight:1 }}>✕</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Stock</div>
            <select value={form.symbol} onChange={e => { set('symbol', e.target.value); const h = holdings.find(x => x.symbol === e.target.value); if(h) set('qtyHeld', h.qty); }} style={inputStyle}>
              {holdings.map(h => <option key={h.symbol} value={h.symbol}>{h.symbol}</option>)}
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Ex-date</div>
            <input type="date" value={form.exDate} onChange={e => set('exDate', e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Per share (₹)</div>
            <input value={form.perShare} onChange={e => set('perShare', e.target.value)} placeholder="10.00" style={{ ...inputStyle, fontFamily:'var(--font-mono)' }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Qty held</div>
            <input value={form.qtyHeld} onChange={e => set('qtyHeld', e.target.value)} placeholder="15" style={{ ...inputStyle, fontFamily:'var(--font-mono)' }} />
          </div>
        </div>
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Notes (optional)</div>
          <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Interim / final / special dividend..." style={inputStyle} />
        </div>
        {total > 0 && (
          <div style={{ background:'rgba(34,197,94,0.08)', borderRadius:'var(--radius)', padding:'10px 14px', marginBottom:14, display:'flex', justifyContent:'space-between' }}>
            <span style={{ fontSize:12, color:'var(--text-success)' }}>Total dividend</span>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:14, fontWeight:600, color:'var(--text-success)' }}>{fmtINR(total)}</span>
          </div>
        )}
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onClose} style={{ flex:1, padding:'10px 0', borderRadius:'var(--radius)', border:'0.5px solid var(--border-strong)', background:'none', color:'var(--text-secondary)', cursor:'pointer', fontSize:13 }}>Cancel</button>
          <button onClick={() => { if (!form.symbol || !form.perShare || !form.qtyHeld) return alert('All fields required'); onSave({ ...form, perShare: parseFloat(form.perShare), qtyHeld: parseFloat(form.qtyHeld), total: parseFloat(form.perShare) * parseFloat(form.qtyHeld), id: Date.now().toString() }); onClose(); }} style={{ flex:2, padding:'10px 0', borderRadius:'var(--radius)', border:'none', background:'var(--fill-success)', color:'#000', cursor:'pointer', fontSize:13, fontWeight:600 }}>Log dividend</button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Watchlist Modal ──────────────────────────────────────────────────────
function AddWatchlistModal({ onClose, onSave }) {
  const [form, setForm] = useState({ symbol: '', exchange: 'NSE', targetPrice: '', notes: '', sector: 'Other' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  useEffect(() => { if (form.symbol) set('sector', getSector(form.symbol)); }, [form.symbol]);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'var(--surface-1)', border:'0.5px solid var(--border)', borderRadius:14, padding:24, width:400 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <span style={{ fontSize:16, fontWeight:500, color:'var(--text-primary)' }}>Add to watchlist</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:20, lineHeight:1 }}>✕</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Symbol</div>
            <input value={form.symbol} onChange={e => set('symbol', e.target.value.toUpperCase())} placeholder="BAJFINANCE" style={{ ...inputStyle, fontFamily:'var(--font-mono)', fontWeight:600 }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Exchange</div>
            <div style={{ display:'flex', gap:6 }}>
              {['NSE','BSE'].map(e => (
                <div key={e} onClick={() => set('exchange', e)} style={{ flex:1, textAlign:'center', padding:'8px 0', borderRadius:'var(--radius)', cursor:'pointer', fontSize:12, fontWeight:600, border:`0.5px solid ${form.exchange===e?'rgba(99,102,241,0.5)':'var(--border)'}`, background:form.exchange===e?'rgba(99,102,241,0.12)':'var(--surface-2)', color:form.exchange===e?'#818cf8':'var(--text-muted)' }}>{e}</div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Target price (₹)</div>
            <input value={form.targetPrice} onChange={e => set('targetPrice', e.target.value)} placeholder="6800" style={{ ...inputStyle, fontFamily:'var(--font-mono)' }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Sector</div>
            <select value={form.sector} onChange={e => set('sector', e.target.value)} style={inputStyle}>
              {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Notes</div>
          <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Why you're watching this..." style={inputStyle} />
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onClose} style={{ flex:1, padding:'10px 0', borderRadius:'var(--radius)', border:'0.5px solid var(--border-strong)', background:'none', color:'var(--text-secondary)', cursor:'pointer', fontSize:13 }}>Cancel</button>
          <button onClick={() => { if(!form.symbol) return alert('Symbol required'); onSave({ ...form, targetPrice: parseFloat(form.targetPrice||0), id: Date.now().toString(), addedDate: new Date().toISOString().slice(0,10), sector: form.sector || getSector(form.symbol) }); onClose(); }} style={{ flex:2, padding:'10px 0', borderRadius:'var(--radius)', border:'none', background:'var(--fill-accent)', color:'var(--on-accent)', cursor:'pointer', fontSize:13, fontWeight:600 }}>Add to watchlist</button>
        </div>
      </div>
    </div>
  );
}

// ─── Sector Allocation Bar ────────────────────────────────────────────────────
function SectorAllocation({ data }) {
  if (!data.length) return null;
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ marginTop: 24, padding: '16px 0', borderTop: '0.5px solid var(--border)' }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>Sector allocation</div>
      {/* Stacked bar */}
      <div style={{ display: 'flex', height: 8, borderRadius: 6, overflow: 'hidden', marginBottom: 14, gap: 1 }}>
        {data.map((s, i) => (
          <div key={s.sector} style={{ width: (s.value / total * 100) + '%', background: SECTOR_COLORS[i % SECTOR_COLORS.length], minWidth: 2 }} title={`${s.sector}: ${(s.value/total*100).toFixed(1)}%`} />
        ))}
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: '10px 20px', flexWrap: 'wrap' }}>
        {data.map((s, i) => (
          <div key={s.sector} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: SECTOR_COLORS[i % SECTOR_COLORS.length], display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.sector}</span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{(s.value / total * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function StockPortfolio() {
  const [tab, setTab] = useState('portfolio');
  const [data, setData] = useState(() => {
    const d = loadData();
    return { transactions: [], dividends: [], watchlist: [], ...d };
  });
  const [quotes, setQuotes] = useState({});
  const [quoteStatus, setQuoteStatus] = useState('idle');
  const [lastFetched, setLastFetched] = useState(null);
  const [modal, setModal] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const update = useCallback((patch) => {
    setData(prev => { const next = { ...prev, ...patch }; saveData(next); return next; });
  }, []);

  // Auto-fix sectors on existing transactions that show "Other"
  useEffect(() => {
    const fixed = data.transactions.map(tx => ({
      ...tx,
      sector: (!tx.sector || tx.sector === 'Other') ? getSector(tx.symbol) : tx.sector,
    }));
    const changed = fixed.some((tx, i) => tx.sector !== data.transactions[i].sector);
    if (changed) update({ transactions: fixed });
  }, []);

  // ── Holdings computed from transactions ──────────────────────────────────
  const holdings = useMemo(() => {
    const map = {};
    [...data.transactions].sort((a,b) => new Date(a.date)-new Date(b.date)).forEach(tx => {
      const key = tx.symbol + '_' + (tx.exchange || 'NSE');
      if (!map[key]) map[key] = { symbol: tx.symbol, exchange: tx.exchange || 'NSE', sector: getSector(tx.symbol), qty: 0, totalCost: 0, firstDate: null };
      if (tx.type === 'BUY') {
        map[key].qty += tx.qty;
        map[key].totalCost += tx.qty * tx.price + (tx.brokerage || 0);
        // Track first BUY date for days held
        if (!map[key].firstDate || tx.date < map[key].firstDate) map[key].firstDate = tx.date;
      } else {
        const avg = map[key].qty > 0 ? map[key].totalCost / map[key].qty : 0;
        map[key].qty -= tx.qty;
        map[key].totalCost -= tx.qty * avg;
      }
      // Update sector — prefer detected over 'Other'
      if (tx.sector && tx.sector !== 'Other') map[key].sector = tx.sector;
      else { const det = getSector(tx.symbol); if (det !== 'Other') map[key].sector = det; }
    });
    return Object.values(map)
      .filter(h => h.qty > 0.001)
      .map(h => ({ ...h, avgCost: h.qty > 0 ? h.totalCost / h.qty : 0 }))
      .sort((a,b) => a.symbol.localeCompare(b.symbol));
  }, [data.transactions]);

  // ── Fetch quotes ─────────────────────────────────────────────────────────
  const fetchQuotes = useCallback(async () => {
    const symbols = [...new Set([
      ...holdings.map(h => ({ symbol: h.symbol, exchange: h.exchange })),
      ...data.watchlist.map(w => ({ symbol: w.symbol, exchange: w.exchange })),
    ])];
    if (!symbols.length) return;
    setQuoteStatus('loading');
    try {
      const res = await fetch(`${SYNC_SERVER}/stocks/quotes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });
      const json = await res.json();
      if (json.success) { setQuotes(json.quotes || {}); setQuoteStatus('ok'); setLastFetched(new Date()); }
      else setQuoteStatus('error');
    } catch { setQuoteStatus('error'); }
  }, [holdings, data.watchlist]);

  useEffect(() => { fetchQuotes(); }, [holdings.length, data.watchlist.length]);
  useEffect(() => {
    const interval = setInterval(fetchQuotes, 60000);
    return () => clearInterval(interval);
  }, [fetchQuotes]);

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    let invested = 0, currentValue = 0;
    holdings.forEach(h => {
      const cmp = quotes[h.symbol]?.ltp;
      invested += h.totalCost;
      currentValue += cmp ? h.qty * cmp : h.totalCost;
    });
    const unrealised = currentValue - invested;
    const returnPct = invested > 0 ? (unrealised / invested) * 100 : 0;
    const totalDividends = data.dividends.reduce((s, d) => s + (d.total || 0), 0);

    // Realised P&L
    const map2 = {};
    [...data.transactions].sort((a,b) => new Date(a.date)-new Date(b.date)).forEach(tx => {
      const k = tx.symbol + '_' + (tx.exchange||'NSE');
      if (!map2[k]) map2[k] = { qty:0, totalCost:0, realised:0 };
      if (tx.type==='BUY') { map2[k].qty += tx.qty; map2[k].totalCost += tx.qty * tx.price; }
      else { const avg = map2[k].qty>0 ? map2[k].totalCost/map2[k].qty : 0; map2[k].realised += tx.qty*(tx.price-avg)-(tx.brokerage||0); map2[k].qty-=tx.qty; map2[k].totalCost-=tx.qty*avg; }
    });
    const realised = Object.values(map2).reduce((s,v) => s+v.realised, 0);
    return { invested, currentValue, unrealised, returnPct, totalDividends, realised };
  }, [holdings, quotes, data.transactions, data.dividends]);

  // ── Sector allocation ────────────────────────────────────────────────────
  const sectorAlloc = useMemo(() => {
    const map = {};
    holdings.forEach(h => {
      const val = quotes[h.symbol]?.ltp ? h.qty * quotes[h.symbol].ltp : h.totalCost;
      const sec = h.sector || getSector(h.symbol) || 'Other';
      map[sec] = (map[sec] || 0) + val;
    });
    const total = Object.values(map).reduce((s,v) => s+v, 0);
    return Object.entries(map).sort((a,b) => b[1]-a[1]).map(([sector, value]) => ({ sector, value, pct: total > 0 ? (value/total)*100 : 0 }));
  }, [holdings, quotes]);

  // ── Broker sync ───────────────────────────────────────────────────────────
  const syncFromBroker = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${SYNC_SERVER}/stocks/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ existingTransactions: data.transactions }),
      });
      const json = await res.json();
      if (json.success && json.transactions?.length) {
        const existing = new Set(data.transactions.map(t => t.brokerTradeId).filter(Boolean));
        const newOnes = json.transactions.filter(t => !existing.has(t.brokerTradeId)).map(t => ({
          ...t, sector: getSector(t.symbol), id: Date.now().toString() + Math.random(),
        }));
        if (newOnes.length) { update({ transactions: [...data.transactions, ...newOnes] }); alert(`Synced ${newOnes.length} holding${newOnes.length>1?'s':''}`); }
        else alert('Already up to date');
      } else alert(json.error || 'Sync failed — make sure broker is connected');
    } catch { alert('Could not reach sync server (port 5001)'); }
    setSyncing(false);
  };

  // ═══ TAB: PORTFOLIO ════════════════════════════════════════════════════════
  const renderPortfolio = () => (
    <div>
      {/* Summary cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:24 }}>
        {[
          { lbl:'Invested', val:fmtINR(summary.invested), col:'var(--text-primary)' },
          { lbl:'Current value', val:fmtINR(summary.currentValue), col:'var(--text-primary)' },
          { lbl:'Unrealised P&L', val:(summary.unrealised>=0?'+':'') + fmtINR(Math.abs(summary.unrealised)), col:summary.unrealised>=0?'var(--text-success)':'var(--text-danger)' },
          { lbl:'Overall return', val:fmtPct(summary.returnPct), col:summary.returnPct>=0?'var(--text-success)':'var(--text-danger)' },
        ].map(({ lbl, val, col }) => (
          <div key={lbl} style={{ background:'var(--surface-1)', border:'0.5px solid var(--border)', borderRadius:10, padding:'14px 16px' }}>
            <div style={{ fontSize:10, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:8 }}>{lbl}</div>
            <div style={{ fontSize:20, fontWeight:600, fontFamily:'var(--font-mono)', color:col }}>{val}</div>
          </div>
        ))}
      </div>

      {holdings.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 0', color:'var(--text-muted)', fontSize:14 }}>
          <div style={{ fontSize:32, marginBottom:12 }}>📊</div>
          No holdings yet — add a transaction or sync from broker
        </div>
      ) : (
        <>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, WebkitFontSmoothing:'antialiased' }}>
            <thead>
              <tr>
                {['Stock','Qty','Avg cost','CMP','Value','P&L','Return','Held',''].map((h,i) => (
                  <th key={i} style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-muted)', fontWeight:500, padding:'8px 12px', textAlign:i===0?'left':'right', borderBottom:'0.5px solid var(--border)', background:'var(--surface-1)', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {holdings.map(h => {
                const q = quotes[h.symbol];
                const cmp = q?.ltp;
                const curVal = cmp ? h.qty * cmp : null;
                const upnl = curVal !== null ? curVal - h.totalCost : null;
                const retPct = upnl !== null && h.totalCost > 0 ? (upnl / h.totalCost) * 100 : null;
                const days = daysBetween(h.firstDate);
                const pnlCol = upnl === null ? 'var(--text-muted)' : upnl >= 0 ? 'var(--text-success)' : 'var(--text-danger)';
                return (
                  <tr key={h.symbol + h.exchange} style={{ borderBottom:'0.5px solid var(--border)' }}>
                    <td style={{ padding:'12px 12px' }}>
                      <div style={{ fontWeight:600, fontSize:13, color:'var(--text-primary)', marginBottom:3 }}>{h.symbol}</div>
                      <div style={{ display:'flex', gap:5, alignItems:'center' }}>
                        <span style={{ fontSize:10, padding:'1px 6px', borderRadius:3, background:'rgba(99,102,241,0.1)', color:'#818cf8', border:'0.5px solid rgba(99,102,241,0.2)' }}>{h.sector}</span>
                        <span style={{ fontSize:10, color:'var(--text-muted)' }}>{h.exchange}</span>
                      </div>
                    </td>
                    <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'12px 12px', color:'var(--text-secondary)' }}>{h.qty}</td>
                    <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'12px 12px', color:'var(--text-secondary)' }}>{fmtINR(h.avgCost)}</td>
                    <td style={{ textAlign:'right', padding:'12px 12px' }}>
                      {cmp ? (
                        <>
                          <div style={{ fontFamily:'var(--font-mono)', fontWeight:600, color:'var(--text-primary)' }}>{fmtINR(cmp)}</div>
                          {q.changePct !== undefined && <div style={{ fontSize:10, color: q.changePct >= 0 ? 'var(--text-success)' : 'var(--text-danger)', fontFamily:'var(--font-mono)' }}>{fmtChange(q.changePct)}</div>}
                        </>
                      ) : (
                        <span style={{ color:'var(--text-muted)', fontSize:11 }}>{quoteStatus==='loading'?'...' : '—'}</span>
                      )}
                    </td>
                    <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'12px 12px', color:'var(--text-secondary)' }}>{curVal !== null ? fmtINR(curVal) : '—'}</td>
                    <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:600, padding:'12px 12px', color:pnlCol }}>
                      {upnl !== null ? (upnl >= 0 ? '+' : '−') + fmtINR(Math.abs(upnl)).replace('−','').replace('₹','₹') : '—'}
                    </td>
                    <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'12px 12px', color:pnlCol }}>{retPct !== null ? fmtPct(retPct) : '—'}</td>
                    <td style={{ textAlign:'right', color:'var(--text-muted)', padding:'12px 12px', fontFamily:'var(--font-mono)' }}>{days}d</td>
                    <td style={{ textAlign:'right', padding:'12px 12px' }}>
                      <button onClick={() => setModal({ type:'transaction', prefill:{ symbol:h.symbol, exchange:h.exchange, sector:h.sector, type:'SELL' } })} style={{ fontSize:10, padding:'3px 10px', borderRadius:'var(--radius)', border:'0.5px solid var(--border-danger)', background:'var(--bg-danger)', color:'var(--text-danger)', cursor:'pointer', whiteSpace:'nowrap' }}>Sell</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <SectorAllocation data={sectorAlloc} />
        </>
      )}
    </div>
  );

  // ═══ TAB: TRANSACTIONS ════════════════════════════════════════════════════
  const renderTransactions = () => (
    <div>
      {data.transactions.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 0', color:'var(--text-muted)', fontSize:14 }}>No transactions yet</div>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr>
              {['Stock','Type','Qty','Price','Total','Brokerage','Date','Notes',''].map((h,i) => (
                <th key={i} style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-muted)', fontWeight:500, padding:'8px 12px', textAlign:i===0||i===8?'left':'right', borderBottom:'0.5px solid var(--border)', background:'var(--surface-1)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...data.transactions].sort((a,b) => new Date(b.date)-new Date(a.date)).map(tx => (
              <tr key={tx.id} style={{ borderBottom:'0.5px solid var(--border)' }}>
                <td style={{ padding:'10px 12px' }}>
                  <div style={{ fontWeight:600, fontSize:13, color:'var(--text-primary)' }}>{tx.symbol}</div>
                  <div style={{ fontSize:10, color:'var(--text-muted)' }}>{tx.exchange}</div>
                </td>
                <td style={{ textAlign:'right', padding:'10px 12px' }}>
                  <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:4, background:tx.type==='BUY'?'var(--bg-success)':'var(--bg-danger)', color:tx.type==='BUY'?'var(--text-success)':'var(--text-danger)', border:`0.5px solid ${tx.type==='BUY'?'var(--border-success)':'var(--border-danger)'}` }}>{tx.type}</span>
                </td>
                <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 12px' }}>{tx.qty}</td>
                <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 12px' }}>{fmtINR(tx.price)}</td>
                <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 12px' }}>{fmtINR(tx.qty * tx.price)}</td>
                <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 12px', color:'var(--text-muted)' }}>{fmtINR(tx.brokerage || 0)}</td>
                <td style={{ textAlign:'right', color:'var(--text-muted)', padding:'10px 12px' }}>{tx.date}</td>
                <td style={{ textAlign:'right', color:'var(--text-muted)', fontSize:11, padding:'10px 12px', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.notes}</td>
                <td style={{ padding:'10px 12px' }}>
                  <button onClick={() => update({ transactions: data.transactions.filter(t => t.id !== tx.id) })} style={{ fontSize:10, padding:'2px 7px', borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'none', color:'var(--text-muted)', cursor:'pointer' }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  // ═══ TAB: DIVIDENDS ═══════════════════════════════════════════════════════
  const renderDividends = () => {
    const total = data.dividends.reduce((s,d) => s+(d.total||0), 0);
    const yr = new Date().getFullYear().toString();
    const thisYear = data.dividends.filter(d => d.exDate?.startsWith(yr)).reduce((s,d) => s+(d.total||0), 0);
    return (
      <div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:24 }}>
          {[['Total received', fmtINR(total), 'var(--text-success)'], ['This year ('+yr+')', fmtINR(thisYear), 'var(--text-success)'], ['Total entries', data.dividends.length.toString(), 'var(--text-primary)']].map(([l,v,c]) => (
            <div key={l} style={{ background:'var(--surface-1)', border:'0.5px solid var(--border)', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:10, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:8 }}>{l}</div>
              <div style={{ fontSize:20, fontWeight:600, fontFamily:'var(--font-mono)', color:c }}>{v}</div>
            </div>
          ))}
        </div>
        {data.dividends.length === 0 ? (
          <div style={{ textAlign:'center', padding:'60px 0', color:'var(--text-muted)', fontSize:14 }}>
            <div style={{ fontSize:32, marginBottom:12 }}>💰</div>
            No dividends logged yet
          </div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr>
                {['Stock','Ex-date','Per share','Qty held','Total','Notes',''].map((h,i) => (
                  <th key={i} style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-muted)', fontWeight:500, padding:'8px 12px', textAlign:i===0||i===6?'left':'right', borderBottom:'0.5px solid var(--border)', background:'var(--surface-1)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...data.dividends].sort((a,b) => new Date(b.exDate)-new Date(a.exDate)).map(d => (
                <tr key={d.id} style={{ borderBottom:'0.5px solid var(--border)' }}>
                  <td style={{ padding:'10px 12px', fontWeight:600, fontSize:13, color:'var(--text-primary)' }}>{d.symbol}</td>
                  <td style={{ textAlign:'right', color:'var(--text-muted)', padding:'10px 12px' }}>{d.exDate}</td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 12px' }}>{fmtINR(d.perShare)}</td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 12px' }}>{d.qtyHeld}</td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:600, color:'var(--text-success)', padding:'10px 12px' }}>+{fmtINR(d.total)}</td>
                  <td style={{ textAlign:'right', color:'var(--text-muted)', fontSize:11, padding:'10px 12px' }}>{d.notes}</td>
                  <td style={{ padding:'10px 12px' }}>
                    <button onClick={() => update({ dividends: data.dividends.filter(x => x.id !== d.id) })} style={{ fontSize:10, padding:'2px 7px', borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'none', color:'var(--text-muted)', cursor:'pointer' }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  // ═══ TAB: WATCHLIST ═══════════════════════════════════════════════════════
  const renderWatchlist = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      {data.watchlist.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 0', color:'var(--text-muted)', fontSize:14 }}>
          <div style={{ fontSize:32, marginBottom:12 }}>👁</div>
          No stocks on watchlist yet
        </div>
      ) : data.watchlist.map(w => {
        const q = quotes[w.symbol];
        const cmp = q?.ltp;
        const pctAway = cmp && w.targetPrice ? ((cmp - w.targetPrice) / w.targetPrice) * 100 : null;
        const progress = cmp && w.targetPrice ? Math.min(100, (cmp / w.targetPrice) * 100) : null;
        const aboveTarget = pctAway !== null && pctAway >= 0;
        return (
          <div key={w.id} style={{ background:'var(--surface-1)', border:'0.5px solid var(--border)', borderRadius:10, padding:'14px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:16 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                <span style={{ fontSize:14, fontWeight:600, color:'var(--text-primary)' }}>{w.symbol}</span>
                <span style={{ fontSize:10, padding:'1px 6px', borderRadius:3, background:'rgba(99,102,241,0.1)', color:'#818cf8', border:'0.5px solid rgba(99,102,241,0.2)' }}>{w.sector}</span>
                <span style={{ fontSize:10, color:'var(--text-muted)' }}>{w.exchange}</span>
              </div>
              {w.targetPrice > 0 && <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:6 }}>Target {fmtINR(w.targetPrice)}{w.notes ? ` · ${w.notes}` : ''}</div>}
              {progress !== null && (
                <>
                  <div style={{ height:3, borderRadius:2, background:'var(--border)', overflow:'hidden', width:200, marginBottom:4 }}>
                    <div style={{ height:'100%', borderRadius:2, width:progress+'%', background: aboveTarget ? '#818cf8' : 'var(--fill-success)', transition:'width 0.3s' }} />
                  </div>
                  <div style={{ fontSize:10, color:'var(--text-muted)' }}>
                    {aboveTarget ? `${pctAway.toFixed(1)}% above target` : `${Math.abs(pctAway).toFixed(1)}% below target`}
                  </div>
                </>
              )}
            </div>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6, flexShrink:0 }}>
              {cmp ? (
                <>
                  <span style={{ fontFamily:'var(--font-mono)', fontSize:15, fontWeight:600, color:'var(--text-primary)' }}>{fmtINR(cmp)}</span>
                  {q.changePct !== undefined && <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color: q.changePct >= 0 ? 'var(--text-success)' : 'var(--text-danger)' }}>{fmtChange(q.changePct)}</span>}
                </>
              ) : <span style={{ fontSize:12, color:'var(--text-muted)' }}>{quoteStatus==='loading'?'...':'—'}</span>}
              <div style={{ display:'flex', gap:6 }}>
                <button onClick={() => setModal({ type:'transaction', prefill:{ symbol:w.symbol, exchange:w.exchange, sector:w.sector, type:'BUY' } })} style={{ fontSize:11, padding:'4px 12px', borderRadius:'var(--radius)', border:'none', background:'var(--fill-accent)', color:'var(--on-accent)', cursor:'pointer', fontWeight:500 }}>Buy</button>
                <button onClick={() => update({ watchlist: data.watchlist.filter(x => x.id !== w.id) })} style={{ fontSize:11, padding:'4px 8px', borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'none', color:'var(--text-muted)', cursor:'pointer' }}>✕</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const TABS = [{ id:'portfolio', label:'Portfolio' }, { id:'transactions', label:'Transactions' }, { id:'dividends', label:'Dividends' }, { id:'watchlist', label:'Watchlist' }];
  const addBtnLabel = { portfolio:'Add transaction', transactions:'Add transaction', dividends:'Log dividend', watchlist:'Add to watchlist' };
  const addBtnAction = { portfolio:()=>setModal({type:'transaction'}), transactions:()=>setModal({type:'transaction'}), dividends:()=>setModal({type:'dividend'}), watchlist:()=>setModal({type:'watchlist'}) };

  const pnlSummaryColor = summary.unrealised >= 0 ? 'var(--text-success)' : 'var(--text-danger)';

  return (
    <div style={{ padding:'0 24px 32px', maxWidth:1280, margin:'0 auto', WebkitFontSmoothing:'antialiased', MozOsxFontSmoothing:'grayscale' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', padding:'20px 0 18px' }}>
        <div>
          <div style={{ fontSize:22, fontWeight:500, color:'var(--text-primary)', marginBottom:4 }}>Stock Portfolio</div>
          <div style={{ fontSize:12, color:'var(--text-muted)', display:'flex', gap:10, alignItems:'center' }}>
            <span>{holdings.length} holding{holdings.length!==1?'s':''}</span>
            {holdings.length > 0 && <>
              <span style={{ opacity:0.4 }}>·</span>
              <span style={{ color: pnlSummaryColor, fontFamily:'var(--font-mono)', fontWeight:500 }}>
                {summary.unrealised >= 0 ? '+' : ''}{fmtINR(summary.unrealised)} ({fmtPct(summary.returnPct)})
              </span>
            </>}
            {quoteStatus==='loading' && <><span style={{ opacity:0.4 }}>·</span><span>fetching prices...</span></>}
            {quoteStatus==='ok' && lastFetched && <><span style={{ opacity:0.4 }}>·</span><span>prices at {lastFetched.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</span></>}
            {quoteStatus==='error' && <><span style={{ opacity:0.4 }}>·</span><span style={{ color:'var(--text-danger)' }}>prices unavailable</span></>}
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={fetchQuotes} disabled={quoteStatus==='loading'} style={{ padding:'7px 13px', borderRadius:'var(--radius)', border:'0.5px solid var(--border-strong)', background:'none', color:'var(--text-secondary)', cursor:'pointer', fontSize:12, opacity:quoteStatus==='loading'?0.5:1 }}>⟳ Refresh</button>
          <button onClick={syncFromBroker} disabled={syncing} style={{ padding:'7px 13px', borderRadius:'var(--radius)', border:'0.5px solid var(--border-strong)', background:'none', color:'var(--text-secondary)', cursor:'pointer', fontSize:12, opacity:syncing?0.6:1 }}>{syncing?'Syncing...':'⇌ Sync broker'}</button>
          <button onClick={addBtnAction[tab]} style={{ padding:'8px 16px', borderRadius:'var(--radius)', border:'none', background:'var(--fill-accent)', color:'var(--on-accent)', cursor:'pointer', fontSize:13, fontWeight:500 }}>+ {addBtnLabel[tab]}</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'0.5px solid var(--border)', marginBottom:22 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding:'10px 20px', fontSize:13, fontWeight:500, background:'none', border:'none', borderBottom:`2px solid ${tab===t.id?'var(--fill-accent)':'transparent'}`, color:tab===t.id?'var(--text-primary)':'var(--text-muted)', cursor:'pointer', transition:'color 0.15s' }}>{t.label}</button>
        ))}
      </div>

      {tab==='portfolio' && renderPortfolio()}
      {tab==='transactions' && renderTransactions()}
      {tab==='dividends' && renderDividends()}
      {tab==='watchlist' && renderWatchlist()}

      {modal?.type==='transaction' && <AddTransactionModal prefill={modal.prefill||null} onClose={() => setModal(null)} onSave={tx => update({ transactions:[...data.transactions, tx] })} />}
      {modal?.type==='dividend' && <AddDividendModal holdings={holdings} onClose={() => setModal(null)} onSave={d => update({ dividends:[...data.dividends, d] })} />}
      {modal?.type==='watchlist' && <AddWatchlistModal onClose={() => setModal(null)} onSave={w => update({ watchlist:[...data.watchlist, w] })} />}
    </div>
  );
}
