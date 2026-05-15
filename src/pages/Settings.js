import React, { useState } from 'react';
import { useJournal } from '../context/JournalContext';
import { initSupabase, clearSupabase, testConnection, cloudLoad, cloudSave, getSupabaseCredentials, isSupabaseReady } from '../lib/supabase';
import { isAuthEnabled, setPassword, getPasswordHash, logout } from '../components/LoginScreen';

const BROKER_FIELDS = {
  angelone: [
    { key: 'clientId',    label: 'Client ID',     type: 'text',     placeholder: 'e.g. AAAH426988' },
    { key: 'apiKey',      label: 'API Key',        type: 'text',     placeholder: 'From SmartAPI dashboard' },
    { key: 'pin',         label: 'MPIN',           type: 'password', placeholder: '4-digit MPIN' },
    { key: 'totpSecret',  label: 'TOTP Secret',    type: 'password', placeholder: 'Base32 secret from TOTP setup' },
  ],
  kotak: [
    { key: 'consumerKey',    label: 'Consumer Key',     type: 'text',     placeholder: 'From Kotak Neo API' },
    { key: 'consumerSecret', label: 'Consumer Secret',  type: 'password', placeholder: 'Consumer secret' },
    { key: 'mobile',         label: 'Mobile Number',    type: 'text',     placeholder: 'Registered mobile' },
    { key: 'password',       label: 'Trading Password', type: 'password', placeholder: 'Trading password' },
  ],
  zerodha: [
    { key: 'userId',     label: 'User ID',        type: 'text',     placeholder: 'Zerodha user ID' },
    { key: 'apiKey',     label: 'API Key',        type: 'text',     placeholder: 'Kite API key' },
    { key: 'apiSecret',  label: 'API Secret',     type: 'password', placeholder: 'Kite API secret' },
  ],
};

function AccountCredentials({ account, credentials, onSave }) {
  const { settings } = useJournal();
  const fields = BROKER_FIELDS[account.broker] || [];
  const [creds, setCreds] = useState(credentials || {});
  const [saved, setSaved] = useState(false);

  if (fields.length === 0) return (
    <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No API credentials needed for this broker.</div>
  );

  const handleSave = () => {
    onSave(creds);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
        {/* Per-account brokerage */}
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label">Brokerage Per Lot (₹) — overrides global setting</label>
          <input
            className="form-input"
            type="number"
            placeholder={`Global: ${settings.brokeragePerLot || 40}`}
            value={creds['_brokerage'] || ''}
            onChange={e => set('_brokerage', e.target.value)}
          />
        </div>

        {fields.map(f => (
          <div key={f.key} className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">{f.label}</label>
            <input
              className="form-input"
              type={f.type}
              placeholder={f.placeholder}
              value={creds[f.key] || ''}
              onChange={e => setCreds(p => ({ ...p, [f.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      {saved && <div className="alert alert-success" style={{ marginBottom: 10 }}>✓ Credentials saved</div>}
      <button className="btn btn-primary btn-sm" onClick={handleSave}>Save Credentials</button>
    </div>
  );
}

import { v4 as uuidv4 } from 'uuid';

function SupabaseSettings() {
  const { accounts, trades, settings, syncStatus, lastSynced } = useJournal();
  const saved = getSupabaseCredentials();
  const [url, setUrl]       = useState(saved.url);
  const [key, setKey]       = useState(saved.key);
  const [msg, setMsg]       = useState('');
  const [msgType, setMsgType] = useState('info');
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const isConnected = isSupabaseReady() && saved.url;

  const showMsg = (text, type = 'info') => { setMsg(text); setMsgType(type); setTimeout(() => setMsg(''), 4000); };

  const handleConnect = async () => {
    if (!url || !key) { showMsg('Enter both URL and Anon Key.', 'error'); return; }
    setTesting(true);
    initSupabase(url, key);
    const result = await testConnection();
    setTesting(false);
    if (result.ok) {
      showMsg('✓ Connected to Supabase! Data will now sync automatically.', 'success');
    } else {
      showMsg('Connection failed: ' + result.error, 'error');
      clearSupabase();
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    const result = await cloudSave(accounts, trades, settings);
    setSyncing(false);
    showMsg(result.ok ? '✓ Synced to cloud!' : 'Sync failed: ' + result.error, result.ok ? 'success' : 'error');
  };

  const handleLoadFromCloud = async () => {
    if (!window.confirm('This will overwrite your local data with cloud data. Continue?')) return;
    setSyncing(true);
    const result = await cloudLoad();
    setSyncing(false);
    if (result.ok && result.data) {
      window.location.reload(); // simplest way to reload with new data
    } else {
      showMsg(result.ok ? 'No cloud data found.' : 'Load failed: ' + result.error, 'error');
    }
  };

  const handleDisconnect = () => {
    clearSupabase();
    showMsg('Disconnected from Supabase. Data saved locally only.', 'info');
    setUrl(''); setKey('');
  };

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div className="section-title">Cloud Sync — Supabase</div>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 20, fontWeight: 600,
          background: isConnected ? 'var(--profit-dim)' : 'rgba(255,255,255,0.05)',
          color: isConnected ? 'var(--profit)' : 'var(--text-muted)',
          border: isConnected ? '1px solid rgba(16,217,160,0.2)' : '1px solid var(--border)',
        }}>
          {isConnected ? '● Connected' : '○ Not connected'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        Connect to Supabase to sync across devices and access your journal from the web. Free forever.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Supabase Project URL</label>
          <input className="form-input" type="text" value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://xxxx.supabase.co" />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Supabase Anon Key</label>
          <input className="form-input" type="password" value={key} onChange={e => setKey(e.target.value)}
            placeholder="eyJ..." />
        </div>
      </div>

      {msg && <div className={`alert alert-${msgType}`} style={{ marginBottom: 12 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={handleConnect} disabled={testing}>
          {testing ? 'Connecting...' : isConnected ? '↺ Reconnect' : '⚡ Connect'}
        </button>
        {isConnected && <>
          <button className="btn btn-outline" onClick={handleSyncNow} disabled={syncing}>
            {syncing ? 'Syncing...' : '↑ Push to Cloud'}
          </button>
          <button className="btn btn-outline" onClick={handleLoadFromCloud} disabled={syncing}>
            ↓ Pull from Cloud
          </button>
          <button className="btn btn-danger btn-sm" onClick={handleDisconnect} style={{ marginLeft: 'auto' }}>
            Disconnect
          </button>
        </>}
      </div>

      {isConnected && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
          Auto-syncs 2 seconds after any change · {lastSynced ? `Last synced: ${lastSynced.toLocaleTimeString('en-IN')}` : 'Not synced yet this session'}
        </div>
      )}

      {/* Setup guide */}
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          First time setup
        </div>
        <ol style={{ paddingLeft: 18, color: 'var(--text-muted)', fontSize: 12, lineHeight: 2.2 }}>
          <li>Go to <a href="https://supabase.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>supabase.com</a> → sign up free → New project</li>
          <li>In SQL Editor, run this query:
            <div style={{ background: 'var(--bg-primary)', borderRadius: 6, padding: '8px 12px', marginTop: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              {'create table if not exists od_data ('}<br/>
              {'  key text primary key,'}<br/>
              {'  value jsonb not null,'}<br/>
              {'  updated_at timestamptz default now()'}<br/>
              {');'}<br/>
              {'alter table od_data enable row level security;'}<br/>
              {'create policy "Allow all" on od_data for all using (true);'}
            </div>
          </li>
          <li>Go to <strong>Project Settings → API</strong> → copy <strong>Project URL</strong> and <strong>anon/public key</strong></li>
          <li>Paste both above → click Connect</li>
        </ol>
      </div>
    </div>
  );
}

function CustomDateRanges() {
  const { settings, updateSettings } = useJournal();
  const ranges = settings.customDateRanges || [];
  const [name, setName]     = useState('');
  const [from, setFrom]     = useState('');
  const [to, setTo]         = useState('');
  const [msg, setMsg]       = useState('');

  const add = () => {
    if (!name.trim()) { setMsg('Enter a name for this range.'); return; }
    if (!from && !to)  { setMsg('Enter at least a start or end date.'); return; }
    const newRange = { id: uuidv4(), name: name.trim(), from: from || null, to: to || null };
    updateSettings({ customDateRanges: [...ranges, newRange] });
    setName(''); setFrom(''); setTo('');
    setMsg('✓ Saved!');
    setTimeout(() => setMsg(''), 2000);
  };

  const remove = (id) => {
    updateSettings({ customDateRanges: ranges.filter(r => r.id !== id) });
  };

  const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="section-title" style={{ marginBottom: 6 }}>Custom Date Ranges</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        Save named date ranges here — they appear in the date selector on all pages.
      </div>

      {/* Add form */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Range Name</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Diwali Rally, My Analysis..." onKeyDown={e => e.key === 'Enter' && add()} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">From</label>
          <input className="form-input" type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ minWidth: 140 }} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">To</label>
          <input className="form-input" type="date" value={to} onChange={e => setTo(e.target.value)} style={{ minWidth: 140 }} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" style={{ opacity: 0 }}>Add</label>
          <button className="btn btn-primary" onClick={add} style={{ whiteSpace: 'nowrap' }}>+ Save Range</button>
        </div>
      </div>

      {msg && (
        <div className={`alert ${msg.startsWith('✓') ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 12 }}>
          {msg}
        </div>
      )}

      {/* Saved ranges */}
      {ranges.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0', fontStyle: 'italic' }}>
          No custom ranges saved yet.
        </div>
      ) : (
        <div>
          {ranges.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>{r.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                  {fmtDate(r.from)} → {fmtDate(r.to)}
                </span>
              </div>
              <button
                onClick={() => remove(r.id)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, padding: '2px 6px', opacity: 0.6 }}
                title="Delete this range"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const { accounts, addAccount, deleteAccount, settings, updateSettings, exportData, importData } = useJournal();

  const [lotSizes, setLotSizes]     = useState({ ...settings.lotSizes });
  const [brokerage, setBrokerage]   = useState(settings.brokeragePerLot);
  const [capital, setCapital]       = useState(settings.capital);
  const [anthropicKey, setAnthropicKey] = useState(settings.anthropicKey || '');
  const [geminiKey, setGeminiKey] = useState(settings.geminiKey || '');
  const [saved, setSaved]           = useState(false);

  const [newAcc, setNewAcc]         = useState({ name: '', broker: 'angelone', capital: '' });
  const [showAddAcc, setShowAddAcc] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinMsg, setPinMsg] = useState('');
  const [authOn, setAuthOn] = useState(isAuthEnabled());
  const [expandedAcc, setExpandedAcc] = useState(null);

  const handleSave = () => {
    updateSettings({ lotSizes, brokeragePerLot: parseFloat(brokerage), capital: parseFloat(capital), anthropicKey, geminiKey });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAddAccount = () => {
    if (!newAcc.name) { alert('Enter account name'); return; }
    addAccount({ name: newAcc.name, broker: newAcc.broker, capital: parseFloat(newAcc.capital) || 0, color: '#F59E0B' });
    setNewAcc({ name: '', broker: 'angelone', capital: '' });
    setShowAddAcc(false);
  };

  const saveCredentials = (accountId, creds) => {
    const current = settings.brokerCredentials || {};
    updateSettings({ brokerCredentials: { ...current, [accountId]: creds } });
  };

  const addCustomInstrument = () => {
    const name = prompt('Instrument name (e.g. RELIANCE):');
    if (!name) return;
    const lots = parseInt(prompt(`Lot size for ${name.toUpperCase()}:`));
    if (isNaN(lots)) return;
    setLotSizes(p => ({ ...p, [name.toUpperCase()]: lots }));
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => alert(importData(ev.target.result) ? 'Imported!' : 'Import failed.');
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div style={{ maxWidth: 700 }}>
      <div className="page-header">
        <div className="page-title">Settings</div>
        <div className="page-subtitle">Accounts, API credentials, lot sizes, and preferences</div>
      </div>

      {saved && <div className="alert alert-success">Settings saved!</div>}

      {/* ── Accounts & Credentials ─────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-header">
          <div className="section-title">Accounts & Broker Credentials</div>
          <button className="btn btn-outline btn-sm" onClick={() => setShowAddAcc(p => !p)}>+ Add Account</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          Save your broker API credentials here once. They'll auto-fill in Broker Connect.
        </div>

        {showAddAcc && (
          <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: 14, marginBottom: 16, border: '1px solid var(--border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Account Name</label>
                <input className="form-input" value={newAcc.name} onChange={e => setNewAcc(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Angel Main" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Broker</label>
                <select className="form-select" value={newAcc.broker} onChange={e => setNewAcc(p => ({ ...p, broker: e.target.value }))}>
                  <option value="angelone">Angel One</option>
                  <option value="kotak">Kotak Neo</option>
                  <option value="zerodha">Zerodha</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Capital (₹)</label>
                <input className="form-input" type="number" value={newAcc.capital} onChange={e => setNewAcc(p => ({ ...p, capital: e.target.value }))} placeholder="e.g. 1000000" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddAcc(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleAddAccount}>Add Account</button>
            </div>
          </div>
        )}

        {accounts.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '10px 0' }}>No accounts yet. Add one above.</div>
        )}

        {accounts.map(acc => {
          const isExpanded = expandedAcc === acc.id;
          const hasCreds = !!(settings.brokerCredentials?.[acc.id]);
          return (
            <div key={acc.id} style={{ borderRadius: 8, border: '1px solid var(--border)', marginBottom: 10, overflow: 'hidden' }}>
              {/* Account header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', background: isExpanded ? 'var(--bg-hover)' : 'transparent' }}
                onClick={() => setExpandedAcc(isExpanded ? null : acc.id)}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: acc.color || 'var(--accent)', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{acc.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    <span className={`badge ${acc.broker}`} style={{ fontSize: 10 }}>{acc.broker}</span>
                    {acc.capital > 0 && <span style={{ marginLeft: 8 }}>₹{(acc.capital / 100000).toFixed(1)}L capital</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {hasCreds
                    ? <span style={{ fontSize: 11, color: 'var(--profit)', background: 'var(--profit-dim)', padding: '2px 8px', borderRadius: 4 }}>✓ Credentials saved</span>
                    : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No credentials</span>
                  }
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{isExpanded ? '▲' : '▼'}</span>
                  <button
                    onClick={e => { e.stopPropagation(); if (window.confirm(`Delete "${acc.name}"?`)) deleteAccount(acc.id); }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}
                  >✕</button>
                </div>
              </div>

              {/* Credentials form */}
              {isExpanded && (
                <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}>
                  <AccountCredentials
                    account={acc}
                    credentials={settings.brokerCredentials?.[acc.id] || {}}
                    onSave={creds => saveCredentials(acc.id, creds)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Screenshot Import — Gemini Key ───────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-title" style={{ marginBottom: 8 }}>Screenshot Import — Google Gemini API Key</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
          Free, no credit card needed. Get your key in 30 seconds from{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
            aistudio.google.com
          </a>{' '}→ Get API Key → Create API Key.
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Gemini API Key</label>
          <input
            className="form-input"
            type="password"
            value={geminiKey}
            onChange={e => setGeminiKey(e.target.value)}
            placeholder="AIza..."
          />
        </div>
        {geminiKey && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--profit)' }}>✓ Key saved — screenshot import will use Gemini AI</div>
        )}
      </div>

      {/* ── Capital & Brokerage ─────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-title" style={{ marginBottom: 16 }}>Capital & Brokerage</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Total Capital (₹)</label>
            <input className="form-input" type="number" value={capital} onChange={e => setCapital(e.target.value)} placeholder="1000000" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Brokerage Per Lot (₹)</label>
            <input className="form-input" type="number" value={brokerage} onChange={e => setBrokerage(e.target.value)} placeholder="40" />
          </div>
        </div>
      </div>

      {/* ── Lot Sizes ───────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-header">
          <div className="section-title">Lot Sizes</div>
          <button className="btn btn-outline btn-sm" onClick={addCustomInstrument}>+ Add Instrument</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
          NSE periodically revises lot sizes. Update here when they change.
        </div>
        {Object.entries(lotSizes).map(([key, val]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', minWidth: 110 }}>{key}</span>
            <input className="form-input" type="number" style={{ width: 90 }} value={val}
              onChange={e => setLotSizes(p => ({ ...p, [key]: parseInt(e.target.value) }))} />
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>shares / lot</span>
            {!['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','SENSEX','BANKEX'].includes(key) && (
              <button style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                onClick={() => setLotSizes(p => { const n = { ...p }; delete n[key]; return n; })}>✕</button>
            )}
          </div>
        ))}
      </div>

      {/* ── Data Management ─────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-title" style={{ marginBottom: 14 }}>Data Management</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" onClick={exportData}>↑ Export Backup</button>
          <button className="btn btn-outline" onClick={handleImport}>↓ Import Backup</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
          All data stored locally in your browser. Export regularly.
        </div>
      </div>

      {/* ── Security ─────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-title" style={{ marginBottom: 8 }}>Security Lock</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          {authOn ? '🔒 Lock is enabled. Set a new PIN to change it, or clear to disable.' : '🔓 No lock set. Add a PIN to protect your journal.'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">{authOn ? 'New PIN / Password' : 'Set PIN / Password'}</label>
            <input className="form-input" type="password" value={newPin} onChange={e => setNewPin(e.target.value)} placeholder="Min 4 characters" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Confirm PIN</label>
            <input className="form-input" type="password" value={confirmPin} onChange={e => setConfirmPin(e.target.value)} placeholder="Re-enter PIN" />
          </div>
        </div>
        {pinMsg && <div className={`alert ${pinMsg.includes('✓') ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 12 }}>{pinMsg}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary btn-sm" onClick={async () => {
            if (!newPin) { setPinMsg('Enter a PIN first.'); return; }
            if (newPin.length < 4) { setPinMsg('PIN must be at least 4 characters.'); return; }
            if (newPin !== confirmPin) { setPinMsg('PINs do not match.'); return; }
            await setPassword(newPin);
            setAuthOn(true); setNewPin(''); setConfirmPin('');
            setPinMsg('✓ Lock enabled! You will be asked for this PIN next time.');
            setTimeout(() => setPinMsg(''), 4000);
          }}>
            {authOn ? 'Change PIN' : 'Enable Lock'}
          </button>
          {authOn && (
            <button className="btn btn-danger btn-sm" onClick={async () => {
              if (!window.confirm('Remove the security lock?')) return;
              await setPassword('');
              setAuthOn(false); setNewPin(''); setConfirmPin('');
              setPinMsg('Lock removed.');
              setTimeout(() => setPinMsg(''), 3000);
            }}>
              Remove Lock
            </button>
          )}
          {authOn && (
            <button className="btn btn-outline btn-sm" onClick={logout} style={{ marginLeft: 'auto' }}>
              🔒 Lock Now
            </button>
          )}
        </div>
      </div>

      {/* ── Cloud Sync ──────────────────────────────────────────────── */}
      <SupabaseSettings />

      {/* ── Custom Date Ranges ─────────────────────────────────────── */}
      <CustomDateRanges />

      <button className="btn btn-primary" style={{ padding: '10px 28px' }} onClick={handleSave}>Save Settings</button>
    </div>
  );
}
