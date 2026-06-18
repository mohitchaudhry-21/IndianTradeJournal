import React, { useState, useEffect, useMemo } from 'react';
import { fetchOptionChain, fetchExpiryList } from '../utils/optionChain';
import { fetchTickerQuotes } from '../utils/tickerQuotes';
import { payoffAt, netPremium, findBreakevens, positionGreeks, maxProfitLoss, impliedFuturesPrice, standardDeviation } from '../utils/optionsAnalysis';
import { KNOWN_SYMBOLS } from '../utils/tickerSymbols';
import { getLotSize } from '../utils/lotSizes';

const RISK_FREE_RATE = 0.065;

// Defensive formatting — broker APIs occasionally return numeric fields as
// strings or omit them entirely, and a bare .toFixed() call on anything
// non-numeric crashes the whole page rather than degrading gracefully.
function fmt(value, decimals = 1) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n.toFixed(decimals) : '—';
}

// OI change is stored as an absolute delta (changeInOi), not a percentage —
// derive the percentage from the implied previous OI. Returns null rather
// than 0 when there's no real OI data (e.g. AngelOne's chain, which never
// reports OI), so the UI can show a dash instead of a misleading "+0%".
function oiChangePct(side) {
  if (!side) return null;
  const prevOi = side.oi - side.changeInOi;
  if (!prevOi) return null;
  return (side.changeInOi / prevOi) * 100;
}

function OiBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 32, height: 6, background: 'var(--bg-card2)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: 6, background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 28 }}>{value ? fmt(value / 100000, 1) + 'L' : '—'}</span>
    </div>
  );
}

function formatAngelExpiry(angelExpiry) {
  // "26JUN2026" -> "26 Jun"
  if (!angelExpiry || angelExpiry.length < 7) return angelExpiry;
  const day = angelExpiry.slice(0, 2);
  const monthAbbr = angelExpiry.slice(2, 5);
  const monthName = monthAbbr.charAt(0) + monthAbbr.slice(1).toLowerCase();
  return `${day} ${monthName}`;
}

let legIdCounter = 0;
function nextLegId() {
  legIdCounter += 1;
  return `leg_${legIdCounter}`;
}

export default function StrategyBuilder() {
  const [instrument, setInstrument] = useState('NIFTY');
  const [expiries, setExpiries] = useState([]);
  const [selectedExpiry, setSelectedExpiry] = useState(null); // AngelOne format e.g. "26JUN2026"
  const [chainRows, setChainRows] = useState([]);
  const [chainSource, setChainSource] = useState(null);
  const [loadingChain, setLoadingChain] = useState(false);
  const [chainError, setChainError] = useState(null);
  const [spot, setSpot] = useState(null);

  const [legs, setLegs] = useState([]); // { id, strike, optionType, transactionType, quantity, lotSize, iv, premium, ltp }
  const [scenarioSpot, setScenarioSpot] = useState(null);
  const [pickerView, setPickerView] = useState('CHAIN'); // 'CHAIN' | 'GREEKS' — OI is now always shown in CHAIN view
  const [hoveredStrike, setHoveredStrike] = useState(null); // strike currently hovered, reveals B/S buttons

  // Fetch available expiries whenever the instrument changes
  useEffect(() => {
    let cancelled = false;
    fetchExpiryList(instrument).then(result => {
      if (cancelled) return;
      if (result.ok && result.expiries.length) {
        setExpiries(result.expiries);
        setSelectedExpiry(result.expiries[0]);
      } else {
        setExpiries([]);
        setSelectedExpiry(null);
      }
    });
    return () => { cancelled = true; };
  }, [instrument]);

  // Clear legs when switching instrument — a strategy mixing NIFTY and
  // BANKNIFTY legs isn't a coherent single payoff, so starting fresh
  // avoids silently producing a nonsensical combined chart.
  useEffect(() => {
    setLegs([]);
    setScenarioSpot(null);
  }, [instrument]);

  // Live spot price, independent of chain source
  useEffect(() => {
    let cancelled = false;
    const fetchSpot = () => {
      fetchTickerQuotes([instrument]).then(result => {
        if (cancelled) return;
        const quote = result.quotes?.find(q => q.name === instrument);
        if (quote?.ltp) setSpot(quote.ltp);
      });
    };
    fetchSpot();
    const intervalId = setInterval(fetchSpot, 7000);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, [instrument]);

  // Fetch the full option chain for the selected instrument + expiry,
  // polled to keep the strike-picker table's LTP/IV/OI columns live.
  useEffect(() => {
    if (!selectedExpiry) return;
    let cancelled = false;

    // The chain fetch utility expects an ISO-ish date for internal format
    // conversion; reconstruct a real Date from the AngelOne string so it
    // round-trips correctly through toNseExpiryFormat/toAngelOneExpiryFormat.
    const isoFromAngel = (() => {
      const day = parseInt(selectedExpiry.slice(0, 2), 10);
      const monthAbbr = selectedExpiry.slice(2, 5).toUpperCase();
      const year = parseInt(selectedExpiry.slice(5), 10);
      const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
      return new Date(year, months[monthAbbr] ?? 0, day).toISOString();
    })();

    const fetchChain = (isFirstLoad) => {
      if (isFirstLoad) setLoadingChain(true);
      fetchOptionChain(instrument, isoFromAngel, RISK_FREE_RATE).then(result => {
        if (cancelled) return;
        if (isFirstLoad) setLoadingChain(false);
        if (!result.ok) {
          if (isFirstLoad) setChainError(result.error);
          return;
        }
        setChainError(null);
        setChainSource(result.source);
        setChainRows(result.rows);
        if (result.underlyingValue) setSpot(result.underlyingValue);
      });
    };

    fetchChain(true);
    const intervalId = setInterval(() => fetchChain(false), 10000);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, [instrument, selectedExpiry]);

  const lotSize = getLotSize(instrument);

  // Add a leg when a strike's LTP cell is clicked. If a leg for this exact
  // strike+type already exists, increment its quantity instead of adding a
  // duplicate row — mirrors how Sensibull's picker behaves.
  function addLeg(strike, optionType, transactionType) {
    const row = chainRows.find(r => r.strike === strike);
    const sideData = row ? row[optionType] : null;
    setLegs(prev => {
      const existingIdx = prev.findIndex(l => l.strike === strike && l.optionType === optionType && l.transactionType === transactionType);
      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = { ...next[existingIdx], quantity: next[existingIdx].quantity + 1 };
        return next;
      }
      return [...prev, {
        id: nextLegId(),
        strike,
        optionType,
        transactionType,
        quantity: 1,
        lotSize,
        iv: sideData?.iv || 15,
        premium: sideData?.ltp || 0,
        ltp: sideData?.ltp || 0,
        ltpIsLive: chainSource === 'nse',
      }];
    });
  }

  function removeLeg(id) {
    setLegs(prev => prev.filter(l => l.id !== id));
  }

  function updateLegQty(id, qty) {
    setLegs(prev => prev.map(l => l.id === id ? { ...l, quantity: Math.max(1, qty) } : l));
  }

  function clearAllLegs() {
    setLegs([]);
  }

  // Keep each leg's iv/ltp synced to the live chain as it refreshes, so a
  // leg added a while ago doesn't sit on a stale snapshot indefinitely.
  useEffect(() => {
    if (!chainRows.length || !legs.length) return;
    setLegs(prev => prev.map(leg => {
      const row = chainRows.find(r => Math.abs(r.strike - leg.strike) < 0.01);
      const sideData = row ? row[leg.optionType] : null;
      if (!sideData) return leg;
      return { ...leg, iv: sideData.iv || leg.iv, ltp: sideData.ltp || leg.ltp, ltpIsLive: chainSource === 'nse' };
    }));
  }, [chainRows, chainSource]); // eslint-disable-line

  const currentSpot = scenarioSpot ?? spot ?? (chainRows[Math.floor(chainRows.length / 2)]?.strike || 0);
  const spotMin = chainRows.length ? Math.min(...chainRows.map(r => r.strike)) : (currentSpot * 0.92);
  const spotMax = chainRows.length ? Math.max(...chainRows.map(r => r.strike)) : (currentSpot * 1.08);

  const expiryDate = useMemo(() => {
    if (!selectedExpiry) return null;
    const day = parseInt(selectedExpiry.slice(0, 2), 10);
    const monthAbbr = selectedExpiry.slice(2, 5).toUpperCase();
    const year = parseInt(selectedExpiry.slice(5), 10);
    const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
    const d = new Date(year, months[monthAbbr] ?? 0, day, 15, 30); // expiry at market close
    return d;
  }, [selectedExpiry]);

  const T = expiryDate ? Math.max(expiryDate.getTime() - Date.now(), 0) / (1000 * 60 * 60 * 24 * 365) : 0;
  const daysToExpiry = expiryDate ? Math.max(expiryDate.getTime() - Date.now(), 0) / (1000 * 60 * 60 * 24) : 0;

  const curPnl = legs.length ? payoffAt(legs, currentSpot, T, RISK_FREE_RATE, true) : null;
  const { maxProfit, maxLoss } = legs.length ? maxProfitLoss(legs, spotMin, spotMax) : { maxProfit: null, maxLoss: null };
  const breakevens = legs.length ? findBreakevens(legs, spotMin, spotMax) : [];
  const greeks = legs.length ? positionGreeks(legs, currentSpot, T) : { delta: 0, gamma: 0, theta: 0, vega: 0 };
  const netPrem = legs.length ? netPremium(legs) : 0;
  const sd = legs.length && currentSpot ? standardDeviation(legs, currentSpot, T) : { sd1: 0, sd2: 0 };
  const futuresPrice = currentSpot ? impliedFuturesPrice(currentSpot, T) : 0;
  const riskReward = (maxLoss < 0 && maxProfit > 0) ? `${(Math.abs(maxLoss) / maxProfit).toFixed(2)} : 1` : '—';

  const chartPoints = useMemo(() => {
    if (!legs.length || !chainRows.length) return [];
    const step = Math.round((spotMax - spotMin) / 50 / 10) * 10 || 10;
    const pts = [];
    for (let s = spotMin; s <= spotMax; s += step) {
      pts.push({ spot: s, onExpiry: payoffAt(legs, s, 0), onTarget: payoffAt(legs, s, T) });
    }
    return pts;
  }, [legs, spotMin, spotMax, T]);

  const maxAbsPnl = chartPoints.length ? Math.max(...chartPoints.map(p => Math.max(Math.abs(p.onExpiry), Math.abs(p.onTarget))), 1) : 1;
  const maxOi = chainRows.length ? Math.max(...chainRows.map(r => Math.max(r.CE?.oi || 0, r.PE?.oi || 0)), 1) : 1;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="page-title">Strategy builder</div>
        {chainSource && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--profit)', display: 'inline-block' }} />
            {chainSource === 'nse' ? 'live from NSE' : 'live from AngelOne'}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={instrument} onChange={e => setInstrument(e.target.value)}
          style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '6px 10px', fontSize: 13 }}>
          {KNOWN_SYMBOLS.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        <span style={{ fontSize: 15, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
          {currentSpot ? Math.round(currentSpot).toLocaleString('en-IN') : '—'}
        </span>
        <span style={{ width: 1, height: 18, background: 'var(--border)' }} />
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Expiry</span>
        <select value={selectedExpiry || ''} onChange={e => setSelectedExpiry(e.target.value)}
          style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '6px 10px', fontSize: 13 }}>
          {expiries.map(exp => <option key={exp} value={exp}>{formatAngelExpiry(exp)}</option>)}
        </select>
      </div>

      {legs.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 16 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Max profit</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: maxProfit > 0 ? 'var(--profit)' : 'var(--text-primary)' }}>
              {maxProfit === null ? '—' : (maxProfit > 0 ? '+' : '') + '₹' + Math.round(maxProfit).toLocaleString('en-IN')}
            </div>
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Max loss</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: maxLoss < 0 ? 'var(--loss)' : 'var(--text-primary)' }}>
              {maxLoss === null ? '—' : '−₹' + Math.abs(Math.round(maxLoss)).toLocaleString('en-IN')}
            </div>
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Risk:reward</div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{riskReward}</div>
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Breakeven</div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{breakevens.length ? breakevens.map(b => Math.round(b).toLocaleString('en-IN')).join(', ') : '—'}</div>
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Net premium</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: netPrem >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
              {netPrem >= 0 ? '+' : '−'}₹{Math.abs(Math.round(netPrem)).toLocaleString('en-IN')}
            </div>
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Days to expiry</div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{daysToExpiry.toFixed(1)}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: legs.length ? '1.4fr 1fr' : '1fr', gap: 16 }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {['CHAIN', 'GREEKS'].map(v => (
                <button key={v} onClick={() => setPickerView(v)}
                  style={{
                    background: pickerView === v ? 'var(--accent)' : 'var(--bg-card2)',
                    color: pickerView === v ? '#fff' : 'var(--text-secondary)',
                    border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer',
                  }}>{v}</button>
              ))}
            </div>
            {loadingChain && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>loading chain…</span>}
            {chainError && <span style={{ fontSize: 11, color: 'var(--loss)' }}>{chainError}</span>}
          </div>

          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase' }}>
                  {pickerView === 'GREEKS' && <th style={{ textAlign: 'right', padding: '4px 6px' }}>Delta</th>}
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>OI chg</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Call OI</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px' }}>Call LTP</th>
                  <th style={{ textAlign: 'center', padding: '4px 6px' }}>Strike</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Put LTP</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Put OI</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>OI chg</th>
                  {pickerView === 'GREEKS' && <th style={{ textAlign: 'left', padding: '4px 6px' }}>Delta</th>}
                </tr>
              </thead>
              <tbody>
                {chainRows.map(row => {
                  const isAtm = Math.abs(row.strike - currentSpot) < (spotMax - spotMin) / chainRows.length / 2;
                  const showCeBtns = row.CE && (isAtm || hoveredStrike === row.strike);
                  const showPeBtns = row.PE && (isAtm || hoveredStrike === row.strike);
                  const ceChg = oiChangePct(row.CE);
                  const peChg = oiChangePct(row.PE);
                  return (
                    <tr key={row.strike}
                      onMouseEnter={() => setHoveredStrike(row.strike)}
                      onMouseLeave={() => setHoveredStrike(prev => prev === row.strike ? null : prev)}
                      style={{ background: isAtm ? 'var(--accent-dim)' : 'transparent', borderTop: isAtm ? '1px solid var(--accent)' : 'none', borderBottom: isAtm ? '1px solid var(--accent)' : 'none' }}>
                      {pickerView === 'GREEKS' && (
                        <td style={{ textAlign: 'right', padding: '5px 6px', color: 'var(--text-secondary)' }}>{fmt(row.CE?.delta, 2)}</td>
                      )}
                      <td style={{ textAlign: 'right', padding: '5px 6px', color: ceChg === null ? 'var(--text-muted)' : ceChg >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                        {ceChg === null ? '—' : `${ceChg >= 0 ? '+' : ''}${Math.round(ceChg)}%`}
                      </td>
                      <td style={{ textAlign: 'right', padding: '5px 6px' }}>
                        {row.CE ? <OiBar value={row.CE.oi} max={maxOi} color="var(--loss)" /> : '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '5px 6px' }}>
                        {row.CE ? (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, minHeight: 18 }}>
                            {showCeBtns && (
                              <button onClick={() => addLeg(row.strike, 'CE', 'BUY')}
                                title="Buy CE"
                                style={{ background: 'none', border: '1px solid var(--profit)', color: 'var(--profit)', borderRadius: 4, padding: '1px 5px', fontSize: 10, cursor: 'pointer' }}>B</button>
                            )}
                            <span style={{ fontFamily: "'JetBrains Mono', monospace", minWidth: 50, textAlign: 'right' }}>
                              {pickerView === 'GREEKS' ? fmt(row.CE.theta) : fmt(row.CE.ltp)}
                            </span>
                            {showCeBtns && (
                              <button onClick={() => addLeg(row.strike, 'CE', 'SELL')}
                                title="Sell CE"
                                style={{ background: 'none', border: '1px solid var(--loss)', color: 'var(--loss)', borderRadius: 4, padding: '1px 5px', fontSize: 10, cursor: 'pointer' }}>S</button>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'center', padding: '5px 6px', fontWeight: isAtm ? 600 : 400, fontFamily: "'JetBrains Mono', monospace" }}>
                        {row.strike.toLocaleString('en-IN')}
                      </td>
                      <td style={{ textAlign: 'left', padding: '5px 6px' }}>
                        {row.PE ? (
                          <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 4, minHeight: 18 }}>
                            {showPeBtns && (
                              <button onClick={() => addLeg(row.strike, 'PE', 'BUY')}
                                title="Buy PE"
                                style={{ background: 'none', border: '1px solid var(--profit)', color: 'var(--profit)', borderRadius: 4, padding: '1px 5px', fontSize: 10, cursor: 'pointer' }}>B</button>
                            )}
                            <span style={{ fontFamily: "'JetBrains Mono', monospace", minWidth: 50 }}>
                              {pickerView === 'GREEKS' ? fmt(row.PE.theta) : fmt(row.PE.ltp)}
                            </span>
                            {showPeBtns && (
                              <button onClick={() => addLeg(row.strike, 'PE', 'SELL')}
                                title="Sell PE"
                                style={{ background: 'none', border: '1px solid var(--loss)', color: 'var(--loss)', borderRadius: 4, padding: '1px 5px', fontSize: 10, cursor: 'pointer' }}>S</button>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'left', padding: '5px 6px' }}>
                        {row.PE ? <OiBar value={row.PE.oi} max={maxOi} color="var(--profit)" /> : '—'}
                      </td>
                      <td style={{ textAlign: 'left', padding: '5px 6px', color: peChg === null ? 'var(--text-muted)' : peChg >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                        {peChg === null ? '—' : `${peChg >= 0 ? '+' : ''}${Math.round(peChg)}%`}
                      </td>
                      {pickerView === 'GREEKS' && (
                        <td style={{ textAlign: 'left', padding: '5px 6px', color: 'var(--text-secondary)' }}>{fmt(row.PE?.delta, 2)}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {legs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Legs ({legs.length})</div>
                <button onClick={clearAllLegs} style={{ background: 'none', border: 'none', color: 'var(--loss)', fontSize: 11, cursor: 'pointer' }}>Clear all</button>
              </div>
              {legs.map(leg => (
                <div key={leg.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--border)', fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      display: 'inline-block', width: 16, height: 16, borderRadius: 3, textAlign: 'center', lineHeight: '16px',
                      fontSize: 10, fontWeight: 700,
                      background: leg.transactionType === 'SELL' ? 'var(--loss-dim)' : 'var(--profit-dim)',
                      color: leg.transactionType === 'SELL' ? 'var(--loss)' : 'var(--profit)',
                    }}>{leg.transactionType === 'SELL' ? 'S' : 'B'}</span>
                    <input type="number" min={1} value={leg.quantity} onChange={e => updateLegQty(leg.id, parseInt(e.target.value, 10) || 1)}
                      style={{ width: 36, background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 12, padding: '2px 4px' }} />
                    <span>× {leg.strike} {leg.optionType}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-secondary)' }}>{fmt(leg.premium)}</span>
                    <button onClick={() => removeLeg(leg.id)} style={{ background: 'none', border: 'none', color: 'var(--loss)', cursor: 'pointer', fontSize: 14, padding: 0 }}>×</button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10 }}>Greeks</div>
              {[['Delta', fmt(greeks.delta, 1)], ['Gamma', fmt(greeks.gamma, 3)], ['Theta / day', fmt(greeks.theta)], ['Vega', fmt(greeks.vega)]].map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{val}</span>
                </div>
              ))}
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Standard deviation</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                <span style={{ color: 'var(--text-secondary)' }}>1 SD</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{Math.round(sd.sd1)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                <span style={{ color: 'var(--text-secondary)' }}>2 SD</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{Math.round(sd.sd2)}</span>
              </div>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Implied futures</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{futuresPrice ? Math.round(futuresPrice).toLocaleString('en-IN') : '—'}</div>
            </div>
          </div>
        )}
      </div>

      {legs.length > 0 && chartPoints.length > 1 && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Projected {curPnl >= 0 ? 'profit' : 'loss'}: <span style={{ color: curPnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                {curPnl >= 0 ? '+' : '−'}₹{Math.abs(Math.round(curPnl)).toLocaleString('en-IN')}
              </span>
            </div>
          </div>
          {(() => {
            const W = 900, H = 280, padL = 50, padR = 16, padT = 16, padB = 30;
            const plotW = W - padL - padR;
            const plotH = H - padT - padB;
            const xScale = s => padL + ((s - spotMin) / (spotMax - spotMin)) * plotW;
            const yScale = v => padT + plotH / 2 - (v / maxAbsPnl) * (plotH / 2);
            const zeroY = yScale(0);
            const expiryPath = chartPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.spot)},${yScale(p.onExpiry)}`).join(' ');
            const targetPath = chartPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.spot)},${yScale(p.onTarget)}`).join(' ');
            const lossAreaPath = `${expiryPath} L${xScale(spotMax)},${zeroY} L${xScale(spotMin)},${zeroY} Z`;
            return (
              <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 280 }}>
                {[0.25, 0.5, 0.75].map(frac => (
                  <line key={frac} x1={padL} y1={padT + plotH * frac} x2={W - padR} y2={padT + plotH * frac} stroke="rgba(255,255,255,0.04)" />
                ))}
                {chainRows.map(row => {
                  const x = xScale(row.strike);
                  const barW = Math.max(plotW / chainRows.length * 0.6, 3);
                  const ceH = ((row.CE?.oi || 0) / maxOi) * (plotH * 0.32);
                  const peH = ((row.PE?.oi || 0) / maxOi) * (plotH * 0.32);
                  return (
                    <g key={row.strike} opacity={0.3}>
                      <rect x={x - barW / 2} y={zeroY - ceH} width={barW} height={ceH} fill="var(--loss)" />
                      <rect x={x - barW / 2} y={zeroY - peH} width={barW} height={peH} fill="var(--profit)" />
                    </g>
                  );
                })}
                <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="rgba(255,255,255,0.1)" />
                <path d={lossAreaPath} fill="var(--loss)" opacity={0.08} />
                <path d={expiryPath} fill="none" stroke="rgba(228,235,248,0.4)" strokeWidth="1.5" strokeDasharray="4,4" />
                <path d={targetPath} fill="none" stroke="var(--profit)" strokeWidth="2.5" />
                <line x1={xScale(currentSpot)} y1={padT} x2={xScale(currentSpot)} y2={H - padB} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3,3" />
                {[0, 0.25, 0.5, 0.75, 1].map(frac => {
                  const val = spotMin + (spotMax - spotMin) * frac;
                  return (
                    <text key={frac} x={xScale(val)} y={H - 8} fontSize="10" fill="var(--text-muted)" textAnchor="middle">
                      {Math.round(val).toLocaleString('en-IN')}
                    </text>
                  );
                })}
              </svg>
            );
          })()}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
              <span>Target spot price</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-primary)' }}>{Math.round(currentSpot).toLocaleString('en-IN')}</span>
            </div>
            <input type="range" min={spotMin} max={spotMax} step={10} value={currentSpot}
              onChange={e => setScenarioSpot(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)' }} />
          </div>
        </div>
      )}

      {legs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          Hover a strike's price and click B or S to start building a strategy.
        </div>
      )}
    </div>
  );
}
