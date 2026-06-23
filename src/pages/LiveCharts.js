import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';

const SERVER = 'http://localhost:5001';

const TIME_PRESETS = ['1m','5m','15m','30m','1hr','1d','Intraday'];

const ALL_CHARTS = [
  { key:'atm_straddle',  label:'Auto ATM Straddle' },
  { key:'oi_options',    label:'Open Interest - Options' },
  { key:'oi_chg',        label:'Open Interest Change - Options' },
  { key:'pcr',           label:'Put-Call Ratio' },
  { key:'max_pain',      label:'Max Pain' },
  { key:'oi_futures',    label:'Open Interest - Futures' },
  { key:'oi_chg_fut',    label:'Open Interest Change - Futures' },
  { key:'option_iv',     label:'Option IV' },
  { key:'indiavix',      label:'INDIAVIX' },
  { key:'ivp',           label:'IV Percentile' },
  { key:'stock_futures', label:'Stock and Futures Prices' },
  { key:'fut_volume',    label:'Futures Volume' },
];

// Default hidden charts (unchecked in Sensibull by default)
const DEFAULT_HIDDEN = new Set(['stock_futures','fut_volume','indiavix','ivp','oi_futures','oi_chg_fut']);

const EXPIRY_COLORS = ['#ef5350','#26a69a','#5c6bc0','#ff7043','#ab47bc','#42a5f5'];

const C = {
  call:'#ef5350', put:'#26a69a', straddle:'#ef8c36',
  pcr:'#212121', pain:'#5c85d6', spot:'#9c59b6',
  atm_iv:'#26c6da', grid:'rgba(0,0,0,0.06)',
};

function fmt(n, dec=2) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e7) return (n/1e7).toFixed(1)+'Cr';
  if (abs >= 1e5) return (n/1e5).toFixed(1)+'L';
  if (abs >= 1e3) return n.toLocaleString('en-IN',{maximumFractionDigits:dec});
  return n.toFixed(dec);
}

// ── Shared tooltip ──────────────────────────────────────────────────────────
function CT({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:8,
      padding:'8px 12px',fontSize:12,minWidth:160,zIndex:100}}>
      <div style={{color:'var(--text-muted)',marginBottom:4}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{display:'flex',justifyContent:'space-between',gap:16,color:p.color,marginTop:2}}>
          <span>{p.name}</span>
          <span style={{fontWeight:600}}>{typeof p.value==='number'?fmt(p.value,2):p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Right-side legend tooltip (always visible like Sensibull) ───────────────
function RightLegend({ ts, items, spot }) {
  if (!ts) return null;
  const d = new Date(ts);
  const dateStr = d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
  const timeStr = d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  return (
    <div style={{position:'absolute',top:8,right:0,fontSize:11,textAlign:'right',
      background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:8,
      padding:'6px 10px',minWidth:160,zIndex:10}}>
      <div style={{color:'var(--text-muted)',marginBottom:4}}>
        {dateStr}, {timeStr} &nbsp;
        <span style={{background:'#444',color:'#fff',borderRadius:3,padding:'1px 5px',fontSize:10}}>EOD Settlement</span>
      </div>
      {items.map((item,i)=>(
        <div key={i} style={{display:'flex',justifyContent:'space-between',gap:12,marginTop:2}}>
          <span style={{color:item.color,display:'flex',alignItems:'center',gap:4}}>
            <span style={{display:'inline-block',width:14,height:2,background:item.color,flexShrink:0,
              ...(item.dashed?{borderTop:'2px dashed '+item.color,background:'none'}:{})}}/>
            {item.label}
          </span>
          <span style={{fontWeight:600,color:'var(--text-primary)'}}>{item.value}</span>
        </div>
      ))}
      {spot!=null && (
        <div style={{display:'flex',justifyContent:'space-between',gap:12,marginTop:2,
          borderTop:'1px solid var(--border)',paddingTop:4}}>
          <span style={{color:C.spot,display:'flex',alignItems:'center',gap:4}}>
            <span style={{display:'inline-block',width:14,height:0,borderTop:'2px dashed '+C.spot}}/>
            NIFTY
          </span>
          <span style={{fontWeight:600,color:C.spot}}>{spot ? fmt(spot,2)+' +0.37%' : '—'}</span>
        </div>
      )}
    </div>
  );
}

// ── Per-chart left sidebar ──────────────────────────────────────────────────
function ChartSidebar({ chartKey, expiries, selectedExpiries, onToggleExpiry,
  strikeFilter, onStrikeFilter, expiryMode, onExpiryMode,
  strikeSelection, onStrikeSelection, currentValue, currentLabel }) {
  return (
    <div style={{width:170,flexShrink:0,borderRight:'1px solid var(--border)',
      padding:'12px 14px',fontSize:12,color:'var(--text-primary)'}}>

      {/* Current value badge */}
      {currentValue && (
        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,color:'var(--text-muted)'}}>Current Value</div>
          <div style={{fontSize:15,fontWeight:700,color:'var(--text-primary)'}}>{currentValue}</div>
          {currentLabel && <div style={{fontSize:11,color:'var(--text-muted)'}}>{currentLabel}</div>}
        </div>
      )}

      {/* Expiry mode (Automatic/Manual) for PCR, MaxPain, IV */}
      {['pcr','max_pain','option_iv','ivp'].includes(chartKey) && (
        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:4}}>Expiry Selection</div>
          {['Automatic','Manual'].map(m=>(
            <label key={m} style={{display:'flex',alignItems:'center',gap:5,cursor:'pointer',marginBottom:3}}>
              <input type="radio" name={`mode_${chartKey}`} checked={expiryMode===m}
                onChange={()=>onExpiryMode(m)} style={{accentColor:'var(--accent)'}}/>
              <span>{m}</span>
            </label>
          ))}
        </div>
      )}

      {/* Expiry checkboxes */}
      {!['option_iv','indiavix','ivp'].includes(chartKey) && (
        <div style={{marginBottom:10}}>
          {['pcr','max_pain'].includes(chartKey)
            ? <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:4}}>
                {expiryMode==='Manual' ? 'Expiries Included' : ''}
              </div>
            : <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:4}}>Expiries Included</div>
          }
          {expiries.map((exp,i)=>(
            <label key={exp} style={{display:'flex',alignItems:'center',gap:5,cursor:'pointer',marginBottom:3}}>
              <input type="checkbox" checked={selectedExpiries.has(exp)}
                onChange={()=>onToggleExpiry(exp)}
                style={{accentColor:EXPIRY_COLORS[i%EXPIRY_COLORS.length]}}/>
              <span style={{color:EXPIRY_COLORS[i%EXPIRY_COLORS.length]}}>{exp}</span>
            </label>
          ))}
        </div>
      )}

      {/* ATM strike selection for Option IV */}
      {chartKey==='option_iv' && (
        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:4}}>Selection</div>
          {['ATM Strike','Custom'].map(s=>(
            <label key={s} style={{display:'flex',alignItems:'center',gap:5,cursor:'pointer',marginBottom:3}}>
              <input type="radio" name="iv_sel" checked={strikeSelection===s}
                onChange={()=>onStrikeSelection(s)} style={{accentColor:'var(--accent)'}}/>
              <span>{s}</span>
            </label>
          ))}
        </div>
      )}

      {/* Show stock price checkbox */}
      <label style={{display:'flex',alignItems:'center',gap:5,cursor:'pointer',marginBottom:10}}>
        <input type="checkbox" defaultChecked style={{accentColor:'var(--accent)'}}/>
        <span style={{fontSize:11,color:'var(--text-muted)'}}>Show Stock Price</span>
        <span style={{fontSize:11,fontWeight:600,color:'var(--text-muted)'}}>NIFTY</span>
      </label>

      {/* Strikes filter */}
      {['oi_options','oi_chg','pcr'].includes(chartKey) && (
        <div>
          <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:4}}>
            <span style={{fontSize:11,color:'var(--text-muted)'}}>Strikes above/below ATM</span>
            <select value={strikeFilter} onChange={e=>onStrikeFilter(e.target.value)}
              style={{fontSize:11,border:'1px solid var(--border)',borderRadius:4,
                background:'var(--bg-card2)',color:'var(--text-primary)',padding:'2px 4px',cursor:'pointer'}}>
              <option value="All">All</option>
              <option value="5">±5</option>
              <option value="10">±10</option>
              <option value="15">±15</option>
              <option value="20">±20</option>
            </select>
          </div>
          <div style={{fontSize:11,color:'var(--text-muted)'}}>Strike Range 17850 - 29400</div>
          <div style={{fontSize:11,color:'var(--accent)',cursor:'pointer',marginTop:2}}>Choose Custom Strikes</div>
        </div>
      )}
    </div>
  );
}

// ── Chart panel wrapper ─────────────────────────────────────────────────────
function ChartPanel({ chartKey, title, children, sidebar, onClose, height=220 }) {
  return (
    <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:0,
      borderBottom:'1px solid var(--border)',display:'flex',overflow:'hidden'}}>
      {/* Left sidebar */}
      {sidebar}
      {/* Chart area */}
      <div style={{flex:1,minWidth:0,position:'relative',padding:'8px 0 8px 0'}}>
        <div style={{position:'absolute',top:8,left:12,zIndex:5,display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:12,fontWeight:600,color:'var(--text-primary)'}}>{title}</span>
          <span style={{fontSize:11,color:'var(--text-muted)',cursor:'pointer'}}>ⓘ</span>
        </div>
        <button onClick={onClose} style={{position:'absolute',top:6,right:8,zIndex:5,
          background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:16,padding:'0 4px'}}>×</button>
        <div style={{marginTop:24,height}}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Settings panel ──────────────────────────────────────────────────────────
function SettingsPanel({ visible, chartOrder, hiddenCharts, onToggle, onClose, onReorder }) {
  if (!visible) return null;
  return (
    <div style={{position:'fixed',inset:0,zIndex:999,background:'rgba(0,0,0,0.3)'}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()}
        style={{position:'absolute',top:60,right:16,background:'var(--bg-card)',
          border:'1px solid var(--border)',borderRadius:12,width:340,
          padding:'20px',maxHeight:'80vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <span style={{fontSize:15,fontWeight:600}}>Settings</span>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',
            fontSize:20,color:'var(--text-muted)'}}>×</button>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
          <span style={{fontSize:12,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Chart Order</span>
          <span style={{fontSize:12,color:'var(--accent)',cursor:'pointer'}}
            onClick={()=>onReorder(ALL_CHARTS.map(c=>c.key))}>Reset Order</span>
        </div>
        <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12}}>
          Drag to reorder charts, toggle checkbox to hide / show charts
        </div>
        {chartOrder.map(key=>{
          const chart = ALL_CHARTS.find(c=>c.key===key);
          if (!chart) return null;
          return (
            <div key={key} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',
              background:'var(--bg-card2)',borderRadius:8,marginBottom:6,border:'0.5px solid var(--border)'}}>
              <input type="checkbox" checked={!hiddenCharts.has(key)}
                onChange={()=>onToggle(key)}
                style={{width:16,height:16,accentColor:'var(--accent)',cursor:'pointer'}}/>
              <span style={{flex:1,fontSize:13,color:'var(--text-primary)'}}>{chart.label}</span>
              <span style={{color:'var(--text-muted)',fontSize:16,cursor:'grab'}}>⇅</span>
            </div>
          );
        })}
        <button onClick={onClose} style={{width:'100%',marginTop:12,padding:'10px',
          background:'var(--accent)',border:'none',borderRadius:8,
          color:'#fff',fontWeight:600,fontSize:14,cursor:'pointer'}}>Save</button>
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function LiveCharts() {
  const [instrument, setInstrument] = useState('NIFTY');
  const [snaps, setSnaps]           = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [marketOpen, setMarketOpen] = useState(false);
  const [timePreset, setTimePreset] = useState('1d');
  // Range navigator: indices into snaps[] — null means use full range
  const [rangeStart, setRangeStart] = useState(null);
  const [rangeEnd,   setRangeEnd]   = useState(null);
  const navRef = useRef(null);
  const isDragging = useRef(null); // 'start' | 'end' | 'window'
  const dragAnchor = useRef(null);
  const [showSettings, setShowSettings] = useState(false);
  const [chartOrder, setChartOrder] = useState(ALL_CHARTS.map(c=>c.key));
  const [hiddenCharts, setHiddenCharts] = useState(new Set(DEFAULT_HIDDEN));

  // Per-chart state
  const allExpiries = ['23 Jun','30 Jun','07 Jul','14 Jul','21 Jul','28 Jul'];
  const [selectedExpiries, setSelectedExpiries] = useState({
    oi_options:   new Set(['23 Jun']),
    oi_chg:       new Set(['23 Jun']),
    atm_straddle: new Set(['23 Jun']),
    pcr:          new Set(['23 Jun']),
    max_pain:     new Set(['23 Jun']),
    oi_futures:   new Set(['30 Jun']),
    oi_chg_fut:   new Set(['30 Jun']),
  });
  const [strikeFilter, setStrikeFilter]         = useState('All');
  const [expiryModes, setExpiryModes]           = useState({pcr:'Manual',max_pain:'Manual',option_iv:'Automatic',ivp:'Automatic'});
  const [strikeSelection, setStrikeSelection]   = useState('ATM Strike');
  const pollRef = useRef(null);

  const load = useCallback(async (silent=false) => {
    if (!silent) setLoading(true);
    try {
      const r = await fetch(`${SERVER}/live-charts/data?instrument=${instrument}`);
      const d = await r.json();
      if (d.success) { setSnaps(d.snapshots||[]); setMarketOpen(d.market_open); setError(''); }
      else setError(d.error||'Failed to load');
    } catch { setError('Server not running — start server.py'); }
    if (!silent) setLoading(false);
  }, [instrument]);

  useEffect(()=>{
    load();
    pollRef.current = setInterval(()=>load(true), 30000);
    return ()=>clearInterval(pollRef.current);
  },[load]);

  // When snaps update, reset range to full
  useEffect(()=>{
    if (snaps.length) { setRangeStart(0); setRangeEnd(snaps.length-1); }
  }, [snaps.length]);

  // When time preset changes, compute rangeStart from it
  useEffect(()=>{
    if (!snaps.length) return;
    const presets = {'1m':1,'5m':5,'15m':15,'30m':30,'1hr':60};
    const mins = presets[timePreset];
    if (!mins) { setRangeStart(0); setRangeEnd(snaps.length-1); return; }
    const cutoff = new Date(Date.now()-mins*60000).toISOString();
    const idx = snaps.findIndex(s=>s.ts>=cutoff);
    setRangeStart(idx<0?0:idx);
    setRangeEnd(snaps.length-1);
  }, [timePreset, snaps.length]);

  const rs = rangeStart??0;
  const re = rangeEnd??(snaps.length-1);
  const filtered = useMemo(()=>snaps.slice(rs, re+1), [snaps, rs, re]);

  // ── Navigator drag logic ──────────────────────────────────────────────────
  const navPxToIdx = useCallback((clientX)=>{
    if (!navRef.current || !snaps.length) return 0;
    const rect = navRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(pct * (snaps.length-1));
  }, [snaps.length]);

  const onNavMouseDown = useCallback((e, handle)=>{
    e.preventDefault();
    isDragging.current = handle;
    dragAnchor.current = { x: e.clientX, rs, re };
    const onMove = (ev)=>{
      const idx = navPxToIdx(ev.clientX);
      if (isDragging.current==='start') {
        setRangeStart(Math.min(idx, re-1));
      } else if (isDragging.current==='end') {
        setRangeEnd(Math.max(idx, rs+1));
      } else if (isDragging.current==='window') {
        const delta = Math.round(((ev.clientX - dragAnchor.current.x) / navRef.current.getBoundingClientRect().width) * (snaps.length-1));
        const newS = Math.max(0, Math.min(snaps.length-2, dragAnchor.current.rs+delta));
        const span = dragAnchor.current.re - dragAnchor.current.rs;
        setRangeStart(newS);
        setRangeEnd(Math.min(snaps.length-1, newS+span));
      }
    };
    const onUp = ()=>{
      isDragging.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [rs, re, navPxToIdx, snaps.length]);

  const last = filtered[filtered.length-1]||null;

  const toggleExpiry = (chartKey, exp) => {
    setSelectedExpiries(prev=>{
      const next = {...prev};
      const s = new Set(next[chartKey]||[]);
      s.has(exp) ? s.delete(exp) : s.add(exp);
      next[chartKey] = s;
      return next;
    });
  };

  const toggleChart = (key) => {
    setHiddenCharts(prev=>{
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const pollNow = async ()=>{
    setLoading(true);
    try {
      await Promise.all(['NIFTY','BANKNIFTY','FINNIFTY'].map(inst=>
        fetch(`${SERVER}/live-charts/poll-now`,{method:'POST',
          headers:{'Content-Type':'application/json'},body:JSON.stringify({instrument:inst})})
      ));
      await load(true);
    } catch { setError('Server not reachable'); }
    setLoading(false);
  };

  const clearAndRefresh = async ()=>{
    setLoading(true);
    try {
      // Wipe stored snapshots for current instrument then re-poll
      await fetch(`${SERVER}/live-charts/clear`,{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({instrument})});
      await fetch(`${SERVER}/live-charts/poll-now`,{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({instrument})});
      await load(true);
    } catch { setError('Server not reachable'); }
    setLoading(false);
  };

  // Shared chart props
  const xP = { dataKey:'ts_label', tick:{fontSize:11,fill:'var(--text-muted)'}, tickLine:false, axisLine:false, interval:'preserveStartEnd' };
  const yP = (fn) => ({ tick:{fontSize:11,fill:'var(--text-muted)'}, tickFormatter:fn||fmt, tickLine:false, axisLine:false, width:68 });
  const gP = { stroke:'var(--border)', strokeDasharray:'3 3' };
  // When only 1 datapoint exists recharts won't draw a line — render a dot so chart isn't blank
  const dotCfg = (color) => filtered.length <= 1 ? { r:5, fill:color, strokeWidth:0 } : false;

  // ── Render individual charts ────────────────────────────────────────────
  const renderChart = (key) => {
    if (hiddenCharts.has(key)) return null;
    const chart = ALL_CHARTS.find(c=>c.key===key);
    if (!chart) return null;
    const close = ()=>toggleChart(key);
    const expForChart = selectedExpiries[key]||new Set();

    const sidebar = (
      <ChartSidebar
        chartKey={key}
        expiries={allExpiries}
        selectedExpiries={expForChart}
        onToggleExpiry={(exp)=>toggleExpiry(key,exp)}
        strikeFilter={strikeFilter}
        onStrikeFilter={setStrikeFilter}
        expiryMode={expiryModes[key]||'Manual'}
        onExpiryMode={(m)=>setExpiryModes(p=>({...p,[key]:m}))}
        strikeSelection={strikeSelection}
        onStrikeSelection={setStrikeSelection}
        currentValue={key==='pcr'?(last?.pcr?.toFixed(2)||'—')
          :key==='max_pain'?(last?.max_pain?fmt(last.max_pain,0):'—')
          :key==='option_iv'?(last?.atm_iv?last.atm_iv+'%':'—')
          :key==='atm_straddle'?(last?.straddle?fmt(last.straddle,0):'—')
          :null}
        currentLabel={key==='atm_straddle'&&last?`(${last.atm_strike} ${last.expiry})`:null}
      />
    );

    switch(key) {

      case 'atm_straddle': return (
        <ChartPanel key={key} chartKey={key} title="Auto ATM Straddle" sidebar={sidebar} onClose={close}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={filtered} margin={{left:8,right:180,top:4,bottom:4}}>
              <CartesianGrid {...gP}/>
              <XAxis {...xP}/>
              <YAxis {...yP()} yAxisId="l"/>
              <YAxis {...yP(v=>fmt(v,0))} yAxisId="r" orientation="right" width={0}/>
              <Tooltip content={<CT/>}/>
              <Line yAxisId="l" type="monotone" dataKey="straddle" name="ATM Straddle" stroke={C.straddle} dot={dotCfg(C.straddle)} strokeWidth={2} connectNulls/>
              <Line yAxisId="r" type="monotone" dataKey="spot" name="NIFTY" stroke={C.spot} dot={dotCfg(C.spot)} strokeWidth={1.5} strokeDasharray="5 3" connectNulls/>
            </LineChart>
          </ResponsiveContainer>
          <div style={{position:'absolute',top:8,right:8}}>
            <RightLegend ts={last?.ts} spot={last?.spot}
              items={[{label:`23 Jun Auto ATM Straddle`,color:C.straddle,value:last?.straddle?fmt(last.straddle,0):'—'}]}/>
          </div>
        </ChartPanel>
      );

      case 'oi_options': return (
        <ChartPanel key={key} chartKey={key} title="Open Interest — Options" sidebar={sidebar} onClose={close}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={filtered} margin={{left:8,right:180,top:4,bottom:4}}>
              <CartesianGrid {...gP}/>
              <XAxis {...xP}/>
              <YAxis {...yP(fmt)} yAxisId="l"/>
              <YAxis {...yP(v=>fmt(v,0))} yAxisId="r" orientation="right" width={0}/>
              <Tooltip content={<CT/>}/>
              <Line yAxisId="l" type="monotone" dataKey="call_oi" name="Call OI" stroke={C.call} dot={dotCfg(C.call)} strokeWidth={2} connectNulls/>
              <Line yAxisId="l" type="monotone" dataKey="put_oi"  name="Put OI"  stroke={C.put}  dot={dotCfg(C.put)} strokeWidth={2} connectNulls/>
              <Line yAxisId="r" type="monotone" dataKey="spot" name="NIFTY" stroke={C.spot} dot={dotCfg(C.spot)} strokeWidth={1.5} strokeDasharray="5 3" connectNulls/>
            </LineChart>
          </ResponsiveContainer>
          <div style={{position:'absolute',top:8,right:8}}>
            <RightLegend ts={last?.ts} spot={last?.spot} items={[
              {label:'Call OI',color:C.call,value:last?.call_oi?fmt(last.call_oi):'—'},
              {label:'Put OI', color:C.put, value:last?.put_oi?fmt(last.put_oi):'—'},
            ]}/>
          </div>
        </ChartPanel>
      );

      case 'oi_chg': return (
        <ChartPanel key={key} chartKey={key} title="Open Interest Change — Options" sidebar={sidebar} onClose={close}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filtered} margin={{left:8,right:180,top:4,bottom:4}} barCategoryGap="30%">
              <CartesianGrid {...gP}/>
              <XAxis {...xP}/>
              <YAxis {...yP(fmt)} yAxisId="l"/>
              <YAxis {...yP(v=>fmt(v,0))} yAxisId="r" orientation="right" width={0}/>
              <Tooltip content={<CT/>}/>
              <ReferenceLine yAxisId="l" y={0} stroke="var(--text-muted)" strokeOpacity={0.4}/>
              <Bar yAxisId="l" dataKey="call_oi_chg" name="Call OI Chg" fill={C.call} opacity={0.75}/>
              <Bar yAxisId="l" dataKey="put_oi_chg"  name="Put OI Chg"  fill={C.put}  opacity={0.75}/>
              <Line yAxisId="r" type="monotone" dataKey="spot" name="NIFTY" stroke={C.spot} dot={dotCfg(C.spot)} strokeWidth={1.5} strokeDasharray="5 3" connectNulls/>
          </ResponsiveContainer>
          <div style={{position:'absolute',top:8,right:8}}>
            <RightLegend ts={last?.ts} spot={last?.spot} items={[
              {label:'Call OI Chg',color:C.call,value:last?.call_oi_chg?fmt(last.call_oi_chg):'—'},
              {label:'Put OI Chg', color:C.put, value:last?.put_oi_chg?fmt(last.put_oi_chg):'—'},
            ]}/>
          </div>
        </ChartPanel>
      );

      case 'pcr': return (
        <ChartPanel key={key} chartKey={key} title="Put-Call Ratio" sidebar={sidebar} onClose={close}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={filtered} margin={{left:8,right:180,top:4,bottom:4}}>
              <CartesianGrid {...gP}/>
              <XAxis {...xP}/>
              <YAxis {...yP(v=>v.toFixed(2))} yAxisId="l" domain={['auto','auto']}/>
              <YAxis {...yP(v=>fmt(v,0))} yAxisId="r" orientation="right" width={0}/>
              <Tooltip content={<CT/>}/>
              <ReferenceLine yAxisId="l" y={1} stroke="var(--text-muted)" strokeDasharray="4 2"/>
              <Line yAxisId="l" type="monotone" dataKey="pcr" name="PCR" stroke={C.pcr} dot={dotCfg(C.pcr)} strokeWidth={2} connectNulls/>
              <Line yAxisId="r" type="monotone" dataKey="spot" name="NIFTY" stroke={C.spot} dot={dotCfg(C.spot)} strokeWidth={1.5} strokeDasharray="5 3" connectNulls/>
            </LineChart>
          </ResponsiveContainer>
          <div style={{position:'absolute',top:8,right:8}}>
            <RightLegend ts={last?.ts} spot={last?.spot} items={[
              {label:'PCR',color:C.pcr,value:last?.pcr?.toFixed(2)||'—'},
            ]}/>
          </div>
        </ChartPanel>
      );

      case 'max_pain': return (
        <ChartPanel key={key} chartKey={key} title="Max Pain" sidebar={sidebar} onClose={close}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={filtered} margin={{left:8,right:180,top:4,bottom:4}}>
              <CartesianGrid {...gP}/>
              <XAxis {...xP}/>
              <YAxis {...yP(v=>fmt(v,0))} yAxisId="l" domain={['auto','auto']}/>
              <YAxis {...yP(v=>fmt(v,0))} yAxisId="r" orientation="right" width={0}/>
              <Tooltip content={<CT/>}/>
              <Line yAxisId="l" type="monotone" dataKey="max_pain" name="Max Pain" stroke={C.pain} dot={dotCfg(C.pain)} strokeWidth={2} connectNulls/>
              <Line yAxisId="r" type="monotone" dataKey="spot" name="NIFTY" stroke={C.spot} dot={dotCfg(C.spot)} strokeWidth={1.5} strokeDasharray="5 3" connectNulls/>
            </LineChart>
          </ResponsiveContainer>
          <div style={{position:'absolute',top:8,right:8}}>
            <RightLegend ts={last?.ts} spot={last?.spot} items={[
              {label:'Max Pain',color:C.pain,value:last?.max_pain?fmt(last.max_pain,0):'—'},
            ]}/>
          </div>
        </ChartPanel>
      );

      case 'option_iv': return (
        <ChartPanel key={key} chartKey={key} title="Option IV" sidebar={sidebar} onClose={close}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={filtered} margin={{left:8,right:180,top:4,bottom:4}}>
              <CartesianGrid {...gP}/>
              <XAxis {...xP}/>
              <YAxis {...yP(v=>v.toFixed(1)+'%')} yAxisId="l" domain={['auto','auto']}/>
              <YAxis {...yP(v=>fmt(v,0))} yAxisId="r" orientation="right" width={0}/>
              <Tooltip content={<CT/>}/>
              <Line yAxisId="l" type="monotone" dataKey="atm_iv" name="ATM IV" stroke={C.atm_iv} dot={dotCfg(C.atm_iv)} strokeWidth={2} connectNulls/>
              <Line yAxisId="r" type="monotone" dataKey="spot" name="NIFTY" stroke={C.spot} dot={dotCfg(C.spot)} strokeWidth={1.5} strokeDasharray="5 3" connectNulls/>
            </LineChart>
          </ResponsiveContainer>
          <div style={{position:'absolute',top:8,right:8}}>
            <RightLegend ts={last?.ts} spot={last?.spot} items={[
              {label:'ATM IV',color:C.atm_iv,value:last?.atm_iv?(last.atm_iv.toFixed(1)):'—'},
            ]}/>
          </div>
        </ChartPanel>
      );

      // Stub charts for not-yet-built ones
      default: return (
        <ChartPanel key={key} chartKey={key} title={chart.label} sidebar={<div style={{width:170,borderRight:'1px solid var(--border)',padding:'12px 14px',fontSize:12,color:'var(--text-muted)'}}>Coming soon</div>} onClose={close}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'var(--text-muted)',fontSize:13}}>
            Data collection in progress — available after server accumulates history
          </div>
        </ChartPanel>
      );
    }
  };

  const visibleCharts = chartOrder.filter(k=>!hiddenCharts.has(k));

  return (
    <div style={{maxWidth:1400,margin:'0 auto'}}>
      <div style={{marginBottom:14}}>
        <div className="page-title">Live Options Charts</div>
        <div className="page-subtitle">Predict market direction with real-time options data — polls NSE every 3 minutes</div>
      </div>

      {/* ── Top control bar ──────────────────────────────────────────────── */}
      <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px 12px 0 0',
        padding:'8px 16px',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>

        {/* Instrument */}
        <select value={instrument} onChange={e=>setInstrument(e.target.value)}
          style={{background:'var(--bg-card2)',border:'1px solid var(--border)',borderRadius:8,
            color:'var(--text-primary)',fontSize:13,fontWeight:700,padding:'5px 12px',cursor:'pointer',outline:'none'}}>
          {['NIFTY','BANKNIFTY','FINNIFTY'].map(i=><option key={i}>{i}</option>)}
        </select>

        {/* Time presets */}
        <div style={{display:'flex',gap:1,background:'var(--bg-card2)',borderRadius:8,padding:2,border:'1px solid var(--border)'}}>
          {TIME_PRESETS.map(p=>(
            <button key={p} onClick={()=>setTimePreset(p)}
              style={{padding:'4px 10px',borderRadius:6,border:'none',cursor:'pointer',fontSize:12,fontWeight:500,
                background:timePreset===p?'var(--accent)':'transparent',
                color:timePreset===p?'#fff':'var(--text-muted)',transition:'all 0.1s'}}>
              {p}
            </button>
          ))}
        </div>

        {/* ── Range navigator (mini chart + draggable selection) ── */}
        <div ref={navRef} style={{flex:1,height:32,position:'relative',cursor:'crosshair',userSelect:'none'}}
          onMouseDown={(e)=>onNavMouseDown(e,'window')}>
          {/* Full sparkline background */}
          {snaps.length>1&&(()=>{
            const minV = Math.min(...snaps.map(s=>s.spot));
            const maxV = Math.max(...snaps.map(s=>s.spot));
            const range = maxV-minV||1;
            const pts = snaps.map((s,i)=>{
              const x = (i/(snaps.length-1))*100;
              const y = 28-(((s.spot-minV)/range)*22);
              return `${x},${y}`;
            }).join(' ');
            return (
              <svg width="100%" height="32" style={{position:'absolute',inset:0}} preserveAspectRatio="none">
                <polyline points={pts} fill="none" stroke={C.spot} strokeWidth={1.5} opacity={0.4}/>
              </svg>
            );
          })()}
          {/* Shaded selection window */}
          {snaps.length>0&&(()=>{
            const startPct = (rs/(snaps.length-1||1))*100;
            const endPct   = (re/(snaps.length-1||1))*100;
            return (
              <div style={{position:'absolute',top:0,bottom:0,
                left:startPct+'%', width:(endPct-startPct)+'%',
                background:'rgba(59,130,246,0.15)',border:'1px solid rgba(59,130,246,0.5)',
                boxSizing:'border-box'}}>
                {/* Selected range sparkline — brighter */}
                <svg width="100%" height="32" style={{position:'absolute',inset:0}} preserveAspectRatio="none">
                  {filtered.length>1&&(()=>{
                    const minV = Math.min(...filtered.map(s=>s.spot));
                    const maxV = Math.max(...filtered.map(s=>s.spot));
                    const range = maxV-minV||1;
                    const pts = filtered.map((s,i)=>{
                      const x = (i/(filtered.length-1))*100;
                      const y = 28-(((s.spot-minV)/range)*22);
                      return `${x},${y}`;
                    }).join(' ');
                    return <polyline points={pts} fill="none" stroke={C.spot} strokeWidth={2}/>;
                  })()}
                </svg>
                {/* Left handle */}
                <div onMouseDown={e=>{e.stopPropagation();onNavMouseDown(e,'start');}}
                  style={{position:'absolute',left:-4,top:0,bottom:0,width:8,cursor:'ew-resize',
                    background:'rgba(59,130,246,0.8)',borderRadius:'3px 0 0 3px'}}/>
                {/* Right handle */}
                <div onMouseDown={e=>{e.stopPropagation();onNavMouseDown(e,'end');}}
                  style={{position:'absolute',right:-4,top:0,bottom:0,width:8,cursor:'ew-resize',
                    background:'rgba(59,130,246,0.8)',borderRadius:'0 3px 3px 0'}}/>
              </div>
            );
          })()}
          {snaps.length===0&&(
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',
              fontSize:11,color:'var(--text-muted)'}}>No data</div>
          )}
        </div>

        {/* Market status */}
        <span style={{display:'flex',alignItems:'center',gap:5,fontSize:12,
          color:marketOpen?'var(--profit)':'#FFA53D',whiteSpace:'nowrap'}}>
          <span style={{width:7,height:7,borderRadius:'50%',flexShrink:0,
            background:marketOpen?'var(--profit)':'#FFA53D'}}/>
          {marketOpen?'Market live':'EOD Settlement'}
          {last&&<span style={{marginLeft:4,color:'var(--text-muted)'}}>{fmt(last.spot,2)}</span>}
        </span>

        <button onClick={pollNow} disabled={loading}
          style={{background:'var(--bg-card2)',border:'1px solid var(--border)',borderRadius:8,
            color:'var(--text-muted)',fontSize:12,padding:'5px 12px',cursor:'pointer',
            display:'flex',alignItems:'center',gap:5,opacity:loading?0.5:1,whiteSpace:'nowrap'}}>
          {loading?<span style={{display:'inline-block',width:10,height:10,borderRadius:'50%',
            border:'2px solid var(--accent)',borderTopColor:'transparent',animation:'spin 0.7s linear infinite'}}/>:'↻'} Refresh
        </button>

        <button onClick={clearAndRefresh} disabled={loading}
          style={{background:'var(--bg-card2)',border:'1px solid rgba(239,68,68,0.4)',borderRadius:8,
            color:'var(--loss)',fontSize:12,padding:'5px 12px',cursor:'pointer',
            opacity:loading?0.5:1,whiteSpace:'nowrap'}} title="Wipe stored snapshots and fetch fresh data">
          ✕ Clear & Refresh
        </button>

        <button onClick={()=>setShowSettings(s=>!s)}
          style={{background:showSettings?'rgba(59,130,246,0.12)':'var(--bg-card2)',
            border:`1px solid ${showSettings?'var(--accent)':'var(--border)'}`,
            borderRadius:8,color:showSettings?'var(--accent)':'var(--text-muted)',
            fontSize:12,padding:'5px 12px',cursor:'pointer',whiteSpace:'nowrap'}}>
          ⚙ Settings
        </button>
      </div>

      <SettingsPanel visible={showSettings} chartOrder={chartOrder} hiddenCharts={hiddenCharts}
        onToggle={toggleChart} onClose={()=>setShowSettings(false)} onReorder={setChartOrder}/>

      {error&&(
        <div style={{background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',
          borderRadius:10,padding:'12px 16px',margin:'10px 0',color:'var(--loss)',fontSize:13}}>
          {error}
        </div>
      )}

      {/* Charts */}
      {snaps.length===0&&!loading&&!error&&(
        <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'0 0 12px 12px',
          padding:'48px 24px',textAlign:'center',color:'var(--text-muted)'}}>
          <div style={{fontSize:32,marginBottom:12}}>📊</div>
          <div style={{fontSize:15,fontWeight:600,marginBottom:8,color:'var(--text-primary)'}}>No data yet</div>
          <div style={{fontSize:13,marginBottom:16}}>
            Server polls NSE every 3 minutes during market hours (9:15 AM – 3:30 PM IST).<br/>
            Click below to fetch the first snapshot immediately.
          </div>
          <button onClick={pollNow} style={{background:'var(--accent)',border:'none',borderRadius:8,
            color:'#fff',fontWeight:600,fontSize:14,padding:'10px 24px',cursor:'pointer'}}>
            Fetch now
          </button>
        </div>
      )}

      {snaps.length>0&&(
        <div style={{border:'1px solid var(--border)',borderTop:'none',borderRadius:'0 0 12px 12px',overflow:'hidden'}}>
          {visibleCharts.map(key=>renderChart(key))}
          {visibleCharts.length===0&&(
            <div style={{padding:'32px',textAlign:'center',color:'var(--text-muted)',fontSize:13,
              background:'var(--bg-card)'}}>
              All charts hidden — open Settings to show them.
            </div>
          )}
        </div>
      )}

      {/* ── Bottom date/time scale bar (matches Sensibull) ───────────────── */}
      {snaps.length>0&&(
        <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:12,
          marginTop:8,padding:'8px 16px',display:'flex',alignItems:'center',gap:8}}>
          {/* Jump to start */}
          <button onClick={()=>{setRangeStart(0);setRangeEnd(snaps.length-1);}}
            style={{background:'none',border:'1px solid var(--border)',borderRadius:6,
              padding:'3px 8px',cursor:'pointer',color:'var(--text-muted)',fontSize:13,lineHeight:1}}>⏮</button>

          {/* Time axis labels across the selected range */}
          <div style={{flex:1,position:'relative',height:20}}>
            {/* Tick marks at even intervals */}
            {filtered.length>0&&[0,0.25,0.5,0.75,1].map((pct,i)=>{
              const idx = Math.min(filtered.length-1, Math.round(pct*(filtered.length-1)));
              const snap = filtered[idx];
              if (!snap) return null;
              return (
                <span key={i} style={{position:'absolute',left:(pct*100)+'%',transform:'translateX(-50%)',
                  fontSize:11,color:'var(--text-muted)',whiteSpace:'nowrap'}}>
                  {snap.ts_label}
                </span>
              );
            })}
          </div>

          {/* Jump to end */}
          <button onClick={()=>{setRangeStart(snaps.length>10?snaps.length-10:0);setRangeEnd(snaps.length-1);}}
            style={{background:'none',border:'1px solid var(--border)',borderRadius:6,
              padding:'3px 8px',cursor:'pointer',color:'var(--text-muted)',fontSize:13,lineHeight:1}}>⏭</button>

          {/* Selected range summary */}
          <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--text-muted)',
            background:'var(--bg-card2)',borderRadius:6,padding:'3px 10px',whiteSpace:'nowrap'}}>
            {filtered[0]&&(
              <span>{new Date(filtered[0].ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})},
                &nbsp;{filtered[0].ts_label}
              </span>
            )}
            {filtered.length>1&&<span style={{opacity:0.4}}>→</span>}
            {filtered[filtered.length-1]&&(
              <span style={{fontWeight:600,color:'var(--text-primary)'}}>
                {new Date(filtered[filtered.length-1].ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})},
                &nbsp;{filtered[filtered.length-1].ts_label}
              </span>
            )}
          </div>

          <span style={{fontSize:11,color:'var(--text-muted)',whiteSpace:'nowrap'}}>
            {filtered.length}/{snaps.length} snaps
          </span>
        </div>
      )}
    </div>
  );
}
