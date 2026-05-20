import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import DateRangeSelector from '../components/DateRangeSelector';
import { useJournal } from '../context/JournalContext';

function fmt(n) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 100000) return (n < 0 ? '-' : '+') + '₹' + (abs / 100000).toFixed(2) + 'L';
  if (abs >= 1000) return (n < 0 ? '-' : '+') + '₹' + (abs / 1000).toFixed(1) + 'K';
  return (n < 0 ? '-' : '+') + '₹' + Math.abs(n).toFixed(0);
}

function fmtSimple(n) {
  if (!n) return '₹0';
  const abs = Math.abs(n);
  if (abs >= 100000) return (n < 0 ? '-' : '') + '₹' + (abs / 100000).toFixed(2) + 'L';
  if (abs >= 1000) return (n < 0 ? '-' : '') + '₹' + (abs / 1000).toFixed(1) + 'K';
  return (n < 0 ? '-' : '') + '₹' + abs.toFixed(0);
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const pnl = payload[0].value;
  return (
    <div style={{ background: '#1a1f2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, color: pnl >= 0 ? 'var(--profit)' : 'var(--loss)', fontWeight: 500 }}>
        {fmt(pnl)}
      </div>
    </div>
  );
};


// Inline account tag — shows coloured pill only when viewing All Accounts
function AccountTag({ accountId }) {
  const { accounts, activeAccountId } = useJournal();
  if (activeAccountId || !accountId) return null;
  const acc = accounts.find(a => a.id === accountId);
  if (!acc) return null;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:3,
      fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:10,
      background:(acc.color||'#3B82F6')+'22', color:acc.color||'#3B82F6',
      border:`1px solid ${acc.color||'#3B82F6'}44`, whiteSpace:'nowrap',
    }}>
      <span style={{width:5,height:5,borderRadius:'50%',background:acc.color||'#3B82F6'}}/>
      {acc.name}
    </span>
  );
}

export default function Dashboard() {
  const { stats, monthlyPnL, positions, accounts, activeAccountId } = useJournal();
  const navigate = useNavigate();

  const recentClosed = useMemo(() =>
    [...positions]
      .filter(p => p.status !== 'OPEN')
      .sort((a, b) => { const da = b.closeDate || b.openDate || ''; const db = a.closeDate || a.openDate || ''; return da > db ? 1 : da < db ? -1 : 0; })
      .slice(0, 6),
    [positions]
  );

  const openPositions = useMemo(() =>
    positions.filter(p => p.status === 'OPEN')
      .sort((a, b) => (a.daysToExpiry ?? 999) - (b.daysToExpiry ?? 999)),
    [positions]
  );

  const chartData = monthlyPnL.slice(-8);

  const pnlClass = (n) => n > 0 ? 'profit' : n < 0 ? 'loss' : '';

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="page-title">Dashboard</div>
              {activeAccountId && (() => {
                const acc = accounts.find(a => a.id === activeAccountId);
                return acc ? (
                  <span style={{ fontSize: 12, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '3px 10px', borderRadius: 20, fontWeight: 600, border: '1px solid rgba(59,130,246,0.2)' }}>
                    {acc.name}
                  </span>
                ) : null;
              })()}
            </div>
            <div className="page-subtitle">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <DateRangeSelector />
          <button className="btn btn-primary" onClick={() => navigate('/entry')}>
            + Add Trade
          </button>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">Total P&amp;L</div>
          <div className={`value ${pnlClass(stats.totalPnL)}`}>{fmtSimple(stats.totalPnL)}</div>
          <div className="subval">{stats.totalPositions} positions closed</div>
        </div>
        <div className="stat-card">
          <div className="label">This Month</div>
          <div className={`value ${pnlClass(stats.thisMonthPnL)}`}>{fmtSimple(stats.thisMonthPnL)}</div>
          <div className="subval">{new Date().toLocaleString('default', { month: 'long' })}</div>
        </div>
        <div className="stat-card">
          <div className="label">Open Positions</div>
          <div className="value accent">{stats.openPositions}</div>
          <div className="subval">{stats.expiringThisWeek > 0 ? `⚠ ${stats.expiringThisWeek} expiring this week` : 'No expiry this week'}</div>
        </div>
        <div className="stat-card">
          <div className="label">Win Rate</div>
          <div className="value profit">{stats.winRate.toFixed(1)}%</div>
          <div className="subval">PF: {isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'} · {stats.totalPositions} trades</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        {/* Monthly P&L Chart */}
        <div className="card">
          <div className="section-header">
            <div className="section-title">Monthly P&amp;L</div>
          </div>
          {chartData.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 0' }}>
              <div className="icon">📊</div>
              <p>No closed positions yet</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} barSize={24}>
                <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.pnl >= 0 ? 'var(--profit)' : 'var(--loss)'} opacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Key metrics */}
        <div className="card">
          <div className="section-title" style={{ marginBottom: 18 }}>Performance Metrics</div>
          {[
            { label: 'Win Rate', value: stats.winRate.toFixed(1) + '%', color: 'var(--profit)' },
            { label: 'Profit Factor', value: isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞', color: stats.profitFactor >= 1 ? 'var(--profit)' : 'var(--loss)' },
            { label: 'Avg Win', value: fmtSimple(stats.avgWin), color: 'var(--profit)' },
            { label: 'Avg Loss', value: '−' + fmtSimple(stats.avgLoss), color: 'var(--loss)' },
            { label: 'Total Positions', value: stats.totalPositions, color: 'var(--text-primary)' },
            { label: 'Open Positions', value: stats.openPositions, color: 'var(--accent)' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 500, color }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Open positions */}
      {openPositions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="section-header">
            <div className="section-title">Open Positions</div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/positions')}>View All →</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {openPositions.slice(0, 5).map(p => {
              const dteUrgent = p.daysToExpiry !== null && p.daysToExpiry <= 1;
              const dteWarn   = p.daysToExpiry !== null && p.daysToExpiry <= 3;
              const sells = p.legs?.filter(l => l.transactionType === 'SELL') || [];
              const buys  = p.legs?.filter(l => l.transactionType === 'BUY')  || [];
              const pe_sell = sells.find(l => l.optionType === 'PE');
              const pe_buy  = buys.find(l => l.optionType === 'PE');
              const ref = sells[0] || buys[0];
              const lotSize = ref?.lotSize || 1;
              const lots = ref?.quantity || 1;
              const gross = pe_sell && pe_buy ? Math.abs(pe_sell.strike - pe_buy.strike) * lotSize * lots : 0;
              const maxLoss = gross ? -(gross - Math.abs(p.netPremiumCollected)) : null;
              const strikesSummary = p.legs?.map(l =>
                `${l.optionType} ${l.transactionType === 'SELL' ? 'S' : 'B'} ${l.strike?.toLocaleString('en-IN')}  @₹${l.premium}`
              ).join('   ·   ');
              return (
                <div key={p.positionId}
                  onClick={() => navigate('/positions')}
                  style={{
                    background: dteUrgent ? 'rgba(240,86,110,0.06)' : dteWarn ? 'rgba(245,158,11,0.04)' : 'var(--bg-card)',
                    border: `1px solid ${dteUrgent ? 'rgba(240,86,110,0.2)' : dteWarn ? 'rgba(245,158,11,0.15)' : 'var(--border)'}`,
                    borderRadius: 10, padding: '14px 18px', cursor: 'pointer', transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = dteUrgent ? 'rgba(240,86,110,0.06)' : dteWarn ? 'rgba(245,158,11,0.04)' : 'var(--bg-card)'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: strikesSummary ? 8 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className={`badge ${p.strategyName?.toLowerCase().replace(/ /g,'_') || 'custom'}`}>{p.strategyName || 'Custom'}</span>
                      <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{p.instrument}</span>
                      <AccountTag accountId={p.accountId} />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Exp: {p.expiry ? new Date(p.expiry).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' }) : '—'}
                      </span>
                      {p.daysToExpiry !== null && (
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                          background: dteUrgent ? 'rgba(240,86,110,0.15)' : dteWarn ? 'rgba(245,158,11,0.12)' : 'var(--bg-card2)',
                          color: dteUrgent ? 'var(--loss)' : dteWarn ? 'var(--accent)' : 'var(--text-muted)',
                        }}>{p.daysToExpiry}d to expiry</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Net Premium</div>
                        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 600, color: 'var(--profit)' }}>{fmt(p.netPremiumCollected)}</div>
                      </div>
                      {maxLoss !== null && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Max Loss</div>
                          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 600, color: 'var(--loss)' }}>{fmt(maxLoss)}</div>
                        </div>
                      )}
                      {p.margin && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Margin</div>
                          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, color: 'var(--text-secondary)' }}>
                            {p.margin >= 100000 ? '₹'+(p.margin/100000).toFixed(1)+'L' : '₹'+(p.margin/1000).toFixed(0)+'K'}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {strikesSummary && (
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.03em' }}>
                      {strikesSummary}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent closed */}
      <div>
        <div className="section-header">
          <div className="section-title">Recent Closed Positions</div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/history')}>View All →</button>
        </div>
        {recentClosed.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="icon">📋</div>
              <p>No closed positions yet. Add your first trade!</p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {recentClosed.map(p => {
              const ret = p.margin
                ? ((p.realizedPnL || 0) / p.margin) * 100
                : p.netPremiumCollected > 0 ? ((p.realizedPnL || 0) / Math.abs(p.netPremiumCollected)) * 100 : 0;
              const netPnl = p.realizedPnL !== null && p.charges ? p.realizedPnL - p.charges : p.realizedPnL;
              const strikesSummary = p.legs?.map(l =>
                `${l.optionType} ${l.transactionType === 'SELL' ? 'S' : 'B'} ${l.strike?.toLocaleString('en-IN')}`
              ).join('  ·  ');
              return (
                <div key={p.positionId}
                  onClick={() => navigate('/history')}
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', cursor: 'pointer', transition: 'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-card)'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: strikesSummary ? 8 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className={`badge ${p.strategyName?.toLowerCase().replace(/ /g,'_') || 'custom'}`}>{p.strategyName || 'Custom'}</span>
                      <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{p.instrument}</span>
                      <AccountTag accountId={p.accountId} />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Exp: {p.expiry ? new Date(p.expiry).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' }) : '—'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Closed: {p.closeDate ? new Date(p.closeDate).toLocaleDateString('en-IN', { day:'2-digit', month:'short' }) : '—'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Net P&L</div>
                        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 700, color: (netPnl||0) >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                          {netPnl !== null ? fmt(netPnl) : fmt(p.realizedPnL)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                          Return {p.margin ? '(margin)' : '(premium)'}
                        </div>
                        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 600, color: ret >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                          {(ret >= 0 ? '+' : '') + ret.toFixed(1) + '%'}
                        </div>
                      </div>
                      {p.margin && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Margin</div>
                          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: 'var(--text-secondary)' }}>
                            {p.margin >= 100000 ? '₹'+(p.margin/100000).toFixed(1)+'L' : '₹'+(p.margin/1000).toFixed(0)+'K'}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {strikesSummary && (
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.03em' }}>
                      {strikesSummary}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
  );
}
