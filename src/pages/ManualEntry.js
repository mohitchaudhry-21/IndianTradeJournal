import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import AccountBadge from '../components/AccountBadge';
import { useJournal } from '../context/JournalContext';
import { useToast } from '../context/ToastContext';

const INSTRUMENTS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX', 'BANKEX'];
const STRATEGIES = ['Strangle', 'Straddle', 'Iron Condor', 'Bull Put Spread', 'Bear Call Spread', 'Single Leg', 'Custom'];

const DEFAULT_LEG = { optionType: 'CE', transactionType: 'SELL', strike: '', premium: '', quantity: 1 };

const STRATEGY_TEMPLATES = {
  'Strangle': [
    { label: 'OTM CE Sell', optionType: 'CE', transactionType: 'SELL' },
    { label: 'OTM PE Sell', optionType: 'PE', transactionType: 'SELL' },
    { label: 'CE Hedge Buy (optional)', optionType: 'CE', transactionType: 'BUY', optional: true },
    { label: 'PE Hedge Buy (optional)', optionType: 'PE', transactionType: 'BUY', optional: true },
  ],
  'Straddle': [
    { label: 'ATM CE Sell', optionType: 'CE', transactionType: 'SELL' },
    { label: 'ATM PE Sell', optionType: 'PE', transactionType: 'SELL' },
    { label: 'CE Hedge Buy (optional)', optionType: 'CE', transactionType: 'BUY', optional: true },
    { label: 'PE Hedge Buy (optional)', optionType: 'PE', transactionType: 'BUY', optional: true },
  ],
  'Iron Condor': [
    { label: 'OTM PE Sell', optionType: 'PE', transactionType: 'SELL' },
    { label: 'Lower PE Buy (hedge)', optionType: 'PE', transactionType: 'BUY' },
    { label: 'OTM CE Sell', optionType: 'CE', transactionType: 'SELL' },
    { label: 'Higher CE Buy (hedge)', optionType: 'CE', transactionType: 'BUY' },
  ],
  'Bull Put Spread': [
    { label: 'Higher PE Sell', optionType: 'PE', transactionType: 'SELL' },
    { label: 'Lower PE Buy', optionType: 'PE', transactionType: 'BUY' },
  ],
  'Bear Call Spread': [
    { label: 'Lower CE Sell', optionType: 'CE', transactionType: 'SELL' },
    { label: 'Higher CE Buy', optionType: 'CE', transactionType: 'BUY' },
  ],
  'Single Leg': [
    { label: 'Option Leg', optionType: 'CE', transactionType: 'SELL' },
  ],
  'Custom': [],
};

function LegInput({ leg, onChange, onRemove, label, showRemove, settings, instrument }) {
  const lotSize = settings.lotSizes[instrument] || 1;
  const premiumInRs = leg.premium && leg.quantity
    ? (parseFloat(leg.premium) * leg.quantity * lotSize).toFixed(0)
    : null;

  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {premiumInRs && (
            <span style={{ fontSize: 12, color: leg.transactionType === 'SELL' ? 'var(--profit)' : 'var(--loss)', fontFamily: "'JetBrains Mono', monospace" }}>
              {leg.transactionType === 'SELL' ? '+' : '-'}₹{Math.abs(parseInt(premiumInRs)).toLocaleString('en-IN')}
            </span>
          )}
          {showRemove && (
            <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }} onClick={onRemove}>×</button>
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Type</label>
          <select className="form-select" value={leg.optionType} onChange={e => onChange('optionType', e.target.value)}>
            <option value="CE">CE (Call)</option>
            <option value="PE">PE (Put)</option>
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Buy / Sell</label>
          <select className="form-select" value={leg.transactionType} onChange={e => onChange('transactionType', e.target.value)}>
            <option value="SELL">SELL</option>
            <option value="BUY">BUY</option>
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Strike Price</label>
          <input className="form-input" type="number" placeholder="e.g. 24000" value={leg.strike} onChange={e => onChange('strike', e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Premium (₹)</label>
          <input className="form-input" type="number" step="0.05" placeholder="e.g. 180.50" value={leg.premium} onChange={e => onChange('premium', e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Lots</label>
          <input className="form-input" type="number" min="1" value={leg.quantity} onChange={e => onChange('quantity', e.target.value)} />
        </div>
      </div>
      {instrument && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Lot size: {lotSize}</span>
          {' · '}Total qty: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{(leg.quantity || 0) * lotSize}</span> shares
          {leg.premium && <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>· ₹{((parseFloat(leg.premium)||0) * (leg.quantity||0) * lotSize).toLocaleString('en-IN')} total</span>}
        </div>
      )}
    </div>
  );
}

export default function ManualEntry() {
  const { addTrades, accounts, settings, activeAccountId } = useJournal();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [strategyName, setStrategyName] = useState('Strangle');
  const [instrument, setInstrument] = useState('NIFTY');
  const [customInstrument, setCustomInstrument] = useState('');
  const [expiry, setExpiry] = useState('');
  const [tradeDate, setTradeDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState(activeAccountId || accounts[0]?.id || '');
  const [notes, setNotes] = useState('');
  const [source, setSource] = useState('manual');
  const [success, setSuccess] = useState(false);

  // Legs state
  const getInitialLegs = (strategy) => {
    const templates = STRATEGY_TEMPLATES[strategy] || [];
    if (templates.length === 0) return [{ ...DEFAULT_LEG, id: uuidv4() }];
    return templates.map(t => ({ ...DEFAULT_LEG, ...t, id: uuidv4(), optional: t.optional || false }));
  };

  const [legs, setLegs] = useState(() => getInitialLegs('Strangle'));
  const [optionalLegs, setOptionalLegs] = useState({ 2: false, 3: false }); // for optional hedge legs

  const handleStrategyChange = (s) => {
    setStrategyName(s);
    setLegs(getInitialLegs(s));
    setOptionalLegs({ 2: false, 3: false });
  };

  const updateLeg = (idx, field, value) => {
    setLegs(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const addCustomLeg = () => {
    setLegs(prev => [...prev, { ...DEFAULT_LEG, id: uuidv4() }]);
  };

  const removeLeg = (idx) => {
    setLegs(prev => prev.filter((_, i) => i !== idx));
  };

  const toggleOptional = (idx) => {
    setOptionalLegs(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const activeLogs = legs.filter((l, i) => {
    if (!l.optional) return true;
    return optionalLegs[i] === true;
  });

  // Net premium preview
  const actualInstrument = instrument === 'Custom' ? customInstrument : instrument;
  const lotSize = settings.lotSizes[actualInstrument] || 1;
  const netPremium = activeLogs.reduce((sum, l) => {
    if (!l.premium || !l.quantity) return sum;
    const mult = l.transactionType === 'SELL' ? 1 : -1;
    return sum + mult * parseFloat(l.premium) * parseInt(l.quantity) * lotSize;
  }, 0);

  const handleSubmit = () => {
    // Validate
    for (const leg of activeLogs) {
      if (!leg.strike || !leg.premium || !leg.quantity) {
        alert('Please fill in Strike, Premium and Lots for all active legs.'); return;
      }
    }
    if (!expiry) { alert('Please set the expiry date.'); return; }
    if (!accountId) { alert('Please select an account.'); return; }

    const positionId = uuidv4();
    const tradesToAdd = activeLogs.map(leg => ({
      positionId,
      accountId,
      strategyName,
      instrument: actualInstrument,
      expiry,
      date: tradeDate,
      optionType: leg.optionType,
      transactionType: leg.transactionType,
      strike: parseFloat(leg.strike),
      premium: parseFloat(leg.premium),
      quantity: parseInt(leg.quantity),
      lotSize,
      status: 'OPEN',
      source,
      notes,
    }));

    const { added, skipped } = addTrades(tradesToAdd);
    if (added > 0) {
      showToast({ title: 'Position added', message: `${actualInstrument} ${strategyName} · ${added} leg${added>1?'s':''}${skipped ? `, ${skipped} skipped (duplicate)` : ''}` });
    } else {
      showToast({ title: 'Nothing added', message: 'All legs already exist in journal', type: 'error' });
    }
    setSuccess(true);
    setTimeout(() => {
      setSuccess(false);
      navigate('/positions');
    }, 1200);
  };

  const templates = STRATEGY_TEMPLATES[strategyName] || [];

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="page-header">
        <div style={{display:"flex",alignItems:"center",gap:10}}><div className="page-title">Add Trade</div><AccountBadge /></div>
        <div className="page-subtitle">Enter a new options position manually</div>
      </div>

      {success && <div className="alert alert-success">✓ Position added successfully! Redirecting...</div>}

      {/* Top fields */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14 }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Strategy</label>
            <select className="form-select" value={strategyName} onChange={e => handleStrategyChange(e.target.value)}>
              {STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Instrument</label>
            <select className="form-select" value={instrument} onChange={e => setInstrument(e.target.value)}>
              {INSTRUMENTS.map(i => <option key={i} value={i}>{i}</option>)}
              <option value="Custom">Custom...</option>
            </select>
          </div>
          {instrument === 'Custom' && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Instrument Name</label>
              <input className="form-input" value={customInstrument} onChange={e => setCustomInstrument(e.target.value.toUpperCase())} placeholder="e.g. RELIANCE" />
            </div>
          )}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Expiry Date</label>
            <input className="form-input" type="date" value={expiry} onChange={e => setExpiry(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Trade Date</label>
            <input className="form-input" type="date" value={tradeDate} onChange={e => setTradeDate(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Account</label>
            <select className="form-select" value={accountId} onChange={e => setAccountId(e.target.value)}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Legs */}
      <div style={{ marginBottom: 20 }}>
        <div className="section-header">
          <div className="section-title">Legs</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {netPremium !== 0 && (
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: netPremium >= 0 ? 'var(--profit)' : 'var(--loss)', fontWeight: 600 }}>
                Net: {netPremium >= 0 ? '+' : ''}₹{Math.round(netPremium).toLocaleString('en-IN')}
              </span>
            )}
            {netPremium !== 0 && (() => {
              const sells = activeLogs.filter(l => l.transactionType === 'SELL' && l.strike && l.premium);
              const buys = activeLogs.filter(l => l.transactionType === 'BUY' && l.strike && l.premium);
              const pe_sell = sells.find(l => l.optionType === 'PE');
              const pe_buy = buys.find(l => l.optionType === 'PE');
              const lotSz = settings.lotSizes[actualInstrument] || 1;
              const lots = activeLogs[0]?.quantity || 1;
              let maxLoss = null;
              if (pe_sell && pe_buy) {
                const gross = Math.abs(parseFloat(pe_sell.strike) - parseFloat(pe_buy.strike)) * lotSz * parseInt(lots);
                maxLoss = gross - Math.abs(netPremium);
              }
              return maxLoss !== null ? (
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--loss)', marginLeft: 8 }}>
                  Max Loss: -₹{Math.round(maxLoss).toLocaleString('en-IN')}
                </span>
              ) : null;
            })()}
            {strategyName === 'Custom' && (
              <button className="btn btn-outline btn-sm" onClick={addCustomLeg}>+ Add Leg</button>
            )}
          </div>
        </div>

        {legs.map((leg, idx) => {
          const isOptional = leg.optional;
          const isActive = !isOptional || optionalLegs[idx];

          if (isOptional && !isActive) {
            return (
              <div key={leg.id} style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  {templates[idx]?.label || `Leg ${idx + 1}`} (optional)
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => toggleOptional(idx)}>+ Add Hedge</button>
              </div>
            );
          }

          return (
            <LegInput
              key={leg.id}
              leg={leg}
              label={templates[idx]?.label || `Leg ${idx + 1}`}
              onChange={(f, v) => updateLeg(idx, f, v)}
              onRemove={() => isOptional ? toggleOptional(idx) : removeLeg(idx)}
              showRemove={isOptional || strategyName === 'Custom'}
              settings={settings}
              instrument={actualInstrument}
            />
          );
        })}

        {strategyName !== 'Custom' && legs.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Lot size: <strong style={{ color: 'var(--text-secondary)' }}>{lotSize}</strong> shares per lot for {actualInstrument}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Notes (optional)</label>
          <textarea className="form-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Thesis, market view, or any notes..." style={{ resize: 'vertical' }} />
        </div>
      </div>

      {/* Submit */}
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn-outline" onClick={() => navigate('/')}>Cancel</button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSubmit}>
          Add Position →
        </button>
      </div>
    </div>
  );
}
