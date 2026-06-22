import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { payoffAt, positionGreeks, findBreakevens, calibrateLegsIV, maxProfitLoss } from '../utils/optionsAnalysis';
import { fetchOptionChain, fetchExpiryList, fetchEodChain } from '../utils/optionChain';
import { STRATEGY_TEMPLATES, getBadge } from '../utils/strategyTemplates';
import { isMarketOpen } from '../utils/marketHours';
import { getLotSize } from '../utils/lotSizes';
import { impliedVolatility, blackScholes } from '../utils/blackscholes';

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

// ── Sensibull's 3-expiry rule for the Wizard ──────────────────────────────
// Returns exactly 3 expiries: [next weekly, second weekly, monthly]
// Monthly = last Thursday of nearest month (pre-Sep 2025) or last Tuesday (post-Sep 2025)
// If monthly coincides with expiry #1 or #2, take next month's monthly instead.
function isMonthlyExpiry(exp) {
  const date = angelToDate(exp);
  const y = date.getFullYear(), m = date.getMonth();
  // Last day of month
  const lastDay = new Date(y, m + 1, 0);
  // Pre Sep 2025: last Thursday (day=4); Post Sep 2025: last Tuesday (day=2)
  const targetDay = (y > 2025 || (y === 2025 && m >= 8)) ? 2 : 4;
  // Walk back from last day to find last occurrence of targetDay
  const diff = (lastDay.getDay() - targetDay + 7) % 7;
  const lastTargetDay = new Date(y, m, lastDay.getDate() - diff);
  return date.getDate() === lastTargetDay.getDate() &&
         date.getMonth() === lastTargetDay.getMonth() &&
         date.getFullYear() === lastTargetDay.getFullYear();
}

function pickWizardExpiries(allExpiries) {
  if (!allExpiries.length) return [];
  // Sort by date ascending
  const sorted = [...allExpiries].sort((a, b) => angelToDate(a) - angelToDate(b));
  // Weekly = first two in the list
  const w1 = sorted[0];
  const w2 = sorted[1];
  if (!w1) return [];
  if (!w2) return [w1];
  // Monthly: find the first monthly expiry that isn't w1 or w2
  const monthly = sorted.find(e => isMonthlyExpiry(e) && e !== w1 && e !== w2);
  // If none found (e.g. chain doesn't go far enough), fall back to third expiry
  const third = monthly || sorted[2];
  return [w1, w2, third].filter(Boolean);
}

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
function computePOP(calib, spot, T, R, beLow, beHigh, step, atmIvPct) {
  if (!calib.length || T <= 0) return null;
  // Use ATM IV (not leg-average IV) — Sensibull uses ATM IV for POP.
  // Averaging OTM leg IVs understates the vol smile effect and inflates POP.
  const iv = atmIvPct > 0 ? atmIvPct / 100
    : calib.reduce((s,l) => s + (l.iv || 15), 0) / calib.length / 100;
  if (iv <= 0) return null;
  const sigma = iv * Math.sqrt(T);
  const muLog = Math.log(spot) + (R - iv*iv/2) * T;
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
    enabledHedgeKeys, enabledUnhegKeys, spreadGaps, minProfit, maxLoss, ivForExpiry, selectedExpiryForResult }) {
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
  // Use the MINIMUM positive difference between adjacent sorted strikes so we don't
  // get tripped up by chains where the first two entries happen to be 200 pts apart
  // (the 30 Jun chain has sorted[0]=20000, sorted[1]=20200 → step=200 instead of 50).
  // Min-diff correctly returns 50 for NIFTY regardless of chain structure.
  const diffs = sorted.slice(1).map((s, i) => s - sorted[i]).filter(d => d > 0);
  const step = diffs.length > 0 ? Math.min(...diffs) : 50;
  const beLow  = sorted[0] * 0.85;
  const beHigh = sorted[sorted.length-1] * 1.15;

  const results = [];
  // Debug counters — log to console to see exactly which filter kills strategies
  let dbgTotal=0, dbgCat=0, dbgHedge=0, dbgLeg=0, dbgGap=0, dbgOTM=0, dbgPnl=0, dbgMin=0, dbgDir=0, dbgCap=0, dbgPassed=0;

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
    if (!allowedCats.includes(tmpl.category)) { dbgCat++; return; }

    const hk = HEDGE_KEY[tmpl.name], uk = UNHEG_KEY[tmpl.name];
    if (hk && !enabledHedgeKeys[hk]) { dbgHedge++; return; }
    if (uk && !enabledUnhegKeys[uk]) { dbgHedge++; return; }

    // Cover strikes within range of the target in each direction.
    // CRITICAL: anchor range to SPOT (not target) so we always cover OTM strikes
    // regardless of where target is relative to spot.
    // Sensibull observations (spot~23806, target=24300):
    //   2d:  sell strikes up to spot+500pt, max spread 150pt → ~7 strategies
    //   9d:  sell strikes up to spot+850pt, max spread 300pt → ~46 strategies
    //   37d: sell strikes up to spot+1350pt, max spread 1800pt → ~167 strategies
    const naked = tmpl.type === 'unhedged';
    const daysLeft = Math.max((expiryMs - Date.now()) / 86400000, 1);

    // Max OTM distance from spot for sell anchor — piecewise between calibration pts
    let maxOtmPt;
    if (daysLeft <= 2)       maxOtmPt = 500;
    else if (daysLeft <= 9)  maxOtmPt = Math.round((500 + (daysLeft-2)*(700-500)/7) / step) * step;
    else if (daysLeft <= 37) maxOtmPt = Math.round((700 + (daysLeft-9)*(1350-700)/28) / step) * step;
    else                     maxOtmPt = Math.round(1350 * Math.pow(daysLeft/37, 0.7) / step) * step;

    // Max spread width — piecewise
    let maxSpreadPt;
    if (daysLeft <= 2)       maxSpreadPt = 150;
    else if (daysLeft <= 9)  maxSpreadPt = Math.round((150 + (daysLeft-2)*(300-150)/7) / step) * step;
    else if (daysLeft <= 37) maxSpreadPt = Math.round((300 + (daysLeft-9)*(1800-300)/28) / step) * step;
    else                     maxSpreadPt = Math.round(1800 * Math.pow(daysLeft/37, 0.85) / step) * step;

    // Enumerate sell anchors: from spot (ATM) to spot+maxOtmPt
    // atmIdx is already the index of the strike nearest spot
    const maxAnchorIdx = Math.min(sorted.length - 1, atmIdx + Math.round(maxOtmPt / step));
    const bases = [];
    for (let i = atmIdx; i <= maxAnchorIdx; i++) {
      bases.push(i - atmIdx); // offset from ATM
    }

    const maxWidthSteps = Math.round(maxSpreadPt / step);
    const rawOffsets = tmpl.legs(n => n).map(t => t.stepsFromAtm);
    const absOffsets = rawOffsets.filter(o => o !== 0).map(Math.abs);
    const baseWidth = absOffsets.length ? Math.min(...absOffsets) : 0;
    const widths = baseWidth > 0
      ? Array.from({ length: maxWidthSteps }, (_, i) => i + 1)
      : [1];

    for (const base of bases) {
      for (const widthSteps of widths) {
        const scale = baseWidth > 0 ? widthSteps / baseWidth : 1;

        const legTemplates = tmpl.legs(off);
        const legs = legTemplates.map(t => {
          // base = offset from ATM for the anchor leg
          // Scale the relative leg offset by spread width, then add to anchor
          const scaledStep = Math.round(t.stepsFromAtm * scale);
          const strikeIdx = Math.max(0, Math.min(sorted.length - 1, atmIdx + base + scaledStep));
          const strike = sorted[strikeIdx];
          const row = chain.find(r => r.strike === strike);
          const side = row?.[t.optionType];
          if (!side) return null;

          let ltp = side.ltp || 0;
          if (ltp <= 0 && effectiveSpot > 0 && T_live > 0) {
            const iv = (ivForExpiry || 12) / 100;
            ltp = blackScholes(effectiveSpot, strike, T_live, R, iv, t.optionType).price || 0;
          }
          if (ltp <= 0) return null;

          return {
            id: `${tmpl.name}_${base}_${widthSteps}_${t.stepsFromAtm}`,
            strike, optionType: t.optionType, transactionType: t.transactionType,
            quantity: t.qty || 1, lotSize, iv: side.iv || ivForExpiry || 15,
            premium: ltp, ltp, ltpIsLive: (side.ltp || 0) > 0,
          };
        });
        dbgTotal++;
        if (legs.some(l => !l)) { dbgLeg++; continue; }

        // ── Sensibull spread rules ──────────────────────────────────────────
        const strikesSorted = [...new Set(legs.map(l=>l.strike))].sort((a,b)=>a-b);
        if (strikesSorted.length > 1) {
          const sellStrike = Math.min(...legs.filter(l=>l.transactionType==='SELL').map(l=>l.strike));
          const buyStrike  = Math.max(...legs.filter(l=>l.transactionType==='BUY').map(l=>l.strike));
          const spreadWidth = buyStrike - sellStrike;
          if (spreadWidth > maxSpreadPt) { dbgGap++; continue; }
          // Buy leg can't go beyond the furthest sell anchor + one more spread width
          if (buyStrike > effectiveSpot + maxOtmPt + maxSpreadPt) { dbgGap++; continue; }
          // Spread gap filter (from filter panel)
          if (spreadGaps.length > 0 && !spreadGaps.includes(spreadWidth)) { dbgGap++; continue; }
        }

        // ── OTM-only filter (matches Sensibull exactly) ───────────────────
        const allOTM = legs.every(l =>
          l.optionType === 'CE' ? l.strike >= effectiveSpot :
          l.optionType === 'PE' ? l.strike <= effectiveSpot : true
        );
        if (!allOTM) { dbgOTM++; continue; }

        // ── Same pipeline as OptionsAnalyzer ────────────────────────
        const calib = calibrateLegsIV(legs, effectiveSpot, T_live, R);
        const pnl = payoffAt(calib, targetSpot, 0, R, false);
        if (pnl <= 0) { dbgPnl++; continue; }
        const minProfitThreshold = getLot(instrument) * 6;
        if (pnl < minProfitThreshold) { dbgMin++; continue; }
        if (Number.isFinite(minProfit) && pnl < minProfit) { dbgMin++; continue; }

        // Direction consistency
        if (prediction === 'below') {
          const farDown = Math.min(targetSpot * 0.93, effectiveSpot * 0.93);
          if (payoffAt(calib, farDown, 0, R, false) < 0) { dbgDir++; continue; }
          if (payoffAt(calib, targetSpot * 0.80, 0, R, false) < 0) { dbgDir++; continue; }
        } else if (prediction === 'above') {
          const farUp = Math.max(targetSpot * 1.07, effectiveSpot * 1.07);
          if (payoffAt(calib, farUp, 0, R, false) < 0) { dbgDir++; continue; }
          if (payoffAt(calib, targetSpot * 1.20, 0, R, false) < 0) { dbgDir++; continue; }
        }

        const netPrem = legs.reduce((s,l)=>s+(l.transactionType==='SELL'?1:-1)*l.premium*l.quantity*l.lotSize, 0);
        // naked already declared in outer scope (tmpl.type === 'unhedged')

        // Greeks, breakeven, max profit/loss
        const greeks = positionGreeks(calib, effectiveSpot, T_live, R);
        const beFrom = Math.max(beLow, Math.min(...legs.map(l=>l.strike)) - 200);
        const beTo   = Math.min(beHigh, Math.max(...legs.map(l=>l.strike)) + 200);
        const bes = findBreakevens(calib, beFrom, beTo, 1);
        const { maxProfit, maxLoss: maxLossV } = maxProfitLoss(calib, beLow, beHigh);
        const isNakedSell = naked && legs.some(l=>l.transactionType==='SELL');
        const maxLossDisplay = isNakedSell ? null : maxLossV;

        // ── Margin approximation using NSE SPAN formula ──────────────────
        // Matches Sensibull's displayed values even when market is closed /
        // AngelOne is not connected. The AngelOne API call after Go() will
        // override these with exact SPAN values when a session is active.
        //
        // Naked sell: ~10.5% of notional (NSE requires ~10-11% for index options)
        //   NIFTY@24013 × 65 × 10.5% = ₹1.63L ≈ Sensibull's 1.62L ✓
        //
        // Spread: (spread_width + SPAN_buffer) × lotSize × qty
        //   SPAN buffer ≈ 3 daily SD = spot × IV × √(1/252) × 3 ≈ spot × 2%
        //   150pt spread: (150 + 24000×2%) × 65 = (150+480) × 65 = ₹40,950 ≈ Sensibull's 41k ✓
        //   100pt spread: (100 + 480) × 65 = ₹37,700 ≈ Sensibull's 37k ✓
        const spanBuffer = effectiveSpot * 0.02; // ≈ 480 pts for NIFTY@24000
        const spreStrike = [...new Set(calib.map(l=>l.strike))].sort((a,b)=>a-b);
        const spreadWidth = spreStrike.length > 1 ? spreStrike[spreStrike.length-1] - spreStrike[0] : 0;
        const totalQty = calib.filter(l=>l.transactionType==='SELL').reduce((s,l)=>s+l.quantity,0) || 1;
        const approxCap = naked
          ? effectiveSpot * lotSize * totalQty * 0.105          // naked: 10.5% notional
          : (spreadWidth + spanBuffer) * lotSize * totalQty;    // spread: width + SPAN buffer
        if (Number.isFinite(maxLoss) && approxCap > maxLoss) { dbgCap++; continue; }

        dbgPassed++;
        const pop = computePOP(calib, effectiveSpot, T_live, R, beLow, beHigh, step, ivForExpiry);
        const legTargetPrices = calib.map(l =>
          l.optionType === 'CE' ? Math.max(targetSpot - l.strike, 0) : Math.max(l.strike - targetSpot, 0)
        );
        // Net premium per unit (positive = credit, negative = debit)
        const netPremUnit = legs.reduce((s,l)=>s+(l.transactionType==='SELL'?1:-1)*l.ltp, 0);
        const returnPct = approxCap>0 ? (pnl/approxCap)*100 : 0;
        const strikeKey = calib.map(l=>`${l.transactionType[0]}${l.optionType}${l.strike}`).sort().join('_');

        results.push({
          id:`${strikeKey}::${tmpl.name}`, name:tmpl.name, category:tmpl.category, type:tmpl.type, desc:tmpl.desc,
          strikeKey, legs:calib, pnl, breakevens:bes, approxCap, returnPct, netPrem, netPremUnit,
          maxProfit, maxLoss:maxLossDisplay, greeks, pop, legTargetPrices,
          daysLeft:Math.round(Math.max(0,(expiryMs-Date.now())/86400000)),
          expiry: selectedExpiryForResult || '',
          hKey:hk, uKey:uk,
        });
      } // end widthSteps
    } // end base
  });

  // Deduplicate by exact strike combination (same trade = same strikes, same types)
  // but keep ALL unique variants sorted by profit (Sensibull shows multiple Sell Calls
  // at different strikes, multiple Bear Call Spreads at different strike pairs, etc.)
  console.log(`[Wizard computeWizard] ${selectedExpiryForResult||'?'} spot=${Math.round(effectiveSpot)} tgt=${targetSpot}` +
    ` | tried=${dbgTotal} cat✗=${dbgCat} hedge✗=${dbgHedge} leg✗=${dbgLeg} gap✗=${dbgGap}` +
    ` OTM✗=${dbgOTM} pnl✗=${dbgPnl} min✗=${dbgMin} dir✗=${dbgDir} cap✗=${dbgCap} passed=${dbgPassed}`);
  // Per-template breakdown
  const templateHits = {};
  results.forEach(r => { templateHits[r.name] = (templateHits[r.name]||0)+1; });
  console.log('[Wizard computeWizard] by template:', JSON.stringify(templateHits));
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
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [expanded, setExpanded] = useState(null);
  const [sortField, setSortField] = useState('pnl');
  const [sortAsc, setSortAsc] = useState(false); // false = descending = highest profit first

  // Filters
  const [enabledHedge, setEnabledHedge] = useState({buyCall:true,buyPut:true,callSpread:true,putSpread:true,ironCondor:true,ironButterfly:true});
  const [enabledUnheg, setEnabledUnheg] = useState({sellCall:true,sellPut:true,straddle:true,strangle:true});
  const [enabledExpiries, setEnabledExpiries] = useState({});
  const [spreadGaps, setSpreadGaps] = useState([50,100,150,200,250,300]);
  const [ivAdj, setIvAdj] = useState({});
  const [minProfitOn, setMinProfitOn] = useState(false);
  const [minProfitV, setMinProfitV] = useState(0);
  const [maxLossOn, setMaxLossOn] = useState(false);
  const [maxLossV, setMaxLossV] = useState(1000000);

  // Load expiries — filtered to Sensibull's 3: next weekly, second weekly, monthly
  useEffect(() => {
    fetchExpiryList(instrument).then(r => {
      if (!r.ok || !r.expiries?.length) return;
      const wizardExpiries = pickWizardExpiries(r.expiries);
      setExpiries(wizardExpiries);
      setSelectedExpiry(wizardExpiries[0] || '');
      // All 3 enabled by default — user can toggle in Filters
      const en = {};
      wizardExpiries.forEach(e => { en[e] = true; });
      setEnabledExpiries(en);
    });
    setChain([]); setSpot(null); setResults([]); setSearched(false);
  }, [instrument]);

  // Load chain — try live then EOD fallback
  useEffect(() => {
    if (!selectedExpiry) return;
    let cancelled = false;
    setLoading(true); setChainErr(''); setChain([]); setSpot(null);
    // When target date changes, clear any extra-expiry filter selections so
    // the new search focuses on the chosen expiry only (user can re-add via Filters)
    setEnabledExpiries(prev => {
      const next = {};
      Object.keys(prev).forEach(e => { next[e] = false; });
      next[selectedExpiry] = true;
      return next;
    });
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


  // Load chain for a given expiry (tries live then EOD fallback)
  async function loadChainFor(exp) {
    try {
      if (exp === selectedExpiry && chain.length) {
        console.log(`[Wizard] ${exp}: reusing loaded chain (${chain.length} rows)`);
        return chain;
      }
      // Market closed — go straight to EOD to avoid AB9019 errors
      let res;
      if (!isMarketOpen()) {
        res = await fetchEodChain(instrument, exp, R);
        console.log(`[Wizard] ${exp}: EOD chain ${res.ok ? res.rows?.length + ' rows' : 'FAILED: ' + res.error}`);
      } else {
        res = await fetchOptionChain(instrument, expiryIso(exp), R);
        if (!res.ok || !res.rows?.length) res = await fetchEodChain(instrument, exp, R);
        console.log(`[Wizard] ${exp}: chain ${res.ok ? res.rows?.length + ' rows' : 'FAILED: ' + res.error}`);
      }
      return (res.ok && res.rows?.length) ? res.rows : null;
    } catch(err) {
      console.warn(`[Wizard] loadChainFor ${exp} threw:`, err);
      return null;
    }
  }

  async function go() {
    const tgt = parseFloat(targetInput);
    if (!chain.length) { alert('Option chain not loaded yet.'); return; }
    if (!tgt) { alert('Please enter a target price.'); return; }
    setComputing(true);
    try {
      // Always search the target date expiry, plus any extras explicitly checked in Filters
      const checkedExpiries = [
        selectedExpiry,
        ...expiries.filter(e => e !== selectedExpiry && enabledExpiries[e] === true),
      ];
      console.log('[Wizard] go() — expiries to search:', checkedExpiries);
      const allResults = [];

      for (const exp of checkedExpiries) {
        const chainForExp = await loadChainFor(exp);
        if (!chainForExp) { console.warn(`[Wizard] Skipping ${exp} — no chain data`); continue; }
        const expiryMs = angelToDate(exp).getTime();

        // Estimate spot from put-call parity for this expiry's chain
        const validRows = chainForExp.filter(r => r.CE?.ltp > 0 && r.PE?.ltp > 0);
        const expSpot = validRows.length
          ? validRows.reduce((s,r) => s + r.strike + r.CE.ltp - r.PE.ltp, 0) / validRows.length
          : spot;
        console.log(`[Wizard] ${exp}: effectiveSpot=${Math.round(expSpot||spot)} validLtpRows=${validRows.length}`);

        const r = computeWizard({
          chain: chainForExp, spot: expSpot || spot, instrument, prediction,
          targetSpot: tgt, expiryMs, selectedExpiryForResult: exp,
          enabledHedgeKeys: enabledHedge, enabledUnhegKeys: enabledUnheg,
          spreadGaps, minProfit: minProfitOn ? minProfitV : null,
          maxLoss: maxLossOn ? maxLossV : null,
          ivForExpiry: ivAdj[exp] ?? 12,
        });
        console.log(`[Wizard] ${exp}: ${r.length} strategies found`);
        allResults.push(...r);
      }

      // Sort all results by profit descending, deduplicate by strikeKey+expiry
      const seen = new Set();
      const unique = allResults.filter(r => {
        const k = r.strikeKey + '::' + r.expiry;
        if (seen.has(k)) return false;
        seen.add(k); return true;
      }).sort((a,b) => b.pnl - a.pnl);

      setResults(unique); setSearched(true); setPage(1);

      // Fetch real margins from AngelOne in background
      if (unique.length > 0) {
        const strategies = unique.map(row => ({
          id: row.id, instrument, expiry: row.expiry,
          legs: row.legs.map(l => ({
            strike: l.strike, optionType: l.optionType,
            transactionType: l.transactionType, quantity: l.quantity, lotSize: l.lotSize,
          })),
        }));
        fetch('http://localhost:5001/margin/calculate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ strategies }),
        }).then(res => res.json()).then(data => {
          if (!data.ok || !data.margins) return;
          setResults(prev => prev.map(row => {
            const m = data.margins.find(x => x.id === row.id);
            return (m && m.margin > 0) ? { ...row, approxCap: m.margin } : row;
          }));
        }).catch(() => {});
      }
    } catch(err) {
      console.error('[Wizard] compute error:', err);
      setChainErr('Compute error: ' + err.message);
      setResults([]); setSearched(true);
    } finally { setComputing(false); }
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
    ['returnPct', 'Return %'],
  ];

  return (
    <div style={{ maxWidth:1200, margin:'0 auto' }}>
      <div style={{ marginBottom:20 }}>
        <div className="page-title">Strategy Wizard</div>
        <div className="page-subtitle">Tell us your market view — we'll rank every suitable strategy by profit</div>
      </div>

      {/* Input bar */}
      <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'20px 24px', marginBottom:16, display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:6 }}>Instrument</div>
          <select value={instrument} onChange={e=>setInstrument(e.target.value)}
            style={{ background:'var(--bg-card2)', border:'1px solid var(--border-hover)', borderRadius:8, color:'var(--text-primary)', fontSize:14, padding:'10px 14px', cursor:'pointer', outline:'none', fontWeight:700 }}>
            {['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','SENSEX'].map(i=><option key={i} value={i}>{i}{spot&&i===instrument?' '+spot.toLocaleString('en-IN',{maximumFractionDigits:2}):''}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:6 }}>Prediction</div>
          <select value={prediction} onChange={e=>setPrediction(e.target.value)}
            style={{ background:'var(--bg-card2)', border:'1px solid var(--border-hover)', borderRadius:8, color:'var(--text-primary)', fontSize:13, padding:'8px 12px', cursor:'pointer', outline:'none', minWidth:100 }}>
            <option value="above">Above</option>
            <option value="below">Below</option>
            <option value="between">Between</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:6 }}>{instrument} Target</div>
          <input type="number" value={targetInput} onChange={e=>setTargetInput(e.target.value)}
            placeholder={spot?String(Math.round(spot)):'e.g. 24500'}
            style={{ background:'var(--bg-card2)', border:'1px solid var(--border-hover)', borderRadius:8, color:'var(--text-primary)', fontSize:13, padding:'8px 12px', outline:'none', width:130 }} />
        </div>
        <div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:6 }}>Target date</div>
          <select value={selectedExpiry} onChange={e=>setSelectedExpiry(e.target.value)}
            style={{ background:'var(--bg-card2)', border:'1px solid var(--border-hover)', borderRadius:8, color:'var(--text-primary)', fontSize:13, padding:'8px 12px', cursor:'pointer', outline:'none', minWidth:155 }}>
            {expiries.map((e,i)=><option key={e} value={e}>{fmtExp(e)} ({daysUntil(e)} days){i===2?' · Monthly':''}</option>)}
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
        {loading&&<span style={{ fontSize:12, color:'var(--accent)', alignSelf:'center', display:'flex', alignItems:'center', gap:5 }}>
          <span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', border:'2px solid var(--accent)', borderTopColor:'transparent', animation:'spin 0.7s linear infinite' }}/>
          Loading chain…
        </span>}
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
          <div style={{ display:'flex', flexWrap:'wrap', gap:24 }}>
            {/* Expiry — ALL available expiries with checkboxes */}
            <div style={{ minWidth:130 }}>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>
                Expiry
                {Object.values(enabledExpiries).some(v=>!v) && <span style={{ marginLeft:6, color:'#FFA53D', fontSize:10 }}>⚠ some off</span>}
              </div>
              <div style={{ maxHeight:220, overflowY:'auto', paddingRight:4 }}>
                {expiries.length === 0 && <div style={{ fontSize:11, color:'var(--text-muted)' }}>Loading…</div>}
                {expiries.map((e, i)=>(
                  <label key={e} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, marginBottom:6, cursor:'pointer', color: enabledExpiries[e]?'var(--text-secondary)':'var(--text-muted)' }}>
                    <input type="checkbox" checked={!!enabledExpiries[e]} onChange={ev=>setEnabledExpiries(p=>({...p,[e]:ev.target.checked}))} />
                    {fmtExp(e)}
                    <span style={{ fontSize:10, color:'var(--text-muted)' }}>({daysUntil(e)}d)</span>
                    <span style={{ fontSize:9, color: i===2?'#A78BFA':'var(--accent)', opacity:0.7, marginLeft:2 }}>
                      {i===2?'Monthly':'Weekly'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {/* Premium */}
            <div style={{ minWidth:120 }}>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>Premium</div>
              {[['Get',true,()=>{}],['Pay',true,()=>{}]].map(([l])=>(
                <label key={l} style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, marginBottom:8, cursor:'pointer', color:'var(--text-secondary)' }}>
                  <input type="checkbox" defaultChecked /> {l}
                </label>
              ))}
            </div>
            {/* Hedged */}
            <div style={{ minWidth:180 }}>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>Hedged strategies</div>
              {[['Buy Call','buyCall'],['Buy Put','buyPut'],['Call Spread','callSpread'],['Put Spread','putSpread'],['Iron Condor','ironCondor'],['Iron Butterfly','ironButterfly']].map(([l,k])=>(
                <label key={k} style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, marginBottom:7, cursor:'pointer', color:'var(--text-secondary)' }}>
                  <input type="checkbox" checked={!!enabledHedge[k]} onChange={e=>setEnabledHedge(p=>({...p,[k]:e.target.checked}))} />
                  {l} <span style={{ color:'var(--text-muted)', fontSize:11 }}>({hCounts[k]||0})</span>
                </label>
              ))}
            </div>
            {/* Unhedged */}
            <div style={{ minWidth:180 }}>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>Unhedged strategies</div>
              {[['Sell Call','sellCall'],['Sell Put','sellPut'],['Straddle','straddle'],['Strangle','strangle']].map(([l,k])=>(
                <label key={k} style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, marginBottom:7, cursor:'pointer', color:'var(--text-secondary)' }}>
                  <input type="checkbox" checked={!!enabledUnheg[k]} onChange={e=>setEnabledUnheg(p=>({...p,[k]:e.target.checked}))} />
                  {l} <span style={{ color:'var(--text-muted)', fontSize:11 }}>({uCounts[k]||0})</span>
                </label>
              ))}
            </div>
            {/* ATM IV — all expiries, scrollable */}
            <div style={{ minWidth:160 }}>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>ATM IV on target ⓘ</div>
              <div style={{ maxHeight:220, overflowY:'auto', paddingRight:4 }}>
                {expiries.length === 0 && <div style={{ fontSize:11, color:'var(--text-muted)' }}>—</div>}
                {expiries.map(e=>(
                  <div key={e} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8, fontSize:12,
                    color: enabledExpiries[e] ? 'var(--text-secondary)' : 'var(--text-muted)', opacity: enabledExpiries[e] ? 1 : 0.5 }}>
                    <span style={{ minWidth:55, fontSize:11 }}>{fmtExp(e)}</span>
                    <button onClick={()=>setIvAdj(p=>({...p,[e]:Math.max(1,(p[e]||15)-0.5)}))}
                      style={{ background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:4, color:'var(--text-primary)', width:20, height:20, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>−</button>
                    <span style={{ width:30, textAlign:'center', fontWeight:600 }}>{(ivAdj[e] ?? 15).toFixed(1)}</span>
                    <button onClick={()=>setIvAdj(p=>({...p,[e]:(p[e]||15)+0.5}))}
                      style={{ background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:4, color:'var(--text-primary)', width:20, height:20, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>+</button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ height:1, background:'var(--border)', margin:'18px 0' }}/>

          <div style={{ display:'flex', flexWrap:'wrap', gap:24, alignItems:'start' }}>
            {/* Spread gap */}
            <div style={{ minWidth:280 }}>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)', marginBottom:10 }}>Spread gap ⓘ</div>
              <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
                {[50,100,150,200,250,300].map(g=>(
                  <label key={g} style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer', color:'var(--text-secondary)' }}>
                    <input type="checkbox" checked={spreadGaps.includes(g)} onChange={e=>setSpreadGaps(p=>e.target.checked?[...p,g]:p.filter(x=>x!==g))}/>{g}
                  </label>
                ))}
              </div>
            </div>
            {/* Max loss */}
            <div style={{ minWidth:220 }}>
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
            <div style={{ minWidth:220 }}>
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
            <div style={{ minWidth:180 }}>
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
              <div style={{ padding:'14px 24px', borderBottom:'1px solid var(--border)', fontSize:14, color:'var(--text-muted)' }}>
                We found <strong style={{ color:'var(--text-primary)' }}>{sorted.length} strategies</strong> for your prediction of {instrument} <strong>{prediction}</strong> {targetInput}
              </div>
              {/* Column headers */}
              <div style={{ display:'grid', gridTemplateColumns:'2.2fr 1fr 1fr 1fr 1fr 100px', padding:'12px 24px', background:'var(--bg-card2)', borderBottom:'1px solid var(--border)' }}>
                <span style={{ fontSize:12, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em' }}>Trade</span>
                {colHeader.map(([k,l])=>(
                  <button key={k} onClick={()=>sort(k)}
                    style={{ background:'none', border:'none', padding:0, color:sortField===k?'var(--accent)':'var(--text-muted)', cursor:'pointer', fontSize:12, textTransform:'uppercase', letterSpacing:'0.06em', textAlign:'right', display:'flex', alignItems:'center', justifyContent:'flex-end', gap:3 }}>
                    {l}<span>{sortField===k?(sortAsc?'↑':'↓'):'↕'}</span>
                  </button>
                ))}
                <span/>
              </div>

              {/* Paginated rows */}
              {sorted.slice((page-1)*rowsPerPage, page*rowsPerPage).map(row=>{
                const badge=getBadge(row.name);
                const exp=expanded===row.id;
                const be=row.breakevens?.[0];
                return (
                  <div key={row.id} style={{ borderBottom:'1px solid var(--border)' }}>
                    {/* Summary row */}
                    <div style={{ display:'grid', gridTemplateColumns:'2.2fr 1fr 1fr 1fr 1fr 100px', padding:'16px 24px', alignItems:'center', background:exp?'rgba(59,130,246,0.04)':'transparent', cursor:'pointer' }}
                      onClick={()=>setExpanded(exp?null:row.id)}>
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                          <span style={{ fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:5, background:badge.bg, color:badge.color }}>{badge.label}</span>
                          <span style={{ fontSize:14, fontWeight:700 }}>{row.name}</span>
                          <span style={{ fontSize:12, color:'var(--text-muted)', fontWeight:600 }}>{fmtExp(row.expiry||selectedExpiry)}</span>
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'wrap', marginTop:2 }}>
                          {row.legs.map((l,i)=>(
                            <span key={i} style={{ display:'flex', alignItems:'center', gap:3 }}>
                              {i>0&&<span style={{ color:'var(--border-hover)', fontSize:12 }}>·</span>}
                              <span style={{ fontSize:12, fontWeight:600,
                                color: l.transactionType==='SELL' ? '#F87171' : '#34D399' }}>
                                {l.transactionType==='SELL'?'S':'B'}
                              </span>
                              <span style={{ fontSize:12, color:'var(--text-secondary)' }}>
                                {l.strike} {l.optionType}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div style={{ textAlign:'right', fontWeight:800, fontSize:16, letterSpacing:'-0.02em', color:row.pnl>=0?'var(--profit)':'var(--loss)' }}>{fmtMoney(row.pnl,true)}</div>
                      <div style={{ textAlign:'right', fontWeight:700, fontSize:14, color:'var(--text-primary)' }}>{be?be.toLocaleString('en-IN',{maximumFractionDigits:0}):'—'}</div>
                      <div style={{ textAlign:'right', fontWeight:700, fontSize:14, color:'var(--text-secondary)' }}>{fmtCap(row.approxCap)}</div>
                      <div style={{ textAlign:'right', fontWeight:700, fontSize:14, color:row.returnPct>=0?'var(--profit)':'var(--loss)' }}>{fmtPct(row.returnPct)} <span style={{fontSize:10,color:'var(--text-muted)',fontWeight:400}}>{row.daysLeft}d</span></div>
                      <div style={{ textAlign:'right' }}>
                        <button onClick={e=>{e.stopPropagation();setExpanded(exp?null:row.id);}}
                          style={{ background:'var(--accent)', border:'none', borderRadius:8, color:'#fff', fontSize:13, fontWeight:600, padding:'7px 16px', cursor:'pointer' }}>
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
                              <span style={{ fontSize:15, fontWeight:700 }}>{instrument} {fmtExp(row.expiry||selectedExpiry)} — {row.name}</span>
                            </div>
                            <div style={{ fontSize:13, fontWeight:600, color:'var(--text-secondary)', marginBottom:4 }}>How does this trade work?</div>
                            <div style={{ fontSize:13, color:'var(--text-muted)', maxWidth:540 }}>{row.desc}</div>
                          </div>
                          {/* Per-leg details — proper grid like Sensibull */}
                          <div style={{ display:'flex', gap:14, marginLeft:16, flexWrap:'wrap', alignItems:'flex-start' }}>
                            {/* Net premium (most prominent — Sensibull's "LTP" for spreads) */}
                            <div style={{ textAlign:'center', minWidth:80 }}>
                              <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:3 }}>
                                {row.netPremUnit >= 0 ? 'Get (net)' : 'Pay (net)'}
                              </div>
                              <div style={{ fontWeight:800, fontSize:18,
                                color: row.netPremUnit >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                                ₹{Math.abs(row.netPremUnit).toFixed(2)}
                              </div>
                              <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>per unit</div>
                            </div>
                            <div style={{ width:1, background:'var(--border)', alignSelf:'stretch', margin:'0 4px' }} />
                            {row.legs.map((l,i)=>(
                              <div key={i} style={{ textAlign:'center', minWidth:68 }}>
                                <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:3 }}>
                                  {l.transactionType==='BUY'?'B':'S'} {l.strike} {l.optionType}
                                </div>
                                <div style={{ fontWeight:700, fontSize:14 }}>
                                  {l.ltp?.toFixed(2)??'—'}
                                </div>
                                <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>
                                  → {(row.legTargetPrices?.[i]||0).toFixed(2)}
                                </div>
                              </div>
                            ))}
                            <div style={{ textAlign:'center', minWidth:68 }}>
                              <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:3 }}>Qty (1 Lot)</div>
                              <div style={{ fontWeight:800, fontSize:15 }}>{getLot(instrument)}</div>
                            </div>
                          </div>
                        </div>

                        {/* Stats — matches Sensibull: Max profit | Max loss | POP */}
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:14 }}>
                          <div style={{ background:'var(--bg-card2)', borderRadius:8, padding:'10px 14px' }}>
                            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>Max profit</div>
                            <div style={{ fontWeight:800, fontSize:17, color:'var(--profit)' }}>
                              {row.maxProfit > 1e6 ? 'Unlimited' : fmtMoney(row.maxProfit,true)}
                            </div>
                          </div>
                          <div style={{ background:'var(--bg-card2)', borderRadius:8, padding:'10px 14px' }}>
                            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>Max loss</div>
                            <div style={{ fontWeight:800, fontSize:17, color:'var(--loss)' }}>
                              {row.maxLoss === null ? 'Unlimited' : '−₹' + Math.abs(row.maxLoss).toLocaleString('en-IN', {maximumFractionDigits:0})}
                            </div>
                          </div>
                          <div style={{ background:'var(--bg-card2)', borderRadius:8, padding:'10px 14px' }}>
                            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>Probability of profit</div>
                            <div style={{ fontWeight:800, fontSize:17, color:'var(--text-primary)' }}>
                              {row.pop != null ? `${row.pop}%` : '—'}
                            </div>
                          </div>
                        </div>
                        {/* Profit at target + return on margin */}
                        <div style={{ display:'flex', gap:10, marginBottom:14 }}>
                          <div style={{ background:'rgba(16,217,160,0.07)', border:'1px solid rgba(16,217,160,0.2)', borderRadius:8, padding:'8px 14px', flex:1 }}>
                            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:3 }}>Profit at target ({parseFloat(targetInput).toLocaleString('en-IN')})</div>
                            <div style={{ fontWeight:800, fontSize:15, color: row.pnl>=0?'var(--profit)':'var(--loss)' }}>
                              {fmtMoney(row.pnl,true)} <span style={{ fontSize:12, fontWeight:400, color:'var(--text-muted)' }}>({fmtPct(row.returnPct)} on margin)</span>
                            </div>
                          </div>
                          <div style={{ background:'var(--bg-card2)', borderRadius:8, padding:'8px 14px', flex:1 }}>
                            <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:3 }}>Approx. margin required</div>
                            <div style={{ fontWeight:800, fontSize:15, color:'var(--text-primary)' }}>
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

              {/* Pagination */}
              {sorted.length > 5 && (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'16px', borderTop:'1px solid var(--border)', background:'var(--bg-card2)', flexWrap:'wrap' }}>
                  {/* Rows per page */}
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginRight:12 }}>
                    <span style={{ fontSize:12, color:'var(--text-muted)' }}>Show</span>
                    <select value={rowsPerPage} onChange={e=>{ setRowsPerPage(Number(e.target.value)); setPage(1); }}
                      style={{ background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:6, color:'var(--text-primary)', fontSize:12, padding:'4px 8px', cursor:'pointer' }}>
                      {[5,10,15,20,25,30].map(n=><option key={n} value={n}>{n} rows</option>)}
                    </select>
                  </div>
                  {sorted.length > rowsPerPage && (<>
                    <button onClick={()=>setPage(1)} disabled={page===1}
                      style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, color:'var(--text-muted)', padding:'5px 10px', cursor:page===1?'not-allowed':'pointer', opacity:page===1?0.4:1 }}>«</button>
                    <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
                      style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, color:'var(--text-muted)', padding:'5px 10px', cursor:page===1?'not-allowed':'pointer', opacity:page===1?0.4:1 }}>‹</button>
                    <span style={{ fontSize:13, color:'var(--text-secondary)', padding:'0 8px' }}>
                      Page <strong>{page}</strong> of <strong>{Math.ceil(sorted.length/rowsPerPage)}</strong>
                    </span>
                    <button onClick={()=>setPage(p=>Math.min(Math.ceil(sorted.length/rowsPerPage),p+1))} disabled={page>=Math.ceil(sorted.length/rowsPerPage)}
                      style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, color:'var(--text-muted)', padding:'5px 10px', cursor:page>=Math.ceil(sorted.length/rowsPerPage)?'not-allowed':'pointer', opacity:page>=Math.ceil(sorted.length/rowsPerPage)?0.4:1 }}>›</button>
                    <button onClick={()=>setPage(Math.ceil(sorted.length/rowsPerPage))} disabled={page>=Math.ceil(sorted.length/rowsPerPage)}
                      style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, color:'var(--text-muted)', padding:'5px 10px', cursor:page>=Math.ceil(sorted.length/rowsPerPage)?'not-allowed':'pointer', opacity:page>=Math.ceil(sorted.length/rowsPerPage)?0.4:1 }}>»</button>
                  </>)}
                  <span style={{ fontSize:12, color:'var(--text-muted)', marginLeft:8 }}>{sorted.length} total</span>
                </div>
              )}
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
