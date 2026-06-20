import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { payoffAt, positionGreeks, findBreakevens, calibrateLegsIV, maxProfitLoss } from '../utils/optionsAnalysis';
import { fetchOptionChain, fetchExpiryList, fetchEodChain } from '../utils/optionChain';
import { STRATEGY_TEMPLATES, getBadge } from '../utils/strategyTemplates';
import { isMarketOpen } from '../utils/marketHours';
import { getLotSize } from '../utils/lotSizes';
import { impliedVolatility } from '../utils/blackscholes';

const R = 0.065;
// Use the same getLotSize as StrategyBuilder — single source of truth
const getLot = i => getLotSize(i);

const M_IDX = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
function angelToDate(exp) {
  const d=parseInt(exp.slice(0,2),10), m=M_IDX[exp.slice(2,5).toUpperCase()], y=parseInt(exp.slice(5),10);
  return new Date(y, m, d, 15, 30);
}
function daysUntil(exp) { return Math.round((angelToDate(exp)-Date.now())/86400000); }
function fmtExp(exp) {
  const d=angelToDate(exp);
  return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
}
function expiryIso(exp) { return angelToDate(exp).toISOString(); }

function fmtMoney(n,compact=false) {
  if (!Number.isFinite(n)) return '—';
  const a=Math.abs(n), s=n<0?'-':'+';
  if (compact && a>=100000) return s+'₹'+(a/100000).toFixed(2)+'L';
  if (compact && a>=1000)   return s+'₹'+(a/1000).toFixed(1)+'k';
  return s+'₹'+a.toLocaleString('en-IN',{maximumFractionDigits:0});
}
function fmtCap(n) {
  if (!Number.isFinite(n)||n<=0) return '—';
  return n>=100000 ? '₹'+(n/100000).toFixed(2)+'L' : '₹'+n.toLocaleString('en-IN',{maximumFractionDigits:0});
}
function fmtPct(n) { return !Number.isFinite(n)?'—':(n>=0?'+':'')+n.toFixed(2)+'%'; }

// Strategy type keys for filter counts
const HEDGE_KEY = {
  'Buy Call':'buyCall','Bull Call Spread':'callSpread','Bear Call Spread':'callSpread',
  'Bull Condor':'callSpread','Bear Condor':'putSpread','Call Ratio Back Spread':'callSpread',
  'Bull Butterfly':'callSpread','Bear Butterfly':'putSpread','Range Forward':'callSpread',
  'Bull Put Spread':'putSpread','Bear Put Spread':'putSpread','Put Ratio Back Spread':'putSpread',
  'Long Calendar (Calls)':'callSpread','Long Calendar (Puts)':'putSpread',
  'Buy Put':'buyPut','Short Iron Condor':'ironCondor','Long Iron Condor':'ironCondor',
  'Iron Butterfly':'ironButterfly','Long Iron Butterfly':'ironButterfly',
  'Batman':'ironCondor','Double Plateau':'ironCondor','Jade Lizard':'callSpread',
  'Reverse Jade Lizard':'putSpread','Long Synthetic Future':'callSpread',
  'Short Synthetic Future':'putSpread','Risk Reversal':'putSpread','Range Forward':'callSpread',
  'Call Ratio Spread':'callSpread','Put Ratio Spread':'putSpread',
  'Long Straddle':'straddle','Strip':'straddle','Strap':'straddle',
  'Long Strangle':'strangle',
};
const UNHEG_KEY = {
  'Sell Call':'sellCall','Sell Put':'sellPut',
  'Short Straddle':'straddle','Short Strangle':'strangle',
  'Long Straddle':'straddle','Long Strangle':'strangle',
};

// ── Probability of Profit ─────────────────────────────────────────────────
// Approximation of standard normal CDF (Abramowitz & Stegun 26.2.17)
function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const p = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - (1/Math.sqrt(2*Math.PI)) * Math.exp(-x*x/2) * p;
  return x >= 0 ? cdf : 1 - cdf;
}

// Compute probability of profit at expiry using lognormal spot distribution.
// Scans payoff at T=0 across a strike range, weighted by the risk-neutral
// lognormal density — same probabilistic model as Black-Scholes.
function computePOP(calib, spot, T, R, beLow, beHigh, step) {
  if (!calib.length || T <= 0) return null;
  const avgIv = calib.reduce((s,l)=>s+(l.iv||15),0) / calib.length / 100;
  if (avgIv <= 0) return null;
  const sigma = avgIv * Math.sqrt(T);
  const muLog = Math.log(spot) + (R - avgIv*avgIv/2) * T;
  let profitWeight = 0, totalWeight = 0;
  for (let s = beLow; s <= beHigh; s += step) {
    const z = (Math.log(Math.max(s, 1)) - muLog) / sigma;
    const density = Math.exp(-z*z/2) / (sigma * s * Math.sqrt(2*Math.PI));
    totalWeight += density;
    if (payoffAt(calib, s, 0, R, false) > 0) profitWeight += density;
  }
  return totalWeight > 0 ? Math.round((profitWeight/totalWeight)*100) : null;
}

// ── Core computation ──────────────────────────────────────────────────────
// Mirrors OptionsAnalyzer pipeline exactly:
//   calibrateLegsIV  → back-solve IV from real LTPs (Newton-Raphson)
//   payoffAt(T=0)    → at-expiry intrinsic payoff at target spot
//   findBreakevens   → scans T=0 payoff across strike range (correct signature)
//   maxProfitLoss    → same utility as OptionsAnalyzer uses
//   positionGreeks   → current-time Greeks with calibrated IV
function computeWizard({ chain, spot, instrument, prediction, targetSpot, expiryMs,
    enabledHedgeKeys, enabledUnhegKeys, spreadGaps, minProfit, maxLoss }) {
  if (!chain.length || !targetSpot) return [];

  const lotSize = getLot(instrument);
  const sorted = chain.map(r=>r.strike).sort((a,b)=>a-b);
  // Fallback to middle strike if spot unavailable (market closed)
  const effectiveSpot = spot || sorted[Math.floor(sorted.length/2)];
  const atmIdx = sorted.indexOf(sorted.reduce((b,s)=>Math.abs(s-effectiveSpot)<Math.abs(b-effectiveSpot)?s:b, sorted[0]));
  // Minimum 1 day so impliedVolatility solver doesn't blow up for near-expiry options
  const T_live = Math.max((expiryMs - Date.now()) / (365*86400000), 1/365);
  const off = n => sorted[Math.max(0, Math.min(sorted.length-1, atmIdx+n))];
  // Breakeven scan bounds and step size (match OptionsAnalyzer approach)
  const step = sorted.length > 1 ? Math.abs(sorted[1]-sorted[0]) : 50;
  const beLow  = sorted[0] * 0.85;
  const beHigh = sorted[sorted.length-1] * 1.15;

  const results = [];

  // Map prediction → allowed strategy categories (matches Sensibull exactly)
  // "below" → bearish strategies only (Sell Call, Bear Spread, Buy Put, etc.)
  // "above" → bullish strategies only (Buy Call, Bull Spread, Sell Put, etc.)
  // "between" → neutral/range strategies (Iron Condor, Straddle, etc.)
  const ALLOWED_CATEGORIES = {
    below:   ['Bearish'],
    above:   ['Bullish'],
    between: ['Neutral', 'Others'],
  };
  const allowedCats = ALLOWED_CATEGORIES[prediction] || ['Bearish','Bullish','Neutral','Others'];

  STRATEGY_TEMPLATES.forEach(tmpl => {
    // ── Category gate — primary filter matching Sensibull's categorisation ──
    if (!allowedCats.includes(tmpl.category)) return;

    const hk = HEDGE_KEY[tmpl.name], uk = UNHEG_KEY[tmpl.name];
    if (hk && !enabledHedgeKeys[hk]) return;
    if (uk && !enabledUnhegKeys[uk]) return;

    // Cover strikes within 300 points of the target in each direction.
    const RANGE_POINTS = 300;
    const baseMin = Math.round((targetSpot - RANGE_POINTS - effectiveSpot) / step);
    const baseMax = Math.round((targetSpot + RANGE_POINTS - effectiveSpot) / step);
    const bases = Array.from({ length: Math.max(0, baseMax - baseMin + 1) }, (_, i) => baseMin + i);

    // Spread width variation: for multi-leg strategies, try widths from 50 to 400
    // points (1..8 steps for NIFTY). Single-leg templates use width=1 (no scaling).
    const rawOffsets = tmpl.legs(n => n).map(t => t.stepsFromAtm);
    const absOffsets = rawOffsets.filter(o => o !== 0).map(Math.abs);
    const baseWidth = absOffsets.length ? Math.min(...absOffsets) : 0; // smallest non-zero step
    const maxWidthSteps = Math.round(400 / step); // 8 for NIFTY
    const widths = baseWidth > 0
      ? Array.from({ length: maxWidthSteps }, (_, i) => i + 1) // 1..8 steps
      : [1]; // single-leg: no width scaling

    for (const base of bases) {
      for (const widthSteps of widths) {
        const scale = baseWidth > 0 ? widthSteps / baseWidth : 1;

        const legTemplates = tmpl.legs(off);
        const legs = legTemplates.map(t => {
          // Scale the relative offset by spread width, then shift by base
          const scaledStep = Math.round(t.stepsFromAtm * scale);
          const strike = off(scaledStep + base);
          const row = chain.find(r=>r.strike===strike);
          const side = row?.[t.optionType];
          if (!side?.ltp || side.ltp <= 0) return null;
          return {
            id:`${tmpl.name}_${base}_${widthSteps}_${t.stepsFromAtm}`,
            strike, optionType:t.optionType, transactionType:t.transactionType,
            quantity:t.qty||1, lotSize, iv:side.iv||15, premium:side.ltp, ltp:side.ltp,
          };
        });
        if (legs.some(l=>!l)) continue;

        // Spread gap filter — gap = distance between the two closest different strikes
        const strikesSorted = [...new Set(legs.map(l=>l.strike))].sort((a,b)=>a-b);
        if (strikesSorted.length>1 && spreadGaps.length>0) {
          const gap = strikesSorted[1]-strikesSorted[0];
          if (!spreadGaps.includes(gap)) continue;
        }

        // ── Same pipeline as OptionsAnalyzer ────────────────────────
        const calib = calibrateLegsIV(legs, effectiveSpot, T_live, R);
        const pnl = payoffAt(calib, targetSpot, 0, R, false);
        if (pnl <= 0) continue;
        if (Number.isFinite(minProfit) && pnl < minProfit) continue;

        // Direction consistency
        if (prediction === 'below') {
          const farDown = Math.min(targetSpot * 0.93, effectiveSpot * 0.93);
          if (payoffAt(calib, farDown, 0, R, false) < 0) continue;
          if (payoffAt(calib, targetSpot * 0.80, 0, R, false) < 0) continue;
        } else if (prediction === 'above') {
          const farUp = Math.max(targetSpot * 1.07, effectiveSpot * 1.07);
          if (payoffAt(calib, farUp, 0, R, false) < 0) continue;
          if (payoffAt(calib, targetSpot * 1.20, 0, R, false) < 0) continue;
        }

        const netPrem = legs.reduce((s,l)=>s+(l.transactionType==='SELL'?1:-1)*l.premium*l.quantity*l.lotSize, 0);
        const naked = tmpl.type === 'unhedged';
        const approxCap = naked
          ? legs.filter(l=>l.transactionType==='SELL').reduce((s,l)=>s+150000*l.quantity,0)
          : Math.max(Math.abs(netPrem), 1000);
        if (Number.isFinite(maxLoss) && approxCap > maxLoss) continue;

        const greeks = positionGreeks(calib, effectiveSpot, T_live, R);
        const bes = findBreakevens(calib, beLow, beHigh, step);
        const { maxProfit, maxLoss: maxLossV } = maxProfitLoss(calib, beLow, beHigh);
        const isNakedSell = naked && legs.some(l=>l.transactionType==='SELL');
        const maxLossDisplay = isNakedSell ? null : maxLossV;
        const pop = computePOP(calib, effectiveSpot, T_live, R, beLow, beHigh, step);
        const legTargetPrices = calib.map(l =>
          l.optionType === 'CE' ? Math.max(targetSpot - l.strike, 0) : Math.max(l.strike - targetSpot, 0)
        );
        const returnPct = approxCap>0 ? (pnl/approxCap)*100 : 0;
        const strikeKey = calib.map(l=>`${l.transactionType[0]}${l.optionType}${l.strike}`).sort().join('_');

        results.push({
          id:`${strikeKey}::${tmpl.name}`, name:tmpl.name, category:tmpl.category, type:tmpl.type, desc:tmpl.desc,
          strikeKey, legs:calib, pnl, breakevens:bes, approxCap, returnPct, netPrem,
          maxProfit, maxLoss:maxLossDisplay, greeks, pop, legTargetPrices,
          daysLeft:Math.round(Math.max(0,(expiryMs-Date.now())/86400000)),
          hKey:hk, uKey:uk,
        });
      } // end widthSteps
    } // end base
  });

  // Deduplicate by exact strike combination (same trade = same strikes, same types)
  // but keep ALL unique variants sorted by profit (Sensibull shows multiple Sell Calls
  // at different strikes, multiple Bear Call Spreads at different strike pairs, etc.)
  const seen = new Set();
  const unique = results.filter(r => {
    if (seen.has(r.strikeKey)) return false;
    seen.add(r.strikeKey);
    return true;
  });
  return unique.sort((a,b) => b.pnl - a.pnl);
}


// ── Component ─────────────────────────────────────────────────────────────
export default function StrategyWizard() {
  const navigate = useNavigate();

  const [instrument, setInstrument] = useState('NIFTY');
  const [prediction, setPrediction] = useState('below');
  const [targetInput, setTargetInput] = useState('');
  const [expiries, setExpiries] = useState([]);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [chain, setChain] = useState([]);
  const [spot, setSpot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [chainErr, setChainErr] = useState('');

  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [computing, setComputing] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [sortField, setSortField] = useState('pnl');
  const [sortAsc, setSortAsc] = useState(false);

  // Filters
  const [enabledHedge, setEnabledHedge] = useState({buyCall:true,buyPut:true,callSpread:true,putSpread:true,ironCondor:true,ironButterfly:true});
  const [enabledUnheg, setEnabledUnheg] = useState({sellCall:true,sellPut:true,straddle:true,strangle:true});
  const [spreadGaps, setSpreadGaps] = useState([50,100,150]);
  const [ivAdj, setIvAdj] = useState({});
  const [minProfitOn, setMinProfitOn] = useState(false);
  const [minProfitV, setMinProfitV] = useState(0);
  const [maxLossOn, setMaxLossOn] = useState(false);
  const [maxLossV, setMaxLossV] = useState(1000000);

  // Load expiries
  useEffect(() => {
    fetchExpiryList(instrument).then(r => {
      if (!r.ok || !r.expiries?.length) return;
      setExpiries(r.expiries);
      setSelectedExpiry(r.expiries[0]);
    });
    setChain([]); setSpot(null); setResults([]); setSearched(false);
  }, [instrument]);

  // Load chain — try live then EOD fallback
  useEffect(() => {
    if (!selectedExpiry) return;
    let cancelled = false;
    setLoading(true); setChainErr('');
    (async () => {
      let res = await fetchOptionChain(instrument, expiryIso(selectedExpiry), R);
      if (!res.ok || !res.rows?.length) res = await fetchEodChain(instrument, selectedExpiry, R);
      if (cancelled) return;
      setLoading(false);
      if (!res.ok || !res.rows?.length) { setChainErr('Could not load chain — check AngelOne is connected.'); return; }
      setChain(res.rows);
      if (res.underlyingValue) { setSpot(res.underlyingValue); setTargetInput(t => t||String(Math.round(res.underlyingValue))); }
    })();
    return () => { cancelled = true; };
  }, [selectedExpiry, instrument]);

  // Compute ATM IV for each expiry and populate the "ATM IV on target" filter,
  // matching Sensibull's approach:
  // - Estimate underlying spot via put-call parity (forward ≈ strike + CE − PE)
  //   so we don't need a separate API call for the underlying price
  // - Back-solve IV from ATM option LTP using Black-Scholes inverse
  // - Show real IV for all expiries (Sensibull shows 8.7% even for 3-day expiry)
  // - Extrapolate other expiries using NIFTY term structure (+0.5%/30 days)
  useEffect(() => {
    if (!chain.length || !selectedExpiry) return;

    // Estimate underlying spot from put-call parity: forward ≈ strike + CE − PE
    const validRows = chain.filter(r => r.CE?.ltp > 0 && r.PE?.ltp > 0);
    const estimatedSpot = validRows.length
      ? validRows.reduce((s, r) => s + r.strike + r.CE.ltp - r.PE.ltp, 0) / validRows.length
      : null;
    const sp = spot || estimatedSpot || chain[Math.floor(chain.length / 2)]?.strike;
    if (!sp) return;

    // Find ATM strike
    const sorted = chain.map(r => r.strike).sort((a, b) => a - b);
    const atmStrike = sorted.reduce((b, s) => Math.abs(s - sp) < Math.abs(b - sp) ? s : b, sorted[0]);
    const atmRow = chain.find(r => r.strike === atmStrike);
    if (!atmRow) return;

    // IV from optionGreek API if available, otherwise back-solve from LTP
    const ceIv = atmRow.CE?.iv || 0, peIv = atmRow.PE?.iv || 0;
    let atmIv = ceIv && peIv ? (ceIv + peIv) / 2 : ceIv || peIv;
    if (!atmIv) {
      const T = Math.max(daysUntil(selectedExpiry) / 365, 1 / 365);
      try {
        const s1 = atmRow.CE?.ltp > 0 ? impliedVolatility(atmRow.CE.ltp, sp, atmStrike, T, R, 'CE') : null;
        const s2 = atmRow.PE?.ltp > 0 ? impliedVolatility(atmRow.PE.ltp, sp, atmStrike, T, R, 'PE') : null;
        const valid = [s1, s2].filter(s => s && s > 0.01 && s < 5);
        if (valid.length) atmIv = (valid.reduce((a, b) => a + b, 0) / valid.length) * 100;
      } catch { atmIv = 0; }
    }
    const displayIv = Math.round((atmIv || 10) * 10) / 10;

    setIvAdj(prev => {
      const next = { ...prev, [selectedExpiry]: displayIv };
      expiries.forEach(e => {
        if (e === selectedExpiry || prev[e] !== undefined) return;
        const extra = Math.max(0, (daysUntil(e) - daysUntil(selectedExpiry)) / 30) * 0.5;
        next[e] = Math.round((displayIv + extra) * 10) / 10;
      });
      return next;
    });

    // Store estimated spot so computeWizard can use it for Greeks/POP
    if (!spot && estimatedSpot) setSpot(Math.round(estimatedSpot * 100) / 100);
  }, [chain, selectedExpiry]); // eslint-disable-line


  function go() {
    const tgt = parseFloat(targetInput);
    if (!chain.length) { alert('Option chain not loaded yet.'); return; }
    if (!tgt) { alert('Please enter a target price.'); return; }
    setComputing(true);
    const expiryMs = angelToDate(selectedExpiry).getTime();
    setTimeout(() => {
      try {
        const r = computeWizard({
          chain, spot, instrument, prediction, targetSpot:tgt, expiryMs,
          enabledHedgeKeys:enabledHedge, enabledUnhegKeys:enabledUnheg,
          spreadGaps, minProfit:minProfitOn?minProfitV:null, maxLoss:maxLossOn?maxLossV:null,
        });
        setResults(r); setSearched(true);
      } catch(err) {
        console.error('[Wizard] compute error:', err);
        setChainErr('Compute error: ' + err.message);
        setResults([]); setSearched(true);
      } finally { setComputing(false); }
    }, 20);
  }

  const sorted = useMemo(() => {
    return [...results].sort((a,b) => {
      const va = sortField==='breakeven'?(a.breakevens?.[0]??0):a[sortField]??0;
      const vb = sortField==='breakeven'?(b.breakevens?.[0]??0):b[sortField]??0;
      return sortAsc?va-vb:vb-va;
    });
  }, [results, sortField, sortAsc]);

  // Per-type counts from actual results
  const hCounts = useMemo(() => {
    const c={buyCall:0,buyPut:0,callSpread:0,putSpread:0,ironCondor:0,ironButterfly:0};
    results.forEach(r=>{ if(r.hKey&&c[r.hKey]!==undefined) c[r.hKey]++; });
    return c;
  }, [results]);
  const uCounts = useMemo(() => {
    const c={sellCall:0,sellPut:0,straddle:0,strangle:0};
    results.forEach(r=>{ if(r.uKey&&c[r.uKey]!==undefined) c[r.uKey]++; });
    return c;
  }, [results]);

  function sort(f) { if(sortField===f) setSortAsc(a=>!a); else { setSortField(f); setSortAsc(false); } }

  function loadIntoBuilder(row) {
    // Dispatch a browser event so the always-mounted StrategyBuilderKeepAlive
    // picks up the new legs without needing to remount.
    const detail = { legs: row.legs, instrument, expiry: selectedExpiry };
    window.dispatchEvent(new CustomEvent('wizardLoadStrategy', { detail }));
    sessionStorage.setItem('sb_wizard_legs', JSON.stringify(row.legs));
    sessionStorage.setItem('sb_instrument', instrument);
    sessionStorage.setItem('sb_expiry', selectedExpiry);
    navigate('/strategy-builder');
  }

  const daysLeft = selectedExpiry ? daysUntil(selectedExpiry) : 0;
  const colHeader = [
    ['pnl','Profit'],
    ['breakeven','Breakeven'],
    ['approxCap','Approx. capital'],
    ['returnPct', `${daysLeft}d return %`],
  ];

  return (
    <div style={{ maxWidth:1200, margin:'0 auto' }}>
      <div style={{ marginBottom:20 }}>
        <div className="page-title">Strategy Wizard</div>
        <div className="page-subtitle">Tell us your market view — we'll rank every suitable strategy by profit</div>
      </div>

      {/* Input bar */}
      <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'16px 20px', marginBottom:14, display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5 }}>Instrument</div>
          <select value={instrument} onChange={e=>setInstrument(e.target.value)}
            style={{ background:'var(--bg-card2)', border:'1px solid var(--border-hover)', borderRadius:8, color:'var(--text-primary)', fontSize:13, padding:'8px 12px', cursor:'pointer', outline:'none', fontWeight:600 }}>
            {['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','SENSEX'].map(i=><option key={i} value={i}>{i}{spot&&i===instrument?' '+spot.toLocaleString('en-IN',{maximumFractionDigits:2}):''}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5 }}>Prediction</div>
          <select value={prediction} onChange={e=>setPrediction(e.target.value)}
            style={{ background:'var(--bg-card2)', border:'1px solid var(--border-hover)', borderRadius:8, color:'var(--text-primary)', fontSize:13, padding:'8px 12px', cursor:'pointer', outline:'none', minWidth:100 }}>
            <option value="above">Above</option>
            <option value="below">Below</option>
            <option value="between">Between</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5 }}>{instrument} Target</div>
          <input type="number" value={targetInput} onChange={e=>setTargetInput(e.target.value)}
            placeholder={spot?String(Math.round(spot)):'e.g. 24500'}
            style={{ background:'var(--bg-card2)', border:'1px solid var(--border-hover)', borderRadius:8, color:'var(--text-primary)', fontSize:13, padding:'8px 12px', outline:'none', width:130 }} />
        </div>
        <div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5 }}>Target date</div>
          <select value={selectedExpiry} onChange={e=>setSelectedExpiry(e.target.value)}
            style={{ background:'var(--bg-card2)', border:'1px solid var(--border-hover)', borderRadius:8, color:'var(--text-primary)', fontSize:13, padding:'8px 12px', cursor:'pointer', outline:'none', minWidth:155 }}>
            {expiries.map(e=><option key={e} value={e}>{fmtExp(e)} ({daysUntil(e)} days)</option>)}
          </select>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={()=>setShowFilters(f=>!f)}
            style={{ background:showFilters?'rgba(59,130,246,0.12)':'var(--bg-card2)', border:`1px solid ${showFilters?'var(--accent)':'var(--border)'}`, borderRadius:8, color:showFilters?'var(--accent)':'var(--text-primary)', fontSize:13, padding:'8px 16px', cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
            ⚙ Filters
          </button>
          <button onClick={go} disabled={!chain.length||computing}
            style={{ background:'var(--accent)', border:'none', borderRadius:8, color:'#fff', fontSize:13, fontWeight:700, padding:'8px 28px', cursor:chain.length?'pointer':'not-allowed', opacity:chain.length?1:0.5 }}>
            {computing?'Working…':'Go'}
          </button>
        </div>
        {loading&&<span style={{ fontSize:12, color:'var(--text-muted)', alignSelf:'center' }}>Loading chain…</span>}
        {chainErr&&<span style={{ fontSize:12, color:'var(--loss)', alignSelf:'center' }}>{chainErr}</span>}
        {chain.length>0&&!loading&&(
          <span style={{ fontSize:11, color:isMarketOpen()?'var(--profit)':'#FFA53D', alignSelf:'center', display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:isMarketOpen()?'var(--profit)':'#FFA53D', display:'inline-block' }}/>
            {isMarketOpen()?'live':'last close'} · {chain.length} strikes
          </span>
        )}
      </div>

      {/* Filters panel */}
      {showFilters&&(
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'20px 24px', marginBottom:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
            <span style={{ fontSize:15, fontWeight:700 }}>Filters</span>
            <button onClick={()=>setShowFilters(false)} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:20 }}>×</button>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'150px 180px 220px 220px', gap:24 }}>
            {/* Premium */}
            <div>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>Premium</div>
              {[['Get',true,()=>{}],['Pay',true,()=>{}]].map(([l])=>(
                <label key={l} style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, marginBottom:8, cursor:'pointer', color:'var(--text-secondary)' }}>
                  <input type="checkbox" defaultChecked /> {l}
                </label>
              ))}
            </div>
            {/* Hedged */}
            <div>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>Hedged strategies</div>
              {[['Buy Call','buyCall'],['Buy Put','buyPut'],['Call Spread','callSpread'],['Put Spread','putSpread'],['Iron Condor','ironCondor'],['Iron Butterfly','ironButterfly']].map(([l,k])=>(
                <label key={k} style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, marginBottom:7, cursor:'pointer', color:'var(--text-secondary)' }}>
                  <input type="checkbox" checked={!!enabledHedge[k]} onChange={e=>setEnabledHedge(p=>({...p,[k]:e.target.checked}))} />
                  {l} <span style={{ color:'var(--text-muted)', fontSize:11 }}>({hCounts[k]||0})</span>
                </label>
              ))}
            </div>
            {/* Unhedged */}
            <div>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>Unhedged strategies</div>
              {[['Sell Call','sellCall'],['Sell Put','sellPut'],['Straddle','straddle'],['Strangle','strangle']].map(([l,k])=>(
                <label key={k} style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, marginBottom:7, cursor:'pointer', color:'var(--text-secondary)' }}>
                  <input type="checkbox" checked={!!enabledUnheg[k]} onChange={e=>setEnabledUnheg(p=>({...p,[k]:e.target.checked}))} />
                  {l} <span style={{ color:'var(--text-muted)', fontSize:11 }}>({uCounts[k]||0})</span>
                </label>
              ))}
            </div>
            {/* ATM IV */}
            <div>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>ATM IV on target ⓘ</div>
              {expiries.slice(0,3).map(e=>(
                <div key={e} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8, fontSize:12, color:'var(--text-secondary)' }}>
                  <span style={{ minWidth:65, fontSize:11 }}>{fmtExp(e)} opts</span>
                  <button onClick={()=>setIvAdj(p=>({...p,[e]:Math.max(1,(p[e]||15)-0.5)},''))}
                    style={{ background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:4, color:'var(--text-primary)', width:22, height:22, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                  <span style={{ fontFamily:'var(--font-mono)', width:32, textAlign:'center' }}>{(ivAdj[e] ?? 15).toFixed(1)}</span>
                  <button onClick={()=>setIvAdj(p=>({...p,[e]:(p[e]||15)+0.5}))}
                    style={{ background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:4, color:'var(--text-primary)', width:22, height:22, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ height:1, background:'var(--border)', margin:'18px 0' }}/>

          <div style={{ display:'grid', gridTemplateColumns:'200px 1fr 1fr 1fr', gap:24, alignItems:'start' }}>
            {/* Spread gap */}
            <div>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>Spread gap ⓘ</div>
              <div style={{ display:'flex', gap:14 }}>
                {[50,100,150].map(g=>(
                  <label key={g} style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer', color:'var(--text-secondary)' }}>
                    <input type="checkbox" checked={spreadGaps.includes(g)} onChange={e=>setSpreadGaps(p=>e.target.checked?[...p,g]:p.filter(x=>x!==g))}/>{g}
                  </label>
                ))}
              </div>
            </div>
            {/* Max loss */}
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <input type="checkbox" checked={maxLossOn} onChange={e=>setMaxLossOn(e.target.checked)}/>
                <span style={{ fontSize:13, color:'var(--text-secondary)' }}>Max loss limit ⓘ</span>
                <input type="number" value={maxLossV} onChange={e=>setMaxLossV(Number(e.target.value))} disabled={!maxLossOn}
                  style={{ marginLeft:'auto', background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:5, color:'var(--text-primary)', fontSize:12, padding:'3px 8px', width:90, opacity:maxLossOn?1:0.4 }}/>
              </div>
              <input type="range" min={0} max={2000000} step={10000} value={maxLossV} disabled={!maxLossOn}
                onChange={e=>setMaxLossV(Number(e.target.value))} style={{ width:'100%', accentColor:'var(--accent)', opacity:maxLossOn?1:0.3 }}/>
            </div>
            {/* Min profit */}
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <input type="checkbox" checked={minProfitOn} onChange={e=>setMinProfitOn(e.target.checked)}/>
                <span style={{ fontSize:13, color:'var(--text-secondary)' }}>Min profit ⓘ</span>
                <input type="number" value={minProfitV} onChange={e=>setMinProfitV(Number(e.target.value))} disabled={!minProfitOn}
                  style={{ marginLeft:'auto', background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:5, color:'var(--text-primary)', fontSize:12, padding:'3px 8px', width:90, opacity:minProfitOn?1:0.4 }}/>
              </div>
              <input type="range" min={0} max={50000} step={500} value={minProfitV} disabled={!minProfitOn}
                onChange={e=>setMinProfitV(Number(e.target.value))} style={{ width:'100%', accentColor:'var(--accent)', opacity:minProfitOn?1:0.3 }}/>
            </div>
            {/* Delta range */}
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <input type="checkbox" disabled/>
                <span style={{ fontSize:13, color:'var(--text-secondary)' }}>Delta range ⓘ</span>
                <span style={{ marginLeft:'auto', fontSize:12, color:'var(--text-muted)', fontFamily:'var(--font-mono)' }}>0 - 1</span>
              </div>
              <input type="range" min={0} max={1} step={0.1} defaultValue={1}
                style={{ width:'100%', accentColor:'var(--accent)' }}/>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {searched&&(
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
          {sorted.length===0?(
            <div style={{ padding:'48px', textAlign:'center', color:'var(--text-muted)', fontSize:14 }}>
              No strategies match your prediction of <strong>{instrument} {prediction} {targetInput}</strong>.<br/>
              Try a different target price, or remove some filters.
            </div>
          ):(
            <>
              <div style={{ padding:'10px 20px', borderBottom:'1px solid var(--border)', fontSize:12, color:'var(--text-muted)' }}>
                We found <strong style={{ color:'var(--text-primary)' }}>{sorted.length} strategies</strong> for your prediction of {instrument} <strong>{prediction}</strong> {targetInput} by {fmtExp(selectedExpiry)}
              </div>
              {/* Column headers */}
              <div style={{ display:'grid', gridTemplateColumns:'2.2fr 1fr 1fr 1fr 1fr 90px', padding:'10px 20px', background:'var(--bg-card2)', borderBottom:'1px solid var(--border)' }}>
                <span style={{ fontSize:11, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em' }}>Trade</span>
                {colHeader.map(([k,l])=>(
                  <button key={k} onClick={()=>sort(k)}
                    style={{ background:'none', border:'none', padding:0, color:sortField===k?'var(--accent)':'var(--text-muted)', cursor:'pointer', fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', textAlign:'right', display:'flex', alignItems:'center', justifyContent:'flex-end', gap:3 }}>
                    {l}<span>{sortField===k?(sortAsc?'↑':'↓'):'↕'}</span>
                  </button>
                ))}
                <span/>
              </div>

              {sorted.map(row=>{
                const badge=getBadge(row.name);
                const exp=expanded===row.id;
                const be=row.breakevens?.[0];
                return (
                  <div key={row.id} style={{ borderBottom:'1px solid var(--border)' }}>
                    {/* Summary row */}
                    <div style={{ display:'grid', gridTemplateColumns:'2.2fr 1fr 1fr 1fr 1fr 90px', padding:'12px 20px', alignItems:'center', background:exp?'rgba(59,130,246,0.04)':'transparent', cursor:'pointer' }}
                      onClick={()=>setExpanded(exp?null:row.id)}>
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                          <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4, background:badge.bg, color:badge.color }}>{badge.label}</span>
                          <span style={{ fontSize:13, fontWeight:600 }}>{row.name}</span>
                          <span style={{ fontSize:11, color:'var(--text-muted)' }}>{fmtExp(selectedExpiry)}</span>
                        </div>
                        <div style={{ fontSize:11, color:'var(--text-muted)' }}>
                          {row.legs.map(l=>`${l.transactionType==='BUY'?'B':'S'} ${l.strike} ${l.optionType}`).join(' · ')}
                        </div>
                      </div>
                      <div style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:700, color:row.pnl>=0?'var(--profit)':'var(--loss)' }}>{fmtMoney(row.pnl,true)}</div>
                      <div style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text-primary)' }}>{be?be.toLocaleString('en-IN',{maximumFractionDigits:0}):'—'}</div>
                      <div style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text-secondary)' }}>{fmtCap(row.approxCap)}</div>
                      <div style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontSize:12, color:row.returnPct>=0?'var(--profit)':'var(--loss)' }}>{fmtPct(row.returnPct)}</div>
                      <div style={{ textAlign:'right' }}>
                        <button onClick={e=>{e.stopPropagation();setExpanded(exp?null:row.id);}}
                          style={{ background:'var(--accent)', border:'none', borderRadius:6, color:'#fff', fontSize:12, padding:'5px 12px', cursor:'pointer' }}>
                          {exp?'Less ↑':'Trade ↓'}
                        </button>
                      </div>
                    </div>

                    {/* Expanded row */}
                    {exp&&(
                      <div style={{ padding:'20px 24px', background:'rgba(255,255,255,0.015)', borderTop:'1px solid var(--border)' }}>
                        {/* Header */}
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
                          <div style={{ flex:1 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                              <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:4, background:badge.bg, color:badge.color }}>{badge.label}</span>
                              <span style={{ fontSize:15, fontWeight:700 }}>{instrument} {fmtExp(selectedExpiry)} — {row.name}</span>
                            </div>
                            <div style={{ fontSize:13, fontWeight:600, color:'var(--text-secondary)', marginBottom:4 }}>How does this trade work?</div>
                            <div style={{ fontSize:13, color:'var(--text-muted)', maxWidth:540 }}>{row.desc}</div>
                          </div>
                          {/* Per-leg details — proper grid like Sensibull */}
                          <div style={{ display:'flex', gap:14, marginLeft:16, flexWrap:'wrap' }}>
                            {row.legs.map((l,i)=>(
                              <div key={i} style={{ textAlign:'center', minWidth:68 }}>
                                <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:3 }}>
                                  {l.transactionType==='BUY'?'B':'S'} {l.strike} {l.optionType}
                                </div>
                                <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:15 }}>
                                  {l.ltp?.toFixed(2)??'—'}
                                </div>
                                <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>
                                  → {(row.legTargetPrices?.[i]||0).toFixed(2)}
                                </div>
                              </div>
                            ))}
                            <div style={{ textAlign:'center', minWidth:68 }}>
                              <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:3 }}>Qty (1 Lot)</div>
                              <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:15 }}>{getLot(instrument)}</div>
                            </div>
                          </div>
                        </div>

                        {/* Stats — matches Sensibull: Max profit | Max loss | POP */}
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:14 }}>
                          <div style={{ background:'var(--bg-card2)', borderRadius:8, padding:'10px 14px' }}>
                            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>Max profit</div>
                            <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:16, color:'var(--profit)' }}>
                              {row.maxProfit > 1e6 ? 'Unlimited' : fmtMoney(row.maxProfit,true)}
                            </div>
                          </div>
                          <div style={{ background:'var(--bg-card2)', borderRadius:8, padding:'10px 14px' }}>
                            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>Max loss</div>
                            <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:16, color:'var(--loss)' }}>
                              {row.maxLoss === null ? 'Unlimited' : '−₹' + Math.abs(row.maxLoss).toLocaleString('en-IN', {maximumFractionDigits:0})}
                            </div>
                          </div>
                          <div style={{ background:'var(--bg-card2)', borderRadius:8, padding:'10px 14px' }}>
                            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>Probability of profit</div>
                            <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:16, color:'var(--text-primary)' }}>
                              {row.pop != null ? `${row.pop}%` : '—'}
                            </div>
                          </div>
                        </div>
                        {/* Profit at target + return on margin */}
                        <div style={{ display:'flex', gap:10, marginBottom:14 }}>
                          <div style={{ background:'rgba(16,217,160,0.07)', border:'1px solid rgba(16,217,160,0.2)', borderRadius:8, padding:'8px 14px', flex:1 }}>
                            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:3 }}>Profit at target ({parseFloat(targetInput).toLocaleString('en-IN')})</div>
                            <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:14, color: row.pnl>=0?'var(--profit)':'var(--loss)' }}>
                              {fmtMoney(row.pnl,true)} <span style={{ fontSize:12, fontWeight:400, color:'var(--text-muted)' }}>({fmtPct(row.returnPct)} on margin)</span>
                            </div>
                          </div>
                          <div style={{ background:'var(--bg-card2)', borderRadius:8, padding:'8px 14px', flex:1 }}>
                            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:3 }}>Approx. margin required</div>
                            <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:14, color:'var(--text-primary)' }}>
                              {fmtCap(row.approxCap)}
                            </div>
                          </div>
                        </div>

                        {/* Greeks */}
                        <details style={{ marginBottom:16 }}>
                          <summary style={{ fontSize:13, color:'var(--accent)', cursor:'pointer', userSelect:'none', marginBottom:8 }}>View Greeks</summary>
                          <div style={{ display:'flex', gap:24, fontSize:12, marginTop:8 }}>
                            {[['Delta',row.greeks.delta?.toFixed(2)],['Gamma',row.greeks.gamma?.toFixed(4)],['Theta / day',row.greeks.theta?.toFixed(2)],['Vega',row.greeks.vega?.toFixed(2)]].map(([k,v])=>(
                              <div key={k}><span style={{ color:'var(--text-muted)' }}>{k} </span><span style={{ fontFamily:'var(--font-mono)', fontWeight:600 }}>{v??'—'}</span></div>
                            ))}
                          </div>
                        </details>

                        {/* Actions */}
                        <div style={{ display:'flex', gap:10 }}>
                          <button onClick={()=>loadIntoBuilder(row)}
                            style={{ background:'var(--accent)', border:'none', borderRadius:8, color:'#fff', fontSize:13, fontWeight:600, padding:'9px 24px', cursor:'pointer' }}>
                            Analyse in Builder
                          </button>
                          <button onClick={()=>{
                            const drafts=JSON.parse(localStorage.getItem('sb_drafts')||'[]');
                            const name=`${instrument} ${selectedExpiry} ${row.name} · ${new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}`;
                            drafts.unshift({id:Date.now(),name,instrument,selectedExpiry,legs:row.legs});
                            localStorage.setItem('sb_drafts',JSON.stringify(drafts.slice(0,20)));
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

      {!searched&&!loading&&chain.length>0&&(
        <div style={{ textAlign:'center', padding:'64px 20px', color:'var(--text-muted)' }}>
          <div style={{ fontSize:36, marginBottom:12, opacity:0.3 }}>✦</div>
          <div style={{ fontSize:15, marginBottom:6, color:'var(--text-secondary)' }}>Set your prediction and click Go</div>
          <div style={{ fontSize:13 }}>We'll rank every suitable strategy by profit at your target price</div>
        </div>
      )}
      {loading&&(
        <div style={{ textAlign:'center', padding:'48px', color:'var(--text-muted)' }}>Loading option chain for {instrument}…</div>
      )}
    </div>
  );
}
