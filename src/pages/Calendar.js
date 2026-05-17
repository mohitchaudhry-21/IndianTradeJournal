import React, { useState, useMemo } from 'react';
import AccountBadge from '../components/AccountBadge';
import DateRangeSelector from '../components/DateRangeSelector';
import { useJournal } from '../context/JournalContext';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_LABELS  = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

function fmt(n) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '+';
  if (abs >= 100000) return sign + '₹' + (abs / 100000).toFixed(1) + 'L';
  if (abs >= 1000)   return sign + '₹' + (abs / 1000).toFixed(1) + 'K';
  return sign + '₹' + Math.round(abs).toLocaleString('en-IN');
}

function fmtFull(n) {
  if (!n) return '₹0';
  return (n < 0 ? '-' : '+') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
}

function pad(n) { return String(n).padStart(2, '0'); }

function dateStr(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }


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

export default function Calendar() {
  const { positions } = useJournal();
  const [current, setCurrent] = useState(() => {
    const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selected, setSelected] = useState(null);

  const year  = current.getFullYear();
  const month = current.getMonth() + 1; // 1-based

  const daysInMonth = new Date(year, month, 0).getDate();
  // 0=Sun…6=Sat → we want Mon=0…Sun=6
  const rawFirst = new Date(year, month - 1, 1).getDay();
  const firstMon = rawFirst === 0 ? 6 : rawFirst - 1; // offset Mon
  const weeks = Math.ceil((firstMon + daysInMonth) / 7);

  // ── Build day map from positions ────────────────────────────────────────────
  // Each day: { pnl (realized), premium (collected on open), opened [], closed [] }
  const dayMap = useMemo(() => {
    const map = {};
    const ensure = (d) => {
      if (!map[d]) map[d] = { pnl: 0, premium: 0, opened: [], closed: [] };
    };

    positions.forEach(p => {
      // Entry day
      const openDate = p.openDate?.slice(0, 10);
      if (openDate) {
        ensure(openDate);
        map[openDate].opened.push(p);
        map[openDate].premium += p.netPremiumCollected || 0;
      }
      // Close day
      if (p.status !== 'OPEN' && p.closeDate) {
        const closeDate = p.closeDate.slice(0, 10);
        ensure(closeDate);
        map[closeDate].closed.push(p);
        map[closeDate].pnl += p.realizedPnL || 0;
      }
    });
    return map;
  }, [positions]);

  // ── Weekly P&L ───────────────────────────────────────────────────────────────
  function weekPnl(weekIdx) {
    let total = 0;
    for (let d = 0; d < 7; d++) {
      const dayNum = weekIdx * 7 + d - firstMon + 1;
      if (dayNum < 1 || dayNum > daysInMonth) continue;
      const key = dateStr(year, month, dayNum);
      if (dayMap[key]) total += dayMap[key].pnl;
    }
    return total;
  }

  // ── Month totals ─────────────────────────────────────────────────────────────
  const monthPnl = useMemo(() => {
    let total = 0;
    Object.entries(dayMap).forEach(([d, v]) => {
      if (d.startsWith(`${year}-${pad(month)}`)) total += v.pnl;
    });
    return total;
  }, [dayMap, year, month]);

  const monthTrades = useMemo(() => {
    let opened = 0, closed = 0;
    Object.entries(dayMap).forEach(([d, v]) => {
      if (d.startsWith(`${year}-${pad(month)}`)) {
        opened += v.opened.length;
        closed += v.closed.length;
      }
    });
    return { opened, closed };
  }, [dayMap, year, month]);

  const today = new Date().toISOString().slice(0, 10);
  const selectedData = selected ? dayMap[selected] : null;

  const prevMonth = () => setCurrent(new Date(year, month - 2, 1));
  const nextMonth = () => setCurrent(new Date(year, month, 1));

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
              <div className="page-title">Trading Calendar</div>
              <AccountBadge />
            </div>
            <div className="page-subtitle">Daily P&amp;L heatmap · click a day to see positions</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 700, color: monthPnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
              {fmtFull(monthPnl)}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={prevMonth} style={navBtn}>‹</button>
              <span style={{ fontWeight: 700, fontSize: 15, minWidth: 150, textAlign: 'center', color: 'var(--text-primary)' }}>
                {MONTH_NAMES[month - 1]} {year}
              </span>
              <button onClick={nextMonth} style={navBtn}>›</button>
            </div>
          </div>
        </div>
      </div>

      {/* Month summary strip */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        {[
          { label: 'Month P&L', value: fmtFull(monthPnl), color: monthPnl >= 0 ? 'var(--profit)' : 'var(--loss)' },
          { label: 'Positions Opened', value: monthTrades.opened, color: 'var(--accent)' },
          { label: 'Positions Closed', value: monthTrades.closed, color: 'var(--text-secondary)' },
          { label: 'Trading Days', value: Object.keys(dayMap).filter(d => d.startsWith(`${year}-${pad(month)}`) && dayMap[d].closed.length > 0).length, color: 'var(--neutral)' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ flex: 1 }}>
            <div className="label">{s.label}</div>
            <div className="value" style={{ fontSize: 20, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 300px' : '1fr', gap: 20, alignItems: 'start' }}>
        {/* Calendar grid */}
        <div className="card" style={{ padding: 20 }}>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr) 100px', gap: 4, marginBottom: 6 }}>
            {DAY_LABELS.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', padding: '4px 0', letterSpacing: '0.06em' }}>{d}</div>
            ))}
            <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', padding: '4px 0', letterSpacing: '0.06em' }}>WEEK</div>
          </div>

          {/* Weeks */}
          {Array.from({ length: weeks }, (_, wi) => {
            const wp = weekPnl(wi);
            return (
              <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr) 100px', gap: 4, marginBottom: 4 }}>
                {Array.from({ length: 7 }, (_, di) => {
                  const dayNum = wi * 7 + di - firstMon + 1;
                  if (dayNum < 1 || dayNum > daysInMonth)
                    return <div key={di} style={{ height: 72, borderRadius: 8, background: 'transparent' }} />;

                  const key  = dateStr(year, month, dayNum);
                  const data = dayMap[key];
                  const isToday = key === today;
                  const isSel   = key === selected;
                  const hasPnl  = data && data.closed.length > 0;
                  const hasOpen = data && data.opened.length > 0;
                  const pos     = data?.pnl >= 0;

                  let bg = 'var(--bg-card2)';
                  if (hasPnl) bg = pos ? 'rgba(16,217,160,0.10)' : 'rgba(240,86,110,0.10)';
                  else if (hasOpen) bg = 'rgba(245,158,11,0.08)';

                  return (
                    <div
                      key={di}
                      onClick={() => data ? setSelected(isSel ? null : key) : null}
                      style={{
                        height: 72, borderRadius: 8, padding: '8px 10px',
                        cursor: data ? 'pointer' : 'default',
                        background: bg,
                        border: isSel
                          ? `2px solid ${hasPnl ? (pos ? 'var(--profit)' : 'var(--loss)') : 'var(--accent)'}`
                          : isToday
                          ? '2px solid rgba(255,255,255,0.15)'
                          : '2px solid transparent',
                        transition: 'all 0.15s',
                        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                      }}
                    >
                      {/* Day number */}
                      <div style={{
                        fontSize: 12, fontWeight: 600,
                        color: isToday ? 'var(--accent)' : 'var(--text-muted)',
                      }}>{dayNum}</div>

                      {/* P&L or indicator */}
                      {hasPnl && (
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 11, fontWeight: 700,
                          color: pos ? 'var(--profit)' : 'var(--loss)',
                          lineHeight: 1.2,
                        }}>
                          {fmt(data.pnl)}
                        </div>
                      )}
                      {!hasPnl && hasOpen && (
                        <div style={{ fontSize: 10, color: 'var(--accent)' }}>
                          {data.opened.length} opened
                        </div>
                      )}

                      {/* Dots for activity */}
                      {data && (
                        <div style={{ display: 'flex', gap: 3 }}>
                          {data.closed.length > 0 && <div style={{ width: 5, height: 5, borderRadius: '50%', background: pos ? 'var(--profit)' : 'var(--loss)' }} />}
                          {data.opened.length > 0 && <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Weekly P&L */}
                <div style={{
                  height: 72, borderRadius: 8,
                  background: wp > 0 ? 'rgba(16,217,160,0.06)' : wp < 0 ? 'rgba(240,86,110,0.06)' : 'var(--bg-card2)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.05em' }}>WK {wi + 1}</div>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12, fontWeight: 700,
                    color: wp > 0 ? 'var(--profit)' : wp < 0 ? 'var(--loss)' : 'var(--text-muted)',
                  }}>
                    {wp !== 0 ? fmt(wp) : '—'}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            {[
              { color: 'rgba(16,217,160,0.15)', label: 'Profit day' },
              { color: 'rgba(240,86,110,0.15)', label: 'Loss day' },
              { color: 'rgba(245,158,11,0.10)', label: 'Position opened' },
              { color: 'var(--bg-card2)',        label: 'No activity' },
            ].map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: l.color, border: '1px solid var(--border)' }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Day detail panel */}
        {selected && (
          <div className="card" style={{ position: 'sticky', top: 20, minWidth: 260 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                  {new Date(selected + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                {selectedData?.closed.length > 0 && (
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 800, marginTop: 4, color: selectedData.pnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                    {fmtFull(selectedData.pnl)}
                  </div>
                )}
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 2px' }}>×</button>
            </div>

            {/* Closed positions */}
            {selectedData?.closed.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Closed</div>
                {selectedData.closed.map(p => (
                  <div key={p.positionId} style={{ borderRadius: 8, padding: '10px 12px', marginBottom: 8, border: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 3 }}>
                          <span className={`badge ${(p.strategyName||'custom').toLowerCase().replace(/ /g,'_')}`} style={{ fontSize: 10 }}>{p.strategyName||'Custom'}</span>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13 }}>{p.instrument}</span>
                        </div>
                        <AccountTag accountId={p.accountId} />
                      </div>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: (p.realizedPnL||0) >= 0 ? 'var(--profit)' : 'var(--loss)', flexShrink: 0 }}>
                        {fmtFull(p.realizedPnL)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                      {p.legs?.map((leg, i) => (
                        <span key={i} style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-card2)', padding: '2px 6px', borderRadius: 4 }}>
                          {leg.optionType} {leg.transactionType === 'SELL' ? 'S' : 'B'} {leg.strike}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Opened positions */}
            {selectedData?.opened.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Opened</div>
                {selectedData.opened.map(p => (
                  <div key={p.positionId} style={{ borderRadius: 8, padding: '10px 12px', marginBottom: 8, border: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 3 }}>
                          <span className={`badge ${(p.strategyName||'custom').toLowerCase().replace(/ /g,'_')}`} style={{ fontSize: 10 }}>{p.strategyName||'Custom'}</span>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13 }}>{p.instrument}</span>
                        </div>
                        <AccountTag accountId={p.accountId} />
                      </div>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--profit)', flexShrink: 0 }}>
                        +{fmtFull(p.netPremiumCollected)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                      Exp: {p.expiry ? new Date(p.expiry + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                      {p.daysToExpiry !== null ? ` · ${p.daysToExpiry}d left` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!selectedData && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0', fontSize: 13 }}>No activity on this day</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const navBtn = {
  background: 'var(--bg-card2)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer',
  fontSize: 18, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'inherit',
};
