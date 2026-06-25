import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useJournal } from '../context/JournalContext';

const SERVER_URL = 'http://localhost:5001';

function BrokerSection({ name, broker, logo, color, fields, onSync, onRecover, onExcelImport, existingPositions, savedAccounts, savedCredentials }) {
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

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-outline" onClick={handleConnect} disabled={status === 'connecting'}>
          {status === 'connecting' ? 'Connecting...' : status === 'connected' ? '↺ Reconnect' : '⚡ Connect'}
        </button>
        {status === 'connected' && (
          <>
            <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
              {syncing ? 'Syncing...' : '⟳ Sync Trades'}
            </button>
            {onRecover && (
              <button className="btn btn-outline" onClick={onRecover} disabled={syncing}
                title="Recover exit prices for OPEN positions using stored P&L or expiry data"
                style={{ fontSize:12 }}>⟳ Recover Closed</button>
            )}
            {onExcelImport && (
              <label title="Import AngelOne TradesAndCharges Excel" style={{ cursor:'pointer' }}>
                <input type="file" accept=".xlsx,.xls" style={{ display:'none' }}
                  onChange={e => { if (e.target.files[0]) onExcelImport(e.target.files[0]); e.target.value=''; }} />
                <span className="btn btn-outline" style={{ fontSize:12 }}>↑ Import Excel</span>
              </label>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function BrokerConnect() {
  const { addTrades, accounts, positions, addAccount, deleteAccount, settings, closePosition, updatePositionMeta, addLegExit, reopenPosition } = useJournal();
  const handleRecover = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/sync/recover-closed`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ existingPositions: positions.filter(p => p.status === 'OPEN') }),
      });
      const data = await res.json();
      if (!data.success) { alert(`Recovery failed: ${data.error}`); return; }
      if (!data.recovered) {
        alert('No positions could be auto-recovered. Use ↑ Import Excel or add exits manually via the + exit button.');
        return;
      }
      handleSync('angelone')([], data.closePositions || [], []);
      alert(`Recovered ${data.recovered} position(s).`);
    } catch (e) { alert(`Recovery error: ${e.message}`); }
  };

  const handleExcelImport = async (file) => {
    if (!file) return;
    try {
      // Client-side parse using SheetJS — no server needed
      const XLSX = await import('xlsx');
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws   = wb.Sheets['TradesAndCharges'];
      if (!ws) { alert('Sheet "TradesAndCharges" not found. Make sure you uploaded the AngelOne trade report.'); return; }

      // Find header row (contains 'Scrip/Contract')
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });
      const headerIdx = aoa.findIndex(r => r[0] === 'Scrip/Contract');
      if (headerIdx < 0) { alert('Could not find trade data header in Excel.'); return; }

      const headers   = aoa[headerIdx];
      const col       = {};
      headers.forEach((h, i) => { if (h) col[h] = i; });

      const CHARGE_COLS = ['Brokerage','GST','STT','Sebi Tax',
                           'Exchange Turnover Charges','Stamp Duty','Other Charges','IPFT Charges'];
      const MONTH_MAP   = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,
                           Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};

      const parseSymbol = (sym) => {
        if (!sym || !sym.includes('OPTIDX')) return null;
        const m = sym.trim().match(/OPTIDX\s+(\S+)\s+(\w+)\s+(\d+)\s+(\d{4})\s+([\d.]+)\s+(CE|PE)/);
        if (!m) return null;
        const [, inst, mon, day, year, strike, opt] = m;
        const mo = MONTH_MAP[mon];
        if (!mo) return null;
        return {
          instrument: inst,
          expiry:     `${year}-${String(mo).padStart(2,'0')}-${day.padStart(2,'0')}`,
          strike:     parseFloat(strike),
          optionType: opt,
        };
      };

      // Parse fills — skip brokerage-only rows (Trade ID blank or Qty = 0)
      const fills = [];
      for (let i = headerIdx + 1; i < aoa.length; i++) {
        const row     = aoa[i];
        const sym     = row[col['Scrip/Contract']];
        const parsed  = parseSymbol(sym);
        if (!parsed) continue;
        const tradeId = String(row[col['Trade ID']] || '').trim();
        const qty     = parseInt(row[col['Quantity']] || 0);
        if (!tradeId || qty === 0) continue;   // brokerage-only row

        const side      = String(row[col['Buy/Sell']] || '').trim();
        const buyPrice  = parseFloat(row[col['Buy Price']]  || 0);
        const sellPrice = parseFloat(row[col['Sell Price']] || 0);
        const price     = side === 'Buy' ? buyPrice : sellPrice;
        if (price <= 0) continue;

        const charges = CHARGE_COLS.reduce((s, c) => s + parseFloat(row[col[c]] || 0), 0);
        let dateStr   = String(row[col['Date']] || '').slice(0, 10);

        fills.push({ ...parsed, side, price, qty, charges: Math.round(charges * 100) / 100,
                     date: dateStr, orderId: String(row[col['Order ID']] || '') });
      }

      if (!fills.length) { alert('No option fills found in Excel.'); return; }

      // Group by (instrument, expiry, strike, optionType, side)
      const byKey = {};
      fills.forEach(f => {
        const k = `${f.instrument}|${f.expiry}|${f.strike}|${f.optionType}|${f.side}`;
        (byKey[k] = byKey[k] || []).push(f);
      });

      // Normalise expiry for comparison
      const normExp = (s) => {
        if (!s) return '';
        const str = String(s).trim();
        if (str.length >= 10 && str[4] === '-') return str.slice(0, 10);
        const m = str.match(/^(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2,4})$/i);
        if (m) {
          const mm = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                      JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'}[m[2].toUpperCase()];
          const yr = m[3].length === 2 ? '20'+m[3] : m[3];
          return `${yr}-${mm}-${m[1]}`;
        }
        return str.slice(0, 10);
      };

      // Match fills to OPEN journal positions only
      const openPositions = positions.filter(p => p.status === 'OPEN');
      let matched = 0;

      openPositions.forEach(ep => {
        (ep.legs || []).forEach(leg => {
          if (leg.status === 'CLOSED') return;
          const inst     = leg.instrument || '';
          const expiry   = normExp(leg.expiry);
          const strike   = parseFloat(leg.strike || 0);
          const opt      = leg.optionType || '';
          const legTx    = (leg.transactionType || '').toUpperCase();
          const lotSize  = parseInt(leg.lotSize || 1);
          const closeSide = legTx === 'SELL' ? 'Buy' : 'Sell';

          // Find matching fills
          let closeFills = null;
          for (const k of Object.keys(byKey)) {
            const [ki, ke, ks, ko, kside] = k.split('|');
            if (ki === inst && normExp(ke) === expiry &&
                Math.abs(parseFloat(ks) - strike) < 0.01 &&
                ko === opt && kside === closeSide) {
              closeFills = byKey[k];
              break;
            }
          }
          if (!closeFills?.length) return;

          // Group by Order ID → each order = one exit tranche
          const byOrder = {};
          closeFills.forEach(f => { (byOrder[f.orderId] = byOrder[f.orderId] || []).push(f); });

          Object.values(byOrder).forEach(orderFills => {
            const totalQty  = orderFills.reduce((s, f) => s + f.qty, 0);
            const totalLots = lotSize ? Math.floor(totalQty / lotSize) : totalQty;
            if (totalLots <= 0) return;
            const avgPrice  = orderFills.reduce((s, f) => s + f.price * f.qty, 0) / totalQty;
            const totalChg  = orderFills.reduce((s, f) => s + f.charges, 0);
            const exitDate  = orderFills.map(f => f.date).sort().reverse()[0];

            addLegExit(ep.positionId, leg.id, {
              quantity:    totalLots,
              exitPremium: Math.round(avgPrice * 10000) / 10000,
              exitDate,
              charges:     Math.round(totalChg * 100) / 100,
            });
            matched++;
          });
        });
      });

      if (matched === 0) {
        alert(`Parsed ${fills.length} fills but no matches with OPEN positions. Check that the positions are still OPEN in the journal.`);
      } else {
        alert(`Excel import complete: ${matched} exit tranche(s) applied across OPEN positions from ${fills.length} fills.`);
      }
    } catch (e) {
      console.error('Excel import error:', e);
      alert(`Excel import error: ${e.message}`);
    }
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
        existingOpenPositions={positions.filter(p => p.status === 'OPEN')}
        name="Angel One SmartAPI"
        broker="angelone"
        logo="🔶"
        color="#F59E0B"
        existingPositions={positions}
        onSync={handleSync('angelone')}
        onRecover={handleRecover}
        onExcelImport={handleExcelImport}
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
  );
}
