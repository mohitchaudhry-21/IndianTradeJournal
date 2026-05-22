import React, { useState, useMemo, useRef, useEffect } from 'react';
import AccountBadge from '../components/AccountBadge';
import DateRangeSelector from '../components/DateRangeSelector';
import { useJournal } from '../context/JournalContext';

function fmtMoney(n) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '+';
  if (abs >= 100000) return sign + '₹' + (abs / 100000).toFixed(2) + 'L';
  if (abs >= 1000)   return sign + '₹' + (abs / 1000).toFixed(1) + 'K';
  return sign + '₹' + Math.round(abs).toLocaleString('en-IN');
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function calcMaxLoss(position) {
  const { legs } = position;
  if (!legs || legs.length < 2) return null;
  const sells = legs.filter(l => l.transactionType === 'SELL');
  const buys  = legs.filter(l => l.transactionType === 'BUY');
  if (!buys.length) return null;
  const pe_sell = sells.find(l => l.optionType === 'PE');
  const pe_buy  = buys.find(l => l.optionType === 'PE');
  const ce_sell = sells.find(l => l.optionType === 'CE');
  const ce_buy  = buys.find(l => l.optionType === 'CE');
  const ref = sells[0] || buys[0];
  const lotSize = ref.lotSize || 1;
  const lots    = ref.quantity || 1;
  let gross = 0;
  if (pe_sell && pe_buy) gross = Math.max(gross, Math.abs(pe_sell.strike - pe_buy.strike) * lotSize * lots);
  if (ce_sell && ce_buy) gross = Math.max(gross, Math.abs(ce_sell.strike - ce_buy.strike) * lotSize * lots);
  if (!gross) return null;
  return gross - Math.abs(position.netPremiumCollected);
}

function LegsInline({ legs }) {
  if (!legs?.length) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {legs.map((leg, i) => {
        const entry   = leg.premium;
        const exit    = leg.exitPremium;
        const hasExit = exit !== undefined && exit !== null;
        const lotSize = leg.lotSize || 1;
        const legPnl  = hasExit
          ? (leg.transactionType === 'SELL' ? (entry - exit) : (exit - entry)) * leg.quantity * lotSize
          : null;
        return (
          <div key={leg.id || i} style={{ display: 'grid', gridTemplateColumns: 'auto auto auto 1fr auto', alignItems: 'center', gap: 5, paddingBottom: i < legs.length - 1 ? 6 : 0, borderBottom: i < legs.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ display: 'flex', gap: 3 }}>
              <span className={`badge ${leg.optionType?.toLowerCase()}`} style={{ fontSize: 10, padding: '2px 6px' }}>{leg.optionType}</span>
              <span className={`badge ${leg.transactionType?.toLowerCase()}`} style={{ fontSize: 10, padding: '2px 6px' }}>{leg.transactionType}</span>
            </div>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', minWidth: 50 }}>
              {leg.strike?.toLocaleString('en-IN')}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{leg.quantity}L</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
              <span style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', padding: '1px 5px', borderRadius: 3 }}>₹{entry?.toFixed(2) ?? '—'}</span>
              <span style={{ color: 'var(--border-hover)', fontSize: 10 }}>→</span>
              <span style={{ color: hasExit ? (leg.transactionType === 'SELL' ? 'var(--profit)' : 'var(--text-secondary)') : 'var(--text-muted)', background: hasExit ? 'rgba(16,217,160,0.07)' : 'transparent', padding: hasExit ? '1px 5px' : '0', borderRadius: 3 }}>
                {hasExit ? '₹' + exit.toFixed(2) : '—'}
              </span>
            </div>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600, textAlign: 'right', minWidth: 60, color: legPnl === null ? 'var(--text-muted)' : legPnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
              {legPnl === null ? '—' : fmtMoney(legPnl)}
            </span>
          </div>
        );
      })}
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
      <button onClick={() => { setDraft(value); setEditing(true); }} title="Edit strategy" style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer', padding: '3px 4px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><i className="ti ti-pencil" style={{ fontSize: 13 }} aria-hidden="true" /></button>
    </div>
  );
}

// Editable margin cell
function MarginCell({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ? String(value) : '');
  const save = () => {
    const v = parseFloat(draft);
    onSave(isNaN(v) ? null : v);
    setEditing(false);
  };
  if (editing) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 100 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>₹</span>
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} type="number"
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        style={{ background: 'var(--bg-primary)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, padding: '3px 6px', width: 80, outline: 'none' }} />
      <button onClick={save} style={{ background: 'none', border: 'none', color: 'var(--profit)', cursor: 'pointer', fontSize: 14 }}>✓</button>
    </div>
  );
  return (
    <div onClick={() => { setDraft(value ? String(value) : ''); setEditing(true); }}
      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
      title="Click to set margin used">
      {value
        ? <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--text-secondary)' }}>
            {value >= 100000 ? '₹' + (value / 100000).toFixed(1) + 'L' : value >= 1000 ? '₹' + (value / 1000).toFixed(0) + 'K' : '₹' + value}
          </span>
        : <span style={{ fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px dashed var(--text-muted)' }}>+ add</span>}
    </div>
  );
}


// Editable charges cell (brokerage + taxes)
function ChargesCell({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ? String(value) : '');
  const save = () => { const v = parseFloat(draft); onSave(isNaN(v) ? null : v); setEditing(false); };
  const fmt = n => n >= 100000 ? '₹'+(n/100000).toFixed(1)+'L' : n >= 1000 ? '₹'+(n/1000).toFixed(0)+'K' : '₹'+n;
  if (editing) return (
    <div style={{ display:'flex', alignItems:'center', gap:3, minWidth:100 }}>
      <span style={{ fontSize:11, color:'var(--text-muted)' }}>₹</span>
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} type="number"
        onKeyDown={e => { if (e.key==='Enter') save(); if (e.key==='Escape') setEditing(false); }}
        style={{ background:'var(--bg-primary)', border:'1px solid var(--accent)', borderRadius:4, color:'var(--text-primary)', fontFamily:"'JetBrains Mono',monospace", fontSize:12, padding:'3px 6px', width:80, outline:'none' }} />
      <button onClick={save} style={{ background:'none', border:'none', color:'var(--profit)', cursor:'pointer', fontSize:14 }}>✓</button>
    </div>
  );
  return (
    <div onClick={() => { setDraft(value ? String(value) : ''); setEditing(true); }}
      style={{ cursor:'pointer', display:'flex', alignItems:'center', gap:4 }} title="Click to set charges">
      {value
        ? <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:'var(--loss)' }}>-{fmt(value)}</span>
        : <span style={{ fontSize:11, color:'var(--text-muted)', borderBottom:'1px dashed var(--text-muted)' }}>+ add</span>}
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

// Journal / notes panel
function NotesPanel({ position, onClose, onSave }) {
  const [notes,      setNotes]      = useState(position.notes || '');
  const [margin,     setMargin]     = useState(position.margin ? String(position.margin) : '');
  const [charges,    setCharges]    = useState(position.charges ? String(position.charges) : '');
  const [entryDate,  setEntryDate]  = useState(position.openDate ? position.openDate.slice(0,10) : '');
  const [exitDate,   setExitDate]   = useState(position.closeDate ? position.closeDate.slice(0,10) : '');
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
  const maxProfit = position.netPremiumCollected;
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
            { label: 'Charges', value: position.charges ? '-₹'+Math.round(position.charges).toLocaleString('en-IN') : '—', color: 'var(--loss)' },
          { label: 'Net P&L', value: pnl !== null && position.charges ? fmtMoney(pnl - position.charges) : '—', color: (pnl||0) - (position.charges||0) >= 0 ? 'var(--profit)' : 'var(--loss)' },
          { label: 'Return on Premium', value: retOnPremium !== null ? (retOnPremium >= 0 ? '+' : '') + retOnPremium.toFixed(1) + '%' : '—', color: retOnPremium >= 0 ? 'var(--profit)' : 'var(--loss)' },
            { label: 'Return on Margin', value: retOnMargin !== null ? (retOnMargin >= 0 ? '+' : '') + retOnMargin.toFixed(2) + '%' : '—', color: retOnMargin !== null ? (retOnMargin >= 0 ? 'var(--profit)' : 'var(--loss)') : 'var(--text-muted)' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: s.color }}>{s.value}</div>
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
          <label className="form-label">Charges (Brokerage + Taxes) ₹</label>
          <input
            className="form-input"
            type="number"
            value={charges}
            onChange={e => setCharges(e.target.value)}
            placeholder="e.g. 2500"
          />
          {chargesVal && pnl !== null && (
            <div style={{ marginTop:6, fontSize:12, fontFamily:"'JetBrains Mono',monospace", color:'var(--text-muted)' }}>
              Net P&L: <span style={{ color: (pnl-chargesVal)>=0?'var(--profit)':'var(--loss)', fontWeight:600 }}>
                {fmtMoney(pnl - chargesVal)}
              </span>
            </div>
          )}
        </div>

        {/* Margin input */}
        <div className="form-group">
          <label className="form-label">Margin Used (₹)</label>
          <input
            className="form-input"
            type="number"
            value={margin}
            onChange={e => setMargin(e.target.value)}
            placeholder="e.g. 150000"
          />
          {marginVal && pnl !== null && (
            <div style={{ marginTop: 6, fontSize: 12, color: retOnMargin >= 0 ? 'var(--profit)' : 'var(--loss)', fontFamily: "'JetBrains Mono', monospace" }}>
              Return on margin: {retOnMargin >= 0 ? '+' : ''}{retOnMargin.toFixed(2)}%
            </div>
          )}
        </div>

        {/* Legs summary */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Legs</div>
          <LegsInline legs={position.legs} />
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

export default function TradeHistory() {
  const { positions, deletePosition, updatePositionStrategy, updatePositionMeta, reopenPosition } = useJournal();

  const [filterInstrument, setFilterInstrument] = useState('');
  const [filterStrategy,   setFilterStrategy]   = useState('');
  const [filterStatus,     setFilterStatus]     = useState('');
  const [dateFrom,         setDateFrom]         = useState('');
  const [dateTo,           setDateTo]           = useState('');
  const [notesPos,         setNotesPos]         = useState(null);
  const [editExitPos,      setEditExitPos]      = useState(null);
  const [reopenPos,        setReopenPos]        = useState(null);

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
  const closed      = all.filter(p => p.status !== 'OPEN');
  const totalPnL    = closed.reduce((s, p) => s + (p.realizedPnL || 0), 0);
  const wins        = closed.filter(p => (p.realizedPnL || 0) > 0).length;
  const winRate     = closed.length > 0 ? ((wins / closed.length) * 100).toFixed(1) : '0.0';
  const hasFilters  = filterInstrument || filterStrategy || filterStatus || dateFrom || dateTo;


  // ── Export to Excel ──────────────────────────────────────────────────────
  const exportToExcel = async () => {
    const XLSX = await import('xlsx');
    if (!all.length) return;

    const fmtD = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
    const fmtM = n => n != null ? Math.round(n) : '';

    // Sheet 1: Positions summary
    const posRows = all.map(p => {
      const pnl       = p.realizedPnL;
      const maxProfit = p.netPremiumCollected;
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
        'Margin Used (₹)':   margin ? fmtM(margin) : '',
        'P&L (₹)':           pnl != null && p.status !== 'OPEN' ? fmtM(pnl) : '',
        'Charges (₹)':          p.charges ? Math.round(p.charges) : '',
        'Net P&L (₹)':           pnl != null && p.status !== 'OPEN' ? fmtM(pnl - (p.charges || 0)) : '',
        'Return on Premium %': retPrem != null && p.status !== 'OPEN' ? parseFloat(retPrem.toFixed(2)) : '',
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
          'Leg P&L ₹':       legPnl != null ? Math.round(legPnl) : '',
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
    const closed = all.filter(p => p.status !== 'OPEN');
    const totalPnL = closed.reduce((s,p) => s + (p.realizedPnL || 0), 0);
    const wins = closed.filter(p => (p.realizedPnL||0) > 0).length;
    const summaryData = [
      { 'Metric': 'Total Positions', 'Value': all.length },
      { 'Metric': 'Closed Positions', 'Value': closed.length },
      { 'Metric': 'Open Positions', 'Value': all.filter(p => p.status === 'OPEN').length },
      { 'Metric': 'Winners', 'Value': wins },
      { 'Metric': 'Losers', 'Value': closed.filter(p => (p.realizedPnL||0) < 0).length },
      { 'Metric': 'Win Rate %', 'Value': closed.length ? parseFloat(((wins/closed.length)*100).toFixed(1)) : 0 },
      { 'Metric': 'Total P&L (₹)', 'Value': Math.round(totalPnL) },
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
                setReopenPos(null);
              }}>Confirm Reopen</button>
            </div>
          </div>
        </div>
      )}

      {editExitPos && (
        <EditDatesPopup
          position={editExitPos}
          onClose={() => setEditExitPos(null)}
          onSave={dates => {
            updatePositionMeta(editExitPos.positionId, dates);
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
          <span style={{ color: totalPnL >= 0 ? 'var(--profit)' : 'var(--loss)', fontFamily: "'JetBrains Mono', monospace" }}>{fmtMoney(totalPnL)}</span>
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
          <option value="EXPIRED">Expired</option>
        </select>
        <input className="form-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <input className="form-input" type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)} />
        {hasFilters && <button className="btn btn-ghost btn-sm" onClick={() => { setFilterInstrument(''); setFilterStrategy(''); setFilterStatus(''); setDateFrom(''); setDateTo(''); }}>Clear</button>}
      </div>

      {all.length === 0 ? (
        <div className="card"><div className="empty-state"><div className="icon">📋</div><p>No positions yet.</p></div></div>
      ) : (
        <div style={{ overflowX: 'auto', overflowY: 'visible', borderRadius: 10, border: '1px solid var(--border)', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'thin' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <TH>Entry Date</TH>
                <TH>Strategy</TH>
                <TH>Instrument</TH>
                <TH>Strikes</TH>
                <TH>Expiry</TH>
                <TH className="col-hide-lg">Max Profit</TH>
                <TH className="col-hide-lg">Max Loss</TH>
                <TH className="col-hide-md">Margin Used</TH>
                <TH>P&amp;L</TH>
                <TH className="col-hide-lg">Charges</TH>
                <TH>Net P&amp;L</TH>
                <TH className="col-hide-sm">Return %</TH>
                <TH>Status</TH>
                <TH className="col-hide-md">Exit Date</TH>
                <TH style={{ width: 60 }}>Notes</TH>
                <TH style={{ width: 32 }}></TH>
              </tr>
            </thead>
            <tbody>
              {all.map(p => {
                const pnl       = p.realizedPnL;
                const maxProfit = p.netPremiumCollected;
                const maxLoss   = calcMaxLoss(p);
                const margin    = p.margin || null;
                const charges   = p.charges || null;
                const netPnl    = pnl !== null && charges ? pnl - charges : pnl;
                const isOpen    = p.status === 'OPEN';
                const hasNotes  = !!(p.notes && p.notes.trim());

                // Return %: use margin if set, else use max profit (premium)
                const ret = netPnl !== null && !isOpen
                  ? margin
                    ? (netPnl / margin) * 100
                    : maxProfit !== 0 ? (netPnl / Math.abs(maxProfit)) * 100 : null
                  : null;

                const retLabel = margin ? 'on margin' : 'on premium';

                const td = (content, s = {}) => (
                  <td style={{ padding: '12px 12px', borderBottom: '1px solid var(--border)', ...s }}>{content}</td>
                );

                return (
                  <tr key={p.positionId}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>

                    {td(
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{fmtDate(p.openDate)}</span>
                        <button
                          onClick={() => setEditExitPos(p)}
                          title="Edit entry & exit dates"
                          style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer', padding: '3px 4px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        ><i className="ti ti-pencil" style={{ fontSize: 13 }} aria-hidden="true" /></button>
                      </div>,
                      { whiteSpace: 'nowrap' }
                    )}

                    {td(
                      <StrategyCell positionId={p.positionId} value={p.strategyName || 'Custom'}
                        onChange={name => updatePositionStrategy(p.positionId, name)} />
                    )}

                    {td(
                      <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                        <span style={{ fontWeight:600, color:'var(--text-primary)' }}>{p.instrument}</span>
                        <AccountTag accountId={p.accountId} />
                      </div>,
                      { whiteSpace: 'nowrap' }
                    )}

                    {td(<LegsInline legs={p.legs} />, { minWidth: 200 })}

                    {td(fmtDate(p.expiry), { fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' })}

                    {td(fmtMoney(maxProfit), { fontFamily: "'JetBrains Mono', monospace", color: 'var(--profit)', fontWeight: 500, whiteSpace: 'nowrap' })}

                    {td(
                      maxLoss !== null
                        ? <span style={{ color: 'var(--loss)', fontWeight: 500 }}>{fmtMoney(-Math.abs(maxLoss))}</span>
                        : <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>∞</span>,
                      { fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }
                    )}

                    {/* Margin — editable inline */}
                    {td(
                      <MarginCell value={p.margin}
                        onSave={v => updatePositionMeta(p.positionId, { positionMargin: v })} />,
                      { whiteSpace: 'nowrap' }
                    )}

                    {td(
                      isOpen
                        ? <span style={{ color: 'var(--text-muted)' }}>—</span>
                        : <span style={{ color: pnl > 0 ? 'var(--profit)' : pnl < 0 ? 'var(--loss)' : 'var(--text-muted)', fontWeight: 600 }}>{fmtMoney(pnl)}</span>,
                      { fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }
                    )}

                    {/* Charges */}
                    {td(
                      <ChargesCell value={p.charges}
                        onSave={v => updatePositionMeta(p.positionId, { positionCharges: v })} />,
                      { whiteSpace: 'nowrap' }
                    )}

                    {/* Net P&L */}
                    {td(
                      isOpen
                        ? <span style={{ color: 'var(--text-muted)' }}>—</span>
                        : <div>
                            <span style={{ color: netPnl > 0 ? 'var(--profit)' : netPnl < 0 ? 'var(--loss)' : 'var(--text-muted)', fontWeight: 700, fontFamily:"'JetBrains Mono',monospace" }}>{fmtMoney(netPnl)}</span>
                            {charges && <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:1 }}>after charges</div>}
                          </div>,
                      { whiteSpace: 'nowrap' }
                    )}

                    {/* Return % — with tooltip showing basis */}
                    {td(
                      isOpen || ret === null
                        ? <span style={{ color: 'var(--text-muted)' }}>—</span>
                        : <div>
                            <span style={{ color: ret > 0 ? 'var(--profit)' : ret < 0 ? 'var(--loss)' : 'var(--text-muted)', fontWeight: 600 }}>
                              {ret >= 0 ? '+' : ''}{ret.toFixed(2)}%
                            </span>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{retLabel}</div>
                          </div>,
                      { fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }
                    )}

                    {td(
                      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                        <span className={`badge ${p.status.toLowerCase()}`}>{p.status}</span>
                        {!isOpen && (
                          <button
                            onClick={() => setReopenPos(p)}
                            title="Reopen this position"
                            style={{ background:'rgba(255,255,255,0.06)', border:'none', borderRadius:4, color:'var(--text-muted)', cursor:'pointer', fontSize:10, padding:'2px 6px', whiteSpace:'nowrap' }}
                          >↺ Reopen</button>
                        )}
                      </div>
                    )}

                    {td(
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                        {isOpen
                          ? <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 600 }}>● Active</span>
                          : <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(p.closeDate)}</span>
                        }
                        {!isOpen && p.closeDate && p.expiry && (
                          <span style={{
                            fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600,
                            background: p.closeDate.slice(0,10) === p.expiry.slice(0,10) ? 'rgba(245,158,11,0.12)' : 'rgba(16,217,160,0.1)',
                            color: p.closeDate.slice(0,10) === p.expiry.slice(0,10) ? 'var(--accent)' : 'var(--profit)',
                          }}>
                            {p.closeDate.slice(0,10) === p.expiry.slice(0,10) ? 'EXPIRED' : 'EARLY'}
                          </span>
                        )}
                        <button
                          onClick={() => setEditExitPos(p)}
                          title="Edit entry & exit dates"
                          style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer', padding: '3px 4px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        ><i className="ti ti-pencil" style={{ fontSize: 13 }} aria-hidden="true" /></button>
                      </div>,
                      { whiteSpace: 'nowrap' }
                    )}

                    {/* Notes button */}
                    {td(
                      <button
                        onClick={() => setNotesPos(p)}
                        title={hasNotes ? 'View/edit notes' : 'Add notes & journal'}
                        style={{
                          background: hasNotes ? 'var(--accent-dim)' : 'none',
                          border: hasNotes ? '1px solid rgba(245,158,11,0.3)' : '1px dashed var(--border-hover)',
                          borderRadius: 6, color: hasNotes ? 'var(--accent)' : 'var(--text-muted)',
                          cursor: 'pointer', padding: '4px 8px', fontSize: 13, transition: 'all 0.15s',
                        }}
                      >
                        {hasNotes ? '📝' : '+ note'}
                      </button>
                    )}

                    {td(
                      <button onClick={() => { if (window.confirm('Delete this position?')) deletePosition(p.positionId); }}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, opacity: 0.5, padding: '2px 4px' }}
                        title="Delete">✕</button>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
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
