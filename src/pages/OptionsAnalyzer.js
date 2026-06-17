import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useJournal } from '../context/JournalContext';
import { fetchOptionChain, toNseSymbol } from '../utils/optionChain';
import {
  payoffAt, intrinsicAt, netPremium, findBreakevens,
  positionGreeks, maxProfitLoss, impliedFuturesPrice, standardDeviation,
} from '../utils/optionsAnalysis';

const RISK_FREE_RATE = 0.065;

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '+';
  return `${sign}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: 'var(--bg-card2)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

export default function OptionsAnalyzer() {
  const { positions } = useJournal();
  const openPositions = useMemo(() => positions.filter(p => p.status === 'OPEN'), [positions]);

  const [selectedPositionId, setSelectedPositionId] = useState(openPositions[0]?.positionId || null);
  const [checkedLegIds, setCheckedLegIds] = useState(new Set());
  const [chainData, setChainData] = useState({}); // legId -> { ltp, iv, oi }
  const [chainSource, setChainSource] = useState(null); // 'nse' | 'angelone' | null
  const [loadingChain, setLoadingChain] = useState(false);
  const [chainError, setChainError] = useState(null);

  const [spot, setSpot] = useState(null);
  const [targetDte, setTargetDte] = useState(null);

  const position = openPositions.find(p => p.positionId === selectedPositionId) || openPositions[0];

  // Reset leg selection + scenario sliders whenever the chosen position changes
  useEffect(() => {
    if (!position) return;
    setCheckedLegIds(new Set(position.legs.map(l => l.id)));
    setTargetDte(position.daysToExpiry ?? 5);
  }, [position?.positionId]); // eslint-disable-line

  // Fetch the live option chain for this position's instrument + expiry,
  // matching each leg's strike + optionType to the chain response.
  useEffect(() => {
    if (!position) return;
    let cancelled = false;
    setLoadingChain(true);
    setChainError(null);

    const symbol = toNseSymbol(position.instrument);
    fetchOptionChain(symbol, position.expiry, RISK_FREE_RATE).then(result => {
      if (cancelled) return;
      setLoadingChain(false);
      if (!result.ok) {
        setChainError(result.error);
        return;
      }
      setChainSource(result.source);
      if (result.underlyingValue) setSpot(result.underlyingValue);

      const byLeg = {};
      position.legs.forEach(leg => {
        const row = result.rows.find(r => r.strike === leg.strike);
        const legData = row ? row[leg.optionType] : null;
        if (legData) {
          byLeg[leg.id] = { ltp: legData.ltp, iv: legData.iv, oi: legData.oi };
        }
      });
      setChainData(byLeg);
      if (!spot) setSpot(position.legs[0]?.strike || 0);
    });

    return () => { cancelled = true; };
  }, [position?.positionId]); // eslint-disable-line

  if (!openPositions.length) {
    return (
      <div style={{ padding: 32 }}>
        <div className="page-title">Options analyzer</div>
        <div style={{ color: 'var(--text-muted)', marginTop: 12 }}>
          No open positions to analyze. Open a position to use the payoff and Greeks analyzer.
        </div>
      </div>
    );
  }
  if (!position) return null;

  // Build leg objects enriched with live chain data (iv/ltp/oi), falling back
  // to the entry premium's implied behavior if the chain hasn't loaded yet.
  const enrichedLegs = position.legs.map(leg => {
    const remainingQty = (leg.quantity || 1) - (leg.exits || []).reduce((s, e) => s + (e.quantity || 0), 0);
    const chain = chainData[leg.id];
    return {
      ...leg,
      quantity: remainingQty,
      iv: chain?.iv ?? 15,
      ltp: chain?.ltp ?? leg.premium,
      oi: chain?.oi ?? 0,
    };
  }).filter(l => l.quantity > 0);

  const activeLegs = enrichedLegs.filter(l => checkedLegIds.has(l.id));

  const spotMin = Math.min(...enrichedLegs.map(l => l.strike)) * 0.92;
  const spotMax = Math.max(...enrichedLegs.map(l => l.strike)) * 1.08;
  const currentSpot = spot || (spotMin + spotMax) / 2;
  const T = (targetDte || 0) / 365;

  const { maxProfit, maxLoss } = maxProfitLoss(activeLegs, spotMin, spotMax);
  const riskReward = (maxLoss < 0 && maxProfit > 0) ? `${(Math.abs(maxLoss) / maxProfit).toFixed(2)} : 1` : '—';
  const breakevens = findBreakevens(activeLegs, spotMin, spotMax);
  const net = netPremium(activeLegs);
  const curPnl = activeLegs.length ? payoffAt(activeLegs, currentSpot, T) : null;
  const intrinsic = activeLegs.length ? intrinsicAt(activeLegs, currentSpot) : null;
  const timeValue = curPnl !== null && intrinsic !== null ? curPnl - intrinsic : null;
  const greeks = activeLegs.length ? positionGreeks(activeLegs, currentSpot, T) : { delta: 0, gamma: 0, theta: 0, vega: 0 };
  const futPrice = impliedFuturesPrice(currentSpot, T);
  const { sd1, sd2 } = standardDeviation(activeLegs, currentSpot, T);

  const toggleLeg = (legId) => {
    setCheckedLegIds(prev => {
      const next = new Set(prev);
      if (next.has(legId)) next.delete(legId); else next.add(legId);
      return next;
    });
  };

  const selectAll = () => setCheckedLegIds(new Set(enrichedLegs.map(l => l.id)));

  // Build chart data points across the spot range for both curves
  const chartPoints = useMemo(() => {
    if (!activeLegs.length) return [];
    const step = Math.round((spotMax - spotMin) / 50 / 10) * 10 || 10;
    const pts = [];
    for (let s = spotMin; s <= spotMax; s += step) {
      pts.push({
        spot: s,
        onTarget: payoffAt(activeLegs, s, T),
        onExpiry: payoffAt(activeLegs, s, 0),
      });
    }
    return pts;
  }, [activeLegs, spotMin, spotMax, T]); // eslint-disable-line

  const maxAbsPnl = Math.max(1, ...chartPoints.map(p => Math.max(Math.abs(p.onTarget), Math.abs(p.onExpiry))));
  const maxOi = Math.max(1, ...enrichedLegs.map(l => l.oi));

  const pnlTablePrices = [
    Math.round(spotMin),
    Math.round(spotMin + (spotMax - spotMin) * 0.25),
    Math.round((spotMin + spotMax) / 2),
    Math.round(spotMin + (spotMax - spotMin) * 0.75),
    Math.round(spotMax),
  ];

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6, flexWrap: 'wrap' }}>
        <div className="page-title" style={{ margin: 0 }}>Options analyzer</div>
        <select
          value={position.positionId}
          onChange={e => setSelectedPositionId(e.target.value)}
          style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, padding: '7px 10px', outline: 'none', minWidth: 260 }}
        >
          {openPositions.map(p => (
            <option key={p.positionId} value={p.positionId}>
              {p.instrument} {p.strategyName} · {p.expiry ? new Date(p.expiry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}
            </option>
          ))}
        </select>
        {loadingChain && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>loading option chain…</span>}
        {chainError && <span style={{ fontSize: 11, color: 'var(--loss)' }}>chain unavailable — using entry premiums</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 18 }}>
        {position.legs.map(l => `${l.strike}${l.optionType}`).join('/')} · {position.legs[0]?.quantity}L × {position.legs[0]?.lotSize}
        {position.daysToExpiry !== null && ` · ${position.daysToExpiry}d to expiry`}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 18 }}>
        <StatCard label="Max profit" value={fmtMoney(maxProfit)} color="var(--profit)" />
        <StatCard label="Max loss" value={fmtMoney(maxLoss)} color="var(--loss)" />
        <StatCard label="Risk:reward" value={riskReward} />
        <StatCard label="Breakeven" value={breakevens.length ? breakevens.map(b => b.toLocaleString('en-IN')).join(' / ') : '—'} />
        <StatCard label="Net premium" value={activeLegs.length ? fmtMoney(net) : '—'} color={net >= 0 ? 'var(--profit)' : 'var(--loss)'} />
        <StatCard label="Time value" value={fmtMoney(timeValue)} />
        <StatCard label="Margin used" value={position.margin ? `₹${Math.round(position.margin).toLocaleString('en-IN')}` : '—'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2.1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 16 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
                <span style={{ width: 9, height: 2, background: 'var(--profit)', display: 'inline-block' }} />On target date
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
                <span style={{ width: 9, height: 0, borderBottom: '1.5px dashed rgba(228,235,248,0.5)', display: 'inline-block' }} />On expiry
              </span>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, background: 'var(--loss)', opacity: 0.4, display: 'inline-block', borderRadius: 1 }} />Call OI</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, background: 'var(--profit)', opacity: 0.4, display: 'inline-block', borderRadius: 1 }} />Put OI</span>
            </div>
          </div>

          <svg viewBox="0 0 700 280" style={{ width: '100%', height: 280 }}>
            {chartPoints.map((p, i) => {
              const x = 40 + (i / (chartPoints.length - 1)) * 630;
              const w = 630 / chartPoints.length;
              const leg = enrichedLegs.reduce((a, b) => Math.abs(b.strike - p.spot) < Math.abs(a.strike - p.spot) ? b : a, enrichedLegs[0]);
              const withinBar = Math.abs(leg.strike - p.spot) < (spotMax - spotMin) / chartPoints.length;
              if (!withinBar || !checkedLegIds.has(leg.id)) return null;
              const barH = (leg.oi / maxOi) * 100;
              return (
                <rect key={i} x={x - w / 2} y={230 - barH} width={w * 0.9} height={barH}
                  fill={leg.optionType === 'CE' ? 'var(--loss)' : 'var(--profit)'} opacity={0.18} />
              );
            })}
            <line x1="40" y1="130" x2="670" y2="130" stroke="rgba(255,255,255,0.06)" />
            {chartPoints.length > 1 && (
              <>
                <polyline
                  points={chartPoints.map((p, i) => `${40 + (i / (chartPoints.length - 1)) * 630},${130 - (p.onExpiry / maxAbsPnl) * 100}`).join(' ')}
                  fill="none" stroke="rgba(228,235,248,0.4)" strokeWidth="1.5" strokeDasharray="4,4"
                />
                <polyline
                  points={chartPoints.map((p, i) => `${40 + (i / (chartPoints.length - 1)) * 630},${130 - (p.onTarget / maxAbsPnl) * 100}`).join(' ')}
                  fill="none" stroke="var(--profit)" strokeWidth="2.5"
                />
              </>
            )}
            {(() => {
              const xPos = 40 + ((currentSpot - spotMin) / (spotMax - spotMin)) * 630;
              return <line x1={xPos} y1="10" x2={xPos} y2="250" stroke="var(--accent)" strokeWidth="1" strokeDasharray="3,3" />;
            })()}
            <text x="40" y="265" fontSize="10" fill="var(--text-muted)">{Math.round(spotMin).toLocaleString('en-IN')}</text>
            <text x="640" y="265" fontSize="10" fill="var(--text-muted)" textAnchor="end">{Math.round(spotMax).toLocaleString('en-IN')}</text>
          </svg>

          <div style={{ textAlign: 'center', marginTop: 10 }}>
            <span style={{
              fontSize: 13, fontFamily: "'JetBrains Mono', monospace", padding: '5px 12px', borderRadius: 6,
              background: curPnl >= 0 ? 'var(--profit-dim)' : 'var(--loss-dim)',
              color: curPnl >= 0 ? 'var(--profit)' : 'var(--loss)',
            }}>
              {activeLegs.length ? `${curPnl >= 0 ? 'Projected profit: ' : 'Projected loss: '}${fmtMoney(curPnl)}` : 'No legs selected'}
            </span>
          </div>

          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                <span>Target spot price</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-primary)' }}>{Math.round(currentSpot).toLocaleString('en-IN')}</span>
              </div>
              <input type="range" min={spotMin} max={spotMax} step={10} value={currentSpot}
                onChange={e => setSpot(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent)' }} />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                <span>Target date</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-primary)' }}>{targetDte}d</span>
              </div>
              <input type="range" min={0} max={Math.max((position.daysToExpiry ?? 5) + 5, 14)} step={1} value={targetDte || 0}
                onChange={e => setTargetDte(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent)' }} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>Greeks (selected legs)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {[
                ['Delta', greeks.delta.toFixed(1)],
                ['Gamma', greeks.gamma.toFixed(3)],
                ['Theta / day', fmtMoney(greeks.theta)],
                ['Vega', fmtMoney(greeks.vega)],
              ].map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 600 }}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>Standard deviation</div>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', fontFamily: "'JetBrains Mono', monospace" }}>
              <tbody>
                <tr><td style={{ padding: '3px 0', fontFamily: 'Inter, sans-serif' }}>1 SD</td><td style={{ textAlign: 'right' }}>{Math.round(sd1).toLocaleString('en-IN')}</td><td style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>{Math.round(currentSpot - sd1).toLocaleString('en-IN')} - {Math.round(currentSpot + sd1).toLocaleString('en-IN')}</td></tr>
                <tr><td style={{ padding: '3px 0', fontFamily: 'Inter, sans-serif' }}>2 SD</td><td style={{ textAlign: 'right' }}>{Math.round(sd2).toLocaleString('en-IN')}</td><td style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>{Math.round(currentSpot - sd2).toLocaleString('en-IN')} - {Math.round(currentSpot + sd2).toLocaleString('en-IN')}</td></tr>
              </tbody>
            </table>
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Target day futures</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, fontWeight: 600 }}>{futPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Implied by carry to target date</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: chainSource === 'nse' ? 'var(--profit)' : chainSource === 'angelone' ? '#FFA53D' : 'var(--text-muted)', display: 'inline-block' }} />
              <span>{checkedLegIds.size} of {enrichedLegs.length} legs selected{chainSource ? ` · ${chainSource === 'nse' ? 'live from NSE' : 'AngelOne (NSE unavailable)'}` : ''}</span>
            </div>
            <button onClick={selectAll} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11, cursor: 'pointer' }}>select all</button>
          </div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', fontFamily: "'JetBrains Mono', monospace" }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th style={{ width: 26 }}></th>
                <th style={{ textAlign: 'left', fontFamily: 'Inter, sans-serif', fontWeight: 500, padding: '4px 0' }}>Leg</th>
                <th style={{ textAlign: 'right', fontWeight: 500, padding: '4px 0' }}>LTP</th>
                <th style={{ textAlign: 'right', fontWeight: 500, padding: '4px 0' }}>IV</th>
                <th style={{ textAlign: 'right', fontWeight: 500, padding: '4px 0' }}>OI</th>
                <th style={{ textAlign: 'right', fontWeight: 500, padding: '4px 0' }}>Delta</th>
                <th style={{ textAlign: 'right', fontWeight: 500, padding: '4px 0' }}>Theta</th>
              </tr>
            </thead>
            <tbody>
              {enrichedLegs.map(leg => {
                const isChecked = checkedLegIds.has(leg.id);
                const sign = leg.transactionType === 'SELL' ? -1 : 1;
                const g = positionGreeks([leg], currentSpot, T);
                return (
                  <tr key={leg.id} style={{ borderTop: '1px solid var(--border)', opacity: isChecked ? 1 : 0.35 }}>
                    <td style={{ padding: '6px 0' }}>
                      <input type="checkbox" checked={isChecked} onChange={() => toggleLeg(leg.id)} style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} />
                    </td>
                    <td style={{ padding: '6px 0', textAlign: 'left', fontFamily: 'Inter, sans-serif' }}>
                      <span style={{ color: leg.transactionType === 'SELL' ? 'var(--loss)' : 'var(--profit)', fontWeight: 600 }}>{leg.transactionType}</span> {leg.strike} {leg.optionType}
                    </td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{leg.ltp.toFixed(1)}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{leg.iv.toFixed(1)}%</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{(leg.oi / 100000).toFixed(1)}L</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{(sign * g.delta).toFixed(2)}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>{(sign * g.theta).toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>P&L at key prices</div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', fontFamily: "'JetBrains Mono', monospace" }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th style={{ textAlign: 'left', fontFamily: 'Inter, sans-serif', fontWeight: 500, padding: '3px 0' }}>Spot</th>
                <th style={{ textAlign: 'right', fontWeight: 500, padding: '3px 0' }}>On expiry</th>
                <th style={{ textAlign: 'right', fontWeight: 500, padding: '3px 0' }}>On target date</th>
              </tr>
            </thead>
            <tbody>
              {pnlTablePrices.map(price => {
                const expiryPnl = activeLegs.length ? payoffAt(activeLegs, price, 0) : 0;
                const targetPnl = activeLegs.length ? payoffAt(activeLegs, price, T) : 0;
                return (
                  <tr key={price} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '5px 0', textAlign: 'left', fontFamily: 'Inter, sans-serif' }}>{price.toLocaleString('en-IN')}</td>
                    <td style={{ padding: '5px 0', textAlign: 'right', color: expiryPnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>{fmtMoney(expiryPnl)}</td>
                    <td style={{ padding: '5px 0', textAlign: 'right', color: targetPnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>{fmtMoney(targetPnl)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Uncheck a leg to exclude it from every panel above. IV/OI sourced from the live option chain (NSE primary, AngelOne fallback). Greeks calculated with Black-Scholes using that market-quoted IV per strike.
      </div>
    </div>
  );
}
