import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useJournal } from '../context/JournalContext';

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

function BrokerSection({ name, broker, logo, color, fields, onSync, onExcelImport, onSetImportDate, settings, existingPositions, savedAccounts, savedCredentials }) {
  const firstAcc = savedAccounts[0];
  const [selectedAccId, setSelectedAccId] = useState(firstAcc?.id || '');
  const [creds, setCreds] = useState(
    firstAcc ? (savedCredentials[firstAcc.id] || {}) : {}
  );
  const [status, setStatus] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [syncing, setSyncing] = useState(false);
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
      } else {
        setStatus('error');
        setMessage(data.error || 'Connection failed');
      }
    } catch (e) {
      setStatus('error');
      setMessage('Cannot reach sync server. Make sure it is running.');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setMessage('');
    try {
      const res = await fetch(`${SERVER_URL}/sync/${broker}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ existingPositions: existingPositions || [] }),
      });
      const data = await res.json();
      if (data.success) {
        setLastSync(new Date().toLocaleTimeString());
        const newTrades = data.trades || data.positions || [];
        const closedUpdates = data.closePositions || [];
        const openCount = newTrades.filter(t => t.status === 'OPEN').length;
        const closedCount = newTrades.filter(t => t.status === 'CLOSED').length + closedUpdates.length;
        setMessage(`Synced: ${openCount} open, ${closedUpdates.length} closed with exit prices, ${closedCount - closedUpdates.length} new closed`);
        const partialExitsData = data.partialExits || [];
        const partialCount = partialExitsData.length;
        if (partialCount > 0) setMessage(prev => prev + `, ${partialCount} partial exit${partialCount>1?'s':''} detected`);
        if (newTrades.length > 0 || closedUpdates.length > 0 || partialExitsData.length > 0)
          onSync(newTrades, closedUpdates, partialExitsData);
      } else {
        setMessage(data.error || 'Sync failed');
      }
    } catch (e) {
      setMessage('Sync failed — server not running?');
    } finally {
      setSyncing(false);
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
  const { addTrades, accounts, positions, addAccount, deleteAccount, settings, updateSettings, closePosition, updatePositionMeta, addLegExit, reopenPosition } = useJournal();
  const [excelModal, setExcelModal] = React.useState(null);

  const applyExcelMatches = (selectedIds, matchData) => {
    let applied = 0;
    matchData.matches.filter(m => selectedIds.has(m.positionId)).forEach(m => {
      m.legMatches.forEach(({ leg, tranches }) => {
        const existingIds = new Set((leg.exits||[]).map(e=>e.orderId).filter(Boolean));
        tranches.forEach(t => {
          if (t.alreadyImported || (t.orderId && existingIds.has(t.orderId))) return;
          addLegExit(m.positionId, leg.id, { quantity:t.quantity, exitPremium:t.exitPremium, exitDate:t.exitDate, charges:t.charges, orderId:t.orderId });
          applied++;
        });
      });
    });
    setExcelModal(null);
    alert(applied > 0 ? `Applied ${applied} exit tranche(s).` : 'No new tranches — all already imported.');
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
      for (let i=hi+1; i<aoa.length; i++) {
        const row=aoa[i], p=parseSym(row[col['Scrip/Contract']]); if (!p) continue;
        const tid=String(row[col['Trade ID']]||'').trim(), qty=parseInt(row[col['Quantity']]||0);
        if (!tid||qty===0) continue;
        const side=String(row[col['Buy/Sell']]||'').trim();
        const price=side==='Buy'?parseFloat(row[col['Buy Price']]||0):parseFloat(row[col['Sell Price']]||0);
        if (price<=0) continue;
        const chg=CHG.reduce((s,c)=>s+parseFloat(row[col[c]]||0),0);
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
      if (!fills.length) { alert(`No fills found${importDate?` after ${importDate}`:''}.`); return; }
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
          const tranches=Object.entries(byOrd).map(([oid,ofs])=>{
            const tq=ofs.reduce((s,f)=>s+f.qty,0),tl=ls?Math.floor(tq/ls):tq;
            const ap=ofs.reduce((s,f)=>s+f.price*f.qty,0)/tq,tc=ofs.reduce((s,f)=>s+f.charges,0);
            const ed=ofs.map(f=>f.date).sort().reverse()[0];
            return {orderId:oid,quantity:tl,exitPremium:Math.round(ap*10000)/10000,exitDate:ed,charges:Math.round(tc*100)/100,alreadyImported:oid&&existIds.has(oid)};
          }).filter(t=>t.quantity>0);
          if (tranches.length) legMatches.push({leg,tranches});
        });
        if (legMatches.length) {
          const hasNew=legMatches.some(lm=>lm.tranches.some(t=>!t.alreadyImported));
          const legs=ep.legs||[];
          matches.push({positionId:ep.positionId,hasNew,label:`${legs[0]?.instrument||''} ${legs.map(l=>`${l.transactionType} ${l.strike}${l.optionType}`).join(' / ')}`,entryDate:ep.date||legs[0]?.date||'',legMatches});
        }
      });
      if (!matches.length) { alert('No matches with OPEN positions.'); return; }
      setExcelModal({matches,importDate});
    } catch(e){console.error(e);alert(`Excel import error: ${e.message}`);}
  };

  const handleSync = (broker) => (trades, closePositions, partialExits) => {
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
    if (partialExits && partialExits.length > 0) {
      partialExits.forEach(({ positionId, legId, quantity, exitPremium, exitDate }) => {
        if (!positionId || !legId) return;
        addLegExit(positionId, legId, { quantity, exitPremium, exitDate });
      });
    }

    // 3. Import genuinely new trades from broker
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
      addTrades(mapped);
    }
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
      </div>
    </>
  );
}
