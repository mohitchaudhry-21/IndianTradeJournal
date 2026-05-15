import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import AccountBadge from '../components/AccountBadge';
import DateRangeSelector from '../components/DateRangeSelector';
import { useJournal } from '../context/JournalContext';

function fmt(n) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '+';
  if (abs >= 100000) return sign + '₹' + (abs / 100000).toFixed(2) + 'L';
  if (abs >= 1000) return sign + '₹' + (abs / 1000).toFixed(1) + 'K';
  return sign + '₹' + abs.toFixed(0);
}

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

        {position.legs.map(leg => (
          <div key={leg.id} style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '14px', marginBottom: 10, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
              <span className={`badge ${leg.optionType?.toLowerCase()}`}>{leg.optionType}</span>
              <span className={`badge ${leg.transactionType?.toLowerCase()}`}>{leg.transactionType}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>
                {leg.strike}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 4 }}>
                Entry: ₹{leg.premium} × {leg.quantity} lots
              </span>
            </div>
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
        ))}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleConfirm}>Close Position</button>
        </div>
      </div>
    </div>
  );
}

function PositionCard({ position, onClose, onDelete }) {
  const [expanded, setExpanded] = useState(true);
  const dteColor = position.daysToExpiry !== null
    ? position.daysToExpiry <= 1 ? 'var(--loss)'
    : position.daysToExpiry <= 5 ? 'var(--accent)'
    : 'var(--text-secondary)'
    : 'var(--text-muted)';

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      {/* Card header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: expanded ? 16 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className={`badge ${position.strategyName?.toLowerCase().replace(/ /g, '_') || 'custom'}`}>
            {position.strategyName || 'Custom'}
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.2px' }}>
            {position.instrument}
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--text-muted)' }}>
            {position.expiry ? new Date(position.expiry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : ''}
          </span>
          {position.daysToExpiry !== null && (
            <span className="info-tag" style={{ color: dteColor, borderColor: dteColor + '40' }}>
              {position.daysToExpiry >= 0 ? `${position.daysToExpiry}d to expiry` : 'Expired'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ textAlign: 'right', marginRight: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>NET PREMIUM</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 600, color: 'var(--profit)' }}>
              {fmt(position.netPremiumCollected)}
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => onClose(position)}>Close</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(e => !e)}>{expanded ? '▲' : '▼'}</button>
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
              return (
                <div key={leg.id} className="leg-row">
                  <span className={`badge ${leg.optionType?.toLowerCase()}`}>{leg.optionType}</span>
                  <span className={`badge ${leg.transactionType?.toLowerCase()}`}>{leg.transactionType}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', minWidth: 70 }}>
                    {leg.strike?.toLocaleString('en-IN')}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {leg.quantity} lot{leg.quantity > 1 ? 's' : ''} × {lotSize}
                  </span>
                  <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-secondary)', fontSize: 13 }}>
                    @ ₹{leg.premium}
                  </span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: legPremiumVal >= 0 ? 'var(--profit)' : 'var(--loss)', minWidth: 90, textAlign: 'right' }}>
                    {fmt(legPremiumVal)}
                  </span>
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
  const { positions, closePosition, deletePosition } = useJournal();
  const navigate = useNavigate();
  const [closingPos, setClosingPos] = useState(null);
  const [filterInstrument, setFilterInstrument] = useState('');
  const [filterStrategy, setFilterStrategy] = useState('');

  const open = useMemo(() =>
    positions
      .filter(p => p.status === 'OPEN')
      .filter(p => !filterInstrument || p.instrument === filterInstrument)
      .filter(p => !filterStrategy || p.strategyName === filterStrategy)
      .sort((a, b) => (a.daysToExpiry ?? 999) - (b.daysToExpiry ?? 999)),
    [positions, filterInstrument, filterStrategy]
  );

  const instruments = [...new Set(positions.filter(p => p.status === 'OPEN').map(p => p.instrument))];
  const strategies = [...new Set(positions.filter(p => p.status === 'OPEN').map(p => p.strategyName))];

  const handleClose = async (pos) => setClosingPos(pos);
  const handleConfirmClose = (exits) => {
    closePosition(closingPos.positionId, exits);
    setClosingPos(null);
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
            <div className="page-subtitle">{open.length} active position{open.length !== 1 ? 's' : ''} · Net premium: <span style={{ color: 'var(--profit)', fontFamily: "'JetBrains Mono', monospace" }}>{fmt(totalNetPremium)}</span></div>
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/entry')}>+ Add Trade</button>
        </div>
      </div>

      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:16 }}><DateRangeSelector /></div>
      {/* Filters */}
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
            onDelete={deletePosition}
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
    </div>
  );
}
