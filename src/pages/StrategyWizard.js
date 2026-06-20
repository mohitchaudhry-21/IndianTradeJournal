import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { payoffAt, positionGreeks, findBreakevens, calibrateLegsIV } from '../utils/optionsAnalysis';
import { fetchOptionChain, fetchAngelOneLtp, angelOneLtpKey, fetchExpiryList } from '../utils/optionChain';
import { STRATEGY_TEMPLATES, getBadge } from '../utils/strategyTemplates';
import { isMarketOpen } from '../utils/marketHours';

const RISK_FREE_RATE = 0.065;
const LOT_SIZES = { NIFTY: 75, BANKNIFTY: 30, FINNIFTY: 65, MIDCPNIFTY: 120, SENSEX: 20, BANKEX: 30 };
function getLotSize(inst) { return LOT_SIZES[inst?.toUpperCase()] || 75; }

function fmtMoney(n, compact = false) {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '+';
  if (compact && abs >= 100000) return sign + '₹' + (abs / 100000).toFixed(2) + 'L';
  return sign + '₹' + abs.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtPct(n) { return !Number.isFinite(n) ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }
function fmtCapital(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(2) + 'L';
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// ─── Wizard computation ────────────────────────────────────────────────────
// For each strategy template at every valid strike offset, compute P&L stats
// at the user's target spot/date. Return all candidates as a ranked array.
function computeWizardResults({ chainRows, currentSpot, instrument, selectedExpiry, prediction, targetSpot, targetDateMs, hedgedOnly, payOnly, getOnly, spreadGaps, minProfit, maxLoss, maxDeltaAbs, ivMap }) {
  if (!chainRows.length || !currentSpot || !targetSpot || !targetDateMs) return [];

  const lotSize = getLotSize(instrument);
  const sortedStrikes = chainRows.map(r => r.strike).sort((a, b) => a - b);
  const atmIdx = sortedStrikes.indexOf(
    sortedStrikes.reduce((b, s) => Math.abs(s - currentSpot) < Math.abs(b - currentSpot) ? s : b, sortedStrikes[0])
  );
  const T = Math.max((targetDateMs - Date.now()) / (365 * 86400000), 0.001);
  const off = (n) => sortedStrikes[Math.max(0, Math.min(sortedStrikes.length - 1, atmIdx + n))];

  // Apply spread gap filter (which strike-step intervals are allowed)
  const stepSize = sortedStrikes.length > 1 ? (sortedStrikes[1] - sortedStrikes[0]) : 50;
  const allowedGaps = new Set(spreadGaps || [50, 100, 150]);

  const results = [];

  // Determine which strategies to try based on prediction
  const applicable = STRATEGY_TEMPLATES.filter(tmpl => {
    if (payOnly && getOnly) { /* both → show all */ }
    else if (payOnly) { if (tmpl.type === 'unhedged') return false; } // paying = buying = hedged
    else if (getOnly) { if (tmpl.type === 'hedged') return false; }  // getting = selling = unhedged
    if (hedgedOnly && tmpl.type === 'unhedged') return false;
    return true;
  });

  // Try each strategy at a range of ATM offsets
  const offsets = [-4, -3, -2, -1, 0, 1, 2, 3, 4];

  applicable.forEach(tmpl => {
    offsets.forEach(baseOffset => {
      // Build legs shifted by baseOffset
      const legTemplates = tmpl.legs(off);
      const legs = legTemplates.map(t => {
        const strike = off(t.stepsFromAtm + baseOffset);
        const row = chainRows.find(r => r.strike === strike);
        const side = row?.[t.optionType];
        if (!side) return null;
        const ltp = side.ltp || 0;
        const iv = side.iv || ivMap?.[selectedExpiry] || 15;
        return {
          id: `${tmpl.name}-${t.stepsFromAtm}-${baseOffset}`,
          strike,
          optionType: t.optionType,
          transactionType: t.transactionType,
          quantity: t.qty || 1,
          lotSize,
          iv,
          premium: ltp,
          ltp,
          ltpIsLive: !!side.ltp,
        };
      });

      if (legs.some(l => !l || !l.ltp)) return; // skip if any leg has no price

      // Apply spread gap filter
      const uniqueStrikes = [...new Set(legs.map(l => l.strike))].sort((a,b)=>a-b);
      if (uniqueStrikes.length > 1) {
        const gap = uniqueStrikes[1] - uniqueStrikes[0];
        if (!allowedGaps.has(gap)) return;
      }

      // Compute calibrated legs so BS matches market prices
      const calibrated = calibrateLegsIV(legs, currentSpot, T, RISK_FREE_RATE);

      // P&L at target
      const pnl = payoffAt(calibrated, targetSpot, T, RISK_FREE_RATE, false);

      // Filter: prediction direction
      const pnlOk = prediction === 'above' ? pnl > 0 :
                    prediction === 'below' ? pnl > 0 :
                    prediction === 'between' ? pnl > 0 : true;
      if (!pnlOk) return;
      if (Number.isFinite(minProfit) && pnl < minProfit) return;

      // Approx capital (net debit for buys, max-loss for spreads, margin approx for naked sells)
      const netPremium = legs.reduce((s, l) => s + (l.transactionType === 'SELL' ? 1 : -1) * l.premium * l.quantity * l.lotSize, 0);
      const hasNakedSell = legs.some(l => l.transactionType === 'SELL') && tmpl.type === 'unhedged';
      let approxCapital;
      if (hasNakedSell) {
        // Approximate NSE SPAN margin for naked index options: ~1.5L per lot
        approxCapital = legs.filter(l => l.transactionType === 'SELL').reduce((s,l) => s + 150000 * l.quantity, 0);
      } else {
        // Defined-risk: capital = net debit paid OR max loss
        approxCapital = netPremium < 0 ? Math.abs(netPremium) : 0; // debit paid
        if (approxCapital === 0) approxCapital = Math.abs(netPremium) * 0.5; // credit spread: margin = max-loss ≈ spread width × qty × lotSize
      }
      if (Number.isFinite(maxLoss) && approxCapital > maxLoss) return;

      // Greeks at current spot/time
      const greeks = positionGreeks(calibrated, currentSpot, T, RISK_FREE_RATE);
      if (Number.isFinite(maxDeltaAbs) && Math.abs(greeks.delta) > maxDeltaAbs) return;

      // Breakeven(s)
      const breakevens = findBreakevens(calibrated, sortedStrikes[0] * 0.9, sortedStrikes[sortedStrikes.length-1] * 1.1, T, RISK_FREE_RATE);

      // Max profit & loss (scan payoff across wide range)
      const scanSpots = Array.from({ length: 300 }, (_, i) => sortedStrikes[0] * 0.85 + i * (sortedStrikes[sortedStrikes.length-1] * 1.15 - sortedStrikes[0] * 0.85) / 299);
      const scanPnls = scanSpots.map(s => payoffAt(calibrated, s, 0));
      const maxProfitVal = Math.max(...scanPnls);
      const maxLossVal = Math.min(...scanPnls);

      // Return % on capital
      const returnPct = approxCapital > 0 ? (pnl / approxCapital) * 100 : 0;

      // POP (use BS probability: for sells it's roughly 1 - delta of short legs)
      const pop = calibrated.reduce((acc, l) => {
        if (l.transactionType !== 'SELL' || l.optionType === 'FUT') return acc;
        const { blackScholes } = require('../utils/optionsAnalysis');
        return acc; // simplified — will show null if not easily computed
      }, null);

      // Days label
      const daysLeft = Math.max(0, (targetDateMs - Date.now()) / 86400000);

      results.push({
        id: `${tmpl.name}::${baseOffset}`,
        name: tmpl.name,
        category: tmpl.category,
        type: tmpl.type,
        legs: calibrated,
        pnl,
        breakevens,
        approxCapital,
        returnPct,
        maxProfit: maxProfitVal,
        maxLoss: maxLossVal,
        netPremium,
        greeks,
        daysLeft: Math.round(daysLeft),
        desc: tmpl.desc,
      });
    });
  });

  // Deduplicate: keep best pnl per strategy name
  const best = {};
  results.forEach(r => {
    if (!best[r.name] || r.pnl > best[r.name].pnl) best[r.name] = r;
  });
  return Object.values(best);
}

// ─── Sort helpers ──────────────────────────────────────────────────────────
const SORT_FIELDS = [
  { key: 'pnl', label: 'Profit' },
  { key: 'breakeven', label: 'Breakeven' },
  { key: 'approxCapital', label: 'Approx. capital' },
  { key: 'returnPct', label: `Return %` },
];

// ─── Main component ────────────────────────────────────────────────────────
export default function StrategyWizard() {
  const navigate = useNavigate();

  // Input state
  const [instrument, setInstrument] = useState('NIFTY');
  const [prediction, setPrediction] = useState('below'); // 'above' | 'below' | 'between'
  const [targetSpot, setTargetSpot] = useState('');
  const [targetSpotHigh, setTargetSpotHigh] = useState(''); // for 'between'
  const [expiries, setExpiries] = useState([]);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [chainRows, setChainRows] = useState([]);
  const [currentSpot, setCurrentSpot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [chainLoaded, setChainLoaded] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Filters
  const [hedgedChecked, setHedgedChecked] = useState(true);
  const [unhedgedChecked, setUnhedgedChecked] = useState(true);
  const [payOnly, setPayOnly] = useState(false);
  const [getOnly, setGetOnly] = useState(false);
  const [spreadGaps, setSpreadGaps] = useState([50, 100, 150]);
  const [minProfit, setMinProfit] = useState('');
  const [maxLossFilter, setMaxLossFilter] = useState('');
  const [minProfitEnabled, setMinProfitEnabled] = useState(false);
  const [maxLossEnabled, setMaxLossEnabled] = useState(false);

  // Results
  const [results, setResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [sortField, setSortField] = useState('pnl');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const instruments = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'];

  // Load expiries when instrument changes
  useEffect(() => {
    let cancelled = false;
    fetchExpiryList(instrument).then(res => {
      if (cancelled) return;
      if (res.ok && res.expiries?.length) {
        setExpiries(res.expiries);
        setSelectedExpiry(res.expiries[0]);
      }
    });
    return () => { cancelled = true; };
  }, [instrument]);

  // Load chain when expiry changes
  useEffect(() => {
    if (!selectedExpiry) return;
    let cancelled = false;
    setChainLoaded(false);
    const isoExpiry = (() => {
      const months = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
      const d = parseInt(selectedExpiry.slice(0,2),10), m = months[selectedExpiry.slice(2,5).toUpperCase()??0], y = parseInt(selectedExpiry.slice(5),10);
      return new Date(y,m,d,15,30).toISOString();
    })();
    fetchOptionChain(instrument, isoExpiry, RISK_FREE_RATE).then(r => {
      if (cancelled || !r.ok || !r.rows?.length) return;
      setChainRows(r.rows);
      if (r.underlyingValue) { setCurrentSpot(r.underlyingValue); if (!targetSpot) setTargetSpot(String(Math.round(r.underlyingValue))); }
      setChainLoaded(true);
    });
    return () => { cancelled = true; };
  }, [selectedExpiry, instrument]);

  function formatExpiry(exp) {
    const months = { JAN:'Jan',FEB:'Feb',MAR:'Mar',APR:'Apr',MAY:'May',JUN:'Jun',JUL:'Jul',AUG:'Aug',SEP:'Sep',OCT:'Oct',NOV:'Nov',DEC:'Dec' };
    const d = parseInt(exp.slice(0,2),10), m = months[exp.slice(2,5).toUpperCase()], y = parseInt(exp.slice(5),10);
    const ms = new Date(y, Object.keys(months).indexOf(exp.slice(2,5).toUpperCase()), d);
    const days = Math.round((ms - Date.now()) / 86400000);
    return `${d} ${m} (${days} days)`;
  }

  function handleSort(field) {
    if (sortField === field) setSortAsc(a => !a);
    else { setSortField(field); setSortAsc(false); }
  }

  function handleGo() {
    if (!chainLoaded || !targetSpot) return;
    setLoading(true);
    const tgt1 = parseFloat(targetSpot);
    const expiryMs = (() => {
      const months = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
      const d = parseInt(selectedExpiry.slice(0,2),10), m = months[selectedExpiry.slice(2,5).toUpperCase()??0], y = parseInt(selectedExpiry.slice(5),10);
      return new Date(y,m,d,15,30).getTime();
    })();
    setTimeout(() => {
      try {
        const raw = computeWizardResults({
          chainRows, currentSpot, instrument, selectedExpiry,
          prediction, targetSpot: tgt1, targetDateMs: expiryMs,
          hedgedOnly: !unhedgedChecked, payOnly, getOnly,
          spreadGaps, minProfit: minProfitEnabled ? parseFloat(minProfit) : null,
          maxLoss: maxLossEnabled ? parseFloat(maxLossFilter) : null,
          maxDeltaAbs: null, ivMap: {},
        });
        setResults(raw);
        setHasSearched(true);
      } finally { setLoading(false); }
    }, 50);
  }

  const sorted = useMemo(() => {
    const arr = [...results];
    arr.sort((a, b) => {
      let va = sortField === 'breakeven' ? (a.breakevens?.[0] ?? 0) : a[sortField] ?? 0;
      let vb = sortField === 'breakeven' ? (b.breakevens?.[0] ?? 0) : b[sortField] ?? 0;
      return sortAsc ? va - vb : vb - va;
    });
    return arr;
  }, [results, sortField, sortAsc]);

  function loadIntoBuilder(row) {
    // Store legs in sessionStorage for StrategyBuilder to pick up
    sessionStorage.setItem('sb_wizard_legs', JSON.stringify(row.legs));
    sessionStorage.setItem('sb_instrument', instrument);
    sessionStorage.setItem('sb_expiry', selectedExpiry);
    navigate('/strategy-builder');
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <div className="page-title">Strategy Wizard</div>
        <div className="page-subtitle">Tell us your market view and we'll find the right strategy for you</div>
      </div>

      {/* Input bar */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {/* Instrument */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Instrument</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-primary)', border: '1px solid var(--border-hover)', borderRadius: 8, padding: '7px 12px' }}>
            <span style={{ fontWeight: 600 }}>{instrument}</span>
            {currentSpot && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{currentSpot.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
            <select value={instrument} onChange={e => setInstrument(e.target.value)} style={{ background: 'transparent', border: 'none', outline: 'none', color: 'transparent', position: 'absolute', opacity: 0, width: '100%' }} />
          </div>
          <select value={instrument} onChange={e => setInstrument(e.target.value)}
            style={{ marginTop: 4, background: 'var(--bg-primary)', border: '1px solid var(--border-hover)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, padding: '7px 12px', cursor: 'pointer', outline: 'none' }}>
            {instruments.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>

        {/* Prediction */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Prediction</div>
          <select value={prediction} onChange={e => setPrediction(e.target.value)}
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-hover)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, padding: '7px 12px', cursor: 'pointer', outline: 'none', minWidth: 100 }}>
            <option value="above">Above</option>
            <option value="below">Below</option>
            <option value="between">Between</option>
          </select>
        </div>

        {/* Target price */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>{instrument} Target</div>
          <input type="number" value={targetSpot} onChange={e => setTargetSpot(e.target.value)} placeholder="e.g. 24500"
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-hover)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, padding: '7px 12px', outline: 'none', width: 120 }} />
        </div>
        {prediction === 'between' && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>& Below</div>
            <input type="number" value={targetSpotHigh} onChange={e => setTargetSpotHigh(e.target.value)} placeholder="e.g. 25000"
              style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-hover)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, padding: '7px 12px', outline: 'none', width: 120 }} />
          </div>
        )}

        {/* Target date = expiry */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5 }}>Target date</div>
          <select value={selectedExpiry} onChange={e => setSelectedExpiry(e.target.value)}
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-hover)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, padding: '7px 12px', cursor: 'pointer', outline: 'none', minWidth: 140 }}>
            {expiries.map(e => <option key={e} value={e}>{formatExpiry(e)}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {/* Filters */}
          <button onClick={() => setShowFilters(f => !f)}
            style={{ background: showFilters ? 'var(--accent-dim)' : 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, padding: '7px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            ⚙ Filters
          </button>
          {/* Go */}
          <button onClick={handleGo} disabled={!chainLoaded || loading}
            style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700, padding: '7px 28px', cursor: chainLoaded ? 'pointer' : 'not-allowed', opacity: chainLoaded ? 1 : 0.6 }}>
            {loading ? 'Working…' : 'Go'}
          </button>
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Filters</span>
            <button onClick={() => setShowFilters(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 24 }}>
            {/* Premium */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Premium</div>
              {[['Get (sell options)', 'get', getOnly, setGetOnly], ['Pay (buy options)', 'pay', payOnly, setPayOnly]].map(([label, key, val, setter]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={val} onChange={e => setter(e.target.checked)} /> {label}
                </label>
              ))}
            </div>
            {/* Hedged / Unhedged */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Strategy type</div>
              {[['Hedged (defined risk)', hedgedChecked, setHedgedChecked], ['Unhedged (naked sells)', unhedgedChecked, setUnhedgedChecked]].map(([label, val, setter]) => (
                <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={val} onChange={e => setter(e.target.checked)} /> {label}
                </label>
              ))}
            </div>
            {/* Spread gap */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Spread gap</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[50, 100, 150].map(gap => (
                  <label key={gap} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={spreadGaps.includes(gap)}
                      onChange={e => setSpreadGaps(prev => e.target.checked ? [...prev, gap] : prev.filter(g => g !== gap))} />
                    {gap}
                  </label>
                ))}
              </div>
            </div>
            {/* Max loss limit */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Max loss limit</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={maxLossEnabled} onChange={e => setMaxLossEnabled(e.target.checked)} />
                Enabled
              </label>
              <input type="number" value={maxLossFilter} onChange={e => setMaxLossFilter(e.target.value)} placeholder="1000000"
                disabled={!maxLossEnabled}
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-hover)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13, padding: '5px 10px', width: '100%', opacity: maxLossEnabled ? 1 : 0.4 }} />
            </div>
            {/* Min profit */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Min profit at target</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={minProfitEnabled} onChange={e => setMinProfitEnabled(e.target.checked)} />
                Enabled
              </label>
              <input type="number" value={minProfit} onChange={e => setMinProfit(e.target.value)} placeholder="0"
                disabled={!minProfitEnabled}
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-hover)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13, padding: '5px 10px', width: '100%', opacity: minProfitEnabled ? 1 : 0.4 }} />
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {hasSearched && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {sorted.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              No strategies match your prediction and filters. Try adjusting the target price or removing some filters.
            </div>
          ) : (
            <>
              <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
                We found <strong style={{ color: 'var(--text-primary)' }}>{sorted.length} strategies</strong> for your prediction of {instrument} <strong>{prediction}</strong> {targetSpot} by {selectedExpiry}
              </div>
              {/* Table header */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 80px', gap: 0, padding: '10px 20px', background: 'var(--bg-card2)', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <span>Trade</span>
                {SORT_FIELDS.map(f => (
                  <button key={f.key} onClick={() => handleSort(f.key)}
                    style={{ background: 'none', border: 'none', color: sortField === f.key ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', padding: 0, textAlign: 'right', display: 'flex', alignItems: 'center', gap: 3 }}>
                    {f.key === 'returnPct' ? `${sorted[0]?.daysLeft || '?'} day return %` : f.label}
                    <span style={{ fontSize: 10 }}>{sortField === f.key ? (sortAsc ? '↑' : '↓') : '↕'}</span>
                  </button>
                ))}
                <span />
              </div>

              {/* Rows */}
              {sorted.map(row => {
                const badge = getBadge(row.name);
                const isExpanded = expandedId === row.id;
                const be = row.breakevens?.[0];

                return (
                  <div key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    {/* Summary row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 80px', gap: 0, padding: '12px 20px', alignItems: 'center', background: isExpanded ? 'var(--bg-card2)' : 'transparent', transition: 'background 0.1s' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: badge.bg, color: badge.color }}>{badge.label}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{row.name}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {row.legs.map(l => `${l.transactionType === 'BUY' ? 'B' : 'S'} ${l.strike} ${l.optionType}`).join(' · ')}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: row.pnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                        {row.pnl >= 0 ? '+' : ''}₹{Math.abs(row.pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </div>
                      <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                        {be ? be.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}
                      </div>
                      <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                        {fmtCapital(row.approxCapital)}
                      </div>
                      <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: row.returnPct >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                        {fmtPct(row.returnPct)}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <button onClick={() => setExpandedId(isExpanded ? null : row.id)}
                          style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, padding: '4px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {isExpanded ? 'Less ↑' : 'More ↓'}
                        </button>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{ padding: '20px 24px', background: 'rgba(255,255,255,0.02)', borderTop: '1px solid var(--border)' }}>
                        {/* Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: badge.bg, color: badge.color }}>{badge.label}</span>
                              <span style={{ fontSize: 15, fontWeight: 700 }}>{instrument} {selectedExpiry} — {row.name}</span>
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 4 }}>How does this trade work?</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{row.desc}</div>
                          </div>
                          {/* LTP / Target price per leg */}
                          <div style={{ display: 'flex', gap: 20 }}>
                            {row.legs.slice(0, 2).map((l, i) => (
                              <div key={i} style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>LTP</div>
                                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 15 }}>{l.ltp?.toFixed(2) ?? '—'}</div>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{l.strike} {l.optionType}</div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Stats row */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
                          {[
                            { label: 'Max profit', value: row.maxProfit > 1e8 ? 'Unlimited' : fmtMoney(row.maxProfit, true), color: row.maxProfit >= 0 ? 'var(--profit)' : 'var(--loss)' },
                            { label: 'Max loss', value: row.maxLoss < -1e8 ? 'Unlimited' : fmtMoney(row.maxLoss, true), color: row.maxLoss <= 0 ? 'var(--loss)' : 'var(--profit)' },
                            { label: 'Profit at target', value: fmtMoney(row.pnl, true), color: row.pnl >= 0 ? 'var(--profit)' : 'var(--loss)' },
                          ].map(s => (
                            <div key={s.label} style={{ background: 'var(--bg-card2)', borderRadius: 8, padding: '10px 14px' }}>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{s.label}</div>
                              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 16, color: s.color }}>{s.value}</div>
                            </div>
                          ))}
                        </div>

                        {/* Greeks */}
                        <details style={{ marginBottom: 16 }}>
                          <summary style={{ fontSize: 13, color: 'var(--accent)', cursor: 'pointer', marginBottom: 8, userSelect: 'none' }}>View Greeks</summary>
                          <div style={{ display: 'flex', gap: 20, fontSize: 12 }}>
                            {[
                              ['Delta', row.greeks.delta?.toFixed(2)],
                              ['Gamma', row.greeks.gamma?.toFixed(4)],
                              ['Theta / day', row.greeks.theta?.toFixed(2)],
                              ['Vega', row.greeks.vega?.toFixed(2)],
                            ].map(([k, v]) => (
                              <div key={k}>
                                <span style={{ color: 'var(--text-muted)' }}>{k} </span>
                                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{v ?? '—'}</span>
                              </div>
                            ))}
                          </div>
                        </details>

                        {/* Action buttons */}
                        <div style={{ display: 'flex', gap: 10 }}>
                          <button onClick={() => loadIntoBuilder(row)}
                            style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, padding: '9px 24px', cursor: 'pointer' }}>
                            Analyse in Builder
                          </button>
                          <button onClick={() => {
                            const drafts = JSON.parse(localStorage.getItem('sb_drafts') || '[]');
                            const name = `${instrument} ${selectedExpiry} ${row.name} · ${new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })}`;
                            drafts.unshift({ id: Date.now(), name, instrument, selectedExpiry, legs: row.legs });
                            localStorage.setItem('sb_drafts', JSON.stringify(drafts.slice(0, 20)));
                            alert('Saved to drafts!');
                          }}
                            style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-secondary)', fontSize: 13, padding: '9px 20px', cursor: 'pointer' }}>
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

      {!hasSearched && chainLoaded && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✦</div>
          <div style={{ fontSize: 15, marginBottom: 6 }}>Set your prediction and click Go</div>
          <div style={{ fontSize: 13 }}>We'll find all strategies that match your market view</div>
        </div>
      )}
      {!chainLoaded && (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>Loading option chain for {instrument}…</div>
      )}
    </div>
  );
}
