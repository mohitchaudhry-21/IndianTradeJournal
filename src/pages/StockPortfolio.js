import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '../context/ToastContext';

const SYNC_SERVER = 'http://localhost:5001';
const STOCK_KEY = 'itj_stock_data';

const SECTORS = ['Banking','IT','Energy','Auto','Pharma','FMCG','Finance','Infra','Metals','Telecom','Cons. Disc.','Insurance','Defence','Real Estate','Media','Other'];
const SECTOR_COLORS = ['#6366f1','#22c55e','#f59e0b','#3b82f6','#ec4899','#14b8a6','#f97316','#8b5cf6','#06b6d4','#84cc16','#ef4444','#a855f7','#10b981','#f43f5e','#0ea5e9','#94a3b8'];

const SYMBOL_SECTOR_MAP = {
  HDFCBANK:'Banking',ICICIBANK:'Banking',SBIN:'Banking',AXISBANK:'Banking',KOTAKBANK:'Banking',
  INDUSINDBK:'Banking',BANKBARODA:'Banking',PNB:'Banking',RBLBANK:'Banking',UNIONBANK:'Banking',
  FEDERALBNK:'Banking',IDFCFIRSTB:'Banking',YESBANK:'Banking',CANBK:'Banking',IDFCFIRSTB:'Banking',
  TCS:'IT',INFY:'IT',HCLTECH:'IT',WIPRO:'IT',TECHM:'IT',LTIM:'IT',PERSISTENT:'IT',ITBEES:'IT',
  RELIANCE:'Energy',ONGC:'Energy',NTPC:'Energy',POWERGRID:'Energy',BPCL:'Energy',TATAPOWER:'Energy',
  COALINDIA:'Energy',GAIL:'Energy',IOC:'Energy',HINDPETRO:'Energy',IREDA:'Energy',IRFC:'Energy',
  MARUTI:'Auto',TATAMOTORS:'Auto',HEROMOTOCO:'Auto',EICHERMOT:'Auto',TMPV:'Auto',TMCV:'Auto',
  MOTHERSON:'Auto',BHARATFORG:'Auto',BALKRISHNA:'Auto',
  SUNPHARMA:'Pharma',DRREDDY:'Pharma',CIPLA:'Pharma',DIVISLAB:'Pharma',AUROPHARMA:'Pharma',
  HINDUNILVR:'FMCG',ITC:'FMCG',NESTLEIND:'FMCG',BRITANNIA:'FMCG',MARICO:'FMCG',
  BAJFINANCE:'Finance',BAJAJFINSV:'Finance',HDFCLIFE:'Finance',SBILIFE:'Finance',
  MUTHOOTFIN:'Finance',CHOLAFIN:'Finance',BSE:'Finance',MCX:'Finance',CDSL:'Finance',
  CAMS:'Finance',NSDL:'Finance',AAVAS:'Finance',HDBFS:'Finance',TATACAP:'Finance',GROWW:'Finance',
  TATASTEEL:'Metals',JSWSTEEL:'Metals',HINDALCO:'Metals',VEDL:'Metals',SAIL:'Metals',NMDC:'Metals',
  NATIONALUM:'Metals',
  LT:'Infra',ULTRACEMCO:'Infra',GRASIM:'Infra',SHREECEM:'Infra',HUDCO:'Infra',NHPC:'Infra',
  RVNL:'Infra',IRCON:'Infra',
  BHARTIARTL:'Telecom',IDEA:'Telecom',
  TITAN:'Cons. Disc.',TRENT:'Cons. Disc.',DMART:'Cons. Disc.',DIXON:'Cons. Disc.',VOLTAS:'Cons. Disc.',
  EUREKAFORB:'Cons. Disc.',AMBER:'Cons. Disc.',
  STARHEALTH:'Insurance',ICICIGI:'Insurance',NIACL:'Insurance',NIVABUPA:'Insurance',
  HAL:'Defence',BEL:'Defence',BHEL:'Defence',BEML:'Defence',COCHINSHIP:'Defence',
  DLF:'Real Estate',GODREJPROP:'Real Estate',
  GOLDBEES:'Metals',NIFTYBEES:'Other',JUNIORBEES:'Other',
  UNITDSPR:'FMCG',HYUNDAI:'Auto',ANTHEM:'Pharma',BELRISE:'Auto',
  TATASTEEL:'Metals',ONGC:'Energy',NTPC:'Energy',TATAPOWER:'Energy',
  SUZLON:'Energy',TATASTEEL:'Metals',IDFCFIRSTB:'Banking',RVNL:'Infra',
  IDEA:'Telecom',JIOFIN:'Finance',TATASTEEL:'Metals',NHPC:'Infra',
  ONGC:'Energy',NTPC:'Energy',IRFC:'Energy',IDFCFIRSTB:'Banking',
};

function getSector(sym) { return SYMBOL_SECTOR_MAP[sym?.toUpperCase()] || 'Other'; }
function loadData() { try { return JSON.parse(localStorage.getItem(STOCK_KEY) || '{}'); } catch { return {}; } }
function saveData(d) { localStorage.setItem(STOCK_KEY, JSON.stringify(d)); }

function fmtINR(n, dec = 2) {
  if (n == null || isNaN(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n).toFixed(dec);
  const [i, d] = abs.split('.');
  let r = i;
  if (i.length > 3) {
    const last3 = i.slice(-3);
    const rest = i.slice(0, -3);
    const grps = [];
    for (let x = rest.length; x > 0; x -= 2) grps.unshift(rest.slice(Math.max(0, x-2), x));
    r = grps.join(',') + ',' + last3;
  }
  return sign + '₹' + r + (d ? '.' + d : '');
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function daysBetween(d) {
  if (!d) return 0;
  const p = new Date(d);
  if (isNaN(p.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - p) / 86400000));
}

const inp = { width:'100%', padding:'8px 10px', fontSize:13, borderRadius:'var(--radius)', border:'0.5px solid var(--border)', background:'var(--surface-2)', color:'var(--text-primary)', outline:'none', boxSizing:'border-box' };

// ── Add Transaction Modal ──────────────────────────────────────────────────────
function TxModal({ onClose, onSave, prefill }) {
  const [f, setF] = useState({ type:'BUY', exchange:'NSE', symbol:'', date:new Date().toISOString().slice(0,10), qty:'', price:'', brokerage:'20', notes:'', sector:'', ...prefill });
  const set = (k,v) => setF(p => ({...p,[k]:v}));
  useEffect(() => { if (f.symbol) set('sector', getSector(f.symbol)); }, [f.symbol]);
  const total = parseFloat(f.qty||0) * parseFloat(f.price||0);
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'var(--surface-1)',border:'0.5px solid var(--border)',borderRadius:14,padding:24,width:500,maxHeight:'92vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
          <span style={{fontSize:16,fontWeight:500}}>Add transaction</span>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:20}}>✕</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          <div>
            <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Type</div>
            <div style={{display:'flex',gap:6}}>
              {['BUY','SELL'].map(t=><div key={t} onClick={()=>set('type',t)} style={{flex:1,textAlign:'center',padding:'8px 0',borderRadius:'var(--radius)',cursor:'pointer',fontSize:12,fontWeight:600,border:`0.5px solid ${f.type===t?(t==='BUY'?'var(--border-success)':'var(--border-danger)'):'var(--border)'}`,background:f.type===t?(t==='BUY'?'var(--bg-success)':'var(--bg-danger)'):'var(--surface-2)',color:f.type===t?(t==='BUY'?'var(--text-success)':'var(--text-danger)'):'var(--text-muted)'}}>{t}</div>)}
            </div>
          </div>
          <div>
            <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Exchange</div>
            <div style={{display:'flex',gap:6}}>
              {['NSE','BSE'].map(e=><div key={e} onClick={()=>set('exchange',e)} style={{flex:1,textAlign:'center',padding:'8px 0',borderRadius:'var(--radius)',cursor:'pointer',fontSize:12,fontWeight:600,border:`0.5px solid ${f.exchange===e?'rgba(99,102,241,0.5)':'var(--border)'}`,background:f.exchange===e?'rgba(99,102,241,0.12)':'var(--surface-2)',color:f.exchange===e?'#818cf8':'var(--text-muted)'}}>{e}</div>)}
            </div>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          <div><div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Symbol</div><input value={f.symbol} onChange={e=>set('symbol',e.target.value.toUpperCase())} placeholder="RELIANCE" style={{...inp,fontFamily:'var(--font-mono)',fontWeight:600}}/></div>
          <div><div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Date</div><input type="date" value={f.date} onChange={e=>set('date',e.target.value)} style={inp}/></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:14}}>
          {[['Qty','qty','10'],['Price (₹)','price','2812.40'],['Brokerage (₹)','brokerage','20']].map(([l,k,p])=><div key={k}><div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>{l}</div><input value={f[k]} onChange={e=>set(k,e.target.value)} placeholder={p} style={{...inp,fontFamily:'var(--font-mono)'}}/></div>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          <div><div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Sector</div><select value={f.sector} onChange={e=>set('sector',e.target.value)} style={inp}>{SECTORS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Notes</div><input value={f.notes} onChange={e=>set('notes',e.target.value)} placeholder="Reason..." style={inp}/></div>
        </div>
        {total>0 && <div style={{background:'var(--surface-2)',borderRadius:'var(--radius)',padding:'10px 14px',marginBottom:16,display:'flex',justifyContent:'space-between'}}><span style={{fontSize:12,color:'var(--text-muted)'}}>Total</span><span style={{fontFamily:'var(--font-mono)',fontSize:14,fontWeight:600}}>{fmtINR(total)}</span></div>}
        <div style={{display:'flex',gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:'10px 0',borderRadius:'var(--radius)',border:'0.5px solid var(--border-strong)',background:'none',color:'var(--text-secondary)',cursor:'pointer',fontSize:13}}>Cancel</button>
          <button onClick={()=>{if(!f.symbol||!f.qty||!f.price)return alert('Symbol, qty and price required');onSave({...f,qty:parseFloat(f.qty),price:parseFloat(f.price),brokerage:parseFloat(f.brokerage||0),id:Date.now().toString(),sector:f.sector||getSector(f.symbol)});onClose();}} style={{flex:2,padding:'10px 0',borderRadius:'var(--radius)',border:'none',background:'var(--fill-accent)',color:'var(--on-accent)',cursor:'pointer',fontSize:13,fontWeight:600}}>Add transaction</button>
        </div>
      </div>
    </div>
  );
}

// ── Dividend Modal ─────────────────────────────────────────────────────────────
function DivModal({ onClose, onSave, holdings }) {
  const [f, setF] = useState({symbol:holdings[0]?.symbol||'',exDate:new Date().toISOString().slice(0,10),perShare:'',qtyHeld:'',notes:''});
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  const total = parseFloat(f.perShare||0)*parseFloat(f.qtyHeld||0);
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'var(--surface-1)',border:'0.5px solid var(--border)',borderRadius:14,padding:24,width:420}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}><span style={{fontSize:16,fontWeight:500}}>Log dividend</span><button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:20}}>✕</button></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          <div><div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Stock</div><select value={f.symbol} onChange={e=>{set('symbol',e.target.value);const h=holdings.find(x=>x.symbol===e.target.value);if(h)set('qtyHeld',h.qty);}} style={inp}>{holdings.map(h=><option key={h.symbol} value={h.symbol}>{h.symbol}</option>)}<option value="OTHER">Other</option></select></div>
          <div><div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Ex-date</div><input type="date" value={f.exDate} onChange={e=>set('exDate',e.target.value)} style={inp}/></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          <div><div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Per share (₹)</div><input value={f.perShare} onChange={e=>set('perShare',e.target.value)} placeholder="10.00" style={{...inp,fontFamily:'var(--font-mono)'}}/></div>
          <div><div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Qty held</div><input value={f.qtyHeld} onChange={e=>set('qtyHeld',e.target.value)} placeholder="15" style={{...inp,fontFamily:'var(--font-mono)'}}/></div>
        </div>
        <div style={{marginBottom:16}}><div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Notes</div><input value={f.notes} onChange={e=>set('notes',e.target.value)} placeholder="Interim / final..." style={inp}/></div>
        {total>0 && <div style={{background:'rgba(34,197,94,0.08)',borderRadius:'var(--radius)',padding:'10px 14px',marginBottom:14,display:'flex',justifyContent:'space-between'}}><span style={{fontSize:12,color:'var(--text-success)'}}>Total dividend</span><span style={{fontFamily:'var(--font-mono)',fontSize:14,fontWeight:600,color:'var(--text-success)'}}>{fmtINR(total)}</span></div>}
        <div style={{display:'flex',gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:'10px 0',borderRadius:'var(--radius)',border:'0.5px solid var(--border-strong)',background:'none',color:'var(--text-secondary)',cursor:'pointer',fontSize:13}}>Cancel</button>
          <button onClick={()=>{if(!f.symbol||!f.perShare||!f.qtyHeld)return alert('All fields required');onSave({...f,perShare:parseFloat(f.perShare),qtyHeld:parseFloat(f.qtyHeld),total:parseFloat(f.perShare)*parseFloat(f.qtyHeld),id:Date.now().toString()});onClose();}} style={{flex:2,padding:'10px 0',borderRadius:'var(--radius)',border:'none',background:'var(--fill-success)',color:'#000',cursor:'pointer',fontSize:13,fontWeight:600}}>Log dividend</button>
        </div>
      </div>
    </div>
  );
}

// ── Watchlist Modal ────────────────────────────────────────────────────────────
function WlModal({ onClose, onSave }) {
  const [f, setF] = useState({symbol:'',exchange:'NSE',targetPrice:'',notes:'',sector:'Other'});
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  useEffect(()=>{if(f.symbol)set('sector',getSector(f.symbol));},[f.symbol]);
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'var(--surface-1)',border:'0.5px solid var(--border)',borderRadius:14,padding:24,width:400}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}><span style={{fontSize:16,fontWeight:500}}>Add to watchlist</span><button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:20}}>✕</button></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          <div><div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Symbol</div><input value={f.symbol} onChange={e=>set('symbol',e.target.value.toUpperCase())} placeholder="BAJFINANCE" style={{...inp,fontFamily:'var(--font-mono)',fontWeight:600}}/></div>
          <div><div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Exchange</div><div style={{display:'flex',gap:6}}>{['NSE','BSE'].map(e=><div key={e} onClick={()=>set('exchange',e)} style={{flex:1,textAlign:'center',padding:'8px 0',borderRadius:'var(--radius)',cursor:'pointer',fontSize:12,fontWeight:600,border:`0.5px solid ${f.exchange===e?'rgba(99,102,241,0.5)':'var(--border)'}`,background:f.exchange===e?'rgba(99,102,241,0.12)':'var(--surface-2)',color:f.exchange===e?'#818cf8':'var(--text-muted)'}}>{e}</div>)}</div></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          <div><div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Target price (₹)</div><input value={f.targetPrice} onChange={e=>set('targetPrice',e.target.value)} placeholder="6800" style={{...inp,fontFamily:'var(--font-mono)'}}/></div>
          <div><div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Sector</div><select value={f.sector} onChange={e=>set('sector',e.target.value)} style={inp}>{SECTORS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
        </div>
        <div style={{marginBottom:18}}><div style={{fontSize:11,color:'var(--text-muted)',marginBottom:5,textTransform:'uppercase',letterSpacing:'.05em'}}>Notes</div><input value={f.notes} onChange={e=>set('notes',e.target.value)} placeholder="Why you're watching..." style={inp}/></div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:'10px 0',borderRadius:'var(--radius)',border:'0.5px solid var(--border-strong)',background:'none',color:'var(--text-secondary)',cursor:'pointer',fontSize:13}}>Cancel</button>
          <button onClick={()=>{if(!f.symbol)return alert('Symbol required');onSave({...f,targetPrice:parseFloat(f.targetPrice||0),id:Date.now().toString(),addedDate:new Date().toISOString().slice(0,10)});onClose();}} style={{flex:2,padding:'10px 0',borderRadius:'var(--radius)',border:'none',background:'var(--fill-accent)',color:'var(--on-accent)',cursor:'pointer',fontSize:13,fontWeight:600}}>Add to watchlist</button>
        </div>
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function StockPortfolio() {
  const { showToast } = useToast();
  const [tab, setTab] = useState('portfolio');
  const [data, setData] = useState(()=>{ const d=loadData(); return {transactions:[],dividends:[],watchlist:[],...d}; });
  const [quotes, setQuotes] = useState({});
  const [qStatus, setQStatus] = useState('idle');
  const [lastFetched, setLastFetched] = useState(null);
  const [modal, setModal] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [sortCol, setSortCol] = useState('symbol');
  const [sortDir, setSortDir] = useState(1);

  const update = useCallback((patch) => {
    setData(prev => { const next={...prev,...patch}; saveData(next); return next; });
  }, []);

  // Auto-fix sectors
  useEffect(() => {
    const fixed = data.transactions.map(tx => ({...tx, sector: (!tx.sector||tx.sector==='Other')?getSector(tx.symbol):tx.sector}));
    if (fixed.some((tx,i)=>tx.sector!==data.transactions[i].sector)) update({transactions:fixed});
  }, []);

  // Holdings
  const holdings = useMemo(() => {
    const map = {};
    [...data.transactions].sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(tx => {
      const key = tx.symbol+'_'+(tx.exchange||'NSE');
      if (!map[key]) map[key] = {symbol:tx.symbol,exchange:tx.exchange||'NSE',sector:getSector(tx.symbol),qty:0,totalCost:0,firstDate:null};
      if (tx.type==='BUY') {
        map[key].qty += tx.qty;
        map[key].totalCost += tx.qty*tx.price+(tx.brokerage||0);
        if (!map[key].firstDate||tx.date<map[key].firstDate) map[key].firstDate=tx.date;
      } else {
        const avg=map[key].qty>0?map[key].totalCost/map[key].qty:0;
        map[key].qty-=tx.qty; map[key].totalCost-=tx.qty*avg;
      }
      if (tx.sector&&tx.sector!=='Other') map[key].sector=tx.sector;
      else { const d=getSector(tx.symbol); if(d!=='Other') map[key].sector=d; }
    });
    return Object.values(map).filter(h=>h.qty>0.001).map(h=>({...h,avgCost:h.qty>0?h.totalCost/h.qty:0}));
  }, [data.transactions]);

  // Fetch quotes
  const fetchQuotes = useCallback(async () => {
    const symbols = [...new Set([...holdings.map(h=>({symbol:h.symbol,exchange:h.exchange})),...data.watchlist.map(w=>({symbol:w.symbol,exchange:w.exchange}))])];
    if (!symbols.length) return;
    setQStatus('loading');
    try {
      const res = await fetch(`${SYNC_SERVER}/stocks/quotes`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbols})});
      const json = await res.json();
      if (json.success) { setQuotes(json.quotes||{}); setQStatus('ok'); setLastFetched(new Date()); }
      else setQStatus('error');
    } catch { setQStatus('error'); }
  }, [holdings, data.watchlist]);

  useEffect(() => { fetchQuotes(); }, [holdings.length, data.watchlist.length]);
  useEffect(() => { const id=setInterval(fetchQuotes,60000); return ()=>clearInterval(id); }, [fetchQuotes]);

  // Summary
  const summary = useMemo(() => {
    let invested=0,currentValue=0;
    holdings.forEach(h => {
      const cmp=quotes[h.symbol]?.ltp;
      invested+=h.totalCost;
      currentValue+=cmp?h.qty*cmp:h.totalCost;
    });
    const unrealised=currentValue-invested;
    const returnPct=invested>0?(unrealised/invested)*100:0;
    return {invested,currentValue,unrealised,returnPct};
  }, [holdings,quotes]);

  // Today's gain
  const todayGain = useMemo(() => {
    return holdings.reduce((sum,h)=>{
      const q=quotes[h.symbol];
      if (!q||q.change==null) return sum;
      return sum + h.qty*(q.ltp-(q.ltp-q.change));
    },0);
  },[holdings,quotes]);

  // Sector allocation
  const sectorAlloc = useMemo(() => {
    const map={};
    holdings.forEach(h=>{ const val=quotes[h.symbol]?.ltp?h.qty*quotes[h.symbol].ltp:h.totalCost; map[h.sector]=(map[h.sector]||0)+val; });
    const total=Object.values(map).reduce((s,v)=>s+v,0);
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([sector,value])=>({sector,value,pct:total>0?(value/total)*100:0}));
  },[holdings,quotes]);

  // Sync
  const syncBroker = async () => {
    setSyncing(true);
    try {
      const res=await fetch(`${SYNC_SERVER}/stocks/sync`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({existingTransactions:data.transactions})});
      const json=await res.json();
      if (json.success&&json.transactions?.length) {
        const existing=new Set(data.transactions.map(t=>t.brokerTradeId).filter(Boolean));
        const newOnes=json.transactions.filter(t=>!existing.has(t.brokerTradeId)).map(t=>({...t,sector:getSector(t.symbol),id:Date.now().toString()+Math.random()}));
        if (newOnes.length) { update({transactions:[...data.transactions,...newOnes]}); showToast({ title: 'Stocks synced', message: `${newOnes.length} holding${newOnes.length>1?'s':''} added` }); }
        else showToast({ title: 'Stocks unchanged', message: 'Already up to date' });
      } else showToast({ title: 'Stock sync failed', message: json.error||'', type: 'error' });
    } catch { showToast({ title: 'Stock sync failed', message: 'Could not reach sync server', type: 'error' }); }
    setSyncing(false);
  };

  // Sort holdings
  const sortedHoldings = useMemo(() => {
    return [...holdings].sort((a,b) => {
      let av,bv;
      const qa=quotes[a.symbol],qb=quotes[b.symbol];
      if (sortCol==='symbol') { av=a.symbol; bv=b.symbol; return sortDir*av.localeCompare(bv); }
      if (sortCol==='qty') { av=a.qty; bv=b.qty; }
      else if (sortCol==='avgCost') { av=a.avgCost; bv=b.avgCost; }
      else if (sortCol==='ltp') { av=qa?.ltp||0; bv=qb?.ltp||0; }
      else if (sortCol==='invAmt') { av=a.totalCost; bv=b.totalCost; }
      else if (sortCol==='curVal') { av=qa?a.qty*qa.ltp:0; bv=qb?b.qty*qb.ltp:0; }
      else if (sortCol==='gl') { av=qa?a.qty*qa.ltp-a.totalCost:0; bv=qb?b.qty*qb.ltp-b.totalCost:0; }
      else if (sortCol==='todayGl') { av=qa?a.qty*qa.change:0; bv=qb?b.qty*qb.change:0; }
      else if (sortCol==='days') { av=daysBetween(a.firstDate); bv=daysBetween(b.firstDate); }
      else { av=0; bv=0; }
      return sortDir*(av-bv);
    });
  },[holdings,quotes,sortCol,sortDir]);

  const SortTh = ({col, label, right}) => (
    <th onClick={()=>{ if(sortCol===col) setSortDir(-sortDir); else { setSortCol(col); setSortDir(-1); } }}
      style={{fontSize:11,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--text-muted)',fontWeight:500,padding:'10px 14px',textAlign:right?'right':'left',borderBottom:'0.5px solid var(--border)',background:'var(--surface-1)',cursor:'pointer',whiteSpace:'nowrap',userSelect:'none'}}>
      {label} {sortCol===col?(sortDir===1?'↑':'↓'):''}
    </th>
  );

  // ── Portfolio Tab ────────────────────────────────────────────────────────────
  const renderPortfolio = () => (
    <div>
      {/* Summary cards — AngelOne style */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:24}}>
        {[
          {lbl:'Invested Amount', val:fmtINR(summary.invested), sub:null, col:'var(--text-primary)'},
          {lbl:'Current Value', val:fmtINR(summary.currentValue), sub:null, col:'var(--text-primary)'},
          {lbl:'Overall Gain', val:fmtINR(Math.abs(summary.unrealised)), sub:fmtPct(summary.returnPct), col:summary.unrealised>=0?'var(--text-success)':'var(--text-danger)', sign:summary.unrealised>=0?'+':'−'},
          {lbl:"Today's Gain", val:fmtINR(Math.abs(todayGain)), sub:null, col:todayGain>=0?'var(--text-success)':'var(--text-danger)', sign:todayGain>=0?'+':'−'},
        ].map(({lbl,val,sub,col,sign})=>(
          <div key={lbl} style={{background:'var(--surface-1)',border:'0.5px solid var(--border)',borderRadius:10,padding:'16px 18px'}}>
            <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>{lbl}</div>
            <div style={{fontFamily:'var(--font-mono)',fontSize:20,fontWeight:600,color:col}}>{sign||''}{val}</div>
            {sub && <div style={{fontFamily:'var(--font-mono)',fontSize:13,color:col,marginTop:3}}>{sub}</div>}
          </div>
        ))}
      </div>

      {holdings.length===0 ? (
        <div style={{textAlign:'center',padding:'60px 0',color:'var(--text-muted)',fontSize:14}}>
          <div style={{fontSize:36,marginBottom:12}}>📊</div>
          No holdings yet — add a transaction or sync from broker
        </div>
      ) : (
        <>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,WebkitFontSmoothing:'antialiased'}}>
            <thead>
              <tr>
                <SortTh col="symbol" label="Name" />
                <SortTh col="qty" label="Qty" right />
                <SortTh col="avgCost" label="Avg. Price" right />
                <SortTh col="ltp" label="LTP" right />
                <SortTh col="invAmt" label="Inv. Amt." right />
                <SortTh col="curVal" label="Current Val." right />
                <SortTh col="gl" label="Overall G/L" right />
                <SortTh col="todayGl" label="Today's G/L" right />
                <SortTh col="days" label="Days" right />
                <th style={{fontSize:11,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--text-muted)',fontWeight:500,padding:'10px 14px',textAlign:'right',borderBottom:'0.5px solid var(--border)',background:'var(--surface-1)'}}></th>
              </tr>
            </thead>
            <tbody>
              {sortedHoldings.map(h => {
                const q=quotes[h.symbol];
                const cmp=q?.ltp;
                const curVal=cmp?h.qty*cmp:null;
                const gl=curVal!==null?curVal-h.totalCost:null;
                const glPct=gl!==null&&h.totalCost>0?(gl/h.totalCost)*100:null;
                const todayGl=q?.change!=null?h.qty*q.change:null;
                const todayGlPct=q?.changePct;
                const days=daysBetween(h.firstDate);
                const glCol=gl===null?'var(--text-muted)':gl>=0?'var(--text-success)':'var(--text-danger)';
                const tdayCol=todayGl===null?'var(--text-muted)':todayGl>=0?'var(--text-success)':'var(--text-danger)';
                return (
                  <tr key={h.symbol+h.exchange} style={{borderBottom:'0.5px solid var(--border)'}}>
                    <td style={{padding:'12px 14px'}}>
                      <div style={{fontWeight:600,fontSize:14,color:'var(--text-primary)',marginBottom:3}}>{h.symbol}</div>
                      <div style={{display:'flex',gap:5,alignItems:'center'}}>
                        <span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:'rgba(99,102,241,0.1)',color:'#818cf8',border:'0.5px solid rgba(99,102,241,0.2)'}}>{h.sector}</span>
                        <span style={{fontSize:10,color:'var(--text-muted)'}}>{h.exchange}</span>
                      </div>
                    </td>
                    <td style={{textAlign:'right',fontFamily:'var(--font-mono)',padding:'12px 14px',color:'var(--text-secondary)',fontSize:13}}>{h.qty}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--font-mono)',padding:'12px 14px',color:'var(--text-secondary)',fontSize:13}}>{fmtINR(h.avgCost)}</td>
                    <td style={{textAlign:'right',padding:'12px 14px'}}>
                      {cmp ? (
                        <>
                          <div style={{fontFamily:'var(--font-mono)',fontWeight:600,color:'var(--text-primary)',fontSize:13}}>{fmtINR(cmp)}</div>
                          {q.changePct!=null && <div style={{fontSize:11,color:q.changePct>=0?'var(--text-success)':'var(--text-danger)',fontFamily:'var(--font-mono)'}}>{fmtPct(q.changePct)}</div>}
                        </>
                      ) : <span style={{color:'var(--text-muted)',fontSize:12}}>{qStatus==='loading'?'...':'—'}</span>}
                    </td>
                    <td style={{textAlign:'right',fontFamily:'var(--font-mono)',padding:'12px 14px',color:'var(--text-secondary)',fontSize:13}}>{fmtINR(h.totalCost,0)}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--font-mono)',padding:'12px 14px',color:'var(--text-secondary)',fontSize:13}}>{curVal!==null?fmtINR(curVal,0):'—'}</td>
                    <td style={{textAlign:'right',padding:'12px 14px'}}>
                      {gl!==null ? (
                        <>
                          <div style={{fontFamily:'var(--font-mono)',fontWeight:600,color:glCol,fontSize:13}}>{gl>=0?'+':'−'}{fmtINR(Math.abs(gl),0)}</div>
                          <div style={{fontSize:11,color:glCol,fontFamily:'var(--font-mono)'}}>{fmtPct(glPct)}</div>
                        </>
                      ) : <span style={{color:'var(--text-muted)'}}>—</span>}
                    </td>
                    <td style={{textAlign:'right',padding:'12px 14px'}}>
                      {todayGl!==null ? (
                        <>
                          <div style={{fontFamily:'var(--font-mono)',fontWeight:600,color:tdayCol,fontSize:13}}>{todayGl>=0?'+':'−'}{fmtINR(Math.abs(todayGl),0)}</div>
                          <div style={{fontSize:11,color:tdayCol,fontFamily:'var(--font-mono)'}}>{todayGlPct!=null?fmtPct(todayGlPct):''}</div>
                        </>
                      ) : <span style={{color:'var(--text-muted)'}}>—</span>}
                    </td>
                    <td style={{textAlign:'right',color:'var(--text-muted)',padding:'12px 14px',fontFamily:'var(--font-mono)',fontSize:12}}>{days>0?days+'d':'—'}</td>
                    <td style={{textAlign:'right',padding:'12px 14px'}}>
                      <button onClick={()=>setModal({type:'tx',prefill:{symbol:h.symbol,exchange:h.exchange,sector:h.sector,type:'SELL'}})} style={{fontSize:11,padding:'3px 10px',borderRadius:'var(--radius)',border:'0.5px solid var(--border-danger)',background:'var(--bg-danger)',color:'var(--text-danger)',cursor:'pointer',whiteSpace:'nowrap'}}>Sell</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr style={{borderTop:'0.5px solid var(--border)',background:'var(--surface-1)'}}>
                <td style={{padding:'10px 14px',fontWeight:600,color:'var(--text-secondary)',fontSize:13}}>Total ({holdings.length})</td>
                <td></td><td></td><td></td>
                <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontWeight:600,padding:'10px 14px',fontSize:13}}>{fmtINR(summary.invested,0)}</td>
                <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontWeight:600,padding:'10px 14px',fontSize:13}}>{fmtINR(summary.currentValue,0)}</td>
                <td style={{textAlign:'right',padding:'10px 14px'}}>
                  <div style={{fontFamily:'var(--font-mono)',fontWeight:700,color:summary.unrealised>=0?'var(--text-success)':'var(--text-danger)',fontSize:13}}>{summary.unrealised>=0?'+':'−'}{fmtINR(Math.abs(summary.unrealised),0)}</div>
                  <div style={{fontSize:11,color:summary.unrealised>=0?'var(--text-success)':'var(--text-danger)',fontFamily:'var(--font-mono)'}}>{fmtPct(summary.returnPct)}</div>
                </td>
                <td style={{textAlign:'right',padding:'10px 14px'}}>
                  <div style={{fontFamily:'var(--font-mono)',fontWeight:700,color:todayGain>=0?'var(--text-success)':'var(--text-danger)',fontSize:13}}>{todayGain>=0?'+':'−'}{fmtINR(Math.abs(todayGain),0)}</div>
                </td>
                <td></td><td></td>
              </tr>
            </tfoot>
          </table>

          {/* Sector allocation */}
          {sectorAlloc.length>0 && (
            <div style={{marginTop:24,paddingTop:20,borderTop:'0.5px solid var(--border)'}}>
              <div style={{fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--text-muted)',marginBottom:12}}>Sector allocation</div>
              <div style={{display:'flex',height:8,borderRadius:6,overflow:'hidden',marginBottom:12,gap:1}}>
                {sectorAlloc.map((s,i)=><div key={s.sector} style={{width:s.pct+'%',background:SECTOR_COLORS[i%SECTOR_COLORS.length],minWidth:2}} title={`${s.sector}: ${s.pct.toFixed(1)}%`}/>)}
              </div>
              <div style={{display:'flex',gap:'8px 20px',flexWrap:'wrap'}}>
                {sectorAlloc.map((s,i)=>(
                  <div key={s.sector} style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{width:8,height:8,borderRadius:2,background:SECTOR_COLORS[i%SECTOR_COLORS.length],display:'inline-block',flexShrink:0}}/>
                    <span style={{fontSize:12,color:'var(--text-secondary)'}}>{s.sector}</span>
                    <span style={{fontSize:12,fontFamily:'var(--font-mono)',color:'var(--text-muted)'}}>{s.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  // ── Transactions Tab ─────────────────────────────────────────────────────────
  const renderTransactions = () => (
    <div>
      {data.transactions.length===0 ? <div style={{textAlign:'center',padding:'60px 0',color:'var(--text-muted)'}}>No transactions yet</div> : (
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead>
            <tr>{['Stock','Type','Qty','Price','Total','Brokerage','Date','Notes',''].map((h,i)=><th key={i} style={{fontSize:10,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--text-muted)',fontWeight:500,padding:'10px 14px',textAlign:i===0||i===8?'left':'right',borderBottom:'0.5px solid var(--border)',background:'var(--surface-1)'}}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {[...data.transactions].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(tx=>(
              <tr key={tx.id} style={{borderBottom:'0.5px solid var(--border)'}}>
                <td style={{padding:'10px 14px'}}><div style={{fontWeight:600,fontSize:13}}>{tx.symbol}</div><div style={{fontSize:10,color:'var(--text-muted)'}}>{tx.exchange}</div></td>
                <td style={{textAlign:'right',padding:'10px 14px'}}><span style={{fontSize:10,fontWeight:600,padding:'2px 7px',borderRadius:4,background:tx.type==='BUY'?'var(--bg-success)':'var(--bg-danger)',color:tx.type==='BUY'?'var(--text-success)':'var(--text-danger)',border:`0.5px solid ${tx.type==='BUY'?'var(--border-success)':'var(--border-danger)'}`}}>{tx.type}</span></td>
                <td style={{textAlign:'right',fontFamily:'var(--font-mono)',padding:'10px 14px'}}>{tx.qty}</td>
                <td style={{textAlign:'right',fontFamily:'var(--font-mono)',padding:'10px 14px'}}>{fmtINR(tx.price)}</td>
                <td style={{textAlign:'right',fontFamily:'var(--font-mono)',padding:'10px 14px'}}>{fmtINR(tx.qty*tx.price)}</td>
                <td style={{textAlign:'right',fontFamily:'var(--font-mono)',padding:'10px 14px',color:'var(--text-muted)'}}>{fmtINR(tx.brokerage||0)}</td>
                <td style={{textAlign:'right',color:'var(--text-muted)',padding:'10px 14px'}}>{tx.date}</td>
                <td style={{textAlign:'right',color:'var(--text-muted)',fontSize:11,padding:'10px 14px',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tx.notes}</td>
                <td style={{padding:'10px 14px'}}><button onClick={()=>{update({transactions:data.transactions.filter(t=>t.id!==tx.id)});showToast({title:'Transaction deleted',message:`${tx.symbol} · ${tx.qty} @ ₹${tx.price}`,type:'error'});}} style={{fontSize:10,padding:'2px 7px',borderRadius:'var(--radius)',border:'0.5px solid var(--border)',background:'none',color:'var(--text-muted)',cursor:'pointer'}}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  // ── Dividends Tab ────────────────────────────────────────────────────────────
  const renderDividends = () => {
    const total=data.dividends.reduce((s,d)=>s+(d.total||0),0);
    const yr=new Date().getFullYear().toString();
    const thisYear=data.dividends.filter(d=>d.exDate?.startsWith(yr)).reduce((s,d)=>s+(d.total||0),0);
    return (
      <div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:24}}>
          {[['Total received',fmtINR(total),'var(--text-success)'],['This year ('+yr+')',fmtINR(thisYear),'var(--text-success)'],['Total entries',data.dividends.length.toString(),'var(--text-primary)']].map(([l,v,c])=>(
            <div key={l} style={{background:'var(--surface-1)',border:'0.5px solid var(--border)',borderRadius:10,padding:'14px 16px'}}>
              <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>{l}</div>
              <div style={{fontSize:20,fontWeight:600,fontFamily:'var(--font-mono)',color:c}}>{v}</div>
            </div>
          ))}
        </div>
        {data.dividends.length===0 ? <div style={{textAlign:'center',padding:'60px 0',color:'var(--text-muted)'}}>No dividends logged yet</div> : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead><tr>{['Stock','Ex-date','Per share','Qty held','Total','Notes',''].map((h,i)=><th key={i} style={{fontSize:10,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--text-muted)',fontWeight:500,padding:'10px 14px',textAlign:i===0||i===6?'left':'right',borderBottom:'0.5px solid var(--border)',background:'var(--surface-1)'}}>{h}</th>)}</tr></thead>
            <tbody>
              {[...data.dividends].sort((a,b)=>new Date(b.exDate)-new Date(a.exDate)).map(d=>(
                <tr key={d.id} style={{borderBottom:'0.5px solid var(--border)'}}>
                  <td style={{padding:'10px 14px',fontWeight:600,fontSize:13}}>{d.symbol}</td>
                  <td style={{textAlign:'right',color:'var(--text-muted)',padding:'10px 14px'}}>{d.exDate}</td>
                  <td style={{textAlign:'right',fontFamily:'var(--font-mono)',padding:'10px 14px'}}>{fmtINR(d.perShare)}</td>
                  <td style={{textAlign:'right',fontFamily:'var(--font-mono)',padding:'10px 14px'}}>{d.qtyHeld}</td>
                  <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontWeight:600,color:'var(--text-success)',padding:'10px 14px'}}>+{fmtINR(d.total)}</td>
                  <td style={{textAlign:'right',color:'var(--text-muted)',fontSize:11,padding:'10px 14px'}}>{d.notes}</td>
                  <td style={{padding:'10px 14px'}}><button onClick={()=>{update({dividends:data.dividends.filter(x=>x.id!==d.id)});showToast({title:'Dividend deleted',message:`${d.symbol} · ₹${(d.total||0).toFixed(2)}`,type:'error'});}} style={{fontSize:10,padding:'2px 7px',borderRadius:'var(--radius)',border:'0.5px solid var(--border)',background:'none',color:'var(--text-muted)',cursor:'pointer'}}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  // ── Watchlist Tab ────────────────────────────────────────────────────────────
  const renderWatchlist = () => (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {data.watchlist.length===0 ? <div style={{textAlign:'center',padding:'60px 0',color:'var(--text-muted)'}}>No stocks on watchlist</div> :
      data.watchlist.map(w=>{
        const q=quotes[w.symbol];const cmp=q?.ltp;
        const pctAway=cmp&&w.targetPrice?((cmp-w.targetPrice)/w.targetPrice)*100:null;
        const progress=cmp&&w.targetPrice?Math.min(100,(cmp/w.targetPrice)*100):null;
        return (
          <div key={w.id} style={{background:'var(--surface-1)',border:'0.5px solid var(--border)',borderRadius:10,padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:16}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:5}}>
                <span style={{fontSize:14,fontWeight:600}}>{w.symbol}</span>
                <span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:'rgba(99,102,241,0.1)',color:'#818cf8',border:'0.5px solid rgba(99,102,241,0.2)'}}>{w.sector}</span>
                <span style={{fontSize:10,color:'var(--text-muted)'}}>{w.exchange}</span>
              </div>
              {w.targetPrice>0 && <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:6}}>Target {fmtINR(w.targetPrice)}{w.notes?` · ${w.notes}`:''}</div>}
              {progress!==null && <>
                <div style={{height:3,borderRadius:2,background:'var(--border)',overflow:'hidden',width:200,marginBottom:4}}><div style={{height:'100%',borderRadius:2,width:progress+'%',background:pctAway>=0?'#818cf8':'var(--fill-success)',transition:'width 0.3s'}}/></div>
                <div style={{fontSize:10,color:'var(--text-muted)'}}>{pctAway>=0?`${pctAway.toFixed(1)}% above target`:`${Math.abs(pctAway).toFixed(1)}% below target`}</div>
              </>}
            </div>
            <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:5,flexShrink:0}}>
              {cmp ? <>
                <span style={{fontFamily:'var(--font-mono)',fontSize:15,fontWeight:600}}>{fmtINR(cmp)}</span>
                {q.changePct!=null && <span style={{fontFamily:'var(--font-mono)',fontSize:11,color:q.changePct>=0?'var(--text-success)':'var(--text-danger)'}}>{fmtPct(q.changePct)}</span>}
              </> : <span style={{fontSize:12,color:'var(--text-muted)'}}>{qStatus==='loading'?'...':'—'}</span>}
              <div style={{display:'flex',gap:6}}>
                <button onClick={()=>setModal({type:'tx',prefill:{symbol:w.symbol,exchange:w.exchange,sector:w.sector,type:'BUY'}})} style={{fontSize:11,padding:'4px 12px',borderRadius:'var(--radius)',border:'none',background:'var(--fill-accent)',color:'var(--on-accent)',cursor:'pointer',fontWeight:500}}>Buy</button>
                <button onClick={()=>{update({watchlist:data.watchlist.filter(x=>x.id!==w.id)});showToast({title:'Removed from watchlist',message:w.symbol,type:'error'});}} style={{fontSize:11,padding:'4px 8px',borderRadius:'var(--radius)',border:'0.5px solid var(--border)',background:'none',color:'var(--text-muted)',cursor:'pointer'}}>✕</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const TABS=[{id:'portfolio',label:'Portfolio'},{id:'transactions',label:'Transactions'},{id:'dividends',label:'Dividends'},{id:'watchlist',label:'Watchlist'}];
  const addLabel={portfolio:'Add transaction',transactions:'Add transaction',dividends:'Log dividend',watchlist:'Add to watchlist'};
  const addAction={portfolio:()=>setModal({type:'tx'}),transactions:()=>setModal({type:'tx'}),dividends:()=>setModal({type:'div'}),watchlist:()=>setModal({type:'wl'})};

  return (
    <div style={{padding:'0 24px 32px',maxWidth:1400,margin:'0 auto',WebkitFontSmoothing:'antialiased',MozOsxFontSmoothing:'grayscale'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',padding:'20px 0 18px'}}>
        <div>
          <div style={{fontSize:22,fontWeight:500,marginBottom:4}}>Stock Portfolio</div>
          <div style={{fontSize:12,color:'var(--text-muted)',display:'flex',gap:10,alignItems:'center'}}>
            <span>{holdings.length} holding{holdings.length!==1?'s':''}</span>
            {qStatus==='loading'&&<><span style={{opacity:.4}}>·</span><span>fetching prices...</span></>}
            {qStatus==='ok'&&lastFetched&&<><span style={{opacity:.4}}>·</span><span>prices at {lastFetched.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</span></>}
            {qStatus==='error'&&<><span style={{opacity:.4}}>·</span><span style={{color:'var(--text-danger)'}}>prices unavailable</span></>}
          </div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={fetchQuotes} disabled={qStatus==='loading'} style={{padding:'7px 13px',borderRadius:'var(--radius)',border:'0.5px solid var(--border-strong)',background:'none',color:'var(--text-secondary)',cursor:'pointer',fontSize:12,opacity:qStatus==='loading'?.5:1}}>⟳ Refresh</button>
          <button onClick={syncBroker} disabled={syncing} style={{padding:'7px 13px',borderRadius:'var(--radius)',border:'0.5px solid var(--border-strong)',background:'none',color:'var(--text-secondary)',cursor:'pointer',fontSize:12,opacity:syncing?.6:1}}>{syncing?'Syncing...':'⇌ Sync broker'}</button>
          <button onClick={addAction[tab]} style={{padding:'8px 16px',borderRadius:'var(--radius)',border:'none',background:'var(--fill-accent)',color:'var(--on-accent)',cursor:'pointer',fontSize:13,fontWeight:500}}>+ {addLabel[tab]}</button>
        </div>
      </div>
      <div style={{display:'flex',borderBottom:'0.5px solid var(--border)',marginBottom:22}}>
        {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{padding:'10px 20px',fontSize:13,fontWeight:500,background:'none',border:'none',borderBottom:`2px solid ${tab===t.id?'var(--fill-accent)':'transparent'}`,color:tab===t.id?'var(--text-primary)':'var(--text-muted)',cursor:'pointer'}}>{t.label}</button>)}
      </div>
      {tab==='portfolio'&&renderPortfolio()}
      {tab==='transactions'&&renderTransactions()}
      {tab==='dividends'&&renderDividends()}
      {tab==='watchlist'&&renderWatchlist()}
      {modal?.type==='tx'&&<TxModal prefill={modal.prefill||null} onClose={()=>setModal(null)} onSave={tx=>{update({transactions:[...data.transactions,tx]});showToast({title:'Transaction added',message:`${tx.type} ${tx.symbol} · ${tx.qty} @ ₹${tx.price}`});}}/>}
      {modal?.type==='div'&&<DivModal holdings={holdings} onClose={()=>setModal(null)} onSave={d=>{update({dividends:[...data.dividends,d]});showToast({title:'Dividend logged',message:`${d.symbol} · ₹${d.total.toFixed(2)}`});}}/>}
      {modal?.type==='wl'&&<WlModal onClose={()=>setModal(null)} onSave={w=>{update({watchlist:[...data.watchlist,w]});showToast({title:'Added to watchlist',message:w.symbol});}}/>}
    </div>
  );
}
