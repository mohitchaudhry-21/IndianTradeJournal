import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import DateRangeSelector from '../components/DateRangeSelector';
import { useJournal } from '../context/JournalContext';
import AccountTag from '../components/AccountTag';

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

export default function Dashboard() {
  const { stats, monthlyPnL, positions, accounts, activeAccountId } = useJournal();
  const navigate = useNavigate();

  const recentClosed = useMemo(() =>
    [...positions]
      .filter(p => p.status !== 'OPEN')
      .sort((a, b) => (b.closeDate || b.openDate).localeCompare(a.closeDate || a.openDate))
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
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Instrument</th>
                  <th>Expiry</th>
                  <th>DTE</th>
                  <th>Legs</th>
                  <th>Premium Collected</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.slice(0, 5).map(p => (
                  <tr key={p.positionId} style={{ cursor: 'pointer' }} onClick={() => navigate('/positions')}>
                    <td><span className={`badge ${p.strategyName?.toLowerCase().replace(' ', '_') || 'custom'}`}>{p.strategyName || 'Custom'}</span></td>
                    <td className="text-primary"><div style={{ display:'flex', alignItems:'center', gap:6 }}>{p.instrument}<AccountTag accountId={p.accountId} /></div></td>
                    <td className="mono">{p.expiry ? new Date(p.expiry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</td>
                    <td>
                      <span style={{ color: (p.daysToExpiry ?? 99) <= 3 ? 'var(--loss)' : (p.daysToExpiry ?? 99) <= 7 ? 'var(--accent)' : 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>
                        {p.daysToExpiry !== null ? `${p.daysToExpiry}d` : '—'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.legs.length} leg{p.legs.length > 1 ? 's' : ''}</td>
                    <td className="profit">{fmt(p.netPremiumCollected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Instrument</th>
                  <th>Expiry</th>
                  <th>Premium Collected</th>
                  <th>P&amp;L</th>
                  <th>Return %</th>
                  <th>Close Date</th>
                </tr>
              </thead>
              <tbody>
                {recentClosed.map(p => {
                  const ret = p.netPremiumCollected > 0 ? ((p.realizedPnL || 0) / Math.abs(p.netPremiumCollected)) * 100 : 0;
                  return (
                    <tr key={p.positionId}>
                      <td><span className={`badge ${p.strategyName?.toLowerCase().replace(' ', '_') || 'custom'}`}>{p.strategyName || 'Custom'}</span></td>
                      <td className="text-primary"><div style={{ display:'flex', alignItems:'center', gap:6 }}>{p.instrument}<AccountTag accountId={p.accountId} /></div></td>
                      <td className="mono">{p.expiry ? new Date(p.expiry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</td>
                      <td className="mono">{fmt(p.netPremiumCollected)}</td>
                      <td className={pnlClass(p.realizedPnL)}>{fmt(p.realizedPnL)}</td>
                      <td className={pnlClass(ret)}>{ret >= 0 ? '+' : ''}{ret.toFixed(1)}%</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        {p.closeDate ? new Date(p.closeDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
