import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useJournal } from '../context/JournalContext';
import { useToast } from '../context/ToastContext';

const SERVER_URL = 'http://localhost:5001';

function ExcelImportModal({ modal, onApply, onClose }) {
  const [selected, setSelected] = React.useState(() =>
    new Set(modal.matches.filter(m => m.hasNew).map(m => m.positionId))
  );
  const toggle = id => setSelected(s => { const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });
  const fmt = p => p!=null ? `₹${Number(p).toFixed(2)}` : '—';
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.65)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center'}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:12,width:580,maxHeight:'80vh',display:'flex',flexDirection:'column',boxShadow:'0 24px 64px rgba(0,0,0,0.6)'}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
          <div>
            <div style={{fontWeight:700,fontSize:14,color:'var(--text-primary)'}}>Select positions to import</div>
            <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>{modal.matches.length} matched · {modal.importDate?`from ${modal.importDate}`:'all dates'}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:18}}>✕</button>
        </div>
        <div style={{overflowY:'auto',flex:1,padding:'8px 16px'}}>
          {modal.matches.map(m=>{
            const isSel=selected.has(m.positionId);
            return (
              <div key={m.positionId} style={{marginBottom:8,border:`1px solid ${isSel?'rgba(99,102,241,0.35)':'var(--border)'}`,borderRadius:8,overflow:'hidden',opacity:m.hasNew?1:0.55}}>
                <label style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:isSel?'rgba(99,102,241,0.07)':'var(--bg-primary)',cursor:'pointer'}}>
                  <input type="checkbox" checked={isSel} onChange={()=>toggle(m.positionId)} style={{width:14,height:14,accentColor:'var(--accent)',flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:'var(--text-primary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.label}</div>
                    <div style={{fontSize:11,color:'var(--text-muted)'}}>{m.entryDate}</div>
                  </div>
                  {!m.hasNew&&<span style={{fontSize:10,color:'var(--text-muted)',background:'rgba(255,255,255,0.06)',borderRadius:4,padding:'2px 6px',flexShrink:0}}>already imported</span>}
                </label>
                <div style={{padding:'6px 12px 8px',background:'rgba(0,0,0,0.15)',borderTop:'1px solid var(--border)'}}>
                  {m.legMatches.map(({leg,tranches},li)=>(
                    <div key={li} style={{marginBottom:li<m.legMatches.length-1?6:0}}>
                      <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:3}}>
                        {leg.transactionType} {leg.strike}{leg.optionType} · {leg.quantity}L @ ₹{leg.premium}
                      </div>
                      {tranches.map((t,ti)=>(
                        <div key={ti} style={{display:'flex',alignItems:'center',gap:8,fontSize:11,padding:'2px 0',borderTop:ti>0?'1px solid rgba(255,255,255,0.04)':'none'}}>
                          <span style={{fontFamily:'var(--font-mono)',color:t.alreadyImported?'var(--text-muted)':'var(--text-secondary)',textDecoration:t.alreadyImported?'line-through':'none'}}>
                            {t.quantity}L @ {fmt(t.exitPremium)}
                          </span>
                          <span style={{color:'var(--text-muted)',fontSize:10}}>{t.exitDate ? t.exitDate.split('-').reverse().join('/') : ''}</span>
                          {t.charges>0&&<span style={{color:'var(--loss)',fontSize:10}}>−₹{t.charges.toFixed(2)}</span>}
                          <span style={{marginLeft:'auto',fontSize:10,color:t.alreadyImported?'var(--text-muted)':'var(--profit)'}}>{t.alreadyImported?'✓ done':'new'}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{padding:'10px 16px',borderTop:'1px solid var(--border)',display:'flex',gap:8,alignItems:'center',flexShrink:0}}>
          <span style={{fontSize:12,color:'var(--text-muted)',flex:1}}>{selected.size} selected</span>
          <button onClick={onClose} className="btn btn-outline" style={{fontSize:13}}>Cancel</button>
          <button onClick={()=>onApply(selected,modal)} className="btn btn-primary" style={{fontSize:13}} disabled={selected.size===0}>
            Apply {selected.size>0?`(${selected.size})`:''}
          </button>
        </div>
      </div>
    </div>
  );
}

// Asked once per new-legs group when they share instrument+expiry with an
// already-open position — lets the user decide whether it's an adjustment
// (roll, hedge, tested-side repair etc.) that should live in the SAME trade,
// or a genuinely separate new position.
function AdjustmentPromptModal({ candidate, queueLength, onResolve }) {
  const { legs, existingPosition } = candidate;
  const fmt = n => n != null ? `₹${Number(n).toFixed(2)}` : '—';
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:500, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, width:460, boxShadow:'0 24px 64px rgba(0,0,0,0.6)', padding:22 }}>
        <div style={{ fontWeight:700, fontSize:15, color:'var(--text-primary)', marginBottom:4 }}>
          Is this an adjustment?
        </div>
        <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:16 }}>
          These new {legs[0].instrument} legs share the same expiry as a position you already have open{queueLength > 1 ? ` (${queueLength} to review)` : ''}.
        </div>

        <div style={{ background:'var(--surface-2)', borderRadius:8, padding:'10px 12px', marginBottom:10 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:6 }}>Existing open position</div>
          <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', marginBottom:4 }}>
            {existingPosition.instrument} · {existingPosition.strategyName || 'Custom'} · opened {existingPosition.legs?.[0]?.date || ''}
          </div>
          {(existingPosition.legs || []).map((l, i) => (
            <div key={i} style={{ fontSize:11, color:'var(--text-secondary)', fontFamily:'var(--font-mono)' }}>
              {l.transactionType} {l.strike}{l.optionType} · {l.quantity}L @ {fmt(l.premium)}
            </div>
          ))}
        </div>

        <div style={{ background:'rgba(99,102,241,0.07)', border:'1px solid rgba(99,102,241,0.25)', borderRadius:8, padding:'10px 12px', marginBottom:18 }}>
          <div style={{ fontSize:11, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:6 }}>New legs from broker sync</div>
          {legs.map((l, i) => (
            <div key={i} style={{ fontSize:11, color:'var(--text-secondary)', fontFamily:'var(--font-mono)' }}>
              {l.transactionType} {l.strike}{l.optionType} · {l.quantity}L @ {fmt(l.premium)}
            </div>
          ))}
        </div>

        <div style={{ display:'flex', gap:10 }}>
          <button className="btn btn-outline" style={{ flex:1 }} onClick={() => onResolve(false)}>
            Separate trade
          </button>
          <button className="btn btn-primary" style={{ flex:1 }} onClick={() => onResolve(true)}>
            Yes, it's an adjustment
          </button>
        </div>
      </div>
    </div>
  );
}

function BrokerSection({ name, broker, logo, color, fields, onSync, onExcelImport, onSetImportDate, settings, existingPositions, savedAccounts, savedCredentials }) {
  const { showToast } = useToast();
  const firstAcc = savedAccounts[0];
  const [selectedAccId, setSelectedAccId] = useState(firstAcc?.id || '');
  const [creds, setCreds] = useState(
    firstAcc ? (savedCredentials[firstAcc.id] || {}) : {}
  );
  const [status, setStatus] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncingStocks, setSyncingStocks] = useState(false);
  const [stockSyncMsg, setStockSyncMsg] = useState('');
  const [message, setMessage] = useState('');

  // On mount, check if this broker already has an active session on the
  // local server (e.g. user navigated away and came back) — restores the
  // 'Connected' UI state instead of showing 'Not connected' incorrectly.
  useEffect(() => {
    let cancelled = false;
    fetch(`${SERVER_URL}/status`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data?.[broker]) setStatus('connected');
      })
      .catch(() => {}); // server not running — leave status as-is
    return () => { cancelled = true; };
  }, [broker]);

  const selectAccount = (accId) => {
    setSelectedAccId(accId);
    setCreds(savedCredentials[accId] || {});
    setStatus(null);
    setMessage('');
  };

  const set = (k, v) => setCreds(p => ({ ...p, [k]: v }));

  const handleConnect = async () => {
    setStatus('connecting');
    setMessage('');
    try {
      const res = await fetch(`${SERVER_URL}/connect/${broker}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...creds, accountId: selectedAccId }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus('connected');
        setMessage(data.message || 'Connected successfully');
        showToast({ title: `${name} connected`, message: data.message || '' });
      } else {
        setStatus('error');
        setMessage(data.error || 'Connection failed');
        showToast({ title: `${name} connection failed`, message: data.error || '', type: 'error' });
      }
    } catch (e) {
      setStatus('error');
      setMessage('Cannot reach sync server. Make sure it is running.');
      showToast({ title: `${name} connection failed`, message: 'Sync server not reachable', type: 'error' });
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setMessage('Syncing...');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout — sync makes several sequential broker API calls
      const importDate = settings?.accountImportDates?.[selectedAccId] || '';
      const res = await fetch(`${SERVER_URL}/sync/${broker}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          existingPositions: existingPositions || [],
          syncFromDate: importDate,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (data.success) {
        setLastSync(new Date().toLocaleTimeString());
        const newTrades = data.trades || data.positions || [];
        const closedUpdates = data.closePositions || [];
        const openCount = newTrades.filter(t => t.status === 'OPEN').length;
        const closedCount = newTrades.filter(t => t.status === 'CLOSED').length + closedUpdates.length;
        let syncMsg = `Synced: ${openCount} open, ${closedUpdates.length} closed with exit prices, ${closedCount - closedUpdates.length} new closed`;
        setMessage(syncMsg);
        const partialExitsData = data.partialExits || [];
        const partialCount = partialExitsData.length;
        if (partialCount > 0) { syncMsg += `, ${partialCount} partial exit${partialCount>1?'s':''} detected`; setMessage(prev => prev + `, ${partialCount} partial exit${partialCount>1?'s':''} detected`); }
        const premiumUpdatesData = data.premiumUpdates || [];
        if (premiumUpdatesData.length > 0) { syncMsg += `, ${premiumUpdatesData.length} entry price${premiumUpdatesData.length>1?'s':''} corrected`; setMessage(prev => prev + `, ${premiumUpdatesData.length} entry price${premiumUpdatesData.length>1?'s':''} corrected`); }
        showToast({ title: `${name} sync complete`, message: syncMsg });
        if (newTrades.length > 0 || closedUpdates.length > 0 || partialExitsData.length > 0 || premiumUpdatesData.length > 0)
          onSync(newTrades, closedUpdates, partialExitsData, premiumUpdatesData);
      } else {
        setMessage(data.error || 'Sync failed');
        showToast({ title: `${name} sync failed`, message: data.error || '', type: 'error' });
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        setMessage('Sync timed out after 60s — server may be stuck. Try restarting the sync server.');
        showToast({ title: `${name} sync timed out`, message: 'Server may be stuck — try restarting it', type: 'error' });
      } else {
        setMessage('Sync failed — server not running? ' + (e.message || ''));
        showToast({ title: `${name} sync failed`, message: 'Sync server not reachable', type: 'error' });
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncStocks = async () => {
    setSyncingStocks(true);
    setStockSyncMsg('');
    try {
      const STOCK_KEY = 'itj_stock_data';
      let stockData = {};
      try { stockData = JSON.parse(localStorage.getItem(STOCK_KEY) || '{}'); } catch {}
      const existingTransactions = stockData.transactions || [];
      const res = await fetch(`${SERVER_URL}/stocks/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ existingTransactions }),
      });
      const data = await res.json();
      if (data.success) {
        const existing = new Set(existingTransactions.map(t => t.brokerTradeId).filter(Boolean));
        const newOnes = (data.transactions || []).filter(t => !existing.has(t.brokerTradeId));
        if (newOnes.length) {
          stockData.transactions = [...existingTransactions, ...newOnes];
          localStorage.setItem(STOCK_KEY, JSON.stringify(stockData));
          setStockSyncMsg(`Synced ${newOnes.length} stock holding${newOnes.length > 1 ? 's' : ''} from broker`);
          showToast({ title: `${name} stocks synced`, message: `${newOnes.length} holding${newOnes.length > 1 ? 's' : ''} added` });
        } else {
          setStockSyncMsg('Stock holdings already up to date');
          showToast({ title: `${name} stocks synced`, message: 'Already up to date' });
        }
      } else {
        setStockSyncMsg(data.error || 'Stock sync failed');
        showToast({ title: `${name} stock sync failed`, message: data.error || '', type: 'error' });
      }
    } catch (e) {
      setStockSyncMsg('Stock sync failed — server not running?');
      showToast({ title: `${name} stock sync failed`, message: 'Sync server not reachable', type: 'error' });
    } finally {
      setSyncingStocks(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
          {logo}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {status === 'connected' ? <span style={{ color: 'var(--profit)' }}>● Connected{lastSync ? ` · Last sync ${lastSync}` : ''}</span>
              : status === 'connecting' ? <span style={{ color: 'var(--accent)' }}>● Connecting...</span>
              : status === 'error' ? <span style={{ color: 'var(--loss)' }}>● Not connected</span>
              : <span>○ Not connected</span>}
          </div>
        </div>
      </div>

      {/* Account selector */}
      {savedAccounts.length > 0 && (
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label">Select Saved Account</label>
          <select className="form-select" value={selectedAccId} onChange={e => selectAccount(e.target.value)}
            style={{ maxWidth: 280 }}>
            {savedAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
            <option value="">— Enter manually —</option>
          </select>
          {selectedAccId && savedCredentials[selectedAccId] && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--profit)' }}>✓ Credentials loaded from Settings</div>
          )}
          {selectedAccId && !savedCredentials[selectedAccId] && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--accent)' }}>⚠ No credentials saved for this account — enter below</div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        {fields.map(f => (
          <div key={f.key} className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">{f.label}</label>
            <input
              className="form-input"
              type={f.type || 'text'}
              placeholder={f.placeholder}
              value={creds[f.key] || ''}
              onChange={e => set(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>

      {message && (
        <div className={`alert ${status === 'connected' || message.includes('Synced') ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 14 }}>
          {message}
        </div>
      )}

      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        <button className="btn btn-outline" onClick={handleConnect} disabled={status === 'connecting'}>
          {status === 'connecting' ? 'Connecting...' : status === 'connected' ? '↺ Reconnect' : '⚡ Connect'}
        </button>
        {status === 'connected' && (
          <>
            <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
              {syncing ? 'Syncing...' : '⟳ Sync Trades'}
            </button>
            <button className="btn btn-outline" onClick={handleSyncStocks} disabled={syncingStocks} title="Sync equity stock holdings separately (saved to Stock Portfolio page)">
              {syncingStocks ? 'Syncing stocks...' : '⟳ Sync Stocks'}
            </button>
            {onExcelImport && (
              <label style={{ cursor:'pointer', display:'inline-flex', alignItems:'center' }}>
                <input type="file" accept=".xlsx,.xls" style={{ display:'none' }}
                  onChange={e => { if (e.target.files[0]) onExcelImport(e.target.files[0]); e.target.value=''; }} />
                <span className="btn btn-outline" style={{ fontSize:13 }}>↑ Import Excel</span>
              </label>
            )}
          </>
        )}
      </div>
      {stockSyncMsg && (
        <div style={{ marginTop:8, fontSize:12, padding:'6px 10px', borderRadius:6, background:'rgba(255,255,255,0.04)', color: stockSyncMsg.includes('failed') ? 'var(--loss)' : 'var(--profit)', border:`0.5px solid ${stockSyncMsg.includes('failed') ? 'var(--border-danger)' : 'var(--border-success)'}` }}>
          📊 {stockSyncMsg}
        </div>
      )}
      {onSetImportDate && broker === 'angelone' && (
        <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:8, padding:'7px 10px', background:'rgba(255,255,255,0.03)', border:'1px solid var(--border)', borderRadius:7, width:'fit-content' }}>
          <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:600, whiteSpace:'nowrap' }}>Import fills from:</span>
          <input type="date"
            value={(settings?.accountImportDates || {})[selectedAccId] || ''}
            onChange={e => onSetImportDate(selectedAccId, e.target.value)}
            style={{ fontSize:12, padding:'3px 8px', borderRadius:5, border:'1px solid var(--border)', background:'var(--bg-card)', color:'var(--text-primary)', cursor:'pointer' }} />
          {(settings?.accountImportDates || {})[selectedAccId]
            ? <button onClick={() => onSetImportDate(selectedAccId, '')} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:12, padding:0 }}>✕</button>
            : <span style={{ fontSize:10, color:'var(--text-muted)' }}>all dates</span>}
        </div>
      )}
    </div>
  );
}

export default function BrokerConnect() {
  const { addTrades, accounts, trades: allTrades, positions, activeAccountId, addAccount, deleteAccount, settings, updateSettings, closePosition, updatePositionMeta, addLegExit, updateLegPremiums, reopenPosition, cloudLoad, isSupabaseReady } = useJournal();
  const { showToast } = useToast();
  const [excelModal, setExcelModal] = React.useState(null);
  const [recovering, setRecovering] = React.useState(false);
  const [cloudSnapshot, setCloudSnapshot] = React.useState(null);
  const [recoveryMsg, setRecoveryMsg] = React.useState('');
  // Queue of "is this an adjustment?" prompts when newly-synced legs match the
  // instrument+expiry of an already-open position. Resolved one at a time;
  // `pendingTrades` holds everything else waiting on the queue to clear.
  const [adjustmentQueue, setAdjustmentQueue] = React.useState([]);
  const [pendingTrades,   setPendingTrades]   = React.useState(null);

  const applyExcelMatches = (selectedIds, matchData) => {
    let applied = 0;
    matchData.matches.filter(m => selectedIds.has(m.positionId)).forEach(m => {
      let newTranchesCharges = 0;
      m.legMatches.forEach(({ leg, tranches }) => {
        const existingIds = new Set((leg.exits||[]).map(e=>e.orderId).filter(Boolean));
        tranches.forEach(t => {
          if (t.alreadyImported || (t.orderId && existingIds.has(t.orderId))) return;
          addLegExit(m.positionId, leg.id, { quantity:t.quantity, exitPremium:t.exitPremium, exitDate:t.exitDate, charges:t.charges, orderId:t.orderId });
          newTranchesCharges += Math.abs(t.charges || 0);
          applied++;
        });
      });
      // Sum ALL tranche charges across all legs (existing + new) and save to p.charges
      // so the Booked summary reflects the complete picture
      // totalLegCharges = entry fills charges + exit fills charges from Excel (full round-trip)
      const allTranchesCharges = m.legMatches.reduce((sum, lm) => sum + (lm.totalLegCharges || 0), 0);
      if (allTranchesCharges > 0) {
        updatePositionMeta(m.positionId, { positionCharges: Math.round(allTranchesCharges * 100) / 100 });
      }
    });
    setExcelModal(null);
    if (applied > 0) showToast({ title: 'Excel import applied', message: `${applied} exit tranche${applied>1?'s':''} added` });
    else showToast({ title: 'Excel import', message: 'No new tranches — all already imported.' });
  };

  const setAccountImportDate = (acctId, date) =>
    updateSettings({ accountImportDates: { ...(settings.accountImportDates||{}), [acctId]: date } });

  const handleExcelImport = async (file) => {
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type:'array', cellDates:true });
      const ws = wb.Sheets['TradesAndCharges'];
      if (!ws) { alert('Sheet "TradesAndCharges" not found.'); return; }
      const aoa = XLSX.utils.sheet_to_json(ws, { header:1, raw:false, dateNF:'yyyy-mm-dd' });
      const hi = aoa.findIndex(r => r[0] === 'Scrip/Contract');
      if (hi < 0) { alert('Header not found.'); return; }
      const col = {}; aoa[hi].forEach((h,i) => { if (h) col[h]=i; });
      const CHG = ['Brokerage','GST','STT','Sebi Tax','Exchange Turnover Charges','Stamp Duty','Other Charges','IPFT Charges'];
      const MM = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
      const parseSym = sym => {
        if (!sym||!sym.includes('OPTIDX')) return null;
        const m=sym.trim().match(/OPTIDX\s+(\S+)\s+(\w+)\s+(\d+)\s+(\d{4})\s+([\d.]+)\s+(CE|PE)/);
        if (!m) return null;
        const [,inst,mon,day,year,strike,opt]=m, mo=MM[mon]; if (!mo) return null;
        return {instrument:inst, expiry:`${year}-${String(mo).padStart(2,'0')}-${day.padStart(2,'0')}`, strike:parseFloat(strike), optionType:opt};
      };
      const normExp = s => {
        if (!s) return ''; const str=String(s).trim();
        if (str.length>=10&&str[4]==='-') return str.slice(0,10);
        const m=str.match(/^(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2,4})$/i);
        if (m) { const mm={JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'}[m[2].toUpperCase()]; return `${m[3].length===2?'20'+m[3]:m[3]}-${mm}-${m[1]}`; }
        return str.slice(0,10);
      };
      const acctId = accounts.find(a=>a.broker==='angelone')?.id || '';
      const importDate = (settings.accountImportDates||{})[acctId] || '';
      const fills = [];
      const brokerageCharges = {}; // symbol key -> charges from brokerage-only rows (qty=0)
      for (let i=hi+1; i<aoa.length; i++) {
        const row=aoa[i], p=parseSym(row[col['Scrip/Contract']]); if (!p) continue;
        const tid=String(row[col['Trade ID']]||'').trim(), qty=parseInt(row[col['Quantity']]||0);
        const chg=CHG.reduce((s,c)=>s+parseFloat(row[col[c]]||0),0);
        if (!tid||qty===0) {
          // Brokerage-only row — has charges but no fill qty/price
          if (chg>0) {
            const bk=`${p.instrument}|${normExp(p.expiry)}|${p.strike}|${p.optionType}`;
            brokerageCharges[bk]=(brokerageCharges[bk]||0)+chg;
          }
          continue;
        }
        const side=String(row[col['Buy/Sell']]||'').trim();
        const price=side==='Buy'?parseFloat(row[col['Buy Price']]||0):parseFloat(row[col['Sell Price']]||0);
        if (price<=0) continue;
        const rawDate = row[col['Date']];
        let dt = '';
        if (rawDate instanceof Date) {
          // SheetJS returned a Date object — format as YYYY-MM-DD
          const yr = rawDate.getFullYear();
          const mo = String(rawDate.getMonth()+1).padStart(2,'0');
          const dy = String(rawDate.getDate()).padStart(2,'0');
          dt = `${yr}-${mo}-${dy}`;
        } else if (rawDate) {
          dt = String(rawDate).slice(0,10);
        }
        if (importDate&&dt&&dt<importDate) continue;
        fills.push({...p,side,price,qty,charges:Math.round(chg*100)/100,date:dt,orderId:String(row[col['Order ID']]||'')});
      }
      if (!fills.length) { showToast({ title: 'Excel import', message: `No fills found${importDate?` after ${importDate}`:''}.`, type: 'error' }); return; }
      const byKey={};
      fills.forEach(f=>{const k=`${f.instrument}|${f.expiry}|${f.strike}|${f.optionType}|${f.side}`;(byKey[k]=byKey[k]||[]).push(f);});
      const matches=[];
      positions.filter(p=>p.status==='OPEN').forEach(ep=>{
        const legMatches=[];
        (ep.legs||[]).forEach(leg=>{
          if (leg.status==='CLOSED') return;
          const inst=leg.instrument||'',exp=normExp(leg.expiry),str=parseFloat(leg.strike||0),opt=leg.optionType||'';
          const tx=(leg.transactionType||'').toUpperCase(),ls=parseInt(leg.lotSize||1);
          const cs=tx==='SELL'?'Buy':'Sell';
          let cf=null;
          for (const k of Object.keys(byKey)){const[ki,ke,ks,ko,kside]=k.split('|');if(ki===inst&&normExp(ke)===exp&&Math.abs(parseFloat(ks)-str)<0.01&&ko===opt&&kside===cs){cf=byKey[k];break;}}
          if (!cf?.length) return;
          const byOrd={};
          cf.forEach(f=>{(byOrd[f.orderId]=byOrd[f.orderId]||[]).push(f);});
          const existIds=new Set((leg.exits||[]).map(e=>e.orderId).filter(Boolean));
          // Also get entry-side fills charges (same symbol, opposite side)
          const entrySide = cs==='Buy'?'Sell':'Buy';
          let entryFillsCharges=0;
          for (const k of Object.keys(byKey)){
            const[ki,ke,ks,ko,kside]=k.split('|');
            if(ki===inst&&normExp(ke)===exp&&Math.abs(parseFloat(ks)-str)<0.01&&ko===opt&&kside===entrySide){
              entryFillsCharges=byKey[k].reduce((s,f)=>s+f.charges,0); break;
            }
          }
          const exitFillsCharges=cf.reduce((s,f)=>s+f.charges,0);
          const brokKey=`${inst}|${exp}|${str}|${opt}`;
          const brokOnlyChg=brokerageCharges[brokKey]||0;
          const totalLegCharges=entryFillsCharges+exitFillsCharges+brokOnlyChg;
          const tranches=Object.entries(byOrd).map(([oid,ofs])=>{
            const tq=ofs.reduce((s,f)=>s+f.qty,0),tl=ls?Math.floor(tq/ls):tq;
            const ap=ofs.reduce((s,f)=>s+f.price*f.qty,0)/tq,tc=ofs.reduce((s,f)=>s+f.charges,0);
            const ed=ofs.map(f=>f.date).sort().reverse()[0];
            return {orderId:oid,quantity:tl,exitPremium:Math.round(ap*10000)/10000,exitDate:ed,charges:Math.round(tc*100)/100,alreadyImported:oid&&existIds.has(oid)};
          }).filter(t=>t.quantity>0);
          if (tranches.length) legMatches.push({leg,tranches,totalLegCharges});
        });
        if (legMatches.length) {
          const hasNew=legMatches.some(lm=>lm.tranches.some(t=>!t.alreadyImported));
          const legs=ep.legs||[];
          matches.push({positionId:ep.positionId,hasNew,label:`${legs[0]?.instrument||''} ${legs.map(l=>`${l.transactionType} ${l.strike}${l.optionType}`).join(' / ')}`,entryDate:ep.date||legs[0]?.date||'',legMatches});
        }
      });
      if (!matches.length) { showToast({ title: 'Excel import', message: 'No matches with OPEN positions.', type: 'error' }); return; }
      setExcelModal({matches,importDate});
    } catch(e){console.error(e);showToast({ title: 'Excel import error', message: e.message, type: 'error' });}
  };

  const handleSync = (broker) => (trades, closePositions, partialExits, premiumUpdates) => {
    // 0. Correct stale entry prices on already-matched OPEN legs
    // (e.g. legs imported before the CF-weighted-average fix, or a new
    // carry-forward day rolled in and shifted the blended avg price).
    if (premiumUpdates && premiumUpdates.length > 0) {
      updateLegPremiums(premiumUpdates.map(({ legId, premium }) => ({ legId, premium })));
    }

    // 1. Apply full exits to closed positions
    if (closePositions && closePositions.length > 0) {
      closePositions.forEach(({ positionId, exitDate, exitLegs }) => {
        if (!positionId) return;
        const exitData = {};
        (exitLegs || []).forEach(({ legId, exitPrice, remainingQty }) => {
          if (legId && exitPrice !== undefined) {
            exitData[legId] = { exitPremium: exitPrice, exitDate, remainingQty };
          }
        });
        if (Object.keys(exitData).length === 0) {
          const pos = positions.find(p => p.positionId === positionId);
          if (pos) {
            pos.legs.forEach(leg => {
              exitData[leg.id] = { exitPremium: 0, exitDate };
            });
          }
        }
        if (Object.keys(exitData).length > 0) {
          closePosition(positionId, exitData);
        }
      });
    }

    // 2. Apply partial exits detected by server
    const partialExitPositionIds = new Set();
    if (partialExits && partialExits.length > 0) {
      partialExits.forEach(({ positionId, legId, quantity, exitPremium, exitDate }) => {
        if (!positionId || !legId) return;
        addLegExit(positionId, legId, { quantity, exitPremium, exitDate });
        partialExitPositionIds.add(positionId);
      });
    }

    // 3. Import genuinely new trades from broker — but first check whether any
    // of them look like an ADJUSTMENT to an already-open position (same
    // instrument + expiry + account, different entry date — e.g. rolling a
    // tested side of an iron condor). If so, ask before deciding whether to
    // merge into the existing trade or add as a separate one. Exception: if
    // that same position ALSO had a partial exit in THIS sync (step 2 above),
    // that's already strong same-run evidence of an adjustment in progress —
    // auto-merge without prompting instead of asking something we can already
    // answer confidently.
    if (trades && trades.length > 0) {
      const groupKeys = {};
      trades.forEach(t => {
        const key = `${t.instrument}_${t.expiry}_${t.quantity}`;
        if (!groupKeys[key]) groupKeys[key] = uuidv4();
      });
      const mapped = trades.map(t => ({
        ...t,
        positionId: t.positionId || groupKeys[`${t.instrument}_${t.expiry}_${t.quantity}`],
        source: broker,
        status: t.status || 'OPEN',
      }));

      // Group the new legs by their (fresh) positionId
      const byNewPos = {};
      mapped.forEach(t => { (byNewPos[t.positionId] = byNewPos[t.positionId] || []).push(t); });

      const candidates = [];
      const nonCandidateLegs = [];
      let autoMergedCount = 0;
      Object.entries(byNewPos).forEach(([newPosId, legs]) => {
        const first = legs[0];
        const match = positions.find(p =>
          p.status === 'OPEN' &&
          p.instrument === first.instrument &&
          normaliseExpiry(p.expiry) === normaliseExpiry(first.expiry) &&
          (!first.accountId || !p.legs?.[0]?.accountId || p.legs[0].accountId === first.accountId)
        );
        if (match && partialExitPositionIds.has(match.positionId)) {
          // Same position already had a partial exit this sync — auto-merge
          nonCandidateLegs.push(...legs.map(l => ({
            ...l,
            positionId: match.positionId,
            isAdjustment: true,
            adjustmentDate: l.date || new Date().toISOString().slice(0, 10),
          })));
          autoMergedCount += legs.length;
        } else if (match) {
          candidates.push({ newPosId, legs, existingPosition: match });
        } else {
          nonCandidateLegs.push(...legs);
        }
      });

      if (autoMergedCount > 0) {
        showToast({ title: 'Adjustment auto-merged', message: `${autoMergedCount} new leg${autoMergedCount>1?'s':''} — matching position also had a partial exit this sync` });
      }

      if (candidates.length > 0) {
        // Hold the non-candidate (and auto-merged) legs aside; they'll be
        // added once the remaining queue clears
        setPendingTrades(nonCandidateLegs);
        setAdjustmentQueue(candidates);
      } else {
        addTrades(nonCandidateLegs.length > 0 ? nonCandidateLegs : mapped);
      }
    }
  };

  const normaliseExpiry = (e) => (e || '').toString().slice(0, 10);

  // Resolve the current adjustment prompt: merge into the existing position
  // (reassign positionId + tag as an adjustment) or add as its own trade.
  const resolveAdjustment = (asAdjustment) => {
    const [current, ...rest] = adjustmentQueue;
    if (!current) return;
    const resolvedLegs = asAdjustment
      ? current.legs.map(l => ({
          ...l,
          positionId: current.existingPosition.positionId,
          isAdjustment: true,
          adjustmentDate: l.date || new Date().toISOString().slice(0, 10),
        }))
      : current.legs;

    const nextPending = [...(pendingTrades || []), ...resolvedLegs];

    if (rest.length === 0) {
      // Last one in the queue — commit everything now
      addTrades(nextPending);
      showToast({
        title: asAdjustment ? 'Adjustment added' : 'Added as separate trade',
        message: asAdjustment
          ? `Merged into ${current.existingPosition.instrument} · ${current.existingPosition.strategyName || ''}`
          : `${current.legs[0].instrument} · new position`,
      });
      setPendingTrades(null);
      setAdjustmentQueue([]);
    } else {
      showToast({
        title: asAdjustment ? 'Adjustment added' : 'Added as separate trade',
        message: asAdjustment
          ? `Merged into ${current.existingPosition.instrument} · ${current.existingPosition.strategyName || ''}`
          : `${current.legs[0].instrument} · new position`,
      });
      setPendingTrades(nextPending);
      setAdjustmentQueue(rest);
    }
  };

  const handleRecoverFromCloud = async () => {
    if (!isSupabaseReady || !isSupabaseReady()) {
      setRecoveryMsg('Supabase not connected. Set up cloud sync in Settings first.');
      return;
    }
    setRecovering(true);
    setRecoveryMsg('');
    try {
      const { ok, data } = await cloudLoad();
      if (!ok || !data) { setRecoveryMsg('Could not load cloud data.'); setRecovering(false); return; }
      const allCloudTrades = data.trades || [];

      // Filter cloud trades to ONLY the active account
      // so Mohit only sees his trades and Rahul only sees his
      const activeAccId = activeAccountId || '';
      const cloudTrades = activeAccId
        ? allCloudTrades.filter(t => !t.accountId || t.accountId === activeAccId)
        : allCloudTrades;

      // Check duplicates against active account's local trades
      const accountTrades = (allTrades || []).filter(t =>
        !activeAccId || !t.accountId || t.accountId === activeAccId
      );

      const existingIds = new Set(accountTrades.map(t => t.id).filter(Boolean));
      const existingKeys = new Set(accountTrades.map(t =>
        `${t.instrument}|${t.strike}|${t.optionType}|${(t.date||'').slice(0,10)}|${t.accountId || ''}`
      ));

      // Mark duplicates, sort latest first by date
      const annotated = cloudTrades
        .map(t => ({
          ...t,
          _isDuplicate: existingIds.has(t.id) ||
            existingKeys.has(`${t.instrument}|${t.strike}|${t.optionType}|${(t.date||'').slice(0,10)}|${t.accountId || ''}`)
        }))
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

      const newCount = annotated.filter(t => !t._isDuplicate).length;
      setCloudSnapshot(annotated);
      setRecoveryMsg(`${activeAccId ? `${accounts.find(a=>a.id===activeAccId)?.name || 'Account'}: ` : ''}${cloudTrades.length} trades in cloud — ${newCount} new, ${cloudTrades.length - newCount} already in journal.`);
    } catch (e) {
      setRecoveryMsg('Error: ' + e.message);
    }
    setRecovering(false);
  };

  const handleRestoreCloud = () => {
    if (!cloudSnapshot) return;
    const toRestore = cloudSnapshot.filter(t => !t._isDuplicate);
    if (!toRestore.length) { setRecoveryMsg('No new trades to restore — all already in journal.'); showToast({ title: 'Cloud restore', message: 'No new trades — all already in journal.' }); return; }
    const { added, skipped } = addTrades(toRestore);
    if (added > 0) {
      setRecoveryMsg(`✓ Restored ${added} trade${added > 1 ? 's' : ''} successfully.`);
      showToast({ title: 'Cloud restore complete', message: `${added} trade${added > 1 ? 's' : ''} restored${skipped ? `, ${skipped} already present` : ''}` });
    } else {
      setRecoveryMsg('No new trades to restore — all already in journal.');
      showToast({ title: 'Cloud restore', message: 'No new trades — all already in journal.' });
    }
    setCloudSnapshot(null);
  };

  const handleAddAccount = () => {
    if (!newAcc.name) { alert('Enter account name'); return; }
    addAccount({ name: newAcc.name, broker: newAcc.broker, capital: parseFloat(newAcc.capital) || 0 });
    setNewAcc({ name: '', broker: 'angelone', capital: '' });
    setShowAddAcc(false);
  };

  return (
    <>
      {excelModal && <ExcelImportModal modal={excelModal} onApply={applyExcelMatches} onClose={()=>setExcelModal(null)}/>}
      {adjustmentQueue.length > 0 && (
        <AdjustmentPromptModal
          candidate={adjustmentQueue[0]}
          queueLength={adjustmentQueue.length}
          onResolve={resolveAdjustment}
        />
      )}
      <div style={{ maxWidth: 780 }}>
      <div className="page-header">
        <div className="page-title">Broker Connect</div>
        <div className="page-subtitle">Auto-sync trades from Angel One SmartAPI and Kotak Neo</div>
      </div>

      {/* How it works */}
      <div className="alert alert-info" style={{ marginBottom: 24 }}>
        <strong>How it works:</strong> A small Python server runs on your PC and connects to your broker's API.
        Run <code style={{ background: 'rgba(0,0,0,0.2)', padding: '1px 5px', borderRadius: 3 }}>START-JOURNAL.bat</code> to launch everything.
        Your credentials are stored locally only and never sent anywhere else.
      </div>

      {/* Angel One */}
      <BrokerSection
        name="Angel One SmartAPI"
        broker="angelone"
        logo="🔶"
        color="#F59E0B"
        existingPositions={positions}
        onSync={handleSync('angelone')}
        onExcelImport={handleExcelImport}
        onSetImportDate={setAccountImportDate}
        settings={settings}
        savedAccounts={accounts.filter(a => a.broker === 'angelone')}
        savedCredentials={settings.brokerCredentials || {}}
        fields={[
          { key: 'clientId', label: 'Client ID', placeholder: 'Your Angel One client ID' },
          { key: 'apiKey', label: 'API Key', placeholder: 'From SmartAPI dashboard' },
          { key: 'pin', label: 'MPIN', type: 'password', placeholder: '4-digit MPIN' },
          { key: 'totpSecret', label: 'TOTP Secret', type: 'password', placeholder: 'From TOTP setup' },
        ]}
      />

      {/* Kotak Neo */}
      <BrokerSection
        name="Kotak Neo"
        broker="kotak"
        logo="🔴"
        color="#EF4444"
        existingPositions={positions}
        onSync={handleSync('kotak')}
        savedAccounts={accounts.filter(a => a.broker === 'kotak')}
        savedCredentials={settings.brokerCredentials || {}}
        fields={[
          { key: 'consumerKey', label: 'Access Token',      placeholder: 'From Trade API dashboard' },
          { key: 'ucc',         label: 'UCC / Client Code', placeholder: 'From your Kotak profile' },
          { key: 'mobile',      label: 'Mobile Number',     placeholder: '+91XXXXXXXXXX' },
          { key: 'password',    label: 'MPIN',              type: 'password', placeholder: '6-digit MPIN' },
          { key: 'totp',        label: 'TOTP (6-digit)',    placeholder: 'From Google Authenticator now' },
        ]}
      />

      {/* Setup instructions */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="section-title" style={{ marginBottom: 16 }}>Setup Guide</div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 8 }}>Angel One SmartAPI — API Key Setup</div>
          <ol style={{ paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 2 }}>
            <li>Go to <span style={{ color: 'var(--accent)' }}>smartapi.angelone.in</span> and log in with your Angel One credentials</li>
            <li>Click "Create New App" → fill name & redirect URL (use <code style={{ background: 'var(--bg-primary)', padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>http://localhost</code>)</li>
            <li>Copy your <strong>API Key</strong> from the dashboard</li>
            <li>Enable TOTP in Angel One app: Profile → Security → Enable TOTP → scan QR code with Google Authenticator → copy the secret key</li>
          </ol>
        </div>

        <div className="divider" />

        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#F87171', marginBottom: 8 }}>Kotak Neo — API Setup</div>
          <ol style={{ paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 2 }}>
            <li>Log into Kotak Neo → My Profile → API section → Generate API keys</li>
            <li>Copy <strong>Consumer Key</strong> and <strong>Consumer Secret</strong></li>
            <li>Use your registered mobile number and trading password</li>
            <li>An OTP will be sent to your mobile when connecting</li>
          </ol>
        </div>

        <div className="divider" />

        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Starting the Sync Server</div>
          <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '12px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--text-secondary)' }}>
            <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}># Double-click to start everything:</div>
            <div style={{ color: 'var(--profit)' }}>START-JOURNAL.bat</div>
            <div style={{ color: 'var(--text-muted)', marginTop: 8, marginBottom: 4 }}># Or start server manually:</div>
            <div>cd sync-server</div>
            <div>pip install -r requirements.txt</div>
            <div>python server.py</div>
          </div>
        </div>
      </div>

      <div className="alert alert-info">
        Manage accounts and credentials in <strong>Settings</strong> → Accounts &amp; Broker Credentials.
      </div>

      {/* ─── Cloud Recovery ─────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 6, color: 'var(--text-primary)' }}>Recover lost data from cloud</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
          If trades or exit prices disappeared after a page reload, click below to pull the cloud backup and merge it back.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button className="btn btn-outline" onClick={handleRecoverFromCloud} disabled={recovering}>
            {recovering ? 'Loading cloud...' : '☁ Load cloud snapshot'}
          </button>
          {cloudSnapshot && cloudSnapshot.length > 0 && (
            <button className="btn btn-primary" onClick={handleRestoreCloud}>
              ✓ Restore {cloudSnapshot.filter(t => !t._isDuplicate).length} new trades
            </button>
          )}
          {cloudSnapshot && <button className="btn btn-outline" onClick={() => setCloudSnapshot(null)} style={{marginLeft:'auto'}}>✕ Close</button>}
        </div>
        {recoveryMsg && (
          <div style={{ fontSize: 12, padding: '8px 12px', borderRadius: 6, marginBottom: 10, background: recoveryMsg.includes('Error') || recoveryMsg.includes('not connected') ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)', color: recoveryMsg.includes('Error') || recoveryMsg.includes('not connected') ? 'var(--text-danger)' : 'var(--text-success)', border: `0.5px solid ${recoveryMsg.includes('Error') || recoveryMsg.includes('not connected') ? 'var(--border-danger)' : 'var(--border-success)'}` }}>
            {recoveryMsg}
          </div>
        )}
        {cloudSnapshot && cloudSnapshot.length > 0 && (
          <div style={{ border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '32px 100px 80px 70px 60px 90px 90px 90px 1fr', gap: 0, padding: '7px 12px', background: 'var(--surface-1)', borderBottom: '0.5px solid var(--border)' }}>
              {['#','Instrument','Strike','Type','Status','Date','Entry ₹','Exit ₹',''].map((h,i) => (
                <div key={i} style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)', fontWeight: 500 }}>{h}</div>
              ))}
            </div>
            {/* Rows — all trades, latest first, no pagination */}
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {cloudSnapshot.map((t, i) => (
                <div key={t.id || i} style={{ display: 'grid', gridTemplateColumns: '32px 100px 80px 70px 60px 90px 90px 90px 1fr', gap: 0, padding: '8px 12px', borderBottom: '0.5px solid var(--border)', background: t._isDuplicate ? 'rgba(255,255,255,0.01)' : 'transparent', opacity: t._isDuplicate ? 0.45 : 1, alignItems: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{i+1}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 12, color: 'var(--text-primary)' }}>{t.instrument || '?'}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{t.strike}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{t.optionType} {t.transactionType}</div>
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3, background: t.status === 'CLOSED' ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.06)', color: t.status === 'CLOSED' ? 'var(--text-success)' : 'var(--text-muted)', border: `0.5px solid ${t.status === 'CLOSED' ? 'rgba(34,197,94,0.3)' : 'var(--border)'}` }}>{t.status}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.date}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{t.premium != null ? '₹' + parseFloat(t.premium).toFixed(2) : '—'}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: t.exitPremium != null ? 'var(--text-success)' : 'var(--text-muted)' }}>{t.exitPremium != null ? '₹' + parseFloat(t.exitPremium).toFixed(2) : '—'}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, textAlign: 'right' }}>
                    {t._isDuplicate
                      ? <span style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: 3, border: '0.5px solid var(--border)' }}>Already exists</span>
                      : <span style={{ color: '#818cf8', background: 'rgba(99,102,241,0.1)', padding: '1px 6px', borderRadius: 3, border: '0.5px solid rgba(99,102,241,0.3)' }}>New</span>
                    }
                  </div>
                </div>
              ))}
            </div>
            {/* Footer summary */}
            <div style={{ padding: '8px 12px', background: 'var(--surface-1)', borderTop: '0.5px solid var(--border)', display: 'flex', gap: 16, fontSize: 12 }}>
              <span style={{ color: '#818cf8' }}>● {cloudSnapshot.filter(t => !t._isDuplicate).length} new</span>
              <span style={{ color: 'var(--text-muted)' }}>● {cloudSnapshot.filter(t => t._isDuplicate).length} already in journal</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{cloudSnapshot.length} total in cloud</span>
            </div>
          </div>
        )}
      </div>

      </div>
    </>
  );
}
