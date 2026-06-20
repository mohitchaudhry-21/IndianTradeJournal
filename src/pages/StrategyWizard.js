import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { payoffAt, positionGreeks, findBreakevens, calibrateLegsIV } from '../utils/optionsAnalysis';
import { fetchOptionChain, fetchAngelOneLtp, fetchExpiryList, fetchEodChain } from '../utils/optionChain';
import { STRATEGY_TEMPLATES, getBadge } from '../utils/strategyTemplates';
import { isMarketOpen } from '../utils/marketHours';

const R = 0.065;
const LOT = { NIFTY:75, BANKNIFTY:30, FINNIFTY:65, MIDCPNIFTY:120, SENSEX:20, BANKEX:30 };
const getLotSize = i => LOT[i?.toUpperCase()] || 75;

function fmtK(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '-' : '+';
  if (a >= 100000) return s + '₹' + (a/100000).toFixed(2) + 'L';
  if (a >= 1000)   return s + '₹' + (a/1000).toFixed(1) + 'k';
  return s + '₹' + a.toFixed(0);
}
function fmtCapital(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 100000) return '₹' + (n/100000).toFixed(2) + 'L';
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
function fmtPct(n) { return !Number.isFinite(n) ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }

// Parse AngelOne expiry string to Date (15:30 IST)
function angelToDate(exp) {
  const M = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
  const d = parseInt(exp.slice(0,2),10), m = M[exp.slice(2,5).toUpperCase()], y = parseInt(exp.slice(5),10);
  return new Date(y, m, d, 15, 30);
}
function daysUntil(exp) { return Math.round((angelToDate(exp) - Date.now()) / 86400000); }
function fmtExpiry(exp) {
  const d = angelToDate(exp);
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short' });
}
function expiryToIso(exp) { return angelToDate(exp).toISOString(); }

// Categorise strategies for filter counts
const HEDGED_TYPES = {
  'Buy Call':    'buyCall',
  'Buy Put':     'buyPut',
  'Bull Call Spread':'callSpread','Bear Call Spread':'callSpread',
  'Bull Put Spread':'putSpread', 'Bear Put Spread':'putSpread',
  'Short Iron Condor':'ironCondor','Long Iron Condor':'ironCondor',
  'Iron Butterfly':'ironButterfly','Long Iron Butterfly':'ironButterfly',
};
const UNHEDGED_TYPES = {
  'Sell Call':'sellCall','Sell Put':'sellPut',
  'Short Straddle':'straddle','Long Straddle':'straddle',
  'Short Strangle':'strangle','Long Strangle':'strangle',
};

// ── Computation engine ────────────────────────────────────────────────────
function computeResults({ chain, spot, instrument, prediction, targetSpot, targetMs, selectedExpiries, enabledHedged, enabledUnhedged, spreadGaps, minProfit, maxLoss, ivOverrides }) {
  if (!chain.length || !spot || !targetSpot || !targetMs) return [];
  const lotSize = getLotSize(instrument);
  const sorted = chain.map(r => r.strike).sort((a,b) => a-b);
  const atmIdx = sorted.indexOf(sorted.reduce((b,s) => Math.abs(s-spot)<Math.abs(b-spot)?s:b, sorted[0]));
  const T = Math.max((targetMs - Date.now())/(365*86400000), 0.001);
  const off = n => sorted[Math.max(0, Math.min(sorted.length-1, atmIdx+n))];

  const results = [];

  STRATEGY_TEMPLATES.forEach(tmpl => {
    // Apply hedged/unhedged filter
    const hType = HEDGED_TYPES[tmpl.name];
    const uType = UNHEDGED_TYPES[tmpl.name];
    if (hType && !enabledHedged[hType]) return;
    if (uType && !enabledUnhedged[uType]) return;

    // Try strategy at several ATM offsets
    [-3,-2,-1,0,1,2,3].forEach(base => {
      const legs = tmpl.legs(off).map(t => {
        const strike = off(t.stepsFromAtm + base);
        const row = chain.find(r => r.strike === strike);
        const side = row?.[t.optionType];
        if (!side?.ltp) return null;
        const iv = ivOverrides?.iv || side.iv || 15;
        return { id:`${tmpl.name}_${base}_${t.stepsFromAtm}`, strike, optionType:t.optionType, transactionType:t.transactionType, quantity:t.qty||1, lotSize, iv, premium:side.ltp, ltp:side.ltp, ltpIsLive:true };
      });
      if (legs.some(l => !l)) return;

      // Spread gap filter
      const strikes = [...new Set(legs.map(l=>l.strike))].sort((a,b)=>a-b);
      if (strikes.length > 1 && spreadGaps.length) {
        const gap = strikes[1] - strikes[0];
        if (!spreadGaps.includes(gap)) return;
      }

      const calib = calibrateLegsIV(legs, spot, T, R);
      const pnl = payoffAt(calib, targetSpot, T, R, false);

      // Direction filter
      if (prediction === 'above' && pnl <= 0) return;
      if (prediction === 'below' && pnl <= 0) return;
      if (prediction === 'between' && pnl <= 0) return;
      if (Number.isFinite(minProfit) && pnl < minProfit) return;

      // Approximate capital
      const netPremium = legs.reduce((s,l) => s + (l.transactionType==='SELL'?1:-1)*l.premium*l.quantity*l.lotSize, 0);
      const isNaked = tmpl.type === 'unhedged';
      const approxCapital = isNaked
        ? legs.filter(l=>l.transactionType==='SELL').reduce((s,l)=>s+150000*l.quantity,0)
        : Math.abs(netPremium) || Math.abs(legs.reduce((s,l)=>s+(l.transactionType==='SELL'?1:-1)*l.premium*l.quantity*l.lotSize*0.5,0));
      if (Number.isFinite(maxLoss) && approxCapital > maxLoss) return;

      const greeks = positionGreeks(calib, spot, T, R);
      const bes = findBreakevens(calib, sorted[0]*0.85, sorted[sorted.length-1]*1.15, T, R);
      const scan = Array.from({length:200},(_,i)=>sorted[0]*0.85+i*(sorted[sorted.length-1]*1.15-sorted[0]*0.85)/199);
      const pnls = scan.map(s=>payoffAt(calib,s,0));
      const returnPct = approxCapital > 0 ? (pnl/approxCapital)*100 : 0;

      results.push({
        id:`${tmpl.name}:${base}`, name:tmpl.name, category:tmpl.category, type:tmpl.type, desc:tmpl.desc,
        legs:calib, pnl, breakevens:bes, approxCapital, returnPct, netPremium,
        maxProfit:Math.max(...pnls), maxLoss:Math.min(...pnls), greeks,
        daysLeft:Math.round(Math.max(0,(targetMs-Date.now())/86400000)),
      });
    });
  });

  // Keep best pnl per strategy name
  const best = {};
  results.forEach(r => { if (!best[r.name] || r.pnl > best[r.name].pnl) best[r.name] = r; });
  return Object.values(best);
}

// ── Component ─────────────────────────────────────────────────────────────
const INSTRUMENTS = ['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','SENSEX'];

export default function StrategyWizard() {
  const navigate = useNavigate();

  const [instrument, setInstrument] = useState('NIFTY');
  const [prediction, setPrediction] = useState('below');
  const [targetInput, setTargetInput] = useState('');
  const [expiries, setExpiries] = useState([]);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [chain, setChain] = useState([]);
  const [spot, setSpot] = useState(null);
  const [loadingChain, setLoadingChain] = useState(false);
  const [chainError, setChainError] = useState('');

  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [computing, setComputing] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [sortField, setSortField] = useState('pnl');
  const [sortAsc, setSortAsc] = useState(false);

  // Filters
  const [getEnabled, setGetEnabled] = useState(true);
  const [payEnabled, setPayEnabled] = useState(true);
  const [enabledExpiries, setEnabledExpiries] = useState({});
  const [enabledHedged, setEnabledHedged] = useState({ buyCall:true, buyPut:true, callSpread:true, putSpread:true, ironCondor:true, ironButterfly:true });
  const [enabledUnhedged, setEnabledUnhedged] = useState({ sellCall:true, sellPut:true, straddle:true, strangle:true });
  const [spreadGaps, setSpreadGaps] = useState([50,100,150]);
  const [ivOverrides, setIvOverrides] = useState({});
  const [minProfitEnabled, setMinProfitEnabled] = useState(false);
  const [minProfitVal, setMinProfitVal] = useState(0);
  const [maxLossEnabled, setMaxLossEnabled] = useState(false);
  const [maxLossVal, setMaxLossVal] = useState(1000000);
  const [deltaMin, setDeltaMin] = useState(0);
  const [deltaMax, setDeltaMax] = useState(1);

  // Load expiries
  useEffect(() => {
    fetchExpiryList(instrument).then(r => {
      if (!r.ok || !r.expiries?.length) return;
      setExpiries(r.expiries);
      setSelectedExpiry(r.expiries[0]);
      const en = {}; r.expiries.forEach(e => { en[e] = true; });
      setEnabledExpiries(en);
    });
    setChain([]); setSpot(null); setResults([]); setSearched(false);
  }, [instrument]);

  // Load chain (EOD fallback when market closed)
  useEffect(() => {
    if (!selectedExpiry) return;
    let cancelled = false;
    setLoadingChain(true); setChainError('');
    const loadChain = async () => {
      const iso = expiryToIso(selectedExpiry);
      let result = await fetchOptionChain(instrument, iso, R);
      if (!result.ok || !result.rows?.length) {
        // Market likely closed — use EOD chain
        result = await fetchEodChain(instrument, selectedExpiry, R);
      }
      if (cancelled) return;
      setLoadingChain(false);
      if (!result.ok || !result.rows?.length) {
        setChainError('Could not load chain. Make sure AngelOne is connected.');
        return;
      }
      setChain(result.rows);
      if (result.underlyingValue) {
        setSpot(result.underlyingValue);
        if (!targetInput) setTargetInput(String(Math.round(result.underlyingValue)));
      }
    };
    loadChain();
    return () => { cancelled = true; };
  }, [selectedExpiry, instrument]);

  function handleGo() {
    const tgt = parseFloat(targetInput);
    if (!chain.length || !tgt) return;
    setComputing(true);
    const tMs = angelToDate(selectedExpiry).getTime();
    setTimeout(() => {
      try {
        const r = computeResults({
          chain, spot, instrument, prediction, targetSpot: tgt, targetMs: tMs,
          selectedExpiries: enabledExpiries,
          enabledHedged: getEnabled ? enabledHedged : {},
          enabledUnhedged: payEnabled ? enabledUnhedged : {},
          spreadGaps,
          minProfit: minProfitEnabled ? minProfitVal : null,
          maxLoss: maxLossEnabled ? maxLossVal : null,
          ivOverrides,
        });
        setResults(r); setSearched(true);
      } finally { setComputing(false); }
    }, 30);
  }

  function handleSort(f) {
    if (sortField === f) setSortAsc(a => !a);
    else { setSortField(f); setSortAsc(false); }
  }

  const sorted = useMemo(() => {
    return [...results].sort((a,b) => {
      const va = sortField==='breakeven' ? (a.breakevens?.[0]??0) : a[sortField]??0;
      const vb = sortField==='breakeven' ? (b.breakevens?.[0]??0) : b[sortField]??0;
      return sortAsc ? va-vb : vb-va;
    });
  }, [results, sortField, sortAsc]);

  // Count results per strategy type (for filter labels)
  const typeCounts = useMemo(() => {
    const c = { buyCall:0, buyPut:0, callSpread:0, putSpread:0, ironCondor:0, ironButterfly:0, sellCall:0, sellPut:0, straddle:0, strangle:0 };
    results.forEach(r => {
      const h = HEDGED_TYPES[r.name], u = UNHEDGED_TYPES[r.name];
      if (h) c[h] = (c[h]||0)+1;
      if (u) c[u] = (c[u]||0)+1;
    });
    return c;
  }, [results]);

  function loadIntoBuilder(row) {
    sessionStorage.setItem('sb_wizard_legs', JSON.stringify(row.legs));
    sessionStorage.setItem('sb_instrument', instrument);
    sessionStorage.setItem('sb_expiry', selectedExpiry);
    navigate('/strategy-builder');
  }

  const daysLeft = selectedExpiry ? daysUntil(selectedExpiry) : 0;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <div className="page-title">Strategy Wizard</div>
        <div className="page-subtitle">Tell us your market view — we'll find the right strategies</div>
      </div>

      {/* ── Input bar ── */}
      <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'16px 20px', marginBottom:14, display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
        {/* Instrument */}
        <div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5 }}>Instrument</div>
          <select value={instrument} onChange={e => setInstrument(e.target.value)}
            style={{ background:'var(--bg-card2)', border:'1px solid var(--border-hover)', borderRadius:8, color:'var(--text-primary)', fontSize:13, padding:'8px 12px', cursor:'pointer', outline:'none', fontWeight:600 }}>
            {INSTRUMENTS.map(i => <option key={i} value={i}>{i}{spot && i===instrument ? ` ${spot.toLocaleString('en-IN',{maximumFractionDigits:2})}` : ''}</option>)}
          </select>
        </div>

        {/* Prediction */}
        <div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5 }}>Prediction</div>
          <select value={prediction} onChange={e => setPrediction(e.target.value)}
            style={{ background:'var(--bg-card2)', border:'1px solid var(--border-hover)', borderRadius:8, color:'var(--text-primary)', fontSize:13, padding:'8px 12px', cursor:'pointer', outline:'none', minWidth:110 }}>
            <option value="above">Above</option>
            <option value="below">Below</option>
            <option value="between">Between</option>
          </select>
        </div>

        {/* Target */}
        <div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5 }}>{instrument} Target</div>
          <input type="number" value={targetInput} onChange={e => setTargetInput(e.target.value)}
            placeholder={spot ? String(Math.round(spot)) : 'e.g. 24500'}
            style={{ background:'var(--bg-card2)', border:'1px solid var(--border-hover)', borderRadius:8, color:'var(--text-primary)', fontSize:13, padding:'8px 12px', outline:'none', width:130 }} />
        </div>

        {/* Expiry */}
        <div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5 }}>Target date</div>
          <select value={selectedExpiry} onChange={e => setSelectedExpiry(e.target.value)}
            style={{ background:'var(--bg-card2)', border:'1px solid var(--border-hover)', borderRadius:8, color:'var(--text-primary)', fontSize:13, padding:'8px 12px', cursor:'pointer', outline:'none', minWidth:150 }}>
            {expiries.map(e => <option key={e} value={e}>{fmtExpiry(e)} ({daysUntil(e)} days)</option>)}
          </select>
        </div>

        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => setShowFilters(f => !f)}
            style={{ background: showFilters ? 'rgba(59,130,246,0.15)' : 'var(--bg-card2)', border:`1px solid ${showFilters ? 'var(--accent)' : 'var(--border)'}`, borderRadius:8, color: showFilters ? 'var(--accent)' : 'var(--text-primary)', fontSize:13, padding:'8px 16px', cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
            ⚙ Filters
          </button>
          <button onClick={handleGo} disabled={!chain.length || computing}
            style={{ background:'var(--accent)', border:'none', borderRadius:8, color:'#fff', fontSize:13, fontWeight:700, padding:'8px 28px', cursor: chain.length ? 'pointer' : 'not-allowed', opacity: chain.length ? 1 : 0.5 }}>
            {computing ? 'Working…' : 'Go'}
          </button>
        </div>

        {loadingChain && <span style={{ fontSize:12, color:'var(--text-muted)', alignSelf:'center' }}>Loading chain…</span>}
        {chainError && <span style={{ fontSize:12, color:'var(--loss)', alignSelf:'center' }}>{chainError}</span>}
        {chain.length > 0 && !loadingChain && (
          <span style={{ fontSize:11, color: isMarketOpen() ? 'var(--profit)' : '#FFA53D', alignSelf:'center', display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background: isMarketOpen() ? 'var(--profit)' : '#FFA53D', display:'inline-block' }} />
            {isMarketOpen() ? 'live' : 'last close'} · {chain.length} strikes
          </span>
        )}
      </div>

      {/* ── Filters panel ── */}
      {showFilters && (
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'20px 24px', marginBottom:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
            <span style={{ fontSize:15, fontWeight:700 }}>Filters</span>
            <button onClick={() => setShowFilters(false)} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:20 }}>×</button>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:24 }}>
            {/* Premium */}
            <div>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>Premium</div>
              {[['Get (selling)', getEnabled, setGetEnabled], ['Pay (buying)', payEnabled, setPayEnabled]].map(([l,v,s]) => (
                <label key={l} style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, marginBottom:8, cursor:'pointer', color:'var(--text-secondary)' }}>
                  <input type="checkbox" checked={v} onChange={e => s(e.target.checked)} /> {l}
                </label>
              ))}
            </div>

            {/* Expiry */}
            <div>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>
                Expiry
                {Object.values(enabledExpiries).some(v=>!v) && <span style={{ marginLeft:8, color:'#FFA53D', fontSize:11 }}>⚠ Expiry Missing?</span>}
              </div>
              {expiries.map(e => (
                <label key={e} style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, marginBottom:8, cursor:'pointer', color:'var(--text-secondary)' }}>
                  <input type="checkbox" checked={!!enabledExpiries[e]} onChange={ev => setEnabledExpiries(prev => ({...prev,[e]:ev.target.checked}))} />
                  {fmtExpiry(e)} ({daysUntil(e)} days)
                </label>
              ))}
            </div>

            {/* Hedged strategies */}
            <div>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>Hedged strategies</div>
              {[['Buy Call','buyCall'],['Buy Put','buyPut'],['Call Spread','callSpread'],['Put Spread','putSpread'],['Iron Condor','ironCondor'],['Iron Butterfly','ironButterfly']].map(([l,k]) => (
                <label key={k} style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, marginBottom:7, cursor:'pointer', color:'var(--text-secondary)' }}>
                  <input type="checkbox" checked={!!enabledHedged[k]} onChange={e => setEnabledHedged(p => ({...p,[k]:e.target.checked}))} />
                  {l} <span style={{ color:'var(--text-muted)', fontSize:11 }}>({typeCounts[k]||0})</span>
                </label>
              ))}
            </div>

            {/* Unhedged strategies */}
            <div>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>Unhedged strategies</div>
              {[['Sell Call','sellCall'],['Sell Put','sellPut'],['Straddle','straddle'],['Strangle','strangle']].map(([l,k]) => (
                <label key={k} style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, marginBottom:7, cursor:'pointer', color:'var(--text-secondary)' }}>
                  <input type="checkbox" checked={!!enabledUnhedged[k]} onChange={e => setEnabledUnhedged(p => ({...p,[k]:e.target.checked}))} />
                  {l} <span style={{ color:'var(--text-muted)', fontSize:11 }}>({typeCounts[k]||0})</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ height:1, background:'var(--border)', margin:'20px 0' }} />

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:24 }}>
            {/* ATM IV on target */}
            <div>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>
                ATM IV on target <span style={{ color:'var(--text-muted)', fontSize:10, fontWeight:400 }}>ⓘ</span>
              </div>
              {expiries.slice(0,3).map(e => (
                <div key={e} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, fontSize:13, color:'var(--text-secondary)' }}>
                  <span style={{ minWidth:90 }}>{fmtExpiry(e)} options</span>
                  <button onClick={() => setIvOverrides(p => ({...p,[e]:Math.max(1,(p[e]||15)-0.5)}))}
                    style={{ background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:4, color:'var(--text-primary)', width:22, height:22, cursor:'pointer', fontSize:14, lineHeight:1 }}>−</button>
                  <span style={{ fontFamily:'var(--font-mono)', width:36, textAlign:'center' }}>{(ivOverrides[e]||15).toFixed(1)}</span>
                  <button onClick={() => setIvOverrides(p => ({...p,[e]:(p[e]||15)+0.5}))}
                    style={{ background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:4, color:'var(--text-primary)', width:22, height:22, cursor:'pointer', fontSize:14, lineHeight:1 }}>+</button>
                </div>
              ))}
            </div>

            {/* Spread gap */}
            <div>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>
                Spread gap <span style={{ color:'var(--text-muted)', fontSize:10, fontWeight:400 }}>ⓘ</span>
              </div>
              <div style={{ display:'flex', gap:14 }}>
                {[50,100,150].map(g => (
                  <label key={g} style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer', color:'var(--text-secondary)' }}>
                    <input type="checkbox" checked={spreadGaps.includes(g)}
                      onChange={e => setSpreadGaps(p => e.target.checked ? [...p,g] : p.filter(x=>x!==g))} />
                    {g}
                  </label>
                ))}
              </div>
            </div>

            {/* Max loss + Min profit + Delta */}
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {/* Max loss */}
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                  <input type="checkbox" checked={maxLossEnabled} onChange={e => setMaxLossEnabled(e.target.checked)} />
                  <span style={{ fontSize:13, color:'var(--text-secondary)' }}>Max loss limit <span style={{ color:'var(--text-muted)', fontSize:10 }}>ⓘ</span></span>
                  <input type="number" value={maxLossVal} onChange={e => setMaxLossVal(Number(e.target.value))} disabled={!maxLossEnabled}
                    style={{ marginLeft:'auto', background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:5, color:'var(--text-primary)', fontSize:12, padding:'3px 8px', width:90, opacity: maxLossEnabled?1:0.4 }} />
                </div>
                <input type="range" min={0} max={2000000} step={10000} value={maxLossVal} disabled={!maxLossEnabled}
                  onChange={e => setMaxLossVal(Number(e.target.value))}
                  style={{ width:'100%', accentColor:'var(--accent)', opacity: maxLossEnabled?1:0.3 }} />
              </div>
              {/* Min profit */}
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                  <input type="checkbox" checked={minProfitEnabled} onChange={e => setMinProfitEnabled(e.target.checked)} />
                  <span style={{ fontSize:13, color:'var(--text-secondary)' }}>Min profit <span style={{ color:'var(--text-muted)', fontSize:10 }}>ⓘ</span></span>
                  <input type="number" value={minProfitVal} onChange={e => setMinProfitVal(Number(e.target.value))} disabled={!minProfitEnabled}
                    style={{ marginLeft:'auto', background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:5, color:'var(--text-primary)', fontSize:12, padding:'3px 8px', width:90, opacity: minProfitEnabled?1:0.4 }} />
                </div>
                <input type="range" min={0} max={50000} step={500} value={minProfitVal} disabled={!minProfitEnabled}
                  onChange={e => setMinProfitVal(Number(e.target.value))}
                  style={{ width:'100%', accentColor:'var(--accent)', opacity: minProfitEnabled?1:0.3 }} />
              </div>
              {/* Delta range */}
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                  <input type="checkbox" disabled />
                  <span style={{ fontSize:13, color:'var(--text-secondary)' }}>Delta range <span style={{ color:'var(--text-muted)', fontSize:10 }}>ⓘ</span></span>
                  <span style={{ marginLeft:'auto', fontSize:12, color:'var(--text-muted)', fontFamily:'var(--font-mono)' }}>{deltaMin.toFixed(1)} - {deltaMax.toFixed(1)}</span>
                </div>
                <input type="range" min={0} max={1} step={0.1} value={deltaMax}
                  onChange={e => setDeltaMax(Number(e.target.value))}
                  style={{ width:'100%', accentColor:'var(--accent)' }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Results table ── */}
      {searched && (
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
          {sorted.length === 0 ? (
            <div style={{ padding:'48px 20px', textAlign:'center', color:'var(--text-muted)' }}>
              No strategies match your prediction. Try adjusting the target price or removing filters.
            </div>
          ) : (
            <>
              <div style={{ padding:'10px 20px', borderBottom:'1px solid var(--border)', fontSize:12, color:'var(--text-muted)' }}>
                Found <strong style={{ color:'var(--text-primary)' }}>{sorted.length} strategies</strong> for {instrument} <strong>{prediction}</strong> {targetInput} by {fmtExpiry(selectedExpiry)}
              </div>

              {/* Column headers */}
              <div style={{ display:'grid', gridTemplateColumns:'2.2fr 1fr 1fr 1fr 1fr 88px', padding:'10px 20px', background:'var(--bg-card2)', borderBottom:'1px solid var(--border)', fontSize:11, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em' }}>
                <span>Trade</span>
                {[['pnl','Profit'],['breakeven','Breakeven'],['approxCapital','Approx. capital'],['returnPct', `${daysLeft}d return %`]].map(([k,l]) => (
                  <button key={k} onClick={() => handleSort(k)}
                    style={{ background:'none', border:'none', padding:0, color: sortField===k ? 'var(--accent)' : 'var(--text-muted)', cursor:'pointer', fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', textAlign:'right', display:'flex', alignItems:'center', justifyContent:'flex-end', gap:3 }}>
                    {l} <span>{sortField===k?(sortAsc?'↑':'↓'):'↕'}</span>
                  </button>
                ))}
                <span />
              </div>

              {/* Rows */}
              {sorted.map(row => {
                const badge = getBadge(row.name);
                const expanded = expandedId === row.id;
                const be = row.breakevens?.[0];
                return (
                  <div key={row.id} style={{ borderBottom:'1px solid var(--border)' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'2.2fr 1fr 1fr 1fr 1fr 88px', padding:'12px 20px', alignItems:'center', background: expanded ? 'rgba(59,130,246,0.04)' : 'transparent' }}>
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                          <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4, background:badge.bg, color:badge.color }}>{badge.label}</span>
                          <span style={{ fontSize:13, fontWeight:600 }}>{row.name}</span>
                        </div>
                        <div style={{ fontSize:11, color:'var(--text-muted)' }}>
                          {row.legs.map(l => `${l.transactionType==='BUY'?'B':'S'} ${l.strike} ${l.optionType}`).join(' · ')}
                        </div>
                      </div>
                      <div style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:700, color: row.pnl>=0?'var(--profit)':'var(--loss)' }}>
                        {fmtK(row.pnl)}
                      </div>
                      <div style={{ textAlign:'right', fontFamily:'var(--font-mono)', color:'var(--text-primary)', fontSize:12 }}>
                        {be ? be.toLocaleString('en-IN',{maximumFractionDigits:0}) : '—'}
                      </div>
                      <div style={{ textAlign:'right', fontFamily:'var(--font-mono)', color:'var(--text-secondary)', fontSize:12 }}>
                        {fmtCapital(row.approxCapital)}
                      </div>
                      <div style={{ textAlign:'right', fontFamily:'var(--font-mono)', color: row.returnPct>=0?'var(--profit)':'var(--loss)', fontSize:12 }}>
                        {fmtPct(row.returnPct)}
                      </div>
                      <div style={{ textAlign:'right' }}>
                        <button onClick={() => setExpandedId(expanded ? null : row.id)}
                          style={{ background:'var(--accent)', border:'none', borderRadius:6, color:'#fff', fontSize:12, padding:'5px 12px', cursor:'pointer' }}>
                          {expanded ? 'Less ↑' : 'Trade ↓'}
                        </button>
                      </div>
                    </div>

                    {expanded && (
                      <div style={{ padding:'20px 24px', background:'rgba(255,255,255,0.02)', borderTop:'1px solid var(--border)' }}>
                        {/* Badge + name + leg LTPs */}
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
                          <div>
                            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                              <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:4, background:badge.bg, color:badge.color }}>{badge.label}</span>
                              <span style={{ fontSize:15, fontWeight:700 }}>{instrument} {fmtExpiry(selectedExpiry)} — {row.name}</span>
                            </div>
                            <div style={{ fontSize:12, fontWeight:600, color:'var(--text-secondary)', marginBottom:4 }}>How does this trade work?</div>
                            <div style={{ fontSize:12, color:'var(--text-muted)', maxWidth:520 }}>{row.desc}</div>
                          </div>
                          {/* Per-leg LTP + quantity */}
                          <div style={{ display:'flex', gap:16 }}>
                            {row.legs.map((l,i) => (
                              <div key={i} style={{ textAlign:'center', minWidth:70 }}>
                                <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:2 }}>LTP</div>
                                <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:15 }}>{l.ltp?.toFixed(2)??'—'}</div>
                                <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>{l.transactionType==='BUY'?'B':'S'} {l.strike} {l.optionType}</div>
                              </div>
                            ))}
                            <div style={{ textAlign:'center', minWidth:70 }}>
                              <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:2 }}>Quantity</div>
                              <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:15 }}>1 Lot</div>
                              <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>{getLotSize(instrument)} units</div>
                            </div>
                          </div>
                        </div>

                        {/* Stats */}
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:14 }}>
                          {[
                            { label:'Max profit', val: row.maxProfit > 1e8 ? 'Unlimited' : fmtK(row.maxProfit), color: row.maxProfit>=0?'var(--profit)':'var(--loss)' },
                            { label:'Max loss',   val: row.maxLoss < -1e8 ? 'Unlimited' : fmtK(Math.abs(row.maxLoss)), color:'var(--loss)' },
                            { label:'Profit at target', val: fmtK(row.pnl), color: row.pnl>=0?'var(--profit)':'var(--loss)' },
                          ].map(s => (
                            <div key={s.label} style={{ background:'var(--bg-card2)', borderRadius:8, padding:'10px 14px' }}>
                              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>{s.label}</div>
                              <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:16, color:s.color }}>{s.val}</div>
                            </div>
                          ))}
                        </div>

                        {/* Greeks collapsible */}
                        <details style={{ marginBottom:16 }}>
                          <summary style={{ fontSize:13, color:'var(--accent)', cursor:'pointer', userSelect:'none', marginBottom:8 }}>View Greeks</summary>
                          <div style={{ display:'flex', gap:24, fontSize:12 }}>
                            {[['Delta',row.greeks.delta?.toFixed(2)],['Gamma',row.greeks.gamma?.toFixed(4)],['Theta / day',row.greeks.theta?.toFixed(2)],['Vega',row.greeks.vega?.toFixed(2)]].map(([k,v]) => (
                              <div key={k}><span style={{ color:'var(--text-muted)' }}>{k} </span><span style={{ fontFamily:'var(--font-mono)', fontWeight:600 }}>{v??'—'}</span></div>
                            ))}
                          </div>
                        </details>

                        {/* Actions */}
                        <div style={{ display:'flex', gap:10 }}>
                          <button onClick={() => loadIntoBuilder(row)}
                            style={{ background:'var(--accent)', border:'none', borderRadius:8, color:'#fff', fontSize:13, fontWeight:600, padding:'9px 24px', cursor:'pointer' }}>
                            Analyse in Builder
                          </button>
                          <button onClick={() => {
                            const drafts = JSON.parse(localStorage.getItem('sb_drafts')||'[]');
                            const name = `${instrument} ${selectedExpiry} ${row.name} · ${new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}`;
                            drafts.unshift({ id:Date.now(), name, instrument, selectedExpiry, legs:row.legs });
                            localStorage.setItem('sb_drafts', JSON.stringify(drafts.slice(0,20)));
                            alert('Saved to Strategy Builder drafts!');
                          }}
                            style={{ background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:8, color:'var(--text-secondary)', fontSize:13, padding:'9px 20px', cursor:'pointer' }}>
                            Add to Drafts
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* Empty state */}
      {!searched && !loadingChain && chain.length > 0 && (
        <div style={{ textAlign:'center', padding:'64px 20px', color:'var(--text-muted)' }}>
          <div style={{ fontSize:36, marginBottom:12, opacity:0.4 }}>✦</div>
          <div style={{ fontSize:15, marginBottom:6, color:'var(--text-secondary)' }}>Set your prediction and click Go</div>
          <div style={{ fontSize:13 }}>We'll rank every strategy by profit at your target price</div>
        </div>
      )}
    </div>
  );
}
