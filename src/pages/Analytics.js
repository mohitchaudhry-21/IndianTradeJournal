import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';
import AccountBadge from '../components/AccountBadge';
import DateRangeSelector from '../components/DateRangeSelector';
import { useJournal } from '../context/JournalContext';

function fmt(n) {
  if (!n) return '₹0';
  const abs = Math.abs(n);
  if (abs >= 100000) return (n<0?'-':'') + '₹' + (abs/100000).toFixed(2) + 'L';
  if (abs >= 1000) return (n<0?'-':'') + '₹' + (abs/1000).toFixed(1) + 'K';
  return (n<0?'-':'') + '₹' + abs.toFixed(0);
}

const COLORS = ['#F59E0B', '#10D9A0', '#F0566E', '#60A5FA', '#A78BFA', '#34D399', '#FB923C'];

const TT = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div style={{ background: '#1a1f2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 4 }}>{label || payload[0].name}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, color: v >= 0 ? 'var(--profit)' : 'var(--loss)', fontWeight: 500 }}>
        {(v < 0 ? '-' : '+') + '₹' + Math.abs(v).toLocaleString('en-IN')}
      </div>
    </div>
  );
};

function StatBlock({ label, value, sub, color }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value mono" style={{ color: color || 'var(--text-primary)', fontSize: 22 }}>{value}</div>
      {sub && <div className="subval">{sub}</div>}
    </div>
  );
}

export default function Analytics() {
  const { positions, monthlyPnL, stats } = useJournal();

  const closed = useMemo(() => positions.filter(p => p.status !== 'OPEN' && (p.realizedPnL || 0) !== 0), [positions]);
  const allClosed = useMemo(() => positions.filter(p => p.status !== 'OPEN'), [positions]);

  // Strategy breakdown
  const byStrategy = useMemo(() => {
    const map = {};
    allClosed.forEach(p => {
      const s = p.strategyName || 'Custom';
      if (!map[s]) map[s] = { name: s, pnl: 0, count: 0, wins: 0 };
      map[s].pnl += p.realizedPnL || 0;
      map[s].count++;
      if ((p.realizedPnL || 0) > 0) map[s].wins++;
    });
    return Object.values(map).sort((a, b) => b.pnl - a.pnl);
  }, [allClosed]);

  // Instrument breakdown
  const byInstrument = useMemo(() => {
    const map = {};
    allClosed.forEach(p => {
      const inst = p.instrument || 'Unknown';
      if (!map[inst]) map[inst] = { name: inst, pnl: 0, count: 0, wins: 0 };
      map[inst].pnl += p.realizedPnL || 0;
      map[inst].count++;
      if ((p.realizedPnL || 0) > 0) map[inst].wins++;
    });
    return Object.values(map).sort((a, b) => b.pnl - a.pnl);
  }, [allClosed]);

  // Premium collected vs P&L (theta capture efficiency)
  const premiumStats = useMemo(() => {
    const totalPremium = allClosed.reduce((s, p) => s + Math.max(0, p.netPremiumCollected), 0);
    const totalPnL = allClosed.reduce((s, p) => s + (p.realizedPnL || 0), 0);
    const efficiency = totalPremium > 0 ? (totalPnL / totalPremium) * 100 : 0;
    return { totalPremium, totalPnL, efficiency };
  }, [allClosed]);

  // Win/loss pie
  const winLossPie = useMemo(() => {
    const wins = allClosed.filter(p => (p.realizedPnL || 0) > 0).length;
    const losses = allClosed.filter(p => (p.realizedPnL || 0) < 0).length;
    const be = allClosed.filter(p => (p.realizedPnL || 0) === 0).length;
    return [
      { name: 'Winners', value: wins, fill: '#10D9A0' },
      { name: 'Losers', value: losses, fill: '#F0566E' },
      ...(be > 0 ? [{ name: 'Breakeven', value: be, fill: '#60A5FA' }] : []),
    ].filter(d => d.value > 0);
  }, [allClosed]);

  const last8Months = monthlyPnL.slice(-8);

  return (
    <div>
      <div className="page-header">
        <div style={{display:"flex",alignItems:"center",gap:10}}><div className="page-title">Analytics</div><AccountBadge /></div>
        <div className="page-subtitle">{allClosed.length} closed positions analysed</div>
      </div>

      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:16 }}><DateRangeSelector /></div>
      {allClosed.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="icon">📈</div>
            <p>Close some positions to see analytics.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Key stats */}
          <div className="stat-grid" style={{ marginBottom: 24 }}>
            <StatBlock label="Win Rate" value={stats.winRate.toFixed(1) + '%'} color={stats.winRate >= 60 ? 'var(--profit)' : stats.winRate >= 40 ? 'var(--accent)' : 'var(--loss)'} sub={`${allClosed.filter(p=>(p.realizedPnL||0)>0).length}W / ${allClosed.filter(p=>(p.realizedPnL||0)<0).length}L`} />
            <StatBlock label="Profit Factor" value={isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'} color={stats.profitFactor >= 1.5 ? 'var(--profit)' : stats.profitFactor >= 1 ? 'var(--accent)' : 'var(--loss)'} sub="Gross profit ÷ Gross loss" />
            <StatBlock label="Avg Win" value={fmt(stats.avgWin)} color="var(--profit)" sub="Per winning position" />
            <StatBlock label="Avg Loss" value={'−' + fmt(stats.avgLoss)} color="var(--loss)" sub="Per losing position" />
            <StatBlock label="Premium Collected" value={fmt(premiumStats.totalPremium)} color="var(--accent)" sub="Gross premium all time" />
            <StatBlock label="Theta Efficiency" value={premiumStats.efficiency.toFixed(1) + '%'} color={premiumStats.efficiency > 50 ? 'var(--profit)' : 'var(--accent)'} sub="P&L as % of premium" />
            <StatBlock label="Total P&L" value={fmt(stats.totalPnL)} color={stats.totalPnL >= 0 ? 'var(--profit)' : 'var(--loss)'} sub="All time realized" />
            <StatBlock label="This Month" value={fmt(stats.thisMonthPnL)} color={stats.thisMonthPnL >= 0 ? 'var(--profit)' : 'var(--loss)'} sub={new Date().toLocaleString('default', { month: 'long' })} />
          </div>

          <div className="grid-2" style={{ marginBottom: 24 }}>
            {/* Monthly P&L */}
            <div className="card">
              <div className="section-title" style={{ marginBottom: 16 }}>Monthly P&amp;L</div>
              {last8Months.length === 0 ? <div className="empty-state" style={{padding:'30px 0'}}><p>No monthly data</p></div> : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={last8Months} barSize={28}>
                    <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip content={<TT />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                      {last8Months.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? 'var(--profit)' : 'var(--loss)'} opacity={0.85} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Win/Loss Pie */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div className="section-title" style={{ marginBottom: 16, alignSelf: 'flex-start' }}>Outcome Distribution</div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={winLossPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} innerRadius={45} paddingAngle={3}>
                    {winLossPie.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v + ' positions', n]} contentStyle={{ background: '#1a1f2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                  <Legend formatter={(v) => <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom: 24 }}>
            {/* Strategy breakdown */}
            <div className="card">
              <div className="section-title" style={{ marginBottom: 16 }}>Strategy P&amp;L</div>
              {byStrategy.length === 0 ? <div className="empty-state" style={{padding:'20px 0'}}><p>No data</p></div> : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={byStrategy} layout="vertical" barSize={18}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={90} />
                      <Tooltip content={<TT />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                      <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                        {byStrategy.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? 'var(--profit)' : 'var(--loss)'} opacity={0.85} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="divider" />
                  {byStrategy.map(s => (
                    <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                      <span className={`badge ${s.name.toLowerCase().replace(/ /g,'_')}`}>{s.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.count} trades · {s.count > 0 ? ((s.wins / s.count)*100).toFixed(0) : 0}% win</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: s.pnl >= 0 ? 'var(--profit)' : 'var(--loss)', fontWeight: 500 }}>{fmt(Math.round(s.pnl))}</span>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Instrument breakdown */}
            <div className="card">
              <div className="section-title" style={{ marginBottom: 16 }}>Instrument P&amp;L</div>
              {byInstrument.length === 0 ? <div className="empty-state" style={{padding:'20px 0'}}><p>No data</p></div> : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={byInstrument} layout="vertical" barSize={18}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={90} />
                      <Tooltip content={<TT />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                      <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                        {byInstrument.map((d, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} opacity={0.85} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="divider" />
                  {byInstrument.map((inst, i) => (
                    <div key={inst.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontWeight: 600, color: COLORS[i % COLORS.length], fontSize: 13 }}>{inst.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inst.count} trades · {inst.count > 0 ? ((inst.wins / inst.count)*100).toFixed(0) : 0}% win</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: inst.pnl >= 0 ? 'var(--profit)' : 'var(--loss)', fontWeight: 500 }}>{fmt(Math.round(inst.pnl))}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
