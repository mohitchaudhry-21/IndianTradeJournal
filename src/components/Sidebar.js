import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useJournal } from '../context/JournalContext';
import { calcUnrealizedPnL } from '../utils/livePnL';
import { isAuthEnabled, logout } from './LoginScreen';

const SECTIONS = [
  {
    label: 'TRADING',
    items: [
      { to: '/',           label: 'Dashboard',        icon: '⊞' },
      { to: '/positions',  label: 'Open Positions',   icon: '◎' },
      { to: '/calendar',   label: 'Calendar',         icon: '▦' },
      { to: '/stock-market-calendar', label: 'Market Calendar', icon: '📅' },
      { to: '/heatmap',               label: 'Market Heatmap',  icon: '🟩' },
      { to: '/live-charts',           label: 'Live OI Charts',  icon: '📈' },
    ],
  },
  {
    label: 'ANALYSIS',
    items: [
      { to: '/history',    label: 'Trade History',    icon: '☰' },
      { to: '/analytics',  label: 'Analytics',        icon: '⟋' },
      { to: '/analyzer',   label: 'Options Analyzer', icon: '⌖' },
      { to: '/wizard',     label: 'Strategy Wizard',  icon: '✦' },
      { to: '/strategy-builder', label: 'Strategy Builder', icon: '✦' },
    ],
  },
  {
    label: 'TOOLS',
    items: [
      { to: '/entry',      label: 'Add Trade',        icon: '＋' },
      { to: '/screenshot', label: 'Screenshot Import',icon: '⊡' },
      { to: '/broker',     label: 'Broker Connect',   icon: '⇌' },
    ],
  },
  {
    label: 'ACCOUNT',
    items: [
      { to: '/settings',   label: 'Settings',         icon: '⚙' },
    ],
  },
];

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('od_theme') || 'dark');
  useEffect(() => {
    document.body.classList.toggle('light', theme === 'light');
    localStorage.setItem('od_theme', theme);
  }, [theme]);
  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');
  return [theme, toggle];
}

function fmtSidebar(n) {
  if (!n) return '₹0';
  const abs = Math.abs(n);
  if (abs >= 100000) return (n<0?'-':'') + '₹' + (abs/100000).toFixed(1) + 'L';
  if (abs >= 1000) return (n<0?'-':'') + '₹' + Math.round(abs).toLocaleString('en-IN');
  return (n<0?'-':'') + '₹' + Math.round(abs);
}

export default function Sidebar() {
  const { stats, accounts, activeAccountId, setActiveAccountId, dateFilter, setDateFilter, syncStatus, lastSynced, positions, liveQuotes } = useJournal();

  const liveUnrealizedPnL = React.useMemo(() => {
    const openPositions = positions.filter(p => p.status === 'OPEN'); // already account-filtered
    if (!Object.keys(liveQuotes).length) return null;
    let total = 0;
    let anyFound = false;
    openPositions.forEach(p => {
      const upnl = calcUnrealizedPnL(p, liveQuotes);
      if (upnl !== null) { total += upnl; anyFound = true; }
    });
    return anyFound ? total : null;
  }, [positions, liveQuotes]);
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();

  return (
    <div style={s.sidebar}>
      {/* Logo */}
      <NavLink to="/" end style={{ textDecoration:'none' }}>
      <div style={{...s.logo, cursor:'pointer'}}>
        <div style={s.logoMark}>◈</div>
        <div>
          <div style={s.logoName}>OptionsDesk</div>
          <div style={s.logoSub}>Indian Market Journal</div>
        </div>
      </div>
      </NavLink>

      {/* Quick stats */}
      <div style={{ padding: '12px 12px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* This Month + Total P&L — original side-by-side */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 2 }}>This Month</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: stats.thisMonthPnL >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
              {stats.thisMonthPnL >= 0 ? '+' : ''}{fmtSidebar(stats.thisMonthPnL)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 2 }}>Total P&L</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: stats.totalPnL >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
              {stats.totalPnL >= 0 ? '+' : ''}{fmtSidebar(stats.totalPnL)}
            </div>
          </div>
        </div>

        {/* Live P&L pill */}
        {liveUnrealizedPnL !== null && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 10px', background:'rgba(255,255,255,0.04)', borderRadius:8, border:'1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--accent)', display:'inline-block', boxShadow:'0 0 5px var(--accent)' }} />
              <span style={{ fontSize:9, color:'var(--text-muted)', letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:600 }}>
                Live P&L{activeAccountId ? '' : ' · All'}
              </span>
            </div>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:17, fontWeight:700, color: liveUnrealizedPnL >= 0 ? 'var(--profit)' : 'var(--loss)', letterSpacing:'-0.5px' }}>
              {liveUnrealizedPnL >= 0 ? '+' : ''}{fmtSidebar(liveUnrealizedPnL)}
            </span>
          </div>
        )}

        {/* Open / Win% / Expiring */}
        <div style={{ display: 'flex', gap: 0 }}>
          {[
            { label: 'Open', val: stats.openPositions, color: 'var(--text-primary)' },
            { label: 'Win %', val: stats.winRate.toFixed(0) + '%', color: 'var(--profit)' },
            { label: 'Expiring', val: stats.expiringThisWeek, color: stats.expiringThisWeek > 0 ? 'var(--accent)' : 'var(--text-secondary)' },
          ].map((st, i) => (
            <React.Fragment key={st.label}>
              {i > 0 && <div style={{ width: 1, background: 'var(--border)', margin: '0 6px' }} />}
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 3 }}>{st.label}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: st.color }}>{st.val}</div>
              </div>
            </React.Fragment>
          ))}
        </div>

      </div>
      {/* Account selector */}
      {accounts.length > 0 && (
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
            Viewing Account
          </div>
          <select
            value={activeAccountId}
            onChange={e => setActiveAccountId(e.target.value)}
            style={{
              width: '100%', padding: '7px 10px',
              background: activeAccountId ? 'var(--accent-dim)' : 'var(--bg-primary)',
              border: activeAccountId ? '1px solid rgba(59,130,246,0.3)' : '1px solid var(--border-hover)',
              borderRadius: 7, color: activeAccountId ? 'var(--accent)' : 'var(--text-secondary)',
              fontFamily: "'Sora', sans-serif", fontSize: 13, fontWeight: 500,
              outline: 'none', cursor: 'pointer',
            }}
          >
            <option value="">All Accounts</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {activeAccountId && (
            <button
              onClick={() => setActiveAccountId('')}
              style={{ marginTop: 5, background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', padding: '2px 0', fontFamily: "'Sora', sans-serif" }}
            >
              × Show All Accounts
            </button>
          )}
        </div>
      )}

      {/* Date filter indicator */}
      {(dateFilter.from || dateFilter.to) && (
        <div style={{ padding: '8px 12px', background: 'rgba(59,130,246,0.06)', borderBottom: '1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize: 11, color: 'var(--accent)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>Date Filter</div>
            {dateFilter.from ? new Date(dateFilter.from + 'T12:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' }) : '—'}
            {' → '}
            {dateFilter.to ? new Date(dateFilter.to + 'T12:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' }) : '—'}
          </div>
          <button onClick={() => setDateFilter({ from: null, to: null })}
            style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:14 }}>×</button>
        </div>
      )}

      {/* Nav sections */}
      <nav style={s.nav}>
        {SECTIONS.map((sec, si) => (
          <div key={sec.label} style={{ marginTop: si > 0 ? 6 : 0 }}>
            <div style={s.sectionLabel}>{sec.label}</div>
            {sec.items.map(({ to, label, icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                style={({ isActive }) => ({
                  ...s.navItem,
                  ...(isActive ? s.navActive : {}),
                })}
              >
                <span style={s.navIcon}>{icon}</span>
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Supabase sync status */}
      <div style={{ padding: '8px 12px 4px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: syncStatus === 'synced' ? 'var(--profit)' : syncStatus === 'syncing' ? 'var(--accent)' : syncStatus === 'error' ? 'var(--loss)' : 'var(--text-muted)',
            flexShrink: 0,
            animation: syncStatus === 'syncing' ? 'pulse 1s infinite' : 'none',
          }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {syncStatus === 'synced' ? `Synced ${lastSynced ? lastSynced.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) : ''}` :
             syncStatus === 'syncing' ? 'Syncing...' :
             syncStatus === 'error' ? 'Sync error' :
             'Local only'}
          </span>
        </div>
      </div>

      {/* Theme toggle */}
      <div style={{ padding: '0 8px 6px' }}>
        <button
          onClick={toggleTheme}
          style={{ ...s.lockBtn, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <span>{theme === 'dark' ? '☀ Light Mode' : '☾ Dark Mode'}</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-primary)', padding: '2px 6px', borderRadius: 4 }}>
            {theme === 'dark' ? 'DARK' : 'LIGHT'}
          </span>
        </button>
      </div>

      {/* Lock button */}
      {isAuthEnabled() && (
        <div style={{ padding: '0 8px 8px' }}>
          <button onClick={logout} style={s.lockBtn}>
            🔒 Lock Journal
          </button>
        </div>
      )}
    </div>
  );
}

const s = {
  sidebar: {
    position: 'fixed', left: 0, top: 0, bottom: 0,
    width: 'var(--sidebar-w)', background: 'var(--bg-card)',
    borderRight: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', zIndex: 100,
  },
  logo: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '20px 18px 14px',
    borderBottom: '1px solid var(--border)',
  },
  logoMark: { fontSize: 24, color: 'var(--accent)', lineHeight: 1 },
  logoName: { fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', letterSpacing: '-0.2px' },
  logoSub:  { fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.04em', marginTop: 1 },
  statsRow: {
    display: 'flex', alignItems: 'center',
    padding: '10px 16px', background: 'rgba(255,255,255,0.015)',
    borderBottom: '1px solid var(--border)',
  },
  stat:      { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 },
  statDiv:   { width: 1, height: 26, background: 'var(--border)' },
  statLabel: { fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' },
  statVal:   { fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 500, color: 'var(--text-primary)' },
  nav: { display: 'flex', flexDirection: 'column', padding: '10px 8px', gap: 1 },
  sectionLabel: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.10em',
    color: 'var(--text-muted)', textTransform: 'uppercase',
    padding: '8px 12px 4px', marginTop: 4,
  },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 9,
    padding: '8px 12px', borderRadius: 7,
    fontSize: 13, fontWeight: 500, color: 'var(--text-muted)',
    textDecoration: 'none', transition: 'all 0.15s',
  },
  navActive: { background: 'var(--accent-dim)', color: 'var(--accent)' },
  navIcon: { fontSize: 14, width: 18, textAlign: 'center', flexShrink: 0 },
  lockBtn: {
    width: '100%', background: 'rgba(255,255,255,0.04)',
    border: '1px solid var(--border)', borderRadius: 8,
    color: 'var(--text-muted)', fontFamily: "'Sora',sans-serif",
    fontSize: 13, padding: '9px 12px', cursor: 'pointer',
    textAlign: 'left', transition: 'all 0.15s',
  },
};
