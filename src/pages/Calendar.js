import React, { useState, useMemo } from 'react';
import AccountBadge from '../components/AccountBadge';
import { useJournal } from '../context/JournalContext';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS   = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

function fmtPnl(n) {
  if (!n) return null;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '+';
  if (abs >= 100000) return sign + '₹' + (abs/100000).toFixed(1) + 'L';
  if (abs >= 1000)   return sign + '₹' + (abs/1000).toFixed(1)  + 'K';
  return sign + '₹' + Math.round(abs).toLocaleString('en-IN');
}
function fmtFull(n) {
  if (n == null) return '—';
  return (n < 0 ? '-' : '+') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
}
function pad(n) { return String(n).padStart(2,'0'); }
function ds(y,m,d) { return `${y}-${pad(m)}-${pad(d)}`; }

// Inline account tag
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
  const month = current.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const rawFirst = new Date(year, month-1, 1).getDay();
  const firstMon = rawFirst === 0 ? 6 : rawFirst - 1;
  const totalCells = Math.ceil((firstMon + daysInMonth) / 7) * 7;

  // Build day data map
  const dayMap = useMemo(() => {
    const map = {};
    positions.forEach(p => {
      const refDate = (p.status === 'OPEN')
        ? p.openDate?.slice(0,10)
        : p.closeDate?.slice(0,10) || p.openDate?.slice(0,10);
      if (!refDate) return;
      if (!map[refDate]) map[refDate] = { closed:[], opened:[], pnl:0 };
      if (p.status !== 'OPEN' && p.closeDate?.slice(0,10) === refDate) {
        map[refDate].closed.push(p);
        map[refDate].pnl += p.realizedPnL || 0;
      }
      if (p.openDate?.slice(0,10) === refDate) {
        map[refDate].opened.push(p);
      }
    });
    return map;
  }, [positions]);

  // Month stats
  const monthStats = useMemo(() => {
    let pnl = 0, wins = 0, losses = 0, tradingDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const key = ds(year, month, d);
      const data = dayMap[key];
      if (data?.closed.length > 0) {
        tradingDays++;
        if (data.pnl > 0) wins++;
        else if (data.pnl < 0) losses++;
        pnl += data.pnl;
      }
    }
    return { pnl, wins, losses, tradingDays };
  }, [dayMap, year, month, daysInMonth]);

  const selectedData = selected ? dayMap[selected] : null;
  const today = new Date().toISOString().slice(0,10);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', gap:0 }}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div className="page-title" style={{ marginBottom:0 }}>Trading Calendar</div>
          <AccountBadge />
        </div>

        {/* Month navigation */}
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <button onClick={() => setCurrent(c => new Date(c.getFullYear(), c.getMonth()-1,1))} style={navBtn}>‹</button>
          <div style={{ fontWeight:700, fontSize:16, color:'var(--text-primary)', minWidth:160, textAlign:'center' }}>
            {MONTHS[current.getMonth()]} {year}
          </div>
          <button onClick={() => setCurrent(c => new Date(c.getFullYear(), c.getMonth()+1,1))} style={navBtn}>›</button>
          <button onClick={() => { setCurrent(new Date(new Date().getFullYear(), new Date().getMonth(),1)); }} style={{ ...navBtn, fontSize:12, padding:'6px 12px', width:'auto' }}>Today</button>
        </div>
      </div>

      {/* ── Stats strip ──────────────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
        {[
          { label:'Month P&L', value: fmtFull(monthStats.pnl), color: monthStats.pnl >= 0 ? 'var(--profit)' : 'var(--loss)' },
          { label:'Winning Days', value: monthStats.wins, color:'var(--profit)' },
          { label:'Losing Days',  value: monthStats.losses, color:'var(--loss)' },
          { label:'Trading Days', value: monthStats.tradingDays, color:'var(--text-primary)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding:'14px 18px', textAlign:'center' }}>
            <div style={{ fontSize:11, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:6 }}>{s.label}</div>
            <div style={{ fontSize:22, fontWeight:800, color:s.color, fontFamily:"'JetBrains Mono',monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Calendar + detail ────────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns: selected ? '1fr 300px' : '1fr', gap:16, alignItems:'start' }}>

        {/* Calendar grid */}
        <div style={{ background:'var(--bg-card)', borderRadius:14, overflow:'hidden', border:'1px solid var(--border)' }}>
          {/* Day headers */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', background:'var(--bg-card2)' }}>
            {DAYS.map(d => (
              <div key={d} style={{ padding:'12px 0', textAlign:'center', fontSize:11, fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.1em' }}>{d}</div>
            ))}
          </div>

          {/* Cells */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)' }}>
            {Array.from({ length: totalCells }, (_, i) => {
              const dayNum = i - firstMon + 1;
              const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
              const key = inMonth ? ds(year, month, dayNum) : null;
              const data = key ? dayMap[key] : null;
              const isToday = !!key && key === today;
              const isSelected = !!key && key === selected;
              const hasPnl = data?.closed.length > 0;
              const hasOpened = data?.opened.length > 0;
              const profit = hasPnl && data.pnl > 0;
              const loss   = hasPnl && data.pnl < 0;
              const isWeekend = (i % 7) >= 5;

              let bg = 'transparent';
              if (!inMonth) bg = 'var(--bg-primary)';
              else if (isSelected) bg = 'rgba(59,130,246,0.12)';
              else if (profit) bg = 'rgba(16,217,160,0.07)';
              else if (loss)   bg = 'rgba(240,86,110,0.07)';
              else if (hasOpened) bg = 'rgba(245,158,11,0.06)';

              return (
                <div
                  key={i}
                  onClick={() => inMonth && setSelected(isSelected ? null : key)}
                  style={{
                    minHeight: 90,
                    padding: '10px 12px',
                    background: bg,
                    borderTop: '1px solid var(--border)',
                    borderRight: (i % 7) < 6 ? '1px solid var(--border)' : 'none',
                    cursor: inMonth ? 'pointer' : 'default',
                    position: 'relative',
                    transition: 'background 0.15s',
                    outline: isSelected ? '2px solid var(--accent)' : isToday ? '2px solid rgba(59,130,246,0.4)' : 'none',
                    outlineOffset: '-2px',
                  }}
                  onMouseEnter={e => { if (inMonth && !isSelected) e.currentTarget.style.background = profit ? 'rgba(16,217,160,0.12)' : loss ? 'rgba(240,86,110,0.12)' : 'var(--bg-hover)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = bg; }}
                >
                  {inMonth && (
                    <>
                      {/* Day number */}
                      <div style={{
                        fontSize: 13, fontWeight: isToday ? 800 : 600,
                        color: isToday ? 'var(--accent)' : inMonth ? 'var(--text-secondary)' : 'var(--text-muted)',
                        marginBottom: 6,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}>
                        <span>{dayNum}</span>
                        {hasOpened && !hasPnl && (
                          <span style={{ fontSize:9, background:'rgba(245,158,11,0.2)', color:'#F59E0B', padding:'1px 5px', borderRadius:4, fontWeight:600 }}>
                            {data.opened.length} new
                          </span>
                        )}
                      </div>

                      {/* P&L */}
                      {hasPnl && (
                        <div style={{
                          fontFamily:"'JetBrains Mono',monospace",
                          fontSize: 15, fontWeight: 800,
                          color: profit ? 'var(--profit)' : 'var(--loss)',
                          lineHeight: 1.2, marginBottom: 4,
                        }}>
                          {fmtPnl(data.pnl)}
                        </div>
                      )}

                      {/* Position count */}
                      {(hasPnl || hasOpened) && (
                        <div style={{ fontSize:10, color:'var(--text-muted)', display:'flex', gap:4, flexWrap:'wrap' }}>
                          {hasPnl   && <span>{data.closed.length} closed</span>}
                          {hasOpened && hasPnl && <span>·</span>}
                          {hasOpened && <span>{data.opened.length} opened</span>}
                        </div>
                      )}

                      {/* Dot indicators */}
                      <div style={{ position:'absolute', bottom:6, right:8, display:'flex', gap:3 }}>
                        {hasPnl && <div style={{ width:5, height:5, borderRadius:'50%', background: profit ? 'var(--profit)' : 'var(--loss)' }} />}
                        {hasOpened && <div style={{ width:5, height:5, borderRadius:'50%', background:'#F59E0B' }} />}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Day detail panel */}
        {selected && (
          <div className="card" style={{ position:'sticky', top:20 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14, paddingBottom:12, borderBottom:'1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize:13, color:'var(--text-muted)', marginBottom:2 }}>
                  {new Date(selected+'T12:00:00').toLocaleDateString('en-IN',{weekday:'long'})}
                </div>
                <div style={{ fontWeight:800, fontSize:16, color:'var(--text-primary)' }}>
                  {new Date(selected+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}
                </div>
                {selectedData?.closed.length > 0 && (
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:900, marginTop:6, color: selectedData.pnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                    {fmtFull(selectedData.pnl)}
                  </div>
                )}
              </div>
              <button onClick={() => setSelected(null)} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:20 }}>×</button>
            </div>

            {/* Closed */}
            {selectedData?.closed.length > 0 && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:8 }}>Closed</div>
                {selectedData.closed.map(p => (
                  <div key={p.positionId} style={{ borderRadius:8, padding:'10px 12px', marginBottom:8, border:'1px solid var(--border)', background:'var(--bg-primary)' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:5, flexWrap:'wrap', marginBottom:4 }}>
                          <span className={`badge ${(p.strategyName||'custom').toLowerCase().replace(/ /g,'_')}`} style={{ fontSize:10 }}>{p.strategyName||'Custom'}</span>
                          <span style={{ fontWeight:700, color:'var(--text-primary)', fontSize:13 }}>{p.instrument}</span>
                        </div>
                        <AccountTag accountId={p.accountId} />
                      </div>
                      <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:14, fontWeight:800, color:(p.realizedPnL||0)>=0?'var(--profit)':'var(--loss)', flexShrink:0 }}>
                        {fmtFull(p.realizedPnL)}
                      </span>
                    </div>
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:8 }}>
                      {p.legs?.map((leg,i) => (
                        <span key={i} style={{ fontSize:10, color:'var(--text-muted)', background:'var(--bg-card2)', padding:'2px 7px', borderRadius:4 }}>
                          {leg.optionType} {leg.transactionType==='SELL'?'S':'B'} {leg.strike}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Opened */}
            {selectedData?.opened.length > 0 && (
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:8 }}>Opened</div>
                {selectedData.opened.map(p => (
                  <div key={p.positionId} style={{ borderRadius:8, padding:'10px 12px', marginBottom:8, border:'1px solid var(--border)', background:'var(--bg-primary)' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:5, flexWrap:'wrap', marginBottom:4 }}>
                          <span className={`badge ${(p.strategyName||'custom').toLowerCase().replace(/ /g,'_')}`} style={{ fontSize:10 }}>{p.strategyName||'Custom'}</span>
                          <span style={{ fontWeight:700, color:'var(--text-primary)', fontSize:13 }}>{p.instrument}</span>
                        </div>
                        <AccountTag accountId={p.accountId} />
                      </div>
                      <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:'var(--text-muted)', flexShrink:0 }}>
                        {p.legs?.length || 0} legs
                      </span>
                    </div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:6 }}>
                      Exp: {p.expiry ? new Date(p.expiry+'T12:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) : '—'}
                      {p.daysToExpiry !== null ? ` · ${p.daysToExpiry}d left` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!selectedData && (
              <div style={{ textAlign:'center', color:'var(--text-muted)', padding:'20px 0', fontSize:13 }}>No activity on this day</div>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display:'flex', gap:20, marginTop:16, paddingTop:14, flexWrap:'wrap' }}>
        {[
          { color:'rgba(16,217,160,0.25)', label:'Profit day' },
          { color:'rgba(240,86,110,0.25)', label:'Loss day' },
          { color:'rgba(245,158,11,0.18)', label:'Position opened' },
        ].map(l => (
          <div key={l.label} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{ width:14, height:14, borderRadius:3, background:l.color, border:'1px solid var(--border)' }} />
            <span style={{ fontSize:11, color:'var(--text-muted)' }}>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const navBtn = {
  background:'var(--bg-card2)', border:'1px solid var(--border)',
  borderRadius:8, color:'var(--text-secondary)', cursor:'pointer',
  fontSize:18, width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center',
  fontFamily:'inherit',
};
