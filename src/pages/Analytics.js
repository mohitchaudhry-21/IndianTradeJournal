import React, { useMemo } from 'react';
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend, ReferenceLine } from 'recharts';
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

  const last8Months = monthlyPnL.slice(-12);

  // ── P&L Curve (cumulative) ───────────────────────────────────────────────
  const pnlCurve = useMemo(() => {
    const sorted = [...closed].sort((a, b) => (a.closeDate||'') < (b.closeDate||'') ? -1 : 1);
    let cumPnL = 0;
    return sorted.map((p, i) => {
      cumPnL += p.realizedPnL || 0;
      return {
        trade: i + 1,
        label: p.instrument + ' ' + (p.closeDate||'').slice(5),
        pnl: p.realizedPnL || 0,
        cumPnL: Math.round(cumPnL),
      };
    });
  }, [closed]);

  // ── Win/Loss Streak ───────────────────────────────────────────────────────
  const streakData = useMemo(() => {
    const sorted = [...closed].sort((a, b) => (a.closeDate||'') < (b.closeDate||'') ? -1 : 1);
    let maxWin = 0, maxLoss = 0, curWin = 0, curLoss = 0;
    const tiles = sorted.map(p => {
      const win = (p.realizedPnL||0) > 0;
      if (win) { curWin++; curLoss = 0; maxWin = Math.max(maxWin, curWin); }
      else      { curLoss++; curWin = 0; maxLoss = Math.max(maxLoss, curLoss); }
      return { win, pnl: p.realizedPnL||0, label: (p.instrument||'') + ' ' + (p.closeDate||'').slice(5), streak: win ? curWin : -curLoss };
    });
    const last = tiles[tiles.length - 1];
    const currentStreak = last ? (last.win ? curWin : -curLoss) : 0;
    return { tiles, maxWin, maxLoss, currentStreak };
  }, [closed]);

  // ── Margin Profitability ──────────────────────────────────────────────────
  const marginData = useMemo(() => {
    const trades = closed
      .filter(p => p.margin && p.margin > 0)
      .sort((a, b) => (a.closeDate||'') < (b.closeDate||'') ? -1 : 1)
      .map((p, i) => ({
        trade: i + 1,
        label: (p.instrument||'') + ' ' + (p.closeDate||'').slice(5),
        returnPct: parseFloat(((p.realizedPnL||0) / p.margin * 100).toFixed(2)),
        pnl: p.realizedPnL||0,
        margin: p.margin,
      }));
    const avgReturn = trades.length ? trades.reduce((s,t) => s + t.returnPct, 0) / trades.length : 0;
    const best  = trades.reduce((b, t) => t.returnPct > b.returnPct ? t : b, { returnPct: -Infinity });
    const worst = trades.reduce((b, t) => t.returnPct < b.returnPct ? t : b, { returnPct: Infinity });
    return { trades, avgReturn, best, worst };
  }, [closed]);



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


          {/* ── P&L Curve ─────────────────────────────────────────────── */}
          {pnlCurve.length > 1 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <div className="section-title">Cumulative P&amp;L Curve</div>
                <div style={{ display:'flex', gap:16, fontSize:12, color:'var(--text-muted)' }}>
                  <span>Final: <span style={{ color: pnlCurve[pnlCurve.length-1]?.cumPnL >= 0 ? 'var(--profit)' : 'var(--loss)', fontWeight:700, fontFamily:"'JetBrains Mono',monospace" }}>{fmt(pnlCurve[pnlCurve.length-1]?.cumPnL)}</span></span>
                  <span>{pnlCurve.length} trades</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={pnlCurve} margin={{ top:10, right:10, left:0, bottom:0 }}>
                  <defs>
                    <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--profit)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="var(--profit)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--loss)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="var(--loss)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="trade" tick={{ fill:'var(--text-muted)', fontSize:10 }} axisLine={false} tickLine={false} label={{ value:'Trade #', position:'insideBottomRight', fill:'var(--text-muted)', fontSize:10 }} />
                  <YAxis tick={{ fill:'var(--text-muted)', fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? '₹'+(v/1000).toFixed(0)+'K' : '₹'+v} width={55} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div style={{ background:'#1a1f2e', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, padding:'10px 14px' }}>
                        <div style={{ color:'var(--text-muted)', fontSize:11, marginBottom:3 }}>Trade #{d.trade} · {d.label}</div>
                        <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:2 }}>This trade: <span style={{ color:d.pnl>=0?'var(--profit)':'var(--loss)', fontWeight:700 }}>{fmt(d.pnl)}</span></div>
                        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:15, color:d.cumPnL>=0?'var(--profit)':'var(--loss)', fontWeight:700 }}>Cumulative: {fmt(d.cumPnL)}</div>
                      </div>
                    );
                  }} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="cumPnL" stroke="var(--profit)" strokeWidth={2.5} fill="url(#profitGrad)" dot={false} activeDot={{ r:5, fill:'var(--profit)' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Monthly P&L (full width, enhanced) ───────────────────────── */}
          {last8Months.length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <div className="section-title">Monthly P&amp;L</div>
                <div style={{ display:'flex', gap:16, fontSize:12, color:'var(--text-muted)' }}>
                  <span style={{ color:'var(--profit)' }}>● Profit months: {last8Months.filter(m=>m.pnl>0).length}</span>
                  <span style={{ color:'var(--loss)' }}>● Loss months: {last8Months.filter(m=>m.pnl<0).length}</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={last8Months} barSize={36} margin={{ top:20, right:10, left:0, bottom:0 }}>
                  <XAxis dataKey="label" tick={{ fill:'var(--text-muted)', fontSize:11 }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip content={<TT />} cursor={{ fill:'rgba(255,255,255,0.04)' }} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                  <Bar dataKey="pnl" radius={[6,6,0,0]} label={{ position:'top', formatter:v => v>=1000?'₹'+(v/1000).toFixed(1)+'K':v<=0&&v>-1000?'-₹'+Math.abs(v):'₹'+(v/1000).toFixed(1)+'K', fill:'var(--text-muted)', fontSize:10 }}>
                    {last8Months.map((d,i) => <Cell key={i} fill={d.pnl>=0?'var(--profit)':'var(--loss)'} opacity={0.85} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Win/Loss Streak Heatmap ───────────────────────────────────── */}
          {streakData.tiles.length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:10 }}>
                <div className="section-title">Win / Loss Streak</div>
                <div style={{ display:'flex', gap:20, fontSize:12 }}>
                  {[
                    { label:'Current Streak', value: streakData.currentStreak > 0 ? `+${streakData.currentStreak}W` : `${Math.abs(streakData.currentStreak)}L`, color: streakData.currentStreak >= 0 ? 'var(--profit)' : 'var(--loss)' },
                    { label:'Best Streak', value: streakData.maxWin + 'W', color: 'var(--profit)' },
                    { label:'Worst Streak', value: streakData.maxLoss + 'L', color: 'var(--loss)' },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign:'center' }}>
                      <div style={{ color:'var(--text-muted)', fontSize:10, marginBottom:2 }}>{s.label}</div>
                      <div style={{ color:s.color, fontWeight:800, fontFamily:"'JetBrains Mono',monospace", fontSize:16 }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                {streakData.tiles.map((t, i) => (
                  <div key={i} title={`Trade ${i+1}: ${t.label} · ${t.pnl>=0?'+':''}₹${Math.round(t.pnl).toLocaleString('en-IN')}`}
                    style={{
                      width:32, height:32, borderRadius:6,
                      background: t.win ? 'var(--profit)' : 'var(--loss)',
                      opacity: 0.3 + Math.min(0.7, Math.abs(t.pnl) / 5000),
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize:10, fontWeight:700, color:'white', cursor:'default',
                      border: i === streakData.tiles.length-1 ? '2px solid white' : 'none',
                    }}>
                    {t.win ? 'W' : 'L'}
                  </div>
                ))}
              </div>
              <div style={{ marginTop:10, fontSize:11, color:'var(--text-muted)' }}>
                Each square = one position. Opacity = magnitude. Last trade outlined in white.
              </div>
            </div>
          )}

          {/* ── Margin Profitability ──────────────────────────────────────── */}
          {marginData.trades.length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:10 }}>
                <div className="section-title">Return on Margin</div>
                <div style={{ display:'flex', gap:20, fontSize:12 }}>
                  {[
                    { label:'Avg Return', value: (marginData.avgReturn>=0?'+':'')+marginData.avgReturn.toFixed(2)+'%', color: marginData.avgReturn>=0?'var(--profit)':'var(--loss)' },
                    { label:'Best Trade', value: '+'+marginData.best.returnPct?.toFixed(2)+'%', color:'var(--profit)' },
                    { label:'Worst Trade', value: marginData.worst.returnPct?.toFixed(2)+'%', color:'var(--loss)' },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign:'center' }}>
                      <div style={{ color:'var(--text-muted)', fontSize:10, marginBottom:2 }}>{s.label}</div>
                      <div style={{ color:s.color, fontWeight:800, fontFamily:"'JetBrains Mono',monospace", fontSize:15 }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={marginData.trades} barSize={28} margin={{ top:20, right:10, left:0, bottom:0 }}>
                  <XAxis dataKey="trade" tick={{ fill:'var(--text-muted)', fontSize:10 }} axisLine={false} tickLine={false} label={{ value:'Trade #', position:'insideBottomRight', fill:'var(--text-muted)', fontSize:10 }} />
                  <YAxis tick={{ fill:'var(--text-muted)', fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v => v+'%'} width={42} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div style={{ background:'#1a1f2e', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, padding:'10px 14px' }}>
                        <div style={{ color:'var(--text-muted)', fontSize:11, marginBottom:3 }}>{d.label}</div>
                        <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:2 }}>Margin: ₹{Math.round(d.margin).toLocaleString('en-IN')}</div>
                        <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:4 }}>P&L: <span style={{ color:d.pnl>=0?'var(--profit)':'var(--loss)', fontWeight:700 }}>{fmt(d.pnl)}</span></div>
                        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:16, color:d.returnPct>=0?'var(--profit)':'var(--loss)', fontWeight:800 }}>{d.returnPct>=0?'+':''}{d.returnPct}%</div>
                      </div>
                    );
                  }} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                  <Bar dataKey="returnPct" radius={[4,4,0,0]} label={{ position:'top', formatter:v=>v>0?'+'+v+'%':v+'%', fill:'var(--text-muted)', fontSize:9 }}>
                    {marginData.trades.map((d,i) => <Cell key={i} fill={d.returnPct>=0?'var(--profit)':'var(--loss)'} opacity={0.85} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ marginTop:8, fontSize:11, color:'var(--text-muted)' }}>
                Only positions with margin recorded are shown. Add margin via the notes panel (📝) in Trade History.
              </div>
            </div>
          )}

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
