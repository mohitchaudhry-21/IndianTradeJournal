import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import AccountBadge from '../components/AccountBadge';
import AccountTag from '../components/AccountTag';
import DateRangeSelector from '../components/DateRangeSelector';
import { useJournal } from '../context/JournalContext';
import { useToast } from '../context/ToastContext';
import { calcMaxLoss, calcMaxProfit } from '../utils/calcMaxValues';
import { calcUnrealizedPnL } from '../utils/livePnL';

function fmt(n) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '+';
  if (abs >= 100000) return sign + '₹' + (abs / 100000).toFixed(2) + 'L';
  if (abs >= 1000) return sign + '₹' + Math.round(abs).toLocaleString('en-IN');
  return sign + '₹' + abs.toFixed(0);
}

// Full close modal — unchanged logic, just exit price + date per leg
function CloseModal({ position, onClose, onConfirm }) {
  const [exits, setExits] = useState(() => {
    const m = {};
    position.legs.forEach(l => { m[l.id] = { exitPremium: '', exitDate: new Date().toISOString().slice(0, 10) }; });
    return m;
  });

  const setLeg = (id, field, val) => setExits(p => ({ ...p, [id]: { ...p[id], [field]: val } }));

  const handleConfirm = () => {
    const invalid = position.legs.some(l => exits[l.id].exitPremium === '' || isNaN(Number(exits[l.id].exitPremium)));
    if (invalid) { alert('Please enter exit premium for all legs.'); return; }
    onConfirm(exits);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Close Position — {position.instrument} {position.strategyName}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="alert alert-info" style={{ marginBottom: 20 }}>
          Enter the exit premium for each leg. For expired options, enter 0.
        </div>

        {position.legs.map(leg => {
          const alreadyExited = (leg.exits || []).reduce((s, e) => s + (e.quantity || 0), 0);
          const remaining = (leg.quantity || 1) - alreadyExited;
          return (
            <div key={leg.id} style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '14px', marginBottom: 10, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
                <span className={`badge ${leg.optionType?.toLowerCase()}`}>{leg.optionType}</span>
                <span className={`badge ${leg.transactionType?.toLowerCase()}`}>{leg.transactionType}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>
                  {leg.strike}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 4 }}>
                  Entry: ₹{leg.premium} × {remaining} lots remaining
                </span>
              </div>
              {/* Show existing partial exits */}
              {(leg.exits || []).length > 0 && (
                <div style={{ marginBottom: 10, padding: '8px 10px', background: 'var(--bg-card)', borderRadius: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                  Already exited: {leg.exits.map((e, i) => (
                    <span key={i} style={{ fontFamily: "'JetBrains Mono',monospace", color: 'var(--text-secondary)' }}>
                      {e.quantity}L @ ₹{e.exitPremium?.toFixed(2)}{i < leg.exits.length-1 ? ',  ' : ''}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Exit Premium (₹)</label>
                  <input
                    className="form-input"
                    type="number"
                    min="0"
                    step="0.05"
                    placeholder="0.00"
                    value={exits[leg.id].exitPremium}
                    onChange={e => setLeg(leg.id, 'exitPremium', e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Exit Date</label>
                  <input
                    className="form-input"
                    type="date"
                    value={exits[leg.id].exitDate}
                    onChange={e => setLeg(leg.id, 'exitDate', e.target.value)}
                  />
                </div>
              </div>
            </div>
          );
        })}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleConfirm}>Close Position</button>
        </div>
      </div>
    </div>
  );
}

// Partial exit modal — exit specific lots on a specific leg
function PartialExitModal({ position, onClose, onConfirm }) {
  const [selectedLegId, setSelectedLegId] = useState(position.legs[0]?.id || '');
  const [qty, setQty]     = useState('');
  const [price, setPrice] = useState('');
  const [date, setDate]   = useState(new Date().toISOString().slice(0, 10));

  const selectedLeg = position.legs.find(l => l.id === selectedLegId);
  const alreadyExited = (selectedLeg?.exits || []).reduce((s, e) => s + (e.quantity || 0), 0);
  const remaining = selectedLeg ? (selectedLeg.quantity || 1) - alreadyExited : 0;

  const handleConfirm = () => {
    const q = parseInt(qty);
    const p = parseFloat(price);
    if (!q || q < 1 || q > remaining) { alert(`Enter between 1 and ${remaining} lots.`); return; }
    if (!p || isNaN(p)) { alert('Enter a valid exit price.'); return; }
    onConfirm(selectedLegId, { quantity: q, exitPremium: p, exitDate: date });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Partial Exit — {position.instrument} {position.strategyName}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="alert alert-info" style={{ marginBottom: 20 }}>
          Record a partial exit on one leg. The remaining lots stay open.
        </div>

        {/* Leg selector */}
        <div className="form-group">
          <label className="form-label">Select Leg</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {position.legs.map(leg => {
              const legExited = (leg.exits || []).reduce((s, e) => s + (e.quantity || 0), 0);
              const legRemaining = (leg.quantity || 1) - legExited;
              const isSelected = leg.id === selectedLegId;
              return (
                <div key={leg.id}
                  onClick={() => { setSelectedLegId(leg.id); setQty(''); setPrice(''); }}
                  style={{
                    padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                    background: isSelected ? 'rgba(59,130,246,0.08)' : 'var(--bg-primary)',
                  }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className={`badge ${leg.optionType?.toLowerCase()}`}>{leg.optionType}</span>
                    <span className={`badge ${leg.transactionType?.toLowerCase()}`}>{leg.transactionType}</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{leg.strike?.toLocaleString('en-IN')}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>@ ₹{leg.premium}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: legRemaining < leg.quantity ? 'var(--accent)' : 'var(--text-muted)' }}>
                      {legRemaining}L remaining {legExited > 0 ? `(${legExited}L already exited)` : ''}
                    </span>
                  </div>
                  {/* Show existing exits for this leg */}
                  {(leg.exits || []).length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', paddingLeft: 4 }}>
                      {leg.exits.map((e, i) => (
                        <span key={i} style={{ fontFamily: "'JetBrains Mono',monospace" }}>
                          {e.quantity}L @ ₹{e.exitPremium?.toFixed(2)} on {e.exitDate}
                          {i < leg.exits.length-1 ? '  ·  ' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {selectedLeg && remaining > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 16 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Lots to exit (max {remaining})</label>
              <input className="form-input" type="number" min="1" max={remaining}
                value={qty} onChange={e => setQty(e.target.value)} placeholder={`1–${remaining}`} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Exit Price (₹)</label>
              <input className="form-input" type="number" step="0.05"
                value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 45.50" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Exit Date</label>
              <input className="form-input" type="date"
                value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>
        )}

        {selectedLeg && remaining === 0 && (
          <div style={{ padding: '12px', background: 'var(--bg-primary)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 12, marginTop: 16 }}>
            All lots on this leg have already been exited.
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 2 }}
            onClick={handleConfirm}
            disabled={!qty || !price || parseInt(qty) > remaining || remaining === 0}>
            Record Partial Exit
          </button>
        </div>
      </div>
    </div>
  );
}

// EditLegPopup — same as TradeHistory version
function EditLegPopup({ leg, onClose, onSave }) {
  const [strike,     setStrike]     = React.useState(String(leg.strike || ''));
  const [premium,    setPremium]    = React.useState(String(leg.premium || ''));
  const [quantity,   setQuantity]   = React.useState(String(leg.quantity || ''));
  const [optionType, setOptionType] = React.useState(leg.optionType || 'PE');
  const [txType,     setTxType]     = React.useState(leg.transactionType || 'SELL');
  const handleSave = () => {
    const s = parseFloat(strike), p = parseFloat(premium), q = parseInt(quantity);
    if (!s||!p||!q||isNaN(s)||isNaN(p)||isNaN(q)) { alert('Please fill in all fields.'); return; }
    onSave({ strike:s, premium:p, quantity:q, optionType, transactionType:txType });
    onClose();
  };
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:24, width:380, boxShadow:'0 16px 48px rgba(0,0,0,0.5)' }}>
        <div style={{ fontWeight:700, fontSize:15, color:'var(--text-primary)', marginBottom:4 }}>Edit Leg</div>
        <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:16 }}>Correct any incorrect values.</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <div className="form-group" style={{ marginBottom:0 }}>
            <label className="form-label">Option Type</label>
            <select className="form-select" value={optionType} onChange={e => setOptionType(e.target.value)}>
              <option value="PE">PE (Put)</option><option value="CE">CE (Call)</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom:0 }}>
            <label className="form-label">Buy / Sell</label>
            <select className="form-select" value={txType} onChange={e => setTxType(e.target.value)}>
              <option value="SELL">SELL</option><option value="BUY">BUY</option>
            </select>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <div className="form-group" style={{ marginBottom:0 }}>
            <label className="form-label">Strike Price</label>
            <input className="form-input" type="number" value={strike} onChange={e => setStrike(e.target.value)} placeholder="e.g. 23000" />
          </div>
          <div className="form-group" style={{ marginBottom:0 }}>
            <label className="form-label">Lots</label>
            <input className="form-input" type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} />
          </div>
        </div>
        <div className="form-group" style={{ marginBottom:16 }}>
          <label className="form-label">Entry Premium (₹)</label>
          <input className="form-input" type="number" step="0.05" value={premium} onChange={e => setPremium(e.target.value)} placeholder="e.g. 105.50" />
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <button className="btn btn-outline" style={{ flex:1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex:2 }} onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

function PositionCard({ position, onClose, onPartialExit, onDelete, onEditLeg, liveQuotes }) {
  const [expanded, setExpanded] = useState(true);
  const dteColor = position.daysToExpiry !== null
    ? position.daysToExpiry <= 1 ? 'var(--loss)'
    : position.daysToExpiry <= 5 ? 'var(--accent)'
    : 'var(--text-secondary)'
    : 'var(--text-muted)';

  // Check if any leg has partial exits
  const hasPartialExits = position.legs.some(l => (l.exits || []).length > 0);
  const totalAlreadyExited = position.legs.reduce((s, l) =>
    s + (l.exits || []).reduce((ls, e) => ls + (e.quantity || 0), 0), 0);

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      {/* Card header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: expanded ? 16 : 0, cursor: 'pointer' }} onClick={() => setExpanded(e => !e)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
          <span className={`badge ${position.strategyName?.toLowerCase().replace(/ /g, '_') || 'custom'}`}>
            {position.strategyName || 'Custom'}
          </span>
          <AccountTag accountId={position.accountId} />
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.2px' }}>
            {position.instrument}
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--text-muted)' }}>
            {position.expiry ? new Date(position.expiry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
          </span>
          {position.daysToExpiry !== null && (
            <span className="info-tag" style={{ color: dteColor, borderColor: dteColor + '40' }}>
              {position.daysToExpiry >= 0 ? `${position.daysToExpiry}d to expiry` : 'Expired'}
            </span>
          )}
          {hasPartialExits && (
            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(245,158,11,0.12)', color: 'var(--accent)', fontWeight: 600 }}>
              PARTIAL EXIT
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
          <div style={{ display:'flex', gap:16, marginRight:8 }}>
            {(() => {
              const upnl = calcUnrealizedPnL(position, liveQuotes || {});
              if (upnl === null) return (
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:2 }}>UNREALISED P&L</div>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:16, fontWeight:600, color:'var(--text-muted)' }}>
                    —
                  </div>
                </div>
              );
              return (
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:2 }}>UNREALISED P&L</div>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:16, fontWeight:600, color: upnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                    {fmt(upnl)}
                  </div>
                </div>
              );
            })()}
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:2 }}>NET PREMIUM</div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:16, fontWeight:600, color:'var(--profit)' }}>
                {fmt(position.netPremiumCollected)}
              </div>
            </div>
            {(() => {
              const mp = calcMaxProfit(position);
              const ml = calcMaxLoss(position);
              if (!ml || ml === 0) return null;
              const rr = Math.abs(ml) / mp;
              const color = rr <= 0.5 ? 'var(--profit)' : rr <= 1 ? 'var(--accent)' : 'var(--loss)';
              return (
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:2 }}>R:R RATIO</div>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:16, fontWeight:600, color }}>
                    {rr.toFixed(2)} : 1
                  </div>
                </div>
              );
            })()}
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => onPartialExit(position)}
            style={{ whiteSpace: 'nowrap' }}>⅓ Partial</button>
          <button className="btn btn-primary btn-sm" onClick={() => onClose(position)}>Close</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(e => !e)} style={{ minWidth: 36, fontSize: 16 }}>{expanded ? '▲' : '▼'}</button>
          <button className="btn btn-danger btn-sm" onClick={() => {
            if (window.confirm('Delete this entire position?')) onDelete(position.positionId);
          }}>✕</button>
        </div>
      </div>

      {expanded && (
        <>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>Legs</div>
            {position.legs.map((leg, i) => {
              const lotSize = leg.lotSize || 1;
              const legPremiumVal = (leg.transactionType === 'SELL' ? 1 : -1) * leg.premium * leg.quantity * lotSize;
              const alreadyExited = (leg.exits || []).reduce((s, e) => s + (e.quantity || 0), 0);
              const remaining = (leg.quantity || 1) - alreadyExited;
              const isPartial = alreadyExited > 0 && remaining > 0;
              const isFullyExited = alreadyExited > 0 && remaining <= 0;
              // Weighted avg exit price for partially exited lots
              const avgExitPrice = (leg.exits || []).length > 0
                ? (leg.exits.reduce((s,e) => s + e.exitPremium * e.quantity, 0) / alreadyExited).toFixed(2)
                : null;
              return (
                <div key={leg.id} className="leg-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <span className={`badge ${leg.optionType?.toLowerCase()}`}>{leg.optionType}</span>
                  <span className={`badge ${leg.transactionType?.toLowerCase()}`}>{leg.transactionType}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', minWidth: 70 }}>
                    {leg.strike?.toLocaleString('en-IN')}
                  </span>
                  <span style={{ color: isPartial ? 'var(--accent)' : isFullyExited ? 'var(--text-muted)' : 'var(--text-muted)', fontSize: 12 }}>
                    {isFullyExited ? `Closed · ${leg.quantity}L` : isPartial ? `${remaining}L open / ${leg.quantity}L total` : `${leg.quantity} lot${leg.quantity > 1 ? 's' : ''} × ${lotSize}`}
                  </span>
                  <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-secondary)', fontSize: 13 }}>
                    @ ₹{leg.premium}
                    {avgExitPrice && <span style={{ color: 'var(--profit)', marginLeft: 6 }}>→ avg exit ₹{avgExitPrice}</span>}
                  </span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: legPremiumVal >= 0 ? 'var(--profit)' : 'var(--loss)', minWidth: 90, textAlign: 'right' }}>
                    {fmt(legPremiumVal)}
                  </span>
                  <button onClick={e => { e.stopPropagation(); onEditLeg(leg); }} title="Edit leg"
                    style={{ background:'rgba(255,255,255,0.06)', border:'none', borderRadius:4, color:'var(--text-muted)', cursor:'pointer', padding:'3px 4px', lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <i className="ti ti-pencil" style={{ fontSize:12 }} aria-hidden="true" />
                  </button>
                  {/* Individual exit tranches */}
                  {(leg.exits || []).length > 0 && (
                    <div style={{ width: '100%', paddingLeft: 8, marginTop: 2, fontSize: 11, color: 'var(--text-muted)' }}>
                      {leg.exits.map((e, ei) => (
                        <span key={ei} style={{ fontFamily: "'JetBrains Mono',monospace", marginRight: 12 }}>
                          {e.quantity}L @ ₹{e.exitPremium?.toFixed(2)} · {e.exitDate}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {position.notes && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              📝 {position.notes}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Positions() {
  const { positions, closePosition, deletePosition, addLegExit, updateTrade, liveQuotes, liveLoading, liveLastUpdated, refreshLiveQuotes } = useJournal();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [closingPos,      setClosingPos]      = useState(null);
  const [partialExitPos,  setPartialExitPos]  = useState(null);
  const [editLegPos,      setEditLegPos]      = useState(null); // leg being edited
  const [filterInstrument, setFilterInstrument] = useState('');
  const [filterStrategy,   setFilterStrategy]   = useState('');

  const open = useMemo(() =>
    positions
      .filter(p => p.status === 'OPEN' || p.status === 'PARTIAL')
      .filter(p => !filterInstrument || p.instrument === filterInstrument)
      .filter(p => !filterStrategy || p.strategyName === filterStrategy)
      .sort((a, b) => (a.daysToExpiry ?? 999) - (b.daysToExpiry ?? 999)),
    [positions, filterInstrument, filterStrategy]
  );

  const instruments = [...new Set(positions.filter(p => p.status === 'OPEN' || p.status === 'PARTIAL').map(p => p.instrument))];
  const strategies  = [...new Set(positions.filter(p => p.status === 'OPEN' || p.status === 'PARTIAL').map(p => p.strategyName))];

  const handleClose = (pos) => setClosingPos(pos);
  const handleConfirmClose = (exits) => {
    closePosition(closingPos.positionId, exits);
    showToast({ title: 'Position closed', message: `${closingPos.instrument} · ${closingPos.strategyName || ''}` });
    setClosingPos(null);
  };

  const handlePartialExit = (pos) => setPartialExitPos(pos);
  const handleConfirmPartialExit = (legId, tranche) => {
    addLegExit(partialExitPos.positionId, legId, tranche);
    showToast({ title: 'Partial exit recorded', message: `${partialExitPos.instrument} · ${tranche.quantity} lot${tranche.quantity>1?'s':''} @ ₹${tranche.exitPremium}` });
    setPartialExitPos(null);
  };

  const handleDelete = (positionId) => {
    const pos = positions.find(p => p.positionId === positionId);
    deletePosition(positionId);
    showToast({ title: 'Position deleted', message: pos ? `${pos.instrument} · ${pos.strategyName || ''}` : '', type: 'error' });
  };

  const totalNetPremium = open.reduce((s, p) => s + p.netPremiumCollected, 0);

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
              <div className="page-title">Open Positions</div>
              <AccountBadge />
            </div>
            <div className="page-subtitle">
              {open.length} active position{open.length !== 1 ? 's' : ''} · Net premium: <span style={{ color: 'var(--profit)', fontFamily: "'JetBrains Mono', monospace" }}>{fmt(totalNetPremium)}</span>
              {liveLastUpdated && (
                <span style={{ marginLeft:10, fontSize:11, color:'var(--text-muted)' }}>
                  · Live prices updated {liveLastUpdated.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}
                  <button onClick={refreshLiveQuotes} disabled={liveLoading}
                    style={{ marginLeft:6, background:'none', border:'none', color:'var(--accent)', cursor:'pointer', fontSize:11, textDecoration:'underline' }}>
                    {liveLoading ? 'refreshing...' : 'refresh now'}
                  </button>
                </span>
              )}
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/entry')}>+ Add Trade</button>
        </div>
      </div>

      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:16 }}><DateRangeSelector /></div>
      {(instruments.length > 1 || strategies.length > 1) && (
        <div className="filter-bar">
          <select className="form-select" value={filterInstrument} onChange={e => setFilterInstrument(e.target.value)}>
            <option value="">All Instruments</option>
            {instruments.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
          <select className="form-select" value={filterStrategy} onChange={e => setFilterStrategy(e.target.value)}>
            <option value="">All Strategies</option>
            {strategies.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      {open.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="icon">📊</div>
            <p>No open positions. Add your first options trade!</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/entry')}>
              + Add Trade
            </button>
          </div>
        </div>
      ) : (
        open.map(p => (
          <PositionCard
            key={p.positionId}
            position={p}
            onClose={handleClose}
            onPartialExit={handlePartialExit}
            onDelete={handleDelete}
            onEditLeg={leg => setEditLegPos(leg)}
            liveQuotes={liveQuotes}
          />
        ))
      )}

      {closingPos && (
        <CloseModal
          position={closingPos}
          onClose={() => setClosingPos(null)}
          onConfirm={handleConfirmClose}
        />
      )}

      {partialExitPos && (
        <PartialExitModal
          position={partialExitPos}
          onClose={() => setPartialExitPos(null)}
          onConfirm={handleConfirmPartialExit}
        />
      )}

      {editLegPos && (
        <EditLegPopup
          leg={editLegPos}
          onClose={() => setEditLegPos(null)}
          onSave={updates => {
            updateTrade(editLegPos.id, updates);
            setEditLegPos(null);
          }}
        />
      )}
    </div>
  );
}
