import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useJournal } from '../context/JournalContext';

const SERVER_URL = 'http://localhost:5001';

function BrokerSection({ name, broker, logo, color, fields, onSync, existingPositions, savedAccounts, savedCredentials }) {
  const firstAcc = savedAccounts[0];
  const [selectedAccId, setSelectedAccId] = useState(firstAcc?.id || '');
  const [creds, setCreds] = useState(
    firstAcc ? (savedCredentials[firstAcc.id] || {}) : {}
  );
  const [status, setStatus] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');

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
          <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : '⟳ Sync Trades'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function BrokerConnect() {
  const { addTrades, accounts, positions, addAccount, deleteAccount, settings, closePosition, updatePositionMeta, addLegExit, reopenPosition } = useJournal();
  const handleSync = (broker) => (trades, closePositions, partialExits) => {
    // 1. Apply full exits to closed positions
    if (closePositions && closePositions.length > 0) {
      closePositions.forEach(({ positionId, exitDate, exitLegs }) => {
        if (!positionId) return;
        const exitData = {};
        (exitLegs || []).forEach(({ legId, exitPrice }) => {
          if (legId && exitPrice !== undefined) {
            exitData[legId] = { exitPremium: exitPrice, exitDate };
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
}      if (data.success) {
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
        if (newTrades.length > 0) onSync(newTrades, closedUpdates);
        else if (closedUpdates.length > 0) onSync([], closedUpdates);
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
          <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : '⟳ Sync Trades'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function BrokerConnect() {
  const { addTrades, accounts, positions, addAccount, deleteAccount, settings, closePosition, updatePositionMeta } = useJournal();
  const handleSync = (broker) => (trades, closePositions) => {
    // Apply exit prices to existing positions that the broker says are now closed
    if (closePositions && closePositions.length > 0) {
      closePositions.forEach(({ positionId, exitDate, exitLegs }) => {
        if (!positionId) return;
        const exitData = {};
        (exitLegs || []).forEach(({ legId, exitPrice }) => {
          if (legId && exitPrice !== undefined) {
            exitData[legId] = { exitPremium: exitPrice, exitDate };
          }
        });
        // If no exitLegs matched, fall back to closing all legs at their entry price
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

    // Import new trades from broker
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
