import React, { useState, useMemo, useRef, useEffect } from 'react';
import AccountBadge from '../components/AccountBadge';
import DateRangeSelector from '../components/DateRangeSelector';
import { useJournal } from '../context/JournalContext';
import { useToast } from '../context/ToastContext';
import { calcMaxLoss, calcMaxProfit } from '../utils/calcMaxValues';
import { fetchTotalCharges, fetchMargin } from '../utils/brokerCharges';
import { calcUnrealizedPnL } from '../utils/livePnL';

function fmtMoney(n) {
  if (n === null || n === undefined) return '—';
  const sign = n < 0 ? '−' : '+';
  const abs = Math.abs(n);
  const parts = abs.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + '₹' + parts[0] + '.' + parts[1];
}

function fmtExitDate(d) {
  if (!d) return '';
  const s = String(d).trim();
  // YYYY-MM-DD (standard stored format)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [yr, mo, dy] = s.slice(0,10).split('-');
    return `${dy}/${mo}/${yr}`;
  }
  // M/D/YYYY H:MM:SS or M/DD/YY H:MM:SS (corrupted SheetJS formats)
  const mSlash4 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mSlash4) {
    const [, mo, dy, yr] = mSlash4;
    return `${dy.padStart(2,'0')}/${mo.padStart(2,'0')}/${yr}`;
  }
  const mSlash2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})/);
  if (mSlash2) {
    const [, mo, dy, yr] = mSlash2;
    return `${dy.padStart(2,'0')}/${mo.padStart(2,'0')}/20${yr}`;
  }
  return s.slice(0,10);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}


function PartialExitPopup({ leg, positionId, onClose, onSave }) {
  const [qty,    setQty]    = useState('');
  const [price,  setPrice]  = useState('');
  const [date,   setDate]   = useState(new Date().toISOString().slice(0,10));
  const [charges, setCharges] = useState('');
  const totalExited = (leg.exits||[]).reduce((s,e) => s+(e.quantity||0), 0);
  const remaining = (leg.quantity||1) - totalExited;
  const handleSave = () => {
    const q = parseInt(qty); const p = parseFloat(price);
    if (!q || !p || q > remaining) return;
    onSave(positionId, leg.id, {
      quantity:    q,
      exitPremium: p,
      exitDate:    date,
      charges:     charges ? parseFloat(charges) : undefined,
    });
    onClose();
  };
  const prevExits = leg.exits || [];
  const prevChargesTotal = prevExits.reduce((s,e) => s+(e.charges||0), 0);
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:24, width:340, boxShadow:'0 16px 48px rgba(0,0,0,0.5)' }}>
        <div style={{ fontWeight:700, fontSize:15, color:'var(--text-primary)', marginBottom:4 }}>Add Exit Tranche</div>
        <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:16 }}>
          {leg.optionType} {leg.transactionType} {leg.strike?.toLocaleString('en-IN')} · {remaining} lot{remaining!==1?'s':''} remaining
        </div>

        {prevExits.length > 0 && (
          <div style={{ marginBottom:12, padding:'8px 10px', background:'var(--bg-primary)', borderRadius:6, fontSize:11 }}>
            <div style={{ color:'var(--text-muted)', marginBottom:4 }}>Previous tranches:</div>
            {prevExits.map((e,i) => (
              <div key={i} style={{ fontFamily:'var(--font-mono)', color:'var(--text-secondary)', display:'flex', gap:8 }}>
                <span>{e.quantity}L @ ₹{e.exitPremium?.toFixed(2)}</span>
                <span style={{ color:'var(--text-muted)' }}>{fmtExitDate(e.exitDate)}</span>
                {e.charges ? <span style={{ color:'var(--loss)' }}>−₹{Math.abs(e.charges).toFixed(2)}</span> : null}
              </div>
            ))}
            {prevChargesTotal > 0 && (
              <div style={{ marginTop:4, color:'var(--text-muted)', fontSize:10 }}>
                Charges so far: −₹{prevChargesTotal.toFixed(2)}
              </div>
            )}
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
          <div className="form-group">
            <label className="form-label">Lots (max {remaining})</label>
            <input className="form-input" type="number" min="1" max={remaining} value={qty}
              onChange={e => setQty(e.target.value)} placeholder={`1–${remaining}`} />
          </div>
          <div className="form-group">
            <label className="form-label">Exit Price (₹)</label>
            <input className="form-input" type="number" step="0.05" value={price}
              onChange={e => setPrice(e.target.value)} placeholder="e.g. 45.50" />
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
          <div className="form-group">
            <label className="form-label">Exit Date</label>
            <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Charges ₹ <span style={{ color:'var(--text-muted)', fontWeight:400 }}>(optional)</span></label>
            <input className="form-input" type="number" step="0.01" value={charges}
              onChange={e => setCharges(e.target.value)} placeholder="e.g. 45.00" />
          </div>
        </div>

        <div style={{ display:'flex', gap:10 }}>
          <button className="btn btn-outline" style={{ flex:1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex:2 }} onClick={handleSave}
            disabled={!qty || !price || parseInt(qty) > remaining || parseInt(qty) < 1}>
            Confirm Exit
          </button>
        </div>
      </div>
    </div>
  );
}

function LegsInline({ legs, positionId, positionCharges, onAddExit, onRemoveExit, isOpen, onEditLeg, liveLtps }) {
  // liveLtps: { "NIFTY_24200_CE_2026-06-23": 66.5, ... } — same format as liveQuotes in context
  const getLiveLtp = (leg) => {
    if (!liveLtps) return null;
    const key = `${leg.instrument}_${leg.strike}_${leg.optionType}_${(leg.expiry||'').slice(0,10)}`;
    return liveLtps[key] ?? null;
  };

  // Position-level booked + running totals across all legs
  let totalBooked = 0, totalRunning = 0, hasRunning = false;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {legs.map((leg, i) => {
        const entry   = leg.premium;
        const exits   = leg.exits || [];
        const hasExits = exits.length > 0 || (leg.exitPremium !== undefined && leg.exitPremium !== null);
        const exit    = leg.exitPremium; // weighted avg
        const lotSize = leg.lotSize || 1;
        const totalExited = exits.reduce((s,e) => s+(e.quantity||0), 0);
        const remaining = (leg.quantity||1) - totalExited;
        const isPartial = exits.length > 0 && remaining > 0;
        const sign = leg.transactionType === 'SELL' ? 1 : -1; // SELL collects premium, profit when price falls

        // Realized P&L on exited portion — per tranche
        const realizedPnl = exits.length > 0
          ? exits.reduce((s,e) => {
              const pnl = sign * (entry - e.exitPremium) * e.quantity * lotSize;
              return s + pnl;
            }, 0)
          : (exit !== undefined && exit !== null
              ? sign * (entry - exit) * leg.quantity * lotSize
              : null);

        // Running (unrealized) P&L on open portion
        const ltp = getLiveLtp(leg);
        const runningQty = isPartial ? remaining : (isOpen && !hasExits ? (leg.quantity||1) : 0);
        const runningPnl = ltp !== null && runningQty > 0
          ? sign * (entry - ltp) * runningQty * lotSize
          : null;

        if (realizedPnl !== null) totalBooked += realizedPnl;
        if (runningPnl !== null) { totalRunning += runningPnl; hasRunning = true; }

        return (
          <div key={leg.id || i} style={{ paddingBottom: i < legs.length-1 ? 8 : 0, borderBottom: i < legs.length-1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ display:'grid', gridTemplateColumns:'auto auto auto 1fr auto', alignItems:'center', gap:5 }}>
              <div style={{ display:'flex', gap:3 }}>
                <span className={`badge ${leg.optionType?.toLowerCase()}`} style={{ fontSize:10, padding:'2px 6px' }}>{leg.optionType}</span>
                <span className={`badge ${leg.transactionType?.toLowerCase()}`} style={{ fontSize:10, padding:'2px 6px' }}>{leg.transactionType}</span>
              </div>
              <span style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:13, color:'var(--text-primary)', minWidth:50 }}>
                {leg.strike?.toLocaleString('en-IN')}
              </span>
              <span style={{ fontSize:11, color: isPartial ? 'var(--accent)' : 'var(--text-muted)' }}>
                {leg.quantity}L{isPartial ? ` (${remaining}L open)` : ''}
              </span>
              <div style={{ display:'flex', alignItems:'center', gap:5, fontFamily:'var(--font-mono)', fontSize:11 }}>
                <span style={{ color:'var(--text-muted)', background:'rgba(255,255,255,0.05)', padding:'1px 5px', borderRadius:3 }}>₹{entry?.toFixed(2) ?? '—'}</span>
                <span style={{ color:'var(--border-hover)', fontSize:10 }}>→</span>
                <span style={{ color: hasExits ? (leg.transactionType==='SELL' ? 'var(--profit)' : 'var(--text-secondary)') : 'var(--text-muted)', background: hasExits ? 'rgba(16,217,160,0.07)' : 'transparent', padding: hasExits ? '1px 5px' : '0', borderRadius:3 }}>
                  {exit !== null && exit !== undefined ? '₹'+exit.toFixed(2)+(exits.length>1?' (avg)':'') : '—'}
                </span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ fontFamily:'var(--font-mono)', fontSize:11, fontWeight:600, textAlign:'right', minWidth:60, color: realizedPnl===null ? 'var(--text-muted)' : realizedPnl>=0 ? 'var(--profit)' : 'var(--loss)' }}>
                  {realizedPnl===null ? '—' : fmtMoney(realizedPnl)}
                </span>
                {isOpen && onAddExit && remaining > 0 && (
                  <button onClick={() => onAddExit(leg)} title="Add partial exit"
                    style={{ background:'rgba(255,255,255,0.06)', border:'none', borderRadius:4, color:'var(--text-muted)', cursor:'pointer', fontSize:10, padding:'2px 5px', whiteSpace:'nowrap' }}>
                    + exit
                  </button>
                )}
                {onEditLeg && (
                  <button onClick={() => onEditLeg(leg)} title="Edit trade — all fields"
                    style={{ background:'rgba(255,255,255,0.06)', border:'none', borderRadius:4, color:'var(--text-muted)', cursor:'pointer', padding:'3px 4px', lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <i className="ti ti-pencil" style={{ fontSize:12 }} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            {/* Per-tranche exit breakdown with individual P&L */}
            {exits.length > 0 && (
              <div style={{ marginTop:5, paddingLeft:10, display:'flex', flexDirection:'column', gap:3 }}>
                {exits.map((e,ei) => {
                  const tranchePnl = sign * (entry - e.exitPremium) * e.quantity * lotSize;
                  return (
                    <div key={ei} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:11, color:'var(--text-muted)', background:'rgba(255,255,255,0.03)', borderRadius:5, padding:'3px 7px' }}>
                      <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                        <span style={{ fontFamily:'var(--font-mono)', color:'var(--text-secondary)' }}>{e.quantity}L @ ₹{e.exitPremium?.toFixed(2)}</span>
                        <span style={{ opacity:0.4, fontSize:9 }}>{fmtExitDate(e.exitDate)}</span>
                        {e.charges ? <span style={{ color:'var(--loss)', fontSize:9, opacity:0.8 }}>−₹{Math.abs(e.charges).toFixed(2)}</span> : null}
                        {isOpen && onRemoveExit && (
                          <button onClick={() => onRemoveExit(positionId, leg.id, ei)}
                            style={{ background:'none', border:'none', color:'var(--loss)', cursor:'pointer', fontSize:9, padding:'0 2px', opacity:0.5 }}>✕</button>
                        )}
                      </span>
                      <span style={{ fontFamily:'var(--font-mono)', fontWeight:600, fontSize:11, color: tranchePnl>=0 ? 'var(--profit)' : 'var(--loss)' }}>
                        {tranchePnl>=0?'+':'−'}₹{Math.abs(tranchePnl).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
                      </span>
                    </div>
                  );
                })}
                {/* Running P&L for remaining open lots */}
                {isPartial && runningPnl !== null && (
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:11, background:'rgba(59,130,246,0.06)', borderRadius:5, padding:'3px 7px', border:'1px solid rgba(59,130,246,0.15)' }}>
                    <span style={{ color:'var(--accent)', display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ fontFamily:'var(--font-mono)' }}>{remaining}L open @ ₹{ltp?.toFixed(2)} (live)</span>
                    </span>
                    <span style={{ fontFamily:'var(--font-mono)', fontWeight:600, color: runningPnl>=0 ? 'var(--profit)' : 'var(--loss)' }}>
                      {runningPnl>=0?'+':'−'}₹{Math.abs(runningPnl).toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2})}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Position-level booked + running summary — shown when there are partial exits */}
      {(totalBooked !== 0 || hasRunning) && legs.some(l => (l.exits||[]).length > 0) && (() => {
        // charges may be at tranche level (from Excel import) or position level (from broker fetch)
        // use whichever has data — prefer tranche-level as it's more granular
        const trancheChargesRaw = legs.reduce((s,l) => s + (l.exits||[]).reduce((s2,e) => s2+(Math.abs(e.charges||0)), 0), 0);
        const posCharges = positionCharges ? Math.abs(parseFloat(positionCharges)) : 0;
        // Prefer position-level charges (full broker fetch = entry+exit) over
        // per-tranche charges (Excel import = exit only, partial picture)
        const trancheCharges = posCharges > 0 ? posCharges : (trancheChargesRaw > 0 ? trancheChargesRaw : 0);
        const bookedNet = totalBooked - trancheCharges;
        return (
        <div style={{ display:'flex', gap:8, marginTop:4 }}>
          <div style={{ flex:1, background:'rgba(16,217,160,0.07)', border:'1px solid rgba(16,217,160,0.15)', borderRadius:6, padding:'6px 10px' }}>
            <div style={{ fontSize:10, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>Booked</div>
            <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:13, color: totalBooked>=0 ? 'var(--profit)' : 'var(--loss)' }}>
              {totalBooked>=0?'+':'−'}₹{Math.abs(totalBooked).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
            </div>
            {trancheCharges > 0 && (
              <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', marginTop:2 }}>
                after ₹{trancheCharges.toFixed(2)} chg →{' '}
                <span style={{ color: bookedNet>=0 ? 'var(--profit)' : 'var(--loss)', fontWeight:700 }}>
                  {bookedNet>=0?'+':'−'}₹{Math.abs(bookedNet).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
                </span>
              </div>
            )}
          </div>
          {hasRunning && (
            <div style={{ flex:1, background:'rgba(59,130,246,0.07)', border:'1px solid rgba(59,130,246,0.15)', borderRadius:6, padding:'6px 10px' }}>
              <div style={{ fontSize:10, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>Running</div>
              <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:13, color: totalRunning>=0 ? 'var(--profit)' : 'var(--loss)' }}>
                {totalRunning>=0?'+':'−'}₹{Math.abs(totalRunning).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
              </div>
            </div>
          )}
          {hasRunning && (
            <div style={{ flex:1, background:'rgba(255,255,255,0.04)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px' }}>
              <div style={{ fontSize:10, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>Total P&L</div>
              <div style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:13, color: (totalBooked+totalRunning)>=0 ? 'var(--profit)' : 'var(--loss)' }}>
                {(totalBooked+totalRunning)>=0?'+':'−'}₹{Math.abs(totalBooked+totalRunning).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
              </div>
            </div>
          )}
        </div>
        );
      })()}
    </div>
  );
}

function StrategyCell({ positionId, value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const save = () => { onChange(draft.trim() || value); setEditing(false); };
  if (editing) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        style={{ background: 'var(--bg-primary)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text-primary)', fontFamily: "'Sora', sans-serif", fontSize: 12, padding: '3px 7px', width: 120, outline: 'none' }} />
      <button onClick={save} style={{ background: 'none', border: 'none', color: 'var(--profit)', cursor: 'pointer', fontSize: 15 }}>✓</button>
      <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15 }}>✕</button>
    </div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className={`badge ${(value || 'custom').toLowerCase().replace(/ /g, '_')}`} style={{ fontSize: 11 }}>{value || 'Custom'}</span>
      <button onClick={() => { setDraft(value); setEditing(true); }} title="Edit strategy" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '1px 3px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity:0.5 }}><i className="ti ti-pencil" style={{ fontSize: 10 }} aria-hidden="true" /></button>
    </div>
  );
}

// Fetch charges button for left panel
function FetchChargesBtn({ position, onSave }) {
  const [fetching, setFetching] = React.useState(false);
  const { showToast } = useToast();
  const hasBrokerLegs = position?.legs?.some(l => l.brokerTradeId);
  if (!hasBrokerLegs) return null;
  const handleFetch = async () => {
    setFetching(true);
    const result = await fetchTotalCharges(position);
    setFetching(false);
    if (result.ok) {
      const newVal = Math.round(result.charges * 100) / 100;
      const oldVal = position?.charges != null ? Math.abs(Math.round(position.charges * 100) / 100) : null;
      onSave(newVal);
      if (oldVal != null && Math.abs(newVal - oldVal) < 0.01) {
        showToast({ title: 'Charges unchanged', message: `Still ₹${newVal.toFixed(2)}` });
      } else {
        showToast({ title: 'Charges fetched', message: `₹${newVal.toFixed(2)} from broker` });
      }
    } else {
      showToast({ title: 'Could not fetch charges', message: result.error || '', type: 'error' });
    }
  };
  return (
    <button
      onClick={handleFetch}
      disabled={fetching}
      style={{ background:'rgba(99,102,241,0.08)', border:'0.5px solid rgba(99,102,241,0.3)', borderRadius:6, color:'#818cf8', cursor:'pointer', padding:'5px 10px', fontSize:11, fontFamily:'var(--font-sans)', width:'100%', textAlign:'center', display:'block', fontWeight:600, opacity: fetching ? 0.6 : 1 }}
    >
      {fetching ? '⏳ Fetching...' : '↓ Fetch charges'}
    </button>
  );
}

// Editable margin cell
function MarginCell({ value, onSave, position }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ? String(value) : '');
  const [fetching, setFetching] = useState(false);
  const { showToast } = useToast();
  const save = () => {
    const v = parseFloat(draft);
    onSave(isNaN(v) ? null : v);
    setEditing(false);
  };
  const hasBrokerLegs = position?.legs?.some(l => l.brokerTradeId);
  const fetchFromBroker = async (e) => {
    e.stopPropagation();
    if (!position) return;
    setFetching(true);
    const result = await fetchMargin(position.legs);
    setFetching(false);
    if (result.ok) {
      const newVal = Math.round(result.margin);
      const oldVal = value != null ? Math.round(value) : null;
      onSave(newVal);
      if (oldVal != null && newVal === oldVal) {
        showToast({ title: 'Margin unchanged', message: `Still ₹${newVal.toLocaleString('en-IN')}` });
      } else {
        showToast({ title: 'Margin fetched', message: `₹${newVal.toLocaleString('en-IN')} from broker` });
      }
    } else {
      showToast({ title: 'Could not fetch margin', message: result.error || '', type: 'error' });
    }
  };
  if (editing) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 100 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>₹</span>
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} type="number"
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        style={{ background: 'var(--bg-primary)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '3px 6px', width: 80, outline: 'none' }} />
      <button onClick={save} style={{ background: 'none', border: 'none', color: 'var(--profit)', cursor: 'pointer', fontSize: 14 }}>✓</button>
    </div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div onClick={() => { setDraft(value ? String(value) : ''); setEditing(true); }}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
        title="Click to set margin used">
        {value
          ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
              {value >= 100000 ? '₹' + (value / 100000).toFixed(2) + 'L' : value >= 1000 ? '₹' + (value / 1000).toFixed(2) + 'K' : '₹' + parseFloat(value).toFixed(2)}
            </span>
          : <span style={{ fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px dashed var(--text-muted)' }}>+ add</span>}
      </div>
      {hasBrokerLegs && !value && (
        <button onClick={fetchFromBroker} disabled={fetching} title="Fetch margin from broker"
          style={{ background:'rgba(255,255,255,0.06)', border:'none', borderRadius:4, color:'var(--accent)', cursor:'pointer', fontSize:10, padding:'2px 5px' }}>
          {fetching ? '...' : '⇩ fetch'}
        </button>
      )}
    </div>
  );
}


// Editable charges cell (brokerage + taxes)
function ChargesCell({ value, onSave, position }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ? String(value) : '');
  const [fetching, setFetching] = useState(false);
  const { showToast } = useToast();
  const save = () => { const v = parseFloat(draft); onSave(isNaN(v) ? null : v); setEditing(false); };
  const fmt = n => n >= 100000 ? '₹'+(n/100000).toFixed(2)+'L' : n >= 1000 ? '₹'+(n/1000).toFixed(2)+'K' : '₹'+parseFloat(n).toFixed(2);
  const hasBrokerLegs = position?.legs?.some(l => l.brokerTradeId);
  const isOpen = position?.status === 'OPEN';
  const fetchFromBroker = async (e) => {
    e.stopPropagation();
    if (!position) return;
    setFetching(true);
    const result = await fetchTotalCharges(position);
    setFetching(false);
    if (result.ok) {
      const newVal = Math.round(result.charges * 100) / 100;
      const oldVal = value != null ? Math.abs(Math.round(value * 100) / 100) : null;
      onSave(newVal);
      if (oldVal != null && Math.abs(newVal - oldVal) < 0.01) {
        showToast({ title: 'Charges unchanged', message: `Still ₹${newVal.toFixed(2)}` });
      } else {
        showToast({ title: 'Charges fetched', message: `₹${newVal.toFixed(2)} from broker` });
      }
    } else {
      showToast({ title: 'Could not fetch charges', message: result.error || '', type: 'error' });
    }
  };
  if (editing) return (
    <div style={{ display:'flex', alignItems:'center', gap:3, minWidth:100 }}>
      <span style={{ fontSize:11, color:'var(--text-muted)' }}>₹</span>
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} type="number"
        onKeyDown={e => { if (e.key==='Enter') save(); if (e.key==='Escape') setEditing(false); }}
        style={{ background:'var(--bg-primary)', border:'1px solid var(--accent)', borderRadius:4, color:'var(--text-primary)', fontFamily:'var(--font-mono)', fontSize:12, padding:'3px 6px', width:80, outline:'none' }} />
      <button onClick={save} style={{ background:'none', border:'none', color:'var(--profit)', cursor:'pointer', fontSize:14 }}>✓</button>
    </div>
  );
  return (
    <div style={{ display:'flex', alignItems:'center', gap:5 }}>
      <div onClick={() => { setDraft(value ? String(value) : ''); setEditing(true); }}
        style={{ cursor:'pointer', display:'flex', alignItems:'center', gap:4 }} title="Click to set charges">
        {value
          ? <span style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--loss)' }}>-{fmt(value)}</span>
          : <span style={{ fontSize:11, color:'var(--text-muted)', borderBottom:'1px dashed var(--text-muted)' }}>+ add</span>}
      </div>
      {hasBrokerLegs && (
        <button onClick={fetchFromBroker} disabled={fetching} title={isOpen ? 'Fetch entry-side charges from broker' : 'Fetch entry + exit charges from broker'}
          style={{ background:'rgba(255,255,255,0.06)', border:'none', borderRadius:4, color:'var(--accent)', cursor:'pointer', fontSize:10, padding:'2px 5px' }}>
          {fetching ? '...' : '⇩ fetch'}
        </button>
      )}
    </div>
  );
}

// Exit date edit popup
function EditDatesPopup({ position, onClose, onSave }) {
  const [entryDate, setEntryDate] = useState(
    position.openDate ? position.openDate.slice(0, 10) : ''
  );
  const [exitDate, setExitDate] = useState(
    position.closeDate ? position.closeDate.slice(0, 10) : ''
  );
  const expiry = position.expiry ? position.expiry.slice(0, 10) : null;
  const isExpired = exitDate && expiry && exitDate === expiry;

  const handleSave = () => {
    onSave({ positionOpenDate: entryDate || null, positionCloseDate: exitDate || null });
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 340, boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 4 }}>Edit dates</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          {position.strategyName || 'Position'} · {position.instrument} · Expiry {position.expiry ? new Date(position.expiry + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
        </div>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label">Entry Date</label>
          <input className="form-input" type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">Exit Date</label>
          <input className="form-input" type="date" value={exitDate} onChange={e => setExitDate(e.target.value)} />
        </div>
        {exitDate && expiry && (
          <div style={{ fontSize: 11, color: isExpired ? 'var(--accent)' : 'var(--profit)', background: isExpired ? 'rgba(245,158,11,0.08)' : 'rgba(16,217,160,0.08)', border: `1px solid ${isExpired ? 'rgba(245,158,11,0.2)' : 'rgba(16,217,160,0.2)'}`, borderRadius: 6, padding: '6px 10px', marginBottom: 14 }}>
            {isExpired ? '⏱ Counts as expired (closed on expiry day)' : '⚡ Counts as early exit (before expiry)'}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSave}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

// Edit trade popup — lets the user directly correct EVERYTHING on a leg:
// strike, option type, buy/sell, quantity, entry premium, entry date, and
// (when the leg is closed, or the user marks it closed) exit premium + exit
// date + status. Saving writes straight onto the leg via updateTrade, so it
// bypasses closePosition/reopenPosition entirely — nothing will silently
// re-derive or overwrite these values on the next broker sync.
function EditLegPopup({ leg, onClose, onSave }) {
  const [strike,      setStrike]      = useState(String(leg.strike || ''));
  const [premium,     setPremium]     = useState(String(leg.premium || ''));
  const [quantity,    setQuantity]    = useState(String(leg.quantity || ''));
  const [optionType,  setOptionType]  = useState(leg.optionType || 'PE');
  const [txType,      setTxType]      = useState(leg.transactionType || 'SELL');
  const [entryDate,   setEntryDate]   = useState(leg.date ? String(leg.date).slice(0, 10) : '');
  const [isClosed,    setIsClosed]    = useState(leg.status === 'CLOSED' || leg.status === 'EXPIRED');
  const [exitPremium, setExitPremium] = useState(leg.exitPremium != null ? String(leg.exitPremium) : '');
  const [exitDate,    setExitDate]    = useState(leg.exitDate ? String(leg.exitDate).slice(0, 10) : '');

  const handleSave = () => {
    const s = parseFloat(strike);
    const p = parseFloat(premium);
    const q = parseInt(quantity);
    if (!s || !p || !q || isNaN(s) || isNaN(p) || isNaN(q)) {
      alert('Please fill in strike, entry premium and lots correctly.'); return;
    }
    const updates = {
      strike: s,
      premium: p,
      quantity: q,
      optionType,
      transactionType: txType,
      date: entryDate || leg.date,
    };
    if (isClosed) {
      const ep = parseFloat(exitPremium);
      if (exitPremium === '' || isNaN(ep) || ep < 0) {
        alert('Please enter a valid exit premium (0 or more).'); return;
      }
      updates.status = 'CLOSED';
      updates.exitPremium = ep;
      updates.exitDate = exitDate || new Date().toISOString().slice(0, 10);
    } else {
      // Reopening from here — clear exit data and any partial-exit tranches,
      // same as the dedicated Reopen action, so nothing re-closes on next sync.
      updates.status = 'OPEN';
      updates.exitPremium = undefined;
      updates.exitDate = undefined;
      updates.exits = undefined;
      updates.realizedPnL = undefined;
    }
    onSave(updates);
    onClose();
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:24, width:400, boxShadow:'0 16px 48px rgba(0,0,0,0.5)' }}>
        <div style={{ fontWeight:700, fontSize:15, color:'var(--text-primary)', marginBottom:4 }}>Edit Trade</div>
        <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:16 }}>
          Correct any field directly — entry, exit, dates, everything. Saved values are final and won't be recalculated by broker sync.
        </div>

        {/* Option type + direction row */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <div className="form-group" style={{ marginBottom:0 }}>
            <label className="form-label">Option Type</label>
            <select className="form-select" value={optionType} onChange={e => setOptionType(e.target.value)}>
              <option value="PE">PE (Put)</option>
              <option value="CE">CE (Call)</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom:0 }}>
            <label className="form-label">Buy / Sell</label>
            <select className="form-select" value={txType} onChange={e => setTxType(e.target.value)}>
              <option value="SELL">SELL</option>
              <option value="BUY">BUY</option>
            </select>
          </div>
        </div>

        {/* Strike + Lots row */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <div className="form-group" style={{ marginBottom:0 }}>
            <label className="form-label">Strike Price</label>
            <input className="form-input" type="number" value={strike}
              onChange={e => setStrike(e.target.value)} placeholder="e.g. 23000" />
          </div>
          <div className="form-group" style={{ marginBottom:0 }}>
            <label className="form-label">Lots</label>
            <input className="form-input" type="number" min="1" value={quantity}
              onChange={e => setQuantity(e.target.value)} placeholder="e.g. 3" />
          </div>
        </div>

        {/* Entry premium + entry date row */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
          <div className="form-group" style={{ marginBottom:0 }}>
            <label className="form-label">Entry Premium (₹)</label>
            <input className="form-input" type="number" step="0.05" value={premium}
              onChange={e => setPremium(e.target.value)} placeholder="e.g. 105.50" />
          </div>
          <div className="form-group" style={{ marginBottom:0 }}>
            <label className="form-label">Entry Date</label>
            <input className="form-input" type="date" value={entryDate}
              onChange={e => setEntryDate(e.target.value)} />
          </div>
        </div>

        {/* Status toggle */}
        <div className="form-group" style={{ marginBottom:12 }}>
          <label className="form-label">Status</label>
          <div style={{ display:'flex', gap:8 }}>
            <button type="button" onClick={() => setIsClosed(false)}
              style={{ flex:1, padding:'7px', borderRadius:6, border:`1px solid ${!isClosed ? 'var(--accent)' : 'var(--border)'}`, background: !isClosed ? 'rgba(59,130,246,0.12)' : 'transparent', color: !isClosed ? 'var(--accent)' : 'var(--text-muted)', cursor:'pointer', fontSize:12, fontWeight:600 }}>
              Open
            </button>
            <button type="button" onClick={() => setIsClosed(true)}
              style={{ flex:1, padding:'7px', borderRadius:6, border:`1px solid ${isClosed ? 'var(--profit)' : 'var(--border)'}`, background: isClosed ? 'rgba(16,217,160,0.12)' : 'transparent', color: isClosed ? 'var(--profit)' : 'var(--text-muted)', cursor:'pointer', fontSize:12, fontWeight:600 }}>
              Closed
            </button>
          </div>
        </div>

        {/* Exit premium + exit date row — only when marking Closed */}
        {isClosed && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">Exit Premium (₹)</label>
              <input className="form-input" type="number" step="0.05" value={exitPremium}
                onChange={e => setExitPremium(e.target.value)} placeholder="e.g. 0 or 42.50" />
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">Exit Date</label>
              <input className="form-input" type="date" value={exitDate}
                onChange={e => setExitDate(e.target.value)} />
            </div>
          </div>
        )}

        <div style={{ display:'flex', gap:10 }}>
          <button className="btn btn-outline" style={{ flex:1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex:2 }} onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

// Journal / notes panel
function NotesPanel({ position, onClose, onSave }) {
  const { liveQuotes } = useJournal();
  const [notes,      setNotes]      = useState(position.notes || '');
  const [margin,     setMargin]     = useState(position.margin ? String(position.margin) : '');
  const [charges,    setCharges]    = useState(position.charges ? String(position.charges) : '');
  const [entryDate,  setEntryDate]  = useState(position.openDate ? position.openDate.slice(0,10) : '');
  const [exitDate,   setExitDate]   = useState(position.closeDate ? position.closeDate.slice(0,10) : '');
  const [fetchingCharges, setFetchingCharges] = useState(false);
  const [fetchingMargin,  setFetchingMargin]  = useState(false);
  const textRef = useRef();

  useEffect(() => { textRef.current?.focus(); }, []);

  const handleSave = () => {
    onSave({
      positionNotes: notes,
      positionMargin: margin ? parseFloat(margin) : null,
      positionCharges: charges ? parseFloat(charges) : null,
      positionOpenDate: entryDate || null,
      positionCloseDate: exitDate || null,
    });
    onClose();
  };

  const pnl       = position.realizedPnL;
  const maxProfit = calcMaxProfit(position);
  const marginVal = margin ? parseFloat(margin) : null;
  const chargesVal = charges ? parseFloat(charges) : null;
  const retOnMargin = pnl !== null && marginVal ? (pnl / marginVal) * 100 : null;
  const retOnPremium = pnl !== null && maxProfit ? (pnl / Math.abs(maxProfit)) * 100 : null;

  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, bottom: 0, width: 400,
      background: 'var(--bg-card)', borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', zIndex: 200,
      boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
    }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
              {position.instrument} · {position.strategyName || 'Position'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
              {position.expiry ? new Date(position.expiry + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
              {' · '}{position.status}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {/* Quick stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
          {[
            { label: 'Max Profit', value: fmtMoney(maxProfit), color: 'var(--profit)' },
            { label: 'P&L', value: pnl !== null ? fmtMoney(pnl) : '—', color: pnl >= 0 ? 'var(--profit)' : 'var(--loss)' },
            { label: 'Charges', value: position.charges ? '-₹'+Math.abs(parseFloat(position.charges)).toFixed(2) : '—', color: 'var(--loss)' },
          { label: 'Net P&L', value: pnl !== null && position.charges ? fmtMoney(pnl - position.charges) : '—', color: (pnl||0) - (position.charges||0) >= 0 ? 'var(--profit)' : 'var(--loss)' },
          { label: 'Return on Premium', value: retOnPremium !== null ? (retOnPremium >= 0 ? '+' : '') + retOnPremium.toFixed(1) + '%' : '—', color: retOnPremium >= 0 ? 'var(--profit)' : 'var(--loss)' },
            { label: 'Return on Margin', value: retOnMargin !== null ? (retOnMargin >= 0 ? '+' : '') + retOnMargin.toFixed(2) + '%' : '—', color: retOnMargin !== null ? (retOnMargin >= 0 ? 'var(--profit)' : 'var(--loss)') : 'var(--text-muted)' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Body — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: 'clamp(12px,1.5vw,24px)' }}>

        {/* Date editing */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Entry Date</label>
            <input className="form-input" type="date" value={entryDate}
              onChange={e => setEntryDate(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Exit Date {position.status === 'OPEN' && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(open position)</span>}</label>
            <input className="form-input" type="date" value={exitDate}
              onChange={e => setExitDate(e.target.value)}
              placeholder={position.status === 'OPEN' ? 'Still open' : ''} />
          </div>
        </div>

        {/* Charges input */}
        <div className="form-group">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <label className="form-label" style={{ marginBottom:0 }}>Charges (Brokerage + Taxes) ₹</label>
            {position.legs?.some(l => l.brokerTradeId) && (
              <button type="button" disabled={fetchingCharges}
                onClick={async () => {
                  setFetchingCharges(true);
                  const result = await fetchTotalCharges(position);
                  setFetchingCharges(false);
                  if (result.ok) setCharges(String(Math.round(result.charges * 100) / 100));
                  else alert(`Could not fetch charges: ${result.error}`);
                }}
                style={{ background:'rgba(255,255,255,0.06)', border:'none', borderRadius:4, color:'var(--accent)', cursor:'pointer', fontSize:11, padding:'2px 8px' }}>
                {fetchingCharges ? 'fetching...' : '⇩ fetch from broker'}
              </button>
            )}
          </div>
          <input
            className="form-input"
            type="number"
            value={charges}
            onChange={e => setCharges(e.target.value)}
            placeholder="e.g. 2500"
          />
          {chargesVal && pnl !== null && (
            <div style={{ marginTop:6, fontSize:12, fontFamily:'var(--font-mono)', color:'var(--text-muted)' }}>
              Net P&L: <span style={{ color: (pnl-chargesVal)>=0?'var(--profit)':'var(--loss)', fontWeight:600 }}>
                {fmtMoney(pnl - chargesVal)}
              </span>
            </div>
          )}
        </div>

        {/* Margin input */}
        <div className="form-group">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <label className="form-label" style={{ marginBottom:0 }}>Margin Used (₹)</label>
            {position.legs?.some(l => l.brokerTradeId) && (
              <button type="button" disabled={fetchingMargin}
                onClick={async () => {
                  setFetchingMargin(true);
                  const result = await fetchMargin(position.legs);
                  setFetchingMargin(false);
                  if (result.ok) setMargin(String(Math.round(result.margin)));
                  else alert(`Could not fetch margin: ${result.error}`);
                }}
                style={{ background:'rgba(255,255,255,0.06)', border:'none', borderRadius:4, color:'var(--accent)', cursor:'pointer', fontSize:11, padding:'2px 8px' }}>
                {fetchingMargin ? 'fetching...' : '⇩ fetch from broker'}
              </button>
            )}
          </div>
          <input
            className="form-input"
            type="number"
            value={margin}
            onChange={e => setMargin(e.target.value)}
            placeholder="e.g. 150000"
          />
          {marginVal && pnl !== null && (
            <div style={{ marginTop: 6, fontSize: 12, color: retOnMargin >= 0 ? 'var(--profit)' : 'var(--loss)', fontFamily: 'var(--font-mono)' }}>
              Return on margin: {retOnMargin >= 0 ? '+' : ''}{retOnMargin.toFixed(2)}%
            </div>
          )}
        </div>

        {/* Legs summary with partial exit management */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Legs</div>
          <LegsInline
            legs={position.legs}
            positionId={position.positionId}
            positionCharges={position.charges}
            isOpen={position.status === 'OPEN'}
            liveLtps={liveQuotes}
            onAddExit={leg => { onClose(); setTimeout(() => document.dispatchEvent(new CustomEvent('openPartialExit', { detail: { leg, positionId: position.positionId } })), 50); }}
            onRemoveExit={(posId, legId, idx) => {
              if (window.confirm('Remove this exit tranche?')) {
                document.dispatchEvent(new CustomEvent('removeLegExit', { detail: { posId, legId, idx } }));
              }
            }}
            onEditLeg={leg => { onClose(); setTimeout(() => document.dispatchEvent(new CustomEvent('editLeg', { detail: leg })), 50); }}
          />
        </div>

        {/* Notes */}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Notes & Journal</label>
          <textarea
            ref={textRef}
            className="form-input"
            rows={10}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={`Trade thesis, setup notes, what went right/wrong, emotions, lessons learned...\n\nExample:\n- Entered strangle expecting range-bound market\n- IV was elevated at 18%\n- Exited early when market broke support`}
            style={{ resize: 'vertical', lineHeight: 1.6 }}
          />
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
        <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSave}>Save Notes & Margin</button>
      </div>
    </div>
  );
}

const TH = ({ children, style = {} }) => (
  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', ...style }}>
    {children}
  </th>
);


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

// Compute booked P&L from leg exits — accurate per-tranche calculation
function calcBookedPnL(position) {
  const legs = position.legs || [];
  let total = 0, hasAny = false;
  for (const leg of legs) {
    const entry   = leg.premium;
    const exits   = leg.exits || [];
    const exit    = leg.exitPremium;
    const lotSize = leg.lotSize || 1;
    const sign    = leg.transactionType === 'SELL' ? 1 : -1;
    if (exits.length > 0) {
      total += exits.reduce((s, e) => s + sign * (entry - e.exitPremium) * e.quantity * lotSize, 0);
      hasAny = true;
    } else if (exit !== undefined && exit !== null) {
      total += sign * (entry - exit) * (leg.quantity || 1) * lotSize;
      hasAny = true;
    }
  }
  return hasAny ? total : (position.realizedPnL ?? null);
}

export default function TradeHistory() {
  const { positions, deletePosition, updatePositionStrategy, updatePositionMeta, reopenPosition, addLegExit, removeLegExit, updateTrade, liveQuotes } = useJournal();
  const { showToast } = useToast();

  const [filterInstrument, setFilterInstrument] = useState('');
  const [filterStrategy,   setFilterStrategy]   = useState('');
  const [filterStatus,     setFilterStatus]     = useState('');
  const [dateFrom,         setDateFrom]         = useState('');
  const [dateTo,           setDateTo]           = useState('');
  const [notesPos,         setNotesPos]         = useState(null);
  const [editExitPos,      setEditExitPos]      = useState(null);
  const [reopenPos,        setReopenPos]        = useState(null);
  const [partialExitLeg,   setPartialExitLeg]   = useState(null); // { leg, positionId }
  const [editLegData,      setEditLegData]      = useState(null); // { leg } for editing

  // Listen for partial exit events from NotesPanel
  React.useEffect(() => {
    const handleOpenPartialExit = (e) => setPartialExitLeg(e.detail);
    const handleRemoveLegExit   = (e) => { const { posId, legId, idx } = e.detail; removeLegExit(posId, legId, idx); };
    const handleEditLeg         = (e) => setEditLegData(e.detail);
    document.addEventListener('openPartialExit', handleOpenPartialExit);
    document.addEventListener('removeLegExit',   handleRemoveLegExit);
    document.addEventListener('editLeg',         handleEditLeg);
    return () => {
      document.removeEventListener('openPartialExit', handleOpenPartialExit);
      document.removeEventListener('removeLegExit',   handleRemoveLegExit);
      document.removeEventListener('editLeg',         handleEditLeg);
    };
  }, [removeLegExit]);

  const all = useMemo(() =>
    [...positions]
      .filter(p => !filterInstrument || p.instrument === filterInstrument)
      .filter(p => !filterStrategy   || p.strategyName === filterStrategy)
      .filter(p => !filterStatus     || p.status === filterStatus)
      .filter(p => {
        const d = p.openDate || '';
        if (dateFrom && d < dateFrom) return false;
        if (dateTo   && d > dateTo + 'T23:59:59') return false;
        return true;
      })
      .sort((a, b) => { const da = b.openDate || ''; const db = a.openDate || ''; return da > db ? 1 : da < db ? -1 : 0; }),
    [positions, filterInstrument, filterStrategy, filterStatus, dateFrom, dateTo]
  );

  const instruments = [...new Set(positions.map(p => p.instrument))];
  const strategies  = [...new Set(positions.map(p => p.strategyName).filter(Boolean))];
  const closed      = all.filter(p => p.status === 'CLOSED' || p.status === 'EXPIRED');
  const totalPnL    = closed.reduce((s, p) => s + (p.realizedPnL || 0), 0);
  const wins        = closed.filter(p => (p.realizedPnL || 0) > 0).length;
  const winRate     = closed.length > 0 ? ((wins / closed.length) * 100).toFixed(1) : '0.0';
  const hasFilters  = filterInstrument || filterStrategy || filterStatus || dateFrom || dateTo;


  // ── Export to Excel ──────────────────────────────────────────────────────
  const exportToExcel = async () => {
    const XLSX = await import('xlsx');
    if (!all.length) return;

    const fmtD = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
    const fmtM = n => n != null ? parseFloat(n).toFixed(2) : '';

    // Sheet 1: Positions summary
    const posRows = all.map(p => {
      const pnl       = p.realizedPnL;
      const maxProfit = calcMaxProfit(p);
      const maxLoss   = calcMaxLoss(p);
      const margin    = p.margin || null;
      const retMargin = pnl != null && margin ? ((pnl / margin) * 100) : null;
      const retPrem   = pnl != null && maxProfit ? ((pnl / Math.abs(maxProfit)) * 100) : null;
      const strikes   = p.legs?.map(l => `${l.optionType} ${l.transactionType} ${l.strike}`).join(' | ') || '';

      return {
        'Entry Date':        fmtD(p.openDate),
        'Strategy':          p.strategyName || 'Custom',
        'Instrument':        p.instrument || '',
        'Expiry':            fmtD(p.expiry),
        'Strikes':           strikes,
        'Status':            p.status,
        'Exit Date':         p.status !== 'OPEN' ? fmtD(p.closeDate) : 'Active',
        'Max Profit (₹)':    fmtM(maxProfit),
        'Max Loss (₹)':      maxLoss != null ? fmtM(-Math.abs(maxLoss)) : 'Unlimited',
        'R:R':               maxLoss != null && maxLoss !== 0 ? parseFloat((Math.abs(maxLoss) / maxProfit).toFixed(2)) : '',
        'Margin Used (₹)':   margin ? fmtM(margin) : '',
        'P&L (₹)':           pnl != null && p.status !== 'OPEN' && p.status !== 'PARTIAL' ? fmtM(pnl) : '',
        'Charges (₹)':          p.charges ? Math.abs(parseFloat(p.charges)).toFixed(2) : '',
        'Net P&L (₹)':           pnl != null && p.status !== 'OPEN' && p.status !== 'PARTIAL' ? fmtM(pnl - (p.charges || 0)) : '',
        'Return on Premium %': retPrem != null && p.status !== 'OPEN' && p.status !== 'PARTIAL' ? parseFloat(retPrem.toFixed(2)) : '',
        'Return on Margin %':  retMargin != null ? parseFloat(retMargin.toFixed(2)) : '',
        'Legs':              p.legs?.length || 0,
        'Notes':             p.notes || '',
      };
    });

    // Sheet 2: Legs detail
    const legRows = [];
    all.forEach(p => {
      const fmtD2 = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
      p.legs?.forEach(leg => {
        const entry = leg.premium || 0;
        const exit  = leg.exitPremium;
        const lotSize = leg.lotSize || 1;
        const hasExit = exit !== undefined && exit !== null;
        const legPnl  = hasExit
          ? (leg.transactionType === 'SELL' ? (entry - exit) : (exit - entry)) * leg.quantity * lotSize
          : null;
        legRows.push({
          'Entry Date':      fmtD2(p.openDate),
          'Position':        `${p.instrument} ${p.strategyName || ''}`,
          'Expiry':          fmtD2(p.expiry),
          'Option Type':     leg.optionType || '',
          'Buy/Sell':        leg.transactionType || '',
          'Strike':          leg.strike || '',
          'Lots':            leg.quantity || '',
          'Lot Size':        lotSize,
          'Total Qty':       (leg.quantity || 0) * lotSize,
          'Entry Premium ₹': entry,
          'Exit Premium ₹':  hasExit ? exit : '',
          'Leg P&L ₹':       legPnl != null ? parseFloat(legPnl).toFixed(2) : '',
          'Status':          p.status,
        });
      });
    });

    const wb = XLSX.utils.book_new();

    // Positions sheet
    const ws1 = XLSX.utils.json_to_sheet(posRows);
    ws1['!cols'] = [
      {wch:12},{wch:16},{wch:12},{wch:12},{wch:36},{wch:10},{wch:12},
      {wch:14},{wch:14},{wch:14},{wch:12},{wch:20},{wch:20},{wch:6},{wch:40},
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Positions');

    // Legs sheet
    if (legRows.length) {
      const ws2 = XLSX.utils.json_to_sheet(legRows);
      ws2['!cols'] = [
        {wch:12},{wch:22},{wch:12},{wch:10},{wch:8},{wch:8},{wch:6},{wch:8},{wch:8},{wch:14},{wch:14},{wch:12},{wch:10},
      ];
      XLSX.utils.book_append_sheet(wb, ws2, 'Legs Detail');
    }

    // Summary sheet
    const closed = all.filter(p => p.status === 'CLOSED' || p.status === 'EXPIRED');
    const totalPnL = closed.reduce((s,p) => s + (p.realizedPnL || 0), 0);
    const wins = closed.filter(p => (p.realizedPnL||0) > 0).length;
    const summaryData = [
      { 'Metric': 'Total Positions', 'Value': all.length },
      { 'Metric': 'Closed Positions', 'Value': closed.length },
      { 'Metric': 'Open Positions', 'Value': all.filter(p => p.status === 'OPEN').length },
      { 'Metric': 'Winners', 'Value': wins },
      { 'Metric': 'Losers', 'Value': closed.filter(p => (p.realizedPnL||0) < 0).length },
      { 'Metric': 'Win Rate %', 'Value': closed.length ? parseFloat(((wins/closed.length)*100).toFixed(1)) : 0 },
      { 'Metric': 'Total P&L (₹)', 'Value': parseFloat(totalPnL).toFixed(2) },
      { 'Metric': 'Exported On', 'Value': new Date().toLocaleDateString('en-IN') },
    ];
    const ws3 = XLSX.utils.json_to_sheet(summaryData);
    ws3['!cols'] = [{wch:20},{wch:20}];
    XLSX.utils.book_append_sheet(wb, ws3, 'Summary');

    const date = new Date().toISOString().slice(0,10);
    XLSX.writeFile(wb, `OptionsDesk_${date}.xlsx`);
  };

  return (
    <div>
      {/* Backdrop for notes panel */}
      {notesPos && (
        <div onClick={() => setNotesPos(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 199, backdropFilter: 'blur(2px)' }} />
      )}

      {/* Edit exit date popup */}
      {reopenPos && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={e => { if (e.target===e.currentTarget) setReopenPos(null); }}>
          <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:24, width:340, boxShadow:'0 16px 48px rgba(0,0,0,0.5)' }}>
            <div style={{ fontWeight:700, fontSize:15, color:'var(--text-primary)', marginBottom:4 }}>Reopen position?</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:16 }}>
              {reopenPos.strategyName || 'Position'} · {reopenPos.instrument} · Expiry {reopenPos.expiry ? new Date(reopenPos.expiry+'T12:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—'}
            </div>
            <div style={{ fontSize:12, color:'var(--accent)', background:'rgba(59,130,246,0.08)', border:'1px solid rgba(59,130,246,0.2)', borderRadius:6, padding:'8px 10px', marginBottom:16 }}>
              This will clear all exit prices and exit dates, and set the position back to Open.
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <button className="btn btn-outline" style={{ flex:1 }} onClick={() => setReopenPos(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex:2 }} onClick={() => {
                reopenPosition(reopenPos.positionId);
                showToast({ title: 'Position reopened', message: `${reopenPos.instrument} · ${reopenPos.strategyName || ''}` });
                setReopenPos(null);
              }}>Confirm Reopen</button>
            </div>
          </div>
        </div>
      )}

      {partialExitLeg && (
        <PartialExitPopup
          leg={partialExitLeg.leg}
          positionId={partialExitLeg.positionId}
          onClose={() => setPartialExitLeg(null)}
          onSave={(posId, legId, tranche) => {
            addLegExit(posId, legId, tranche);
            showToast({ title: 'Partial exit recorded', message: `${tranche.quantity} lot${tranche.quantity>1?'s':''} @ ₹${tranche.exitPremium}` });
            setPartialExitLeg(null);
          }}
        />
      )}

      {editLegData && (
        <EditLegPopup
          leg={editLegData}
          onClose={() => setEditLegData(null)}
          onSave={updates => {
            updateTrade(editLegData.id, updates);
            showToast({ title: 'Trade updated', message: updates.status === 'CLOSED' ? `Closed @ ₹${updates.exitPremium}` : 'Set to Open' });
            setEditLegData(null);
          }}
        />
      )}

      {editExitPos && (
        <EditDatesPopup
          position={editExitPos}
          onClose={() => setEditExitPos(null)}
          onSave={dates => {
            updatePositionMeta(editExitPos.positionId, dates);
            showToast({ title: 'Dates updated' });
            setEditExitPos(null);
          }}
        />
      )}

      <div className="page-header">
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{display:"flex",alignItems:"center",gap:10}}><div className="page-title">Trade History</div><AccountBadge /></div>
          <button className="btn btn-outline btn-sm" onClick={exportToExcel} disabled={!all.length}
            style={{ display:'flex', alignItems:'center', gap:6 }}>
            ↓ Export Excel
          </button>
        </div>
        <div className="page-subtitle">
          {all.length} positions · {closed.length} closed · Win rate: {winRate}% · P&amp;L:{' '}
          <span style={{ color: totalPnL >= 0 ? 'var(--profit)' : 'var(--loss)', fontFamily: 'var(--font-mono)' }}>{fmtMoney(totalPnL)}</span>
        </div>
      </div>

      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:16 }}><DateRangeSelector /></div>
      <div className="filter-bar">
        <select className="form-select" value={filterInstrument} onChange={e => setFilterInstrument(e.target.value)}>
          <option value="">All Instruments</option>
          {instruments.map(i => <option key={i}>{i}</option>)}
        </select>
        <select className="form-select" value={filterStrategy} onChange={e => setFilterStrategy(e.target.value)}>
          <option value="">All Strategies</option>
          {strategies.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Status</option>
          <option value="OPEN">Open</option>
          <option value="CLOSED">Closed</option>
          <option value="PARTIAL">Partial</option>
          <option value="EXPIRED">Expired</option>
        </select>
        <input className="form-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <input className="form-input" type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)} />
        {hasFilters && <button className="btn btn-ghost btn-sm" onClick={() => { setFilterInstrument(''); setFilterStrategy(''); setFilterStatus(''); setDateFrom(''); setDateTo(''); }}>Clear</button>}
      </div>

      {all.length === 0 ? (
        <div className="card"><div className="empty-state"><div className="icon">📋</div><p>No positions yet.</p></div></div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {all.map((p, posIdx) => {
                const pnl       = calcBookedPnL(p);
                const maxProfit = calcMaxProfit(p);
                const maxLoss   = calcMaxLoss(p);
                const margin    = p.margin || null;
                const charges   = p.charges ? Math.abs(p.charges) : null;
                const netPnl    = pnl !== null ? pnl - (charges || 0) : null;
                const isOpen    = p.status === 'OPEN';
                const hasNotes  = !!(p.notes && p.notes.trim());

                // Return %: use margin if set, else use max profit (premium)
                const ret = netPnl !== null && !isOpen
                  ? margin
                    ? (netPnl / margin) * 100
                    : maxProfit !== 0 ? (netPnl / Math.abs(maxProfit)) * 100 : null
                  : null;

                const retLabel = margin ? 'on margin' : 'on premium';

                // Breakeven — precomputed in JournalContext from entry data
                const breakevens = p.breakevens || [];

                // Combined exit P&L per tranche date across all legs
                // Groups exits by date, sums P&L from each leg for that date
                const combinedExitPnl = (() => {
                  const map = {};
                  (p.legs || []).forEach(leg => {
                    const lTx = (leg.transactionType || '').toUpperCase();
                    const sign = lTx === 'SELL' ? 1 : -1;
                    const ls = leg.lotSize || 1;
                    (leg.exits || []).forEach((e, ei) => {
                      const key = e.exitDate ? e.exitDate.slice(0,10) : `exit_${ei}`;
                      const ep = parseFloat(e.exitPremium || 0);
                      const pnlVal = sign * (leg.premium - ep) * e.quantity * ls;
                      if (!map[key]) map[key] = { pnl: 0, count: 0 };
                      map[key].pnl += pnlVal;
                      map[key].count += 1;
                    });
                  });
                  return map;
                })();
                const isExpiredOpen = isOpen && p.expiry && new Date(p.expiry) < new Date();
                const earlyClose = !isOpen && p.closeDate && p.expiry && p.closeDate.slice(0,10) !== p.expiry.slice(0,10);
                const expiredClose = !isOpen && p.closeDate && p.expiry && p.closeDate.slice(0,10) === p.expiry.slice(0,10);
                const daysHeld = (p.openDate && p.closeDate)
                  ? Math.round((new Date(p.closeDate) - new Date(p.openDate)) / 86400000)
                  : null;

                return (
                  <div key={p.positionId} style={{
                    display:'grid', gridTemplateColumns:'200px minmax(0,1fr)',
                    background:'var(--bg-card)', border:'1px solid var(--border)',
                    borderRadius:12, overflow:'hidden',
                  }}>

                    {/* ── LEFT PANEL ── */}
                    <div style={{ borderRight:'1px solid var(--border)', display:'flex', flexDirection:'column', background:'rgba(0,0,0,0.08)', WebkitFontSmoothing:'antialiased', MozOsxFontSmoothing:'grayscale', textRendering:'optimizeLegibility' }}>

                      {/* Instrument + strategy */}
                      <div style={{ padding:'16px 18px 12px' }}>
                        <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:6 }}>Trade #{all.length - posIdx}</div>
                        <div style={{ fontSize:21, fontWeight:700, color:'var(--text-primary)', lineHeight:1, marginBottom:3 }}>{p.instrument || p.legs?.[0]?.instrument}</div>
                        <div style={{ marginBottom:10 }}>
                          <StrategyCell
                            positionId={p.positionId}
                            value={p.strategyName || 'Custom'}
                            onChange={v => updatePositionMeta(p.positionId, { strategyName: v })}
                          />
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                          <span style={{ fontSize:10, fontWeight:700, padding:'2px 9px', borderRadius:20,
                            background: p.status==='PARTIAL' ? 'rgba(245,158,11,0.1)' : p.status==='OPEN' ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.06)',
                            color: p.status==='PARTIAL' ? '#f59e0b' : p.status==='OPEN' ? 'var(--text-success)' : 'var(--text-muted)',
                            border: p.status==='PARTIAL' ? '0.5px solid rgba(245,158,11,0.3)' : p.status==='OPEN' ? '0.5px solid rgba(34,197,94,0.2)' : '0.5px solid var(--border)'
                          }}>
                            {p.status === 'PARTIAL' ? 'Partially Closed' : p.status}{earlyClose ? ' · Early' : expiredClose ? ' · Expired' : ''}
                          </span>
                          {isExpiredOpen && <span style={{ fontSize:10, color:'#f59e0b', fontWeight:600 }}>⚠ Expiry passed</span>}
                        </div>
                      </div>

                      <div style={{ height:'0.5px', background:'var(--border)', margin:'0 18px' }}></div>

                      {/* Dates */}
                      <div style={{ padding:'14px 18px', borderBottom:'0.5px solid var(--border)' }}>
                        <div style={{ marginBottom:12 }}>
                          <div style={{ fontSize:10, letterSpacing:'.07em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:5 }}>Entry date</div>
                          <div style={{ fontFamily:'var(--font-mono)', fontSize:16, fontWeight:700, color:'var(--text-primary)' }}>{fmtDate(p.openDate)}</div>
                        </div>
                        {daysHeld !== null && (
                          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
                            <div style={{ flex:1, height:'0.5px', background:'var(--border)' }}></div>
                            <span style={{ fontSize:11, color:'var(--text-muted)' }}>{daysHeld} day{daysHeld !== 1 ? 's' : ''} held</span>
                            <div style={{ flex:1, height:'0.5px', background:'var(--border)' }}></div>
                          </div>
                        )}
                        <div>
                          <div style={{ fontSize:10, letterSpacing:'.07em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:5 }}>Exit date</div>
                          <div style={{ fontFamily:'var(--font-mono)', fontSize:16, fontWeight:700, color: isOpen ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                            {isOpen ? '—' : fmtDate(p.closeDate)}
                          </div>
                        </div>
                      </div>

                      {/* Meta */}
                      <div style={{ padding:'12px 18px', borderBottom:'0.5px solid var(--border)', display:'flex', flexDirection:'column', gap:8 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <span style={{ fontSize:13, color:'var(--text-muted)' }}>Expiry</span>
                          <span style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:600, color:'var(--text-secondary)' }}>{fmtDate(p.expiry)}</span>
                        </div>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <span style={{ fontSize:12, color:'var(--text-muted)' }}>Margin</span>
                          <MarginCell value={p.margin} position={p} onSave={v => updatePositionMeta(p.positionId, { positionMargin: v })} />
                        </div>
                        {[
                          { k:'R:R', v: (maxLoss && maxProfit) ? (Math.abs(maxLoss)/maxProfit).toFixed(2)+' : 1' : '—', c:'var(--text-secondary)' },
                          { k:'Max profit', v: maxProfit != null ? (() => { const a=Math.abs(maxProfit); const s=maxProfit<0?'−':'+'; return a>=100000?s+'₹'+(a/100000).toFixed(2)+'L':a>=1000?s+'₹'+(a/1000).toFixed(2)+'K':s+'₹'+a.toFixed(2); })() : '—', c:'var(--profit)' },
                          { k:'Max loss', v: maxLoss != null ? (() => { const a=Math.abs(maxLoss); return '−₹'+(a>=100000?(a/100000).toFixed(2)+'L':a>=1000?(a/1000).toFixed(2)+'K':a.toFixed(2)); })() : '—', c:'var(--loss)' },
                        ].map(({ k, v, c }) => (
                          <div key={k} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <span style={{ fontSize:12, color:'var(--text-muted)' }}>{k}</span>
                            <span style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:600, color:c }}>{v}</span>
                          </div>
                        ))}
                        {/* Breakeven — indigo, separated by subtle divider */}
                        {breakevens.length > 0 && (
                          <>
                            <div style={{ height:'0.5px', background:'rgba(99,102,241,0.25)', margin:'6px 0' }}></div>
                            {breakevens.map(be => (
                              <div key={be.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'3px 0' }}>
                                <span style={{ fontSize:12, color:'rgba(129,140,248,0.8)' }}>{be.label}</span>
                                <span style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:700, color:'#818cf8' }}>{be.value.toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 })}</span>
                              </div>
                            ))}
                          </>
                        )}
                      </div>

                      {/* P&L summary */}
                      <div style={{ padding:'14px 18px', borderBottom:'0.5px solid var(--border)', display:'flex', flexDirection:'column', gap:10 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <span style={{ fontSize:13, color:'var(--text-muted)' }}>Booked P&L</span>
                          <span style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:600, color: pnl > 0 ? 'var(--profit)' : pnl < 0 ? 'var(--loss)' : 'var(--text-muted)' }}>{fmtMoney(pnl)}</span>
                        </div>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <span style={{ fontSize:13, color:'var(--text-muted)' }}>Charges</span>
                          <span style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:600, color:'var(--loss)' }}>
                            {charges != null ? `−₹${charges.toFixed(2)}` : '—'}
                          </span>
                        </div>
                        <div style={{ height:'0.5px', background:'var(--border)' }}></div>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:6 }}>
                          <span style={{ fontSize:12, color:'var(--text-muted)', flexShrink:0 }}>Net P&L</span>
                          <span style={{ fontFamily:'var(--font-mono)', fontSize:16, fontWeight:700, color: netPnl > 0 ? 'var(--profit)' : netPnl < 0 ? 'var(--loss)' : 'var(--text-muted)', whiteSpace:'nowrap' }}>{fmtMoney(netPnl)}</span>
                        </div>
                        {ret !== null && (
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <span style={{ fontSize:12, color:'var(--text-muted)' }}>{retLabel === 'on margin' ? 'On margin' : 'On premium'}</span>
                            <span style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:600, color: ret > 0 ? 'var(--profit)' : ret < 0 ? 'var(--loss)' : 'var(--text-muted)' }}>
                              {ret >= 0 ? '+' : ''}{ret.toFixed(2)}%
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div style={{ padding:'12px 18px', marginTop:'auto', display:'flex', flexDirection:'column', gap:5 }}>
                        <button onClick={() => setEditExitPos(p)} style={{ background:'none', border:'0.5px solid var(--border-hover)', borderRadius:6, color:'var(--text-muted)', cursor:'pointer', padding:'5px 10px', fontSize:11, fontFamily:'var(--font-sans)', width:'100%', textAlign:'center' }}>✎ Edit dates</button>
                        <button onClick={() => setNotesPos(p)} style={{ background: hasNotes ? 'rgba(245,158,11,0.08)' : 'none', border: hasNotes ? '0.5px solid rgba(245,158,11,0.3)' : '0.5px solid var(--border-hover)', borderRadius:6, color: hasNotes ? 'var(--accent)' : 'var(--text-muted)', cursor:'pointer', padding:'5px 10px', fontSize:11, fontFamily:'var(--font-sans)', width:'100%', textAlign:'center' }}>{hasNotes ? '📝 View note' : '+ Add note'}</button>
                        {!isOpen && <button onClick={() => setReopenPos(p)} style={{ background:'none', border:'0.5px solid var(--border-hover)', borderRadius:6, color:'var(--text-muted)', cursor:'pointer', padding:'5px 10px', fontSize:11, fontFamily:'var(--font-sans)', width:'100%', textAlign:'center' }}>↺ Reopen</button>}
                        <FetchChargesBtn position={p} onSave={v => updatePositionMeta(p.positionId, { positionCharges: v })} />
                        <button onClick={() => { if (window.confirm('Delete this position?')) { deletePosition(p.positionId); showToast({ title: 'Position deleted', message: `${p.instrument} · ${p.strategyName || ''}`, type: 'error' }); } }} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:11, opacity:0.5, padding:'3px', width:'100%', textAlign:'center' }}>✕ Delete</button>
                      </div>
                    </div>

                    {/* ── RIGHT PANEL: legs ── */}
                    <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:16, WebkitFontSmoothing:'antialiased', MozOsxFontSmoothing:'grayscale', minWidth:0, overflow:'hidden', fontSmooth:'always' }}>
                      {(p.legs || []).map((leg, li) => {
                        const legTx = (leg.transactionType || '').toUpperCase();
                        const exits = leg.exits || [];
                        const isProfit = legTx === 'SELL'; // SELL legs profit when price falls
                        const spineColor = isProfit ? 'var(--profit)' : 'var(--loss)';
                        const dotColor   = isProfit ? '#22c55e'      : '#ef4444';
                        const legPnl = (() => {
                          const sign = legTx === 'SELL' ? 1 : -1;
                          const entry = leg.premium || 0;
                          const ls = leg.lotSize || 1;
                          if (exits.length > 0) return exits.reduce((s, e) => s + sign * (entry - e.exitPremium) * e.quantity * ls, 0);
                          if (leg.exitPremium != null) return sign * (entry - leg.exitPremium) * (leg.quantity || 1) * ls;
                          return null;
                        })();

                        return (
                          <div key={leg.id || li}>
                            {li > 0 && <div style={{ height:'0.5px', background:'var(--border)', marginBottom:16 }}></div>}
                            {(() => {
                              const allExits = exits.length > 0 ? exits : (leg.exitPremium != null ? [{ exitPremium: leg.exitPremium, quantity: leg.quantity, exitDate: leg.exitDate, charges: null }] : []);
                              const HDR_H = 52;
                              const ROW_H = 44;
                              // Weighted exit avg
                              const totalQty = allExits.reduce((s, e) => s + (e.quantity || 0), 0);
                              const wtdExitAvg = totalQty > 0 ? allExits.reduce((s, e) => s + parseFloat(e.exitPremium || 0) * (e.quantity || 0), 0) / totalQty : null;
                              // Decay captured: for SELL = (entry - exitAvg) / entry * 100; for BUY = (entry - exitAvg) / entry * 100 (negative = good hedge)
                              const decay = wtdExitAvg != null && leg.premium > 0 ? ((leg.premium - wtdExitAvg) / leg.premium * 100) : null;
                              return (
                                <div style={{ display:'flex', gap:14 }}>
                                  {/* Spine */}
                                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', width:18, flexShrink:0 }}>
                                    <div style={{ height: HDR_H/2 - 5.5 + 'px' }}></div>
                                    <div style={{ width:11, height:11, borderRadius:'50%', background:'#6366f1', flexShrink:0 }}></div>
                                    {allExits.length > 0 ? allExits.map((_, ei) => (
                                      <React.Fragment key={ei}>
                                        <div style={{ width:'1.5px', height: ei === 0 ? HDR_H/2 + ROW_H/2 - 6 + 'px' : ROW_H + 'px', background: ei === 0 ? `linear-gradient(180deg,#6366f1,${dotColor})` : dotColor, opacity: ei === 0 ? 1 : 0.45 }}></div>
                                        <div style={{ width:9, height:9, borderRadius:'50%', background:dotColor, flexShrink:0 }}></div>
                                      </React.Fragment>
                                    )) : (
                                      <div style={{ width:'1.5px', flex:1, background:'rgba(99,102,241,0.25)' }}></div>
                                    )}
                                  </div>

                                  {/* Content */}
                                  <div style={{ flex:1, minWidth:0 }}>
                                    {/* Leg header — grid: stats left, buttons+pnl right */}
                                    <div style={{ display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center', height: HDR_H + 'px', borderBottom:'0.5px solid var(--border)', gap:16 }}>
                                      {/* Left: badges + strike + stats */}
                                      <div style={{ display:'flex', alignItems:'center', minWidth:0 }}>
                                        <span style={{ display:'inline-flex', alignItems:'center', fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:4, flexShrink:0, background:'rgba(59,130,246,0.15)', color:'#60a5fa', marginRight:5 }}>{leg.optionType || 'CE'}</span>
                                        <span style={{ display:'inline-flex', alignItems:'center', fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:4, flexShrink:0, background: legTx === 'SELL' ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)', color: legTx === 'SELL' ? '#f87171' : '#4ade80', marginRight:10 }}>{legTx}</span>
                                        <span style={{ fontFamily:'var(--font-mono)', fontSize:15, fontWeight:500, color:'var(--text-primary)', flexShrink:0, marginRight:8 }}>{leg.strike}</span>
                                        <span style={{ fontSize:11, color:'var(--text-muted)', flexShrink:0, marginRight:12 }}>{leg.quantity} lots</span>
                                        <div style={{ width:'0.5px', background:'var(--border)', height:28, flexShrink:0, marginRight:12 }}></div>
                                        <div style={{ display:'flex', flexDirection:'column', gap:2, flexShrink:0, marginRight:12 }}>
                                          <span style={{ fontSize:11, letterSpacing:'.03em', textTransform:'uppercase', color:'var(--text-muted)', whiteSpace:'nowrap', fontWeight:600 }}>Entry avg</span>
                                          <span style={{ fontFamily:'var(--font-mono)', fontSize:15, fontWeight:700, color:'var(--text-primary)', whiteSpace:'nowrap' }}>₹{parseFloat(leg.premium).toFixed(2)}</span>
                                        </div>
                                        {wtdExitAvg !== null && <>
                                          <div style={{ width:'0.5px', background:'var(--border)', height:28, flexShrink:0, marginRight:12 }}></div>
                                          <div style={{ display:'flex', flexDirection:'column', gap:2, flexShrink:0, marginRight:12 }}>
                                            <span style={{ fontSize:11, letterSpacing:'.03em', textTransform:'uppercase', color:'var(--text-muted)', whiteSpace:'nowrap', fontWeight:600 }}>Exit avg</span>
                                            <span style={{ fontFamily:'var(--font-mono)', fontSize:14, fontWeight:700, color: legTx === 'SELL' ? 'var(--profit)' : 'var(--loss)', whiteSpace:'nowrap' }}>₹{wtdExitAvg.toFixed(2)}</span>
                                          </div>
                                          <div style={{ width:'0.5px', background:'var(--border)', height:28, flexShrink:0, marginRight:12 }}></div>
                                          <div style={{ display:'flex', flexDirection:'column', gap:2, flexShrink:0 }}>
                                            <span style={{ fontSize:11, letterSpacing:'.03em', textTransform:'uppercase', color:'var(--text-muted)', whiteSpace:'nowrap', fontWeight:600 }}>Decay captured</span>
                                            <span style={{ fontFamily:'var(--font-mono)', fontSize:14, fontWeight:700, color: decay >= 0 ? 'var(--profit)' : 'var(--loss)', whiteSpace:'nowrap' }}>{decay !== null ? decay.toFixed(2) + '%' : '—'}</span>
                                          </div>
                                        </>}
                                      </div>
                                      {/* Right: always visible */}
                                      <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
                                        <button onClick={() => setPartialExitLeg({ leg, positionId: p.positionId })} style={{ background:'none', border:'0.5px solid var(--border-hover)', borderRadius:5, color:'var(--text-muted)', cursor:'pointer', padding:'2px 9px', fontSize:10, fontFamily:'var(--font-sans)', whiteSpace:'nowrap' }}>+ exit</button>
                                        <button onClick={() => setEditLegData(leg)} title="Edit trade — all fields" style={{ background:'none', border:'0.5px solid var(--border-hover)', borderRadius:5, color:'var(--text-muted)', cursor:'pointer', padding:'2px 7px', fontSize:11, fontFamily:'var(--font-sans)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                                          <i className="ti ti-pencil" style={{ fontSize:12 }} aria-hidden="true" />
                                        </button>
                                        <div style={{ width:'0.5px', background:'var(--border)', height:28 }}></div>
                                        {legPnl !== null
                                          ? <span style={{ fontFamily:'var(--font-mono)', fontSize:14, fontWeight:700, color: legPnl >= 0 ? 'var(--profit)' : 'var(--loss)', whiteSpace:'nowrap' }}>{fmtMoney(legPnl)}</span>
                                          : <span style={{ fontSize:12, color:'var(--text-muted)' }}>open</span>}
                                      </div>
                                    </div>

                                    {/* Exit rows */}
                                    {exits.length > 0 && exits.map((e, ei) => {
                                      const ep = parseFloat(e.exitPremium || 0);
                                      const ePnl = (legTx === 'SELL' ? 1 : -1) * (leg.premium - ep) * e.quantity * (leg.lotSize || 1);
                                      const dateKey = e.exitDate ? e.exitDate.slice(0,10) : null;
                                      const combined = dateKey && combinedExitPnl[dateKey];
                                      const showNet = combined && combined.count >= 2;
                                      return (
                                        <div key={ei} style={{ display:'grid', gridTemplateColumns:'56px 110px 1fr auto', gap:14, alignItems:'center', height: ROW_H + 'px', borderTop: ei === 0 ? 'none' : '0.5px solid var(--border)', paddingLeft:4 }}>
                                          <span style={{ fontSize:12, fontWeight:700, color: ePnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>Exit {ei+1}</span>
                                          <span style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:700, color: ePnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>₹{ep.toFixed(2)}</span>
                                          <span style={{ fontSize:12, color:'var(--text-muted)' }}>{e.quantity}L &nbsp;·&nbsp; {fmtExitDate(e.exitDate)}</span>
                                          <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3 }}>
                                            <span style={{ fontFamily:'var(--font-mono)', fontSize:15, fontWeight:700, color: ePnl >= 0 ? 'var(--profit)' : 'var(--loss)', whiteSpace:'nowrap' }}>{fmtMoney(ePnl)}</span>
                                            {showNet && (
                                              <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                                                <span style={{ fontSize:11, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.03em', fontWeight:600 }}>net</span>
                                                <span style={{ fontFamily:'var(--font-mono)', fontSize:14, fontWeight:700, color: combined.pnl >= 0 ? 'var(--profit)' : 'var(--loss)', whiteSpace:'nowrap' }}>{fmtMoney(combined.pnl)}</span>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}

                                    {/* Single exit (no tranches) */}
                                    {exits.length === 0 && leg.exitPremium != null && (
                                      <div style={{ display:'grid', gridTemplateColumns:'56px 110px 1fr auto', gap:14, alignItems:'center', height: ROW_H + 'px', paddingLeft:4 }}>
                                        <span style={{ fontSize:11, fontWeight:700, color: legPnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>Exit</span>
                                        <span style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:700, color: legPnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>₹{parseFloat(leg.exitPremium).toFixed(2)}</span>
                                        <span style={{ fontSize:11, color:'var(--text-muted)' }}>{leg.quantity}L &nbsp;·&nbsp; {fmtExitDate(leg.exitDate)}</span>
                                        <span style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:700, textAlign:'right', color: legPnl >= 0 ? 'var(--profit)' : 'var(--loss)', whiteSpace:'nowrap' }}>{fmtMoney(legPnl)}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}

                      {/* Note section — fills empty space at bottom right */}
                      {hasNotes ? (
                        <div
                          onClick={() => setNotesPos(p)}
                          style={{ marginTop:'auto', padding:'11px 14px', background:'rgba(245,158,11,0.05)', border:'0.5px solid rgba(245,158,11,0.2)', borderRadius:8, cursor:'pointer' }}
                        >
                          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
                            <span style={{ fontSize:10, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'rgba(245,158,11,0.8)' }}>Note</span>
                            <div style={{ flex:1, height:'0.5px', background:'rgba(245,158,11,0.15)' }}></div>
                            <span style={{ fontSize:10, color:'rgba(245,158,11,0.5)' }}>✎ edit</span>
                          </div>
                          <div style={{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.6, display:'-webkit-box', WebkitLineClamp:4, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                            {p.notes}
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => setNotesPos(p)}
                          style={{ marginTop:'auto', padding:'11px 14px', border:'0.5px dashed var(--border-hover)', borderRadius:8, display:'flex', alignItems:'center', gap:10, cursor:'pointer', opacity:0.45 }}
                        >
                          <span style={{ fontSize:15 }}>📝</span>
                          <span style={{ fontSize:12, color:'var(--text-muted)' }}>Add a note — reasoning, what did you learn?</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
        </div>
      )}

      {/* Notes panel */}
      {notesPos && (
        <NotesPanel
          position={notesPos}
          onClose={() => setNotesPos(null)}
          onSave={updates => {
            updatePositionMeta(notesPos.positionId, updates);
            setNotesPos(null);
          }}
        />
      )}
    </div>
  );
}
