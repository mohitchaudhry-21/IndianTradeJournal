import React, { useState, useEffect, useCallback, useMemo } from 'react';

const SYNC_SERVER = 'http://localhost:5001';
const STOCK_KEY = 'itj_stock_data';

const SECTORS = ['Banking','IT','Energy','Auto','Pharma','FMCG','Finance','Infra','Metals','Telecom','Cons. Disc.','Insurance','Defence','Other'];

function loadData() {
  try { return JSON.parse(localStorage.getItem(STOCK_KEY) || '{}'); } catch { return {}; }
}
function saveData(d) { localStorage.setItem(STOCK_KEY, JSON.stringify(d)); }

function fmtINR(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  const parts = abs.toFixed(decimals).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?=\d))/g, ',');
  return sign + '₹' + parts.join('.');
}

function fmtChange(n) {
  if (n === null || n === undefined) return '—';
  const sign = n >= 0 ? '+' : '';
  return sign + n.toFixed(2) + '%';
}

function daysBetween(d1, d2 = new Date()) {
  return Math.floor((new Date(d2) - new Date(d1)) / 86400000);
}

// ─── Add Transaction Modal ────────────────────────────────────────────────────
function AddTransactionModal({ onClose, onSave, prefill = null }) {
  const [form, setForm] = useState({
    type: 'BUY', exchange: 'NSE', symbol: '', date: new Date().toISOString().slice(0,10),
    qty: '', price: '', brokerage: '20', notes: '', sector: 'Other',
    ...prefill,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const total = parseFloat(form.qty || 0) * parseFloat(form.price || 0);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div style={{ background:'var(--surface-1)', border:'0.5px solid var(--border)', borderRadius:12, padding:24, width:480, maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
          <span style={{ fontSize:15, fontWeight:500, color:'var(--text-primary)' }}>Add transaction</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:18 }}>✕</button>
        </div>

        {/* Type + Exchange */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Type</div>
            <div style={{ display:'flex', gap:6 }}>
              {['BUY','SELL'].map(t => (
                <div key={t} onClick={() => set('type', t)} style={{ flex:1, textAlign:'center', padding:'7px 0', borderRadius:'var(--radius)', cursor:'pointer', fontSize:12, fontWeight:600, border:`0.5px solid ${form.type === t ? (t==='BUY' ? 'var(--border-success)' : 'var(--border-danger)') : 'var(--border)'}`, background: form.type === t ? (t==='BUY' ? 'var(--bg-success)' : 'var(--bg-danger)') : 'var(--surface-2)', color: form.type === t ? (t==='BUY' ? 'var(--text-success)' : 'var(--text-danger)') : 'var(--text-muted)' }}>{t}</div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Exchange</div>
            <div style={{ display:'flex', gap:6 }}>
              {['NSE','BSE'].map(e => (
                <div key={e} onClick={() => set('exchange', e)} style={{ flex:1, textAlign:'center', padding:'7px 0', borderRadius:'var(--radius)', cursor:'pointer', fontSize:12, fontWeight:600, border:`0.5px solid ${form.exchange === e ? 'var(--border-accent)' : 'var(--border)'}`, background: form.exchange === e ? 'var(--bg-accent)' : 'var(--surface-2)', color: form.exchange === e ? 'var(--text-accent)' : 'var(--text-muted)' }}>{e}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Symbol + Date */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Symbol</div>
            <input value={form.symbol} onChange={e => set('symbol', e.target.value.toUpperCase())} placeholder="RELIANCE" style={{ width:'100%', padding:'8px 10px', fontSize:13, borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'var(--surface-2)', color:'var(--text-primary)', fontFamily:'var(--font-mono)' }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Date</div>
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)} style={{ width:'100%', padding:'8px 10px', fontSize:13, borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'var(--surface-2)', color:'var(--text-primary)' }} />
          </div>
        </div>

        {/* Qty + Price + Brokerage */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:12 }}>
          {[['Qty', 'qty', '10', false], ['Price (₹)', 'price', '2812.40', false], ['Brokerage (₹)', 'brokerage', '20', false]].map(([lbl, key, ph]) => (
            <div key={key}>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>{lbl}</div>
              <input value={form[key]} onChange={e => set(key, e.target.value)} placeholder={ph} style={{ width:'100%', padding:'8px 10px', fontSize:13, borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'var(--surface-2)', color:'var(--text-primary)', fontFamily:'var(--font-mono)' }} />
            </div>
          ))}
        </div>

        {/* Sector */}
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Sector</div>
          <select value={form.sector} onChange={e => set('sector', e.target.value)} style={{ width:'100%', padding:'8px 10px', fontSize:13, borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'var(--surface-2)', color:'var(--text-primary)' }}>
            {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Notes */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Notes (optional)</div>
          <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Why you're buying / selling this..." style={{ width:'100%', padding:'8px 10px', fontSize:13, borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'var(--surface-2)', color:'var(--text-primary)' }} />
        </div>

        {/* Total preview */}
        {total > 0 && (
          <div style={{ background:'var(--surface-2)', borderRadius:'var(--radius)', padding:'10px 14px', marginBottom:16, display:'flex', justifyContent:'space-between' }}>
            <span style={{ fontSize:12, color:'var(--text-muted)' }}>Total value</span>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:600, color:'var(--text-primary)' }}>{fmtINR(total)}</span>
          </div>
        )}

        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onClose} style={{ flex:1, padding:'9px 0', borderRadius:'var(--radius)', border:'0.5px solid var(--border-strong)', background:'none', color:'var(--text-secondary)', cursor:'pointer', fontSize:13 }}>Cancel</button>
          <button onClick={() => { if (!form.symbol || !form.qty || !form.price) return alert('Symbol, qty and price are required'); onSave({ ...form, qty: parseFloat(form.qty), price: parseFloat(form.price), brokerage: parseFloat(form.brokerage || 0), id: Date.now().toString() }); onClose(); }} style={{ flex:2, padding:'9px 0', borderRadius:'var(--radius)', border:'none', background:'var(--fill-accent)', color:'var(--on-accent)', cursor:'pointer', fontSize:13, fontWeight:500 }}>Add transaction</button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Dividend Modal ───────────────────────────────────────────────────────
function AddDividendModal({ onClose, onSave, holdings = [] }) {
  const [form, setForm] = useState({ symbol: holdings[0]?.symbol || '', exDate: new Date().toISOString().slice(0,10), perShare: '', qtyHeld: '', notes: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div style={{ background:'var(--surface-1)', border:'0.5px solid var(--border)', borderRadius:12, padding:24, width:400 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
          <span style={{ fontSize:15, fontWeight:500, color:'var(--text-primary)' }}>Log dividend</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:18 }}>✕</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Stock</div>
            <select value={form.symbol} onChange={e => { set('symbol', e.target.value); const h = holdings.find(x => x.symbol === e.target.value); if(h) set('qtyHeld', h.qty); }} style={{ width:'100%', padding:'8px 10px', fontSize:13, borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'var(--surface-2)', color:'var(--text-primary)' }}>
              {holdings.map(h => <option key={h.symbol} value={h.symbol}>{h.symbol}</option>)}
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Ex-date</div>
            <input type="date" value={form.exDate} onChange={e => set('exDate', e.target.value)} style={{ width:'100%', padding:'8px 10px', fontSize:13, borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'var(--surface-2)', color:'var(--text-primary)' }} />
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Per share (₹)</div>
            <input value={form.perShare} onChange={e => set('perShare', e.target.value)} placeholder="10.00" style={{ width:'100%', padding:'8px 10px', fontSize:13, borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'var(--surface-2)', color:'var(--text-primary)', fontFamily:'var(--font-mono)' }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Qty held</div>
            <input value={form.qtyHeld} onChange={e => set('qtyHeld', e.target.value)} placeholder="15" style={{ width:'100%', padding:'8px 10px', fontSize:13, borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'var(--surface-2)', color:'var(--text-primary)', fontFamily:'var(--font-mono)' }} />
          </div>
        </div>
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Notes (optional)</div>
          <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Interim / final dividend..." style={{ width:'100%', padding:'8px 10px', fontSize:13, borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'var(--surface-2)', color:'var(--text-primary)' }} />
        </div>
        {form.perShare && form.qtyHeld && (
          <div style={{ background:'var(--bg-success)', borderRadius:'var(--radius)', padding:'8px 14px', marginBottom:14, display:'flex', justifyContent:'space-between' }}>
            <span style={{ fontSize:12, color:'var(--text-success)' }}>Total dividend</span>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:600, color:'var(--text-success)' }}>{fmtINR(parseFloat(form.perShare||0) * parseFloat(form.qtyHeld||0))}</span>
          </div>
        )}
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onClose} style={{ flex:1, padding:'9px 0', borderRadius:'var(--radius)', border:'0.5px solid var(--border-strong)', background:'none', color:'var(--text-secondary)', cursor:'pointer', fontSize:13 }}>Cancel</button>
          <button onClick={() => { if (!form.symbol || !form.perShare || !form.qtyHeld) return alert('All fields required'); onSave({ ...form, perShare: parseFloat(form.perShare), qtyHeld: parseFloat(form.qtyHeld), total: parseFloat(form.perShare) * parseFloat(form.qtyHeld), id: Date.now().toString() }); onClose(); }} style={{ flex:2, padding:'9px 0', borderRadius:'var(--radius)', border:'none', background:'var(--fill-success)', color:'var(--on-success)', cursor:'pointer', fontSize:13, fontWeight:500 }}>Log dividend</button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Watchlist Modal ──────────────────────────────────────────────────────
function AddWatchlistModal({ onClose, onSave }) {
  const [form, setForm] = useState({ symbol: '', exchange: 'NSE', targetPrice: '', notes: '', sector: 'Other' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div style={{ background:'var(--surface-1)', border:'0.5px solid var(--border)', borderRadius:12, padding:24, width:380 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
          <span style={{ fontSize:15, fontWeight:500, color:'var(--text-primary)' }}>Add to watchlist</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:18 }}>✕</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Symbol</div>
            <input value={form.symbol} onChange={e => set('symbol', e.target.value.toUpperCase())} placeholder="BAJFINANCE" style={{ width:'100%', padding:'8px 10px', fontSize:13, borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'var(--surface-2)', color:'var(--text-primary)', fontFamily:'var(--font-mono)' }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Exchange</div>
            <div style={{ display:'flex', gap:6 }}>
              {['NSE','BSE'].map(e => (
                <div key={e} onClick={() => set('exchange', e)} style={{ flex:1, textAlign:'center', padding:'7px 0', borderRadius:'var(--radius)', cursor:'pointer', fontSize:12, fontWeight:600, border:`0.5px solid ${form.exchange===e?'var(--border-accent)':'var(--border)'}`, background:form.exchange===e?'var(--bg-accent)':'var(--surface-2)', color:form.exchange===e?'var(--text-accent)':'var(--text-muted)' }}>{e}</div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Target buy price (₹)</div>
          <input value={form.targetPrice} onChange={e => set('targetPrice', e.target.value)} placeholder="6800" style={{ width:'100%', padding:'8px 10px', fontSize:13, borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'var(--surface-2)', color:'var(--text-primary)', fontFamily:'var(--font-mono)' }} />
        </div>
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Sector</div>
          <select value={form.sector} onChange={e => set('sector', e.target.value)} style={{ width:'100%', padding:'8px 10px', fontSize:13, borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'var(--surface-2)', color:'var(--text-primary)' }}>
            {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Notes</div>
          <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Why you're watching this..." style={{ width:'100%', padding:'8px 10px', fontSize:13, borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'var(--surface-2)', color:'var(--text-primary)' }} />
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onClose} style={{ flex:1, padding:'9px 0', borderRadius:'var(--radius)', border:'0.5px solid var(--border-strong)', background:'none', color:'var(--text-secondary)', cursor:'pointer', fontSize:13 }}>Cancel</button>
          <button onClick={() => { if(!form.symbol) return alert('Symbol required'); onSave({ ...form, targetPrice: parseFloat(form.targetPrice||0), id: Date.now().toString(), addedDate: new Date().toISOString().slice(0,10) }); onClose(); }} style={{ flex:2, padding:'9px 0', borderRadius:'var(--radius)', border:'none', background:'var(--fill-accent)', color:'var(--on-accent)', cursor:'pointer', fontSize:13, fontWeight:500 }}>Add to watchlist</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main StockPortfolio Page ─────────────────────────────────────────────────
export default function StockPortfolio() {
  const [tab, setTab] = useState('portfolio');
  const [data, setData] = useState(() => {
    const d = loadData();
    return { transactions: [], dividends: [], watchlist: [], ...d };
  });
  const [quotes, setQuotes] = useState({});
  const [quoteStatus, setQuoteStatus] = useState('idle'); // idle | loading | ok | error
  const [lastFetched, setLastFetched] = useState(null);
  const [modal, setModal] = useState(null); // null | 'transaction' | 'dividend' | 'watchlist'
  const [syncing, setSyncing] = useState(false);

  // ── Persist ───────────────────────────────────────────────────────────────
  const update = useCallback((patch) => {
    setData(prev => { const next = { ...prev, ...patch }; saveData(next); return next; });
  }, []);

  // ── Compute holdings from transactions ────────────────────────────────────
  const holdings = useMemo(() => {
    const map = {};
    [...data.transactions].sort((a,b) => new Date(a.date)-new Date(b.date)).forEach(tx => {
      const key = tx.symbol + '_' + tx.exchange;
      if (!map[key]) map[key] = { symbol: tx.symbol, exchange: tx.exchange, sector: tx.sector || 'Other', qty: 0, totalCost: 0, transactions: [], firstDate: tx.date };
      if (tx.type === 'BUY') {
        map[key].qty += tx.qty;
        map[key].totalCost += tx.qty * tx.price + (tx.brokerage || 0);
      } else {
        const avgCost = map[key].qty > 0 ? map[key].totalCost / map[key].qty : 0;
        map[key].qty -= tx.qty;
        map[key].totalCost -= tx.qty * avgCost;
      }
      map[key].transactions.push(tx);
      map[key].sector = tx.sector || map[key].sector;
    });
    return Object.values(map).filter(h => h.qty > 0.001).map(h => ({
      ...h,
      avgCost: h.qty > 0 ? h.totalCost / h.qty : 0,
    }));
  }, [data.transactions]);

  // ── Fetch quotes ──────────────────────────────────────────────────────────
  const fetchQuotes = useCallback(async () => {
    const symbols = [...new Set([
      ...holdings.map(h => ({ symbol: h.symbol, exchange: h.exchange })),
      ...data.watchlist.map(w => ({ symbol: w.symbol, exchange: w.exchange })),
    ])];
    if (!symbols.length) return;
    setQuoteStatus('loading');
    try {
      const res = await fetch(`${SYNC_SERVER}/stocks/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });
      const json = await res.json();
      if (json.success) {
        setQuotes(json.quotes || {});
        setQuoteStatus('ok');
        setLastFetched(new Date());
      } else {
        setQuoteStatus('error');
      }
    } catch {
      setQuoteStatus('error');
    }
  }, [holdings, data.watchlist]);

  // Auto-fetch on mount + every 60s during market hours
  useEffect(() => {
    fetchQuotes();
    const interval = setInterval(fetchQuotes, 60000);
    return () => clearInterval(interval);
  }, [fetchQuotes]);

  // ── Broker sync ───────────────────────────────────────────────────────────
  const syncFromBroker = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${SYNC_SERVER}/stocks/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ existingTransactions: data.transactions }) });
      const json = await res.json();
      if (json.success && json.transactions?.length) {
        const existing = new Set(data.transactions.map(t => t.brokerTradeId).filter(Boolean));
        const newOnes = json.transactions.filter(t => !existing.has(t.brokerTradeId));
        if (newOnes.length) {
          update({ transactions: [...data.transactions, ...newOnes] });
          alert(`Synced ${newOnes.length} new stock transaction${newOnes.length>1?'s':''}`);
        } else {
          alert('Already up to date — no new transactions found');
        }
      } else {
        alert(json.error || 'Sync failed — make sure your broker is connected');
      }
    } catch {
      alert('Could not connect to sync server. Make sure it is running on port 5001.');
    }
    setSyncing(false);
  };

  // ── Summary stats ─────────────────────────────────────────────────────────
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
    return { invested, currentValue, unrealised, returnPct, totalDividends };
  }, [holdings, quotes, data.dividends]);

  // ── Sector allocation ─────────────────────────────────────────────────────
  const sectorAlloc = useMemo(() => {
    const map = {};
    holdings.forEach(h => {
      const val = quotes[h.symbol]?.ltp ? h.qty * quotes[h.symbol].ltp : h.totalCost;
      map[h.sector] = (map[h.sector] || 0) + val;
    });
    const total = Object.values(map).reduce((s,v) => s+v, 0);
    return Object.entries(map).sort((a,b) => b[1]-a[1]).map(([s,v]) => ({ sector:s, value:v, pct: total>0 ? (v/total)*100 : 0 }));
  }, [holdings, quotes]);

  const SECTOR_COLORS = ['var(--fill-accent)','var(--fill-success)','var(--fill-danger)','#818cf8','var(--fill-warning)','var(--border-strong)'];

  // ── Realised P&L ─────────────────────────────────────────────────────────
  const realisedPnL = useMemo(() => {
    // Group sells, compute against avg cost at time of sell
    const map = {};
    [...data.transactions].sort((a,b) => new Date(a.date)-new Date(b.date)).forEach(tx => {
      const key = tx.symbol + '_' + tx.exchange;
      if (!map[key]) map[key] = { qty: 0, totalCost: 0, realised: 0 };
      if (tx.type === 'BUY') {
        map[key].qty += tx.qty;
        map[key].totalCost += tx.qty * tx.price;
      } else {
        const avg = map[key].qty > 0 ? map[key].totalCost / map[key].qty : 0;
        map[key].realised += tx.qty * (tx.price - avg) - (tx.brokerage || 0);
        map[key].qty -= tx.qty;
        map[key].totalCost -= tx.qty * avg;
      }
    });
    return Object.values(map).reduce((s, v) => s + v.realised, 0);
  }, [data.transactions]);

  // ─── Tab: Portfolio ───────────────────────────────────────────────────────
  const renderPortfolio = () => (
    <div>
      {/* Summary */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:20 }}>
        {[
          ['Invested', fmtINR(summary.invested), 'var(--text-primary)'],
          ['Current value', fmtINR(summary.currentValue), 'var(--text-primary)'],
          ['Unrealised P&L', fmtINR(summary.unrealised), summary.unrealised >= 0 ? 'var(--text-success)' : 'var(--text-danger)'],
          ['Overall return', fmtChange(summary.returnPct), summary.returnPct >= 0 ? 'var(--text-success)' : 'var(--text-danger)'],
        ].map(([lbl, val, col]) => (
          <div key={lbl} style={{ background:'var(--surface-1)', borderRadius:'var(--radius)', padding:'12px 14px' }}>
            <div style={{ fontSize:10, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>{lbl}</div>
            <div style={{ fontSize:18, fontWeight:500, fontFamily:'var(--font-mono)', color:col }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Holdings table */}
      {holdings.length === 0 ? (
        <div style={{ textAlign:'center', padding:'48px 0', color:'var(--text-muted)', fontSize:13 }}>
          No holdings yet — add a transaction to get started
        </div>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr style={{ background:'var(--surface-1)' }}>
              {['Stock','Qty','Avg cost','CMP','Cur. value','Unrealised','Return','Days held','Action'].map(h => (
                <th key={h} style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-muted)', fontWeight:500, padding:'8px 10px', textAlign: h==='Stock'?'left':'right', borderBottom:'0.5px solid var(--border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holdings.map(h => {
              const q = quotes[h.symbol];
              const cmp = q?.ltp;
              const curVal = cmp ? h.qty * cmp : null;
              const upnl = curVal ? curVal - h.totalCost : null;
              const retPct = upnl !== null && h.totalCost > 0 ? (upnl / h.totalCost) * 100 : null;
              const days = daysBetween(h.firstDate);
              return (
                <tr key={h.symbol + h.exchange} style={{ borderBottom:'0.5px solid var(--border)' }}>
                  <td style={{ padding:'10px 10px' }}>
                    <div style={{ fontWeight:500, fontSize:13, color:'var(--text-primary)' }}>{h.symbol}</div>
                    <div style={{ display:'flex', gap:5, marginTop:3 }}>
                      <span style={{ fontSize:10, padding:'1px 6px', borderRadius:4, background:'var(--surface-2)', border:'0.5px solid var(--border)', color:'var(--text-secondary)' }}>{h.sector}</span>
                      <span style={{ fontSize:10, color:'var(--text-muted)' }}>{h.exchange}</span>
                    </div>
                  </td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 10px' }}>{h.qty}</td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 10px' }}>{fmtINR(h.avgCost)}</td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:500, padding:'10px 10px', color:'var(--text-primary)' }}>
                    {cmp ? fmtINR(cmp) : <span style={{ color:'var(--text-muted)', fontSize:11 }}>{quoteStatus==='loading'?'...' : '—'}</span>}
                    {q?.changePct !== undefined && <div style={{ fontSize:10, color: q.changePct >= 0 ? 'var(--text-success)' : 'var(--text-danger)' }}>{fmtChange(q.changePct)}</div>}
                  </td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 10px' }}>{curVal ? fmtINR(curVal) : '—'}</td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:600, padding:'10px 10px', color: upnl === null ? 'var(--text-muted)' : upnl >= 0 ? 'var(--text-success)' : 'var(--text-danger)' }}>{upnl !== null ? (upnl >= 0 ? '+' : '') + fmtINR(upnl) : '—'}</td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 10px', color: retPct === null ? 'var(--text-muted)' : retPct >= 0 ? 'var(--text-success)' : 'var(--text-danger)' }}>{retPct !== null ? fmtChange(retPct) : '—'}</td>
                  <td style={{ textAlign:'right', color:'var(--text-muted)', padding:'10px 10px' }}>{days}</td>
                  <td style={{ textAlign:'right', padding:'10px 10px' }}>
                    <button onClick={() => setModal({ type:'transaction', prefill:{ symbol:h.symbol, exchange:h.exchange, sector:h.sector, type:'SELL' } })} style={{ fontSize:10, padding:'2px 8px', borderRadius:'var(--radius)', border:'0.5px solid var(--border-danger)', background:'var(--bg-danger)', color:'var(--text-danger)', cursor:'pointer' }}>Sell</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Sector allocation */}
      {sectorAlloc.length > 0 && (
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:10, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:10 }}>Sector allocation</div>
          <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
            {sectorAlloc.map((s, i) => (
              <div key={s.sector} style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:SECTOR_COLORS[i % SECTOR_COLORS.length], display:'inline-block', flexShrink:0 }}></span>
                <span style={{ fontSize:12, color:'var(--text-secondary)' }}>{s.sector} {s.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // ─── Tab: Transactions ────────────────────────────────────────────────────
  const renderTransactions = () => (
    <div>
      {data.transactions.length === 0 ? (
        <div style={{ textAlign:'center', padding:'48px 0', color:'var(--text-muted)', fontSize:13 }}>No transactions yet</div>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr style={{ background:'var(--surface-1)' }}>
              {['Stock','Type','Qty','Price','Total','Brokerage','Date','Notes',''].map(h => (
                <th key={h} style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-muted)', fontWeight:500, padding:'8px 10px', textAlign: h===''||h==='Stock'?'left':'right', borderBottom:'0.5px solid var(--border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...data.transactions].sort((a,b) => new Date(b.date)-new Date(a.date)).map(tx => (
              <tr key={tx.id} style={{ borderBottom:'0.5px solid var(--border)' }}>
                <td style={{ padding:'10px 10px' }}>
                  <div style={{ fontWeight:500, fontSize:13, color:'var(--text-primary)' }}>{tx.symbol}</div>
                  <div style={{ fontSize:10, color:'var(--text-muted)' }}>{tx.exchange}</div>
                </td>
                <td style={{ textAlign:'right', padding:'10px 10px' }}>
                  <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:4, background: tx.type==='BUY'?'var(--bg-success)':'var(--bg-danger)', color: tx.type==='BUY'?'var(--text-success)':'var(--text-danger)', border:`0.5px solid ${tx.type==='BUY'?'var(--border-success)':'var(--border-danger)'}` }}>{tx.type}</span>
                </td>
                <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 10px' }}>{tx.qty}</td>
                <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 10px' }}>{fmtINR(tx.price)}</td>
                <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 10px' }}>{fmtINR(tx.qty * tx.price)}</td>
                <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 10px', color:'var(--text-muted)' }}>{fmtINR(tx.brokerage || 0)}</td>
                <td style={{ textAlign:'right', color:'var(--text-muted)', padding:'10px 10px' }}>{tx.date}</td>
                <td style={{ textAlign:'right', color:'var(--text-muted)', fontSize:11, padding:'10px 10px', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.notes}</td>
                <td style={{ padding:'10px 10px' }}>
                  <button onClick={() => update({ transactions: data.transactions.filter(t => t.id !== tx.id) })} style={{ fontSize:10, padding:'2px 6px', borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'none', color:'var(--text-muted)', cursor:'pointer' }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  // ─── Tab: Dividends ───────────────────────────────────────────────────────
  const renderDividends = () => {
    const total = data.dividends.reduce((s,d) => s+(d.total||0), 0);
    const thisYear = data.dividends.filter(d => d.exDate?.startsWith(new Date().getFullYear().toString())).reduce((s,d) => s+(d.total||0), 0);
    return (
      <div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:20 }}>
          {[['Total received', fmtINR(total), 'var(--text-success)'], ['This year', fmtINR(thisYear), 'var(--text-success)'], ['Entries', data.dividends.length.toString(), 'var(--text-primary)']].map(([l,v,c]) => (
            <div key={l} style={{ background:'var(--surface-1)', borderRadius:'var(--radius)', padding:'12px 14px' }}>
              <div style={{ fontSize:10, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>{l}</div>
              <div style={{ fontSize:18, fontWeight:500, fontFamily:'var(--font-mono)', color:c }}>{v}</div>
            </div>
          ))}
        </div>
        {data.dividends.length === 0 ? (
          <div style={{ textAlign:'center', padding:'48px 0', color:'var(--text-muted)', fontSize:13 }}>No dividends logged yet</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'var(--surface-1)' }}>
                {['Stock','Ex-date','Per share','Qty held','Total received','Notes',''].map(h => (
                  <th key={h} style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-muted)', fontWeight:500, padding:'8px 10px', textAlign:h===''||h==='Stock'?'left':'right', borderBottom:'0.5px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...data.dividends].sort((a,b) => new Date(b.exDate)-new Date(a.exDate)).map(d => (
                <tr key={d.id} style={{ borderBottom:'0.5px solid var(--border)' }}>
                  <td style={{ padding:'10px 10px', fontWeight:500, fontSize:13, color:'var(--text-primary)' }}>{d.symbol}</td>
                  <td style={{ textAlign:'right', color:'var(--text-muted)', padding:'10px 10px' }}>{d.exDate}</td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 10px' }}>{fmtINR(d.perShare)}</td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', padding:'10px 10px' }}>{d.qtyHeld}</td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:600, color:'var(--text-success)', padding:'10px 10px' }}>+{fmtINR(d.total)}</td>
                  <td style={{ textAlign:'right', color:'var(--text-muted)', fontSize:11, padding:'10px 10px' }}>{d.notes}</td>
                  <td style={{ padding:'10px 10px' }}>
                    <button onClick={() => update({ dividends: data.dividends.filter(x => x.id !== d.id) })} style={{ fontSize:10, padding:'2px 6px', borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'none', color:'var(--text-muted)', cursor:'pointer' }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  // ─── Tab: Watchlist ───────────────────────────────────────────────────────
  const renderWatchlist = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {data.watchlist.length === 0 ? (
        <div style={{ textAlign:'center', padding:'48px 0', color:'var(--text-muted)', fontSize:13 }}>No stocks on watchlist yet</div>
      ) : data.watchlist.map(w => {
        const q = quotes[w.symbol];
        const cmp = q?.ltp;
        const pctAway = cmp && w.targetPrice ? ((cmp - w.targetPrice) / w.targetPrice) * 100 : null;
        const progress = cmp && w.targetPrice ? Math.min(100, (cmp / w.targetPrice) * 100) : null;
        const aboveTarget = pctAway !== null && pctAway >= 0;
        return (
          <div key={w.id} style={{ background:'var(--surface-1)', border:'0.5px solid var(--border)', borderRadius:'var(--radius)', padding:'14px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <span style={{ fontSize:14, fontWeight:500, color:'var(--text-primary)' }}>{w.symbol}</span>
                <span style={{ fontSize:10, padding:'1px 6px', borderRadius:4, background:'var(--surface-2)', border:'0.5px solid var(--border)', color:'var(--text-secondary)' }}>{w.sector}</span>
                <span style={{ fontSize:10, color:'var(--text-muted)' }}>{w.exchange}</span>
              </div>
              {w.targetPrice > 0 && <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5 }}>Target: {fmtINR(w.targetPrice)}{w.notes ? ` · ${w.notes}` : ''}</div>}
              {progress !== null && (
                <div style={{ width:200 }}>
                  <div style={{ height:3, borderRadius:2, background:'var(--border)', overflow:'hidden' }}>
                    <div style={{ height:'100%', borderRadius:2, width:progress+'%', background: aboveTarget ? 'var(--fill-accent)' : 'var(--fill-success)', transition:'width 0.3s' }}></div>
                  </div>
                  <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:3 }}>
                    {aboveTarget ? `${pctAway.toFixed(1)}% above target` : `${Math.abs(pctAway).toFixed(1)}% away from target`}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:5, marginLeft:16 }}>
              {cmp ? (
                <>
                  <span style={{ fontFamily:'var(--font-mono)', fontSize:14, fontWeight:500, color:'var(--text-primary)' }}>{fmtINR(cmp)}</span>
                  {q.changePct !== undefined && <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color: q.changePct >= 0 ? 'var(--text-success)' : 'var(--text-danger)' }}>{fmtChange(q.changePct)}</span>}
                </>
              ) : <span style={{ fontSize:12, color:'var(--text-muted)' }}>—</span>}
              <div style={{ display:'flex', gap:5 }}>
                <button onClick={() => setModal({ type:'transaction', prefill:{ symbol:w.symbol, exchange:w.exchange, sector:w.sector, type:'BUY' } })} style={{ fontSize:10, padding:'3px 10px', borderRadius:'var(--radius)', border:'none', background:'var(--fill-accent)', color:'var(--on-accent)', cursor:'pointer', fontWeight:500 }}>Buy</button>
                <button onClick={() => update({ watchlist: data.watchlist.filter(x => x.id !== w.id) })} style={{ fontSize:10, padding:'3px 6px', borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'none', color:'var(--text-muted)', cursor:'pointer' }}>✕</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const TABS = [
    { id:'portfolio', label:'Portfolio' },
    { id:'transactions', label:'Transactions' },
    { id:'dividends', label:'Dividends' },
    { id:'watchlist', label:'Watchlist' },
  ];

  const addBtnLabel = { portfolio:'Add transaction', transactions:'Add transaction', dividends:'Log dividend', watchlist:'Add to watchlist' };
  const addBtnAction = { portfolio:() => setModal({type:'transaction'}), transactions:() => setModal({type:'transaction'}), dividends:() => setModal({type:'dividend'}), watchlist:() => setModal({type:'watchlist'}) };

  return (
    <div style={{ padding:'0 24px 24px', maxWidth:1200, margin:'0 auto', WebkitFontSmoothing:'antialiased' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 0 16px' }}>
        <div>
          <div style={{ fontSize:22, fontWeight:500, color:'var(--text-primary)' }}>Stock Portfolio</div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:3 }}>
            {holdings.length} holding{holdings.length !== 1 ? 's' : ''}
            {quoteStatus === 'ok' && lastFetched && ` · prices updated ${lastFetched.toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'})}`}
            {quoteStatus === 'loading' && ' · fetching prices...'}
            {quoteStatus === 'error' && ' · prices unavailable'}
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={fetchQuotes} disabled={quoteStatus==='loading'} title="Refresh prices" style={{ padding:'7px 12px', borderRadius:'var(--radius)', border:'0.5px solid var(--border-strong)', background:'none', color:'var(--text-secondary)', cursor:'pointer', fontSize:13, opacity: quoteStatus==='loading' ? 0.5 : 1 }}>⟳ Refresh</button>
          <button onClick={syncFromBroker} disabled={syncing} style={{ padding:'7px 14px', borderRadius:'var(--radius)', border:'0.5px solid var(--border-strong)', background:'none', color:'var(--text-secondary)', cursor:'pointer', fontSize:13, opacity:syncing?0.6:1 }}>{syncing ? 'Syncing...' : '⇌ Sync broker'}</button>
          <button onClick={addBtnAction[tab]} style={{ padding:'7px 16px', borderRadius:'var(--radius)', border:'none', background:'var(--fill-accent)', color:'var(--on-accent)', cursor:'pointer', fontSize:13, fontWeight:500 }}>+ {addBtnLabel[tab]}</button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', borderBottom:'0.5px solid var(--border)', marginBottom:20 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding:'10px 20px', fontSize:13, fontWeight:500, background:'none', border:'none', borderBottom:`2px solid ${tab===t.id?'var(--fill-accent)':'transparent'}`, color: tab===t.id ? 'var(--text-primary)' : 'var(--text-muted)', cursor:'pointer' }}>{t.label}</button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'portfolio' && renderPortfolio()}
      {tab === 'transactions' && renderTransactions()}
      {tab === 'dividends' && renderDividends()}
      {tab === 'watchlist' && renderWatchlist()}

      {/* Modals */}
      {modal?.type === 'transaction' && (
        <AddTransactionModal
          prefill={modal.prefill || null}
          onClose={() => setModal(null)}
          onSave={tx => update({ transactions: [...data.transactions, tx] })}
        />
      )}
      {modal?.type === 'dividend' && (
        <AddDividendModal
          holdings={holdings}
          onClose={() => setModal(null)}
          onSave={d => update({ dividends: [...data.dividends, d] })}
        />
      )}
      {modal?.type === 'watchlist' && (
        <AddWatchlistModal
          onClose={() => setModal(null)}
          onSave={w => update({ watchlist: [...data.watchlist, w] })}
        />
      )}
    </div>
  );
}
