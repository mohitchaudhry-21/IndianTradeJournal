import { restoreSupabase, cloudSave, cloudLoad, isSupabaseReady } from '../lib/supabase';
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';

const JournalContext = createContext(null);

const STORAGE_KEY = 'optionsdesk_data';

const DEFAULT_SETTINGS = {
  lotSizes: {
    NIFTY: 65,
    BANKNIFTY: 15,
    FINNIFTY: 65,
    MIDCPNIFTY: 75,
    SENSEX: 10,
    BANKEX: 15,
  },
  brokeragePerLot: 40,
  capital: 1000000,
  anthropicKey: '',
  geminiKey: '',
  brokerCredentials: {},
  customDateRanges: [],  // [{ id, name, from, to }]
};

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveData(accounts, trades, settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accounts, trades, settings }));
  } catch (e) { console.error('Save failed', e); }
}

export function JournalProvider({ children }) {
  const saved = loadData();

  const [activeAccountId, setActiveAccountId] = useState(''); // '' = All Accounts
  const [dateFilter, setDateFilter] = useState({ from: null, to: null });
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | synced | error
  const [lastSynced, setLastSynced] = useState(null);
  const syncTimer = React.useRef(null); // { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }

  const [accounts, setAccounts] = useState(saved?.accounts || [
    { id: 'acc_default', name: 'Angel One', broker: 'angelone', capital: 1000000, color: '#F59E0B' },
  ]);
  const [trades, setTrades] = useState(saved?.trades || []);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS, ...(saved?.settings || {}) });

  const persist = useCallback((newAccounts, newTrades, newSettings) => {
    saveData(newAccounts, newTrades, newSettings);
    // Debounced cloud sync
    if (isSupabaseReady()) {
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(async () => {
        setSyncStatus('syncing');
        const result = await cloudSave(newAccounts, newTrades, newSettings);
        setSyncStatus(result.ok ? 'synced' : 'error');
        if (result.ok) setLastSynced(new Date());
      }, 2000);
    }
  }, []);

  // ─── Supabase auto-sync ─────────────────────────────────────────────────────
  // Restore Supabase connection on mount and load cloud data
  React.useEffect(() => {
    const restored = restoreSupabase();
    if (restored) {
      setSyncStatus('syncing');
      cloudLoad().then(({ ok, data }) => {
        if (ok && data) {
          if (data.accounts) setAccounts(data.accounts);
          if (data.trades)   setTrades(data.trades);
          if (data.settings) setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
          setSyncStatus('synced');
          setLastSynced(new Date());
        } else {
          setSyncStatus(ok ? 'idle' : 'error');
        }
      });
    }
  }, []); // eslint-disable-line

  // ─── Accounts ───────────────────────────────────────────────────────────────
  const addAccount = useCallback((acc) => {
    const newAcc = { ...acc, id: uuidv4() };
    setAccounts(prev => {
      const next = [...prev, newAcc];
      persist(next, trades, settings);
      return next;
    });
  }, [trades, settings, persist]);

  const deleteAccount = useCallback((id) => {
    setAccounts(prev => {
      const next = prev.filter(a => a.id !== id);
      persist(next, trades, settings);
      return next;
    });
  }, [trades, settings, persist]);

  // ─── Trades (individual legs) ────────────────────────────────────────────────
  const addTrade = useCallback((trade) => {
    const newTrade = { ...trade, id: uuidv4(), createdAt: new Date().toISOString() };
    setTrades(prev => {
      const next = [...prev, newTrade];
      persist(accounts, next, settings);
      return next;
    });
    return newTrade;
  }, [accounts, settings, persist]);

  const addTrades = useCallback((newTrades) => {
    // Broker sync — upsert by brokerTradeId (update if exists, add if new)
    setTrades(prev => {
      const existingById = {};
      prev.forEach(t => { if (t.brokerTradeId) existingById[t.brokerTradeId] = t.id; });

      let updated = [...prev];
      const toAdd = [];

      newTrades.forEach(t => {
        const mapped = { ...t, id: t.id || uuidv4(), createdAt: new Date().toISOString() };
        if (t.brokerTradeId && existingById[t.brokerTradeId]) {
          updated = updated.map(existing =>
            existing.id === existingById[t.brokerTradeId]
              ? { ...existing, premium: t.premium, lotSize: t.lotSize, quantity: t.quantity,
                  status: t.status, exitPrice: t.exitPrice, exitDate: t.exitDate,
                  syncedAt: new Date().toISOString() }
              : existing
          );
        } else {
          toAdd.push(mapped);
        }
      });

      const next = [...updated, ...toAdd];
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  const updateTrade = useCallback((id, updates) => {
    setTrades(prev => {
      const next = prev.map(t => t.id === id ? { ...t, ...updates } : t);
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  const deleteTrade = useCallback((id) => {
    setTrades(prev => {
      const next = prev.filter(t => t.id !== id);
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  const deletePosition = useCallback((positionId) => {
    setTrades(prev => {
      const next = prev.filter(t => (t.positionId || t.id) !== positionId);
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  // Close all legs of a position
  // Update position-level metadata (notes, margin) stored on first leg
  const updatePositionMeta = useCallback((positionId, updates) => {
    setTrades(prev => {
      let first = true;
      const next = prev.map(t => {
        if ((t.positionId || t.id) !== positionId) return t;
        const merged = { ...t, ...updates };
        // Apply custom dates to all legs (openDate to all, closeDate to all)
        if (updates.positionOpenDate)  merged.date    = updates.positionOpenDate;
        if (updates.positionCloseDate) merged.exitDate = updates.positionCloseDate;
        if (first) { first = false; return merged; }
        // Apply dates to ALL legs, other meta only to first
        const legMerge = { ...t };
        if (updates.positionOpenDate)  legMerge.date    = updates.positionOpenDate;
        if (updates.positionCloseDate) legMerge.exitDate = updates.positionCloseDate;
        return legMerge;
      });
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  const updatePositionStrategy = useCallback((positionId, strategyName) => {
    setTrades(prev => {
      const next = prev.map(t =>
        (t.positionId || t.id) === positionId ? { ...t, strategyName } : t
      );
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  const closePosition = useCallback((positionId, exitData) => {
    // exitData: { [legId]: { exitPremium, exitDate } }
    setTrades(prev => {
      const next = prev.map(t => {
        if ((t.positionId || t.id) !== positionId) return t;
        const leg = exitData[t.id];
        if (!leg) return t;
        return {
          ...t,
          exitPremium: parseFloat(leg.exitPremium),
          exitDate: leg.exitDate || new Date().toISOString(),
          status: 'CLOSED',
        };
      });
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  // ─── Settings ────────────────────────────────────────────────────────────────
  const updateSettings = useCallback((updates) => {
    setSettings(prev => {
      const next = { ...prev, ...updates };
      persist(accounts, trades, next);
      return next;
    });
  }, [accounts, trades, persist]);

  // ─── Computed: Positions ─────────────────────────────────────────────────────
  const positions = useMemo(() => {
    const groups = {};
    trades.forEach(t => {
      const key = t.positionId || t.id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });

    // Filter by active account first
    const accountFiltered = activeAccountId
      ? Object.fromEntries(Object.entries(groups).filter(([, legs]) => legs[0]?.accountId === activeAccountId))
      : groups;

    // Filter by date range (use closeDate for closed, openDate for open)
    const filteredGroups = !dateFilter.from && !dateFilter.to
      ? accountFiltered
      : Object.fromEntries(Object.entries(accountFiltered).filter(([, legs]) => {
          const first = legs[0];
          // For open positions filter by entry date; for closed by close date
          const allClosed = legs.every(l => l.status === 'CLOSED' || l.status === 'EXPIRED');
          const refDate = allClosed
            ? (legs.reduce((max, l) => (l.exitDate || '') > max ? (l.exitDate || '') : max, ''))?.slice(0, 10)
            : first.date?.slice(0, 10);
          if (!refDate) return true;
          if (dateFilter.from && refDate < dateFilter.from) return false;
          if (dateFilter.to   && refDate > dateFilter.to)   return false;
          return true;
        }));

    return Object.entries(filteredGroups).map(([posId, legs]) => {
      const first = legs[0];
      const allClosed = legs.every(l => l.status === 'CLOSED' || l.status === 'EXPIRED');
      const status = allClosed ? (legs[0].status === 'EXPIRED' ? 'EXPIRED' : 'CLOSED') : 'OPEN';

      // Net premium: SELL legs receive premium, BUY legs pay premium
      const netPremiumCollected = legs.reduce((sum, l) => {
        const lotSize = l.lotSize || settings.lotSizes[l.instrument] || 1;
        const mult = l.transactionType === 'SELL' ? 1 : -1;
        return sum + mult * (l.premium || 0) * l.quantity * lotSize;
      }, 0);

      // Realized P&L for closed legs
      const realizedPnL = legs.reduce((sum, l) => {
        if (l.status !== 'CLOSED' && l.status !== 'EXPIRED') return sum;
        const lotSize = l.lotSize || settings.lotSizes[l.instrument] || 1;
        const exitP = l.exitPremium !== undefined ? l.exitPremium : 0;
        if (l.transactionType === 'SELL') {
          return sum + (l.premium - exitP) * l.quantity * lotSize;
        } else {
          return sum + (exitP - l.premium) * l.quantity * lotSize;
        }
      }, 0);

      // Days to expiry
      const expiry = first.expiry;
      const daysToExpiry = expiry
        ? Math.ceil((new Date(expiry) - new Date()) / 86400000)
        : null;

      return {
        positionId: posId,
        strategyName: first.strategyName || 'Custom',
        instrument: first.instrument,
        expiry,
        daysToExpiry,
        accountId: first.accountId,
        status,
        legs,
        netPremiumCollected,
        realizedPnL: status !== 'OPEN' ? realizedPnL : null,
        openDate: legs.reduce((min, l) => l.date < min ? l.date : min, legs[0].date),
        closeDate: allClosed ? legs.reduce((max, l) => (l.exitDate || '') > max ? (l.exitDate || '') : max, '') : null,
        notes: first.positionNotes || first.notes || '',
        margin: first.positionMargin || null,
        charges: first.positionCharges || null,
        openDate: first.date || first.openDate || null,
        closeDate: legs.find(l => l.exitDate)?.exitDate || null,
      };
    });
  }, [trades, settings.lotSizes, activeAccountId, dateFilter]);

  // ─── Stats ───────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const closed = positions.filter(p => p.status === 'CLOSED' || p.status === 'EXPIRED');
    const open = positions.filter(p => p.status === 'OPEN');
    const totalPnL = closed.reduce((s, p) => s + (p.realizedPnL || 0), 0);
    const winners = closed.filter(p => (p.realizedPnL || 0) > 0);
    const losers = closed.filter(p => (p.realizedPnL || 0) < 0);
    const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
    const avgWin = winners.length > 0 ? winners.reduce((s, p) => s + p.realizedPnL, 0) / winners.length : 0;
    const avgLoss = losers.length > 0 ? Math.abs(losers.reduce((s, p) => s + p.realizedPnL, 0) / losers.length) : 0;
    const grossProfit = winners.reduce((s, p) => s + p.realizedPnL, 0);
    const grossLoss = Math.abs(losers.reduce((s, p) => s + p.realizedPnL, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // This month P&L
    const now = new Date();
    const thisMonth = closed.filter(p => {
      const d = new Date(p.closeDate || p.openDate);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const thisMonthPnL = thisMonth.reduce((s, p) => s + (p.realizedPnL || 0), 0);

    // Expiring this week
    const expiringThisWeek = open.filter(p => p.daysToExpiry !== null && p.daysToExpiry >= 0 && p.daysToExpiry <= 7);

    return {
      totalPnL,
      thisMonthPnL,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      totalPositions: closed.length,
      openPositions: open.length,
      expiringThisWeek: expiringThisWeek.length,
    };
  }, [positions]);

  // ─── Monthly P&L for chart ────────────────────────────────────────────────────
  const monthlyPnL = useMemo(() => {
    const months = {};
    const closed = positions.filter(p => p.status === 'CLOSED' || p.status === 'EXPIRED');
    closed.forEach(p => {
      const d = new Date(p.closeDate || p.openDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months[key] = (months[key] || 0) + (p.realizedPnL || 0);
    });
    const sorted = Object.entries(months).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([key, pnl]) => {
      const [y, m] = key.split('-');
      const label = new Date(y, m - 1, 1).toLocaleString('default', { month: 'short' }) + " '" + y.slice(2);
      return { key, label, pnl: Math.round(pnl) };
    });
  }, [positions]);

  // ─── Export / Import ─────────────────────────────────────────────────────────
  const exportData = useCallback(() => {
    const data = JSON.stringify({ accounts, trades, settings }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `optionsdesk_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [accounts, trades, settings]);

  const importData = useCallback((json) => {
    try {
      const { accounts: a, trades: t, settings: s } = JSON.parse(json);
      setAccounts(a || []);
      setTrades(t || []);
      setSettings({ ...DEFAULT_SETTINGS, ...(s || {}) });
      saveData(a || [], t || [], { ...DEFAULT_SETTINGS, ...(s || {}) });
      return true;
    } catch { return false; }
  }, []);

  return (
    <JournalContext.Provider value={{
      accounts, activeAccountId, setActiveAccountId,
      dateFilter, setDateFilter,
      syncStatus, lastSynced,
      trades, settings, positions, stats, monthlyPnL,
      addAccount, deleteAccount,
      updatePositionStrategy, updatePositionMeta,
      addTrade, addTrades, updateTrade, deleteTrade, deletePosition, closePosition,
      updateSettings,
      exportData, importData,
    }}>
      {children}
    </JournalContext.Provider>
  );
}

export function useJournal() {
  const ctx = useContext(JournalContext);
  if (!ctx) throw new Error('useJournal must be used within JournalProvider');
  return ctx;
}  } catch (e) { console.error('Save failed', e); }
}

export function JournalProvider({ children }) {
  const saved = loadData();

  const [activeAccountId, setActiveAccountId] = useState(''); // '' = All Accounts
  const [dateFilter, setDateFilter] = useState({ from: null, to: null });
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | synced | error
  const [lastSynced, setLastSynced] = useState(null);
  const syncTimer = React.useRef(null); // { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }

  const [accounts, setAccounts] = useState(saved?.accounts || [
    { id: 'acc_default', name: 'Angel One', broker: 'angelone', capital: 1000000, color: '#F59E0B' },
  ]);
  const [trades, setTrades] = useState(saved?.trades || []);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS, ...(saved?.settings || {}) });

  const persist = useCallback((newAccounts, newTrades, newSettings) => {
    saveData(newAccounts, newTrades, newSettings);
    // Debounced cloud sync
    if (isSupabaseReady()) {
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(async () => {
        setSyncStatus('syncing');
        const result = await cloudSave(newAccounts, newTrades, newSettings);
        setSyncStatus(result.ok ? 'synced' : 'error');
        if (result.ok) setLastSynced(new Date());
      }, 2000);
    }
  }, []);

  // ─── Supabase auto-sync ─────────────────────────────────────────────────────
  // Restore Supabase connection on mount and load cloud data
  React.useEffect(() => {
    const restored = restoreSupabase();
    if (restored) {
      setSyncStatus('syncing');
      cloudLoad().then(({ ok, data }) => {
        if (ok && data) {
          if (data.accounts) setAccounts(data.accounts);
          if (data.trades)   setTrades(data.trades);
          if (data.settings) setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
          setSyncStatus('synced');
          setLastSynced(new Date());
        } else {
          setSyncStatus(ok ? 'idle' : 'error');
        }
      });
    }
  }, []); // eslint-disable-line

  // ─── Accounts ───────────────────────────────────────────────────────────────
  const addAccount = useCallback((acc) => {
    const newAcc = { ...acc, id: uuidv4() };
    setAccounts(prev => {
      const next = [...prev, newAcc];
      persist(next, trades, settings);
      return next;
    });
  }, [trades, settings, persist]);

  const deleteAccount = useCallback((id) => {
    setAccounts(prev => {
      const next = prev.filter(a => a.id !== id);
      persist(next, trades, settings);
      return next;
    });
  }, [trades, settings, persist]);

  // ─── Trades (individual legs) ────────────────────────────────────────────────
  const addTrade = useCallback((trade) => {
    const newTrade = { ...trade, id: uuidv4(), createdAt: new Date().toISOString() };
    setTrades(prev => {
      const next = [...prev, newTrade];
      persist(accounts, next, settings);
      return next;
    });
    return newTrade;
  }, [accounts, settings, persist]);

  const addTrades = useCallback((newTrades) => {
    // Broker sync — upsert by brokerTradeId (update if exists, add if new)
    setTrades(prev => {
      const existingById = {};
      prev.forEach(t => { if (t.brokerTradeId) existingById[t.brokerTradeId] = t.id; });

      let updated = [...prev];
      const toAdd = [];

      newTrades.forEach(t => {
        const mapped = { ...t, id: t.id || uuidv4(), createdAt: new Date().toISOString() };
        if (t.brokerTradeId && existingById[t.brokerTradeId]) {
          updated = updated.map(existing =>
            existing.id === existingById[t.brokerTradeId]
              ? { ...existing, premium: t.premium, lotSize: t.lotSize, quantity: t.quantity,
                  status: t.status, exitPrice: t.exitPrice, exitDate: t.exitDate,
                  syncedAt: new Date().toISOString() }
              : existing
          );
        } else {
          toAdd.push(mapped);
        }
      });

      const next = [...updated, ...toAdd];
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  const updateTrade = useCallback((id, updates) => {
    setTrades(prev => {
      const next = prev.map(t => t.id === id ? { ...t, ...updates } : t);
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  const deleteTrade = useCallback((id) => {
    setTrades(prev => {
      const next = prev.filter(t => t.id !== id);
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  const deletePosition = useCallback((positionId) => {
    setTrades(prev => {
      const next = prev.filter(t => (t.positionId || t.id) !== positionId);
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  // Close all legs of a position
  // Update position-level metadata (notes, margin) stored on first leg
  const updatePositionMeta = useCallback((positionId, updates) => {
    setTrades(prev => {
      let first = true;
      const next = prev.map(t => {
        if ((t.positionId || t.id) !== positionId) return t;
        const merged = { ...t, ...updates };
        // Apply custom dates to all legs (openDate to all, closeDate to all)
        if (updates.positionOpenDate)  merged.date    = updates.positionOpenDate;
        if (updates.positionCloseDate) merged.exitDate = updates.positionCloseDate;
        if (first) { first = false; return merged; }
        // Apply dates to ALL legs, other meta only to first
        const legMerge = { ...t };
        if (updates.positionOpenDate)  legMerge.date    = updates.positionOpenDate;
        if (updates.positionCloseDate) legMerge.exitDate = updates.positionCloseDate;
        return legMerge;
      });
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  const updatePositionStrategy = useCallback((positionId, strategyName) => {
    setTrades(prev => {
      const next = prev.map(t =>
        (t.positionId || t.id) === positionId ? { ...t, strategyName } : t
      );
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  const closePosition = useCallback((positionId, exitData) => {
    // exitData: { [legId]: { exitPremium, exitDate } }
    setTrades(prev => {
      const next = prev.map(t => {
        if ((t.positionId || t.id) !== positionId) return t;
        const leg = exitData[t.id];
        if (!leg) return t;
        return {
          ...t,
          exitPremium: parseFloat(leg.exitPremium),
          exitDate: leg.exitDate || new Date().toISOString(),
          status: 'CLOSED',
        };
      });
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  // ─── Settings ────────────────────────────────────────────────────────────────
  const updateSettings = useCallback((updates) => {
    setSettings(prev => {
      const next = { ...prev, ...updates };
      persist(accounts, trades, next);
      return next;
    });
  }, [accounts, trades, persist]);

  // ─── Computed: Positions ─────────────────────────────────────────────────────
  const positions = useMemo(() => {
    const groups = {};
    trades.forEach(t => {
      const key = t.positionId || t.id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });

    // Filter by active account first
    const accountFiltered = activeAccountId
      ? Object.fromEntries(Object.entries(groups).filter(([, legs]) => legs[0]?.accountId === activeAccountId))
      : groups;

    // Filter by date range (use closeDate for closed, openDate for open)
    const filteredGroups = !dateFilter.from && !dateFilter.to
      ? accountFiltered
      : Object.fromEntries(Object.entries(accountFiltered).filter(([, legs]) => {
          const first = legs[0];
          // For open positions filter by entry date; for closed by close date
          const allClosed = legs.every(l => l.status === 'CLOSED' || l.status === 'EXPIRED');
          const refDate = allClosed
            ? (legs.reduce((max, l) => (l.exitDate || '') > max ? (l.exitDate || '') : max, ''))?.slice(0, 10)
            : first.date?.slice(0, 10);
          if (!refDate) return true;
          if (dateFilter.from && refDate < dateFilter.from) return false;
          if (dateFilter.to   && refDate > dateFilter.to)   return false;
          return true;
        }));

    return Object.entries(filteredGroups).map(([posId, legs]) => {
      const first = legs[0];
      const allClosed = legs.every(l => l.status === 'CLOSED' || l.status === 'EXPIRED');
      const status = allClosed ? (legs[0].status === 'EXPIRED' ? 'EXPIRED' : 'CLOSED') : 'OPEN';

      // Net premium: SELL legs receive premium, BUY legs pay premium
      const netPremiumCollected = legs.reduce((sum, l) => {
        const lotSize = l.lotSize || settings.lotSizes[l.instrument] || 1;
        const mult = l.transactionType === 'SELL' ? 1 : -1;
        return sum + mult * (l.premium || 0) * l.quantity * lotSize;
      }, 0);

      // Realized P&L for closed legs
      const realizedPnL = legs.reduce((sum, l) => {
        if (l.status !== 'CLOSED' && l.status !== 'EXPIRED') return sum;
        const lotSize = l.lotSize || settings.lotSizes[l.instrument] || 1;
        const exitP = l.exitPremium !== undefined ? l.exitPremium : 0;
        if (l.transactionType === 'SELL') {
          return sum + (l.premium - exitP) * l.quantity * lotSize;
        } else {
          return sum + (exitP - l.premium) * l.quantity * lotSize;
        }
      }, 0);

      // Days to expiry
      const expiry = first.expiry;
      const daysToExpiry = expiry
        ? Math.ceil((new Date(expiry) - new Date()) / 86400000)
        : null;

      return {
        positionId: posId,
        strategyName: first.strategyName || 'Custom',
        instrument: first.instrument,
        expiry,
        daysToExpiry,
        accountId: first.accountId,
        status,
        legs,
        netPremiumCollected,
        realizedPnL: status !== 'OPEN' ? realizedPnL : null,
        openDate: legs.reduce((min, l) => l.date < min ? l.date : min, legs[0].date),
        closeDate: allClosed ? legs.reduce((max, l) => (l.exitDate || '') > max ? (l.exitDate || '') : max, '') : null,
        notes: first.positionNotes || first.notes || '',
        margin: first.positionMargin || null,
        charges: first.positionCharges || null,
        openDate: first.date || first.openDate || null,
        closeDate: legs.find(l => l.exitDate)?.exitDate || null,
      };
    });
  }, [trades, settings.lotSizes, activeAccountId, dateFilter]);

  // ─── Stats ───────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const closed = positions.filter(p => p.status === 'CLOSED' || p.status === 'EXPIRED');
    const open = positions.filter(p => p.status === 'OPEN');
    const totalPnL = closed.reduce((s, p) => s + (p.realizedPnL || 0), 0);
    const winners = closed.filter(p => (p.realizedPnL || 0) > 0);
    const losers = closed.filter(p => (p.realizedPnL || 0) < 0);
    const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
    const avgWin = winners.length > 0 ? winners.reduce((s, p) => s + p.realizedPnL, 0) / winners.length : 0;
    const avgLoss = losers.length > 0 ? Math.abs(losers.reduce((s, p) => s + p.realizedPnL, 0) / losers.length) : 0;
    const grossProfit = winners.reduce((s, p) => s + p.realizedPnL, 0);
    const grossLoss = Math.abs(losers.reduce((s, p) => s + p.realizedPnL, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // This month P&L
    const now = new Date();
    const thisMonth = closed.filter(p => {
      const d = new Date(p.closeDate || p.openDate);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const thisMonthPnL = thisMonth.reduce((s, p) => s + (p.realizedPnL || 0), 0);

    // Expiring this week
    const expiringThisWeek = open.filter(p => p.daysToExpiry !== null && p.daysToExpiry >= 0 && p.daysToExpiry <= 7);

    return {
      totalPnL,
      thisMonthPnL,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      totalPositions: closed.length,
      openPositions: open.length,
      expiringThisWeek: expiringThisWeek.length,
    };
  }, [positions]);

  // ─── Monthly P&L for chart ────────────────────────────────────────────────────
  const monthlyPnL = useMemo(() => {
    const months = {};
    const closed = positions.filter(p => p.status === 'CLOSED' || p.status === 'EXPIRED');
    closed.forEach(p => {
      const d = new Date(p.closeDate || p.openDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months[key] = (months[key] || 0) + (p.realizedPnL || 0);
    });
    const sorted = Object.entries(months).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([key, pnl]) => {
      const [y, m] = key.split('-');
      const label = new Date(y, m - 1, 1).toLocaleString('default', { month: 'short' }) + " '" + y.slice(2);
      return { key, label, pnl: Math.round(pnl) };
    });
  }, [positions]);

  // ─── Export / Import ─────────────────────────────────────────────────────────
  const exportData = useCallback(() => {
    const data = JSON.stringify({ accounts, trades, settings }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `optionsdesk_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [accounts, trades, settings]);

  const importData = useCallback((json) => {
    try {
      const { accounts: a, trades: t, settings: s } = JSON.parse(json);
      setAccounts(a || []);
      setTrades(t || []);
      setSettings({ ...DEFAULT_SETTINGS, ...(s || {}) });
      saveData(a || [], t || [], { ...DEFAULT_SETTINGS, ...(s || {}) });
      return true;
    } catch { return false; }
  }, []);

  return (
    <JournalContext.Provider value={{
      accounts, activeAccountId, setActiveAccountId,
      dateFilter, setDateFilter,
      syncStatus, lastSynced,
      trades, settings, positions, stats, monthlyPnL,
      addAccount, deleteAccount,
      updatePositionStrategy, updatePositionMeta,
      addTrade, addTrades, updateTrade, deleteTrade, deletePosition, closePosition,
      updateSettings,
      exportData, importData,
    }}>
      {children}
    </JournalContext.Provider>
  );
}

export function useJournal() {
  const ctx = useContext(JournalContext);
  if (!ctx) throw new Error('useJournal must be used within JournalProvider');
  return ctx;
}
