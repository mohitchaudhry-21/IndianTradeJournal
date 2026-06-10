import { restoreSupabase, cloudSave, cloudLoad, isSupabaseReady } from '../lib/supabase';
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';

const JournalContext = createContext(null);

const STORAGE_KEY = 'optionsdesk_data';

const DEFAULT_SETTINGS = {
  lotSizes: {
    NIFTY: 75,
    BANKNIFTY: 30,
    FINNIFTY: 65,
    MIDCPNIFTY: 120,
    SENSEX: 20,
    BANKEX: 30,
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

  const [activeAccountId, setActiveAccountId_raw] = useState(
    () => localStorage.getItem('od_active_account') || ''
  );
  const setActiveAccountId = (id) => {
    if (id) localStorage.setItem('od_active_account', id);
    else localStorage.removeItem('od_active_account');
    setActiveAccountId_raw(id);
  };
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
    // Broker sync — only add genuinely NEW legs
    // Never overwrite quantity/premium of existing journal legs
    // because partial exits change netqty at broker but journal tracks full position
    setTrades(prev => {
      // Build lookup of existing legs by brokerTradeId
      const existingBrokerIds = new Set(
        prev.filter(t => t.brokerTradeId).map(t => t.brokerTradeId)
      );
      // Build lookup by instrument+strike+optionType+expiry+account to catch
      // legs that were manually entered (no brokerTradeId)
      const existingLegKeys = new Set(
        prev.map(t => `${t.instrument}|${t.strike}|${t.optionType}|${(t.expiry||'').slice(0,10)}|${t.accountId}`)
      );

      const toAdd = [];

      newTrades.forEach(t => {
        // Skip if already tracked by brokerTradeId
        if (t.brokerTradeId && existingBrokerIds.has(t.brokerTradeId)) return;
        // Skip if already tracked by instrument/strike/expiry/account (manually entered)
        const legKey = `${t.instrument}|${t.strike}|${t.optionType}|${(t.expiry||'').slice(0,10)}|${t.accountId}`;
        if (existingLegKeys.has(legKey)) return;
        // Genuinely new leg — add it
        toAdd.push({ ...t, id: t.id || uuidv4(), createdAt: new Date().toISOString() });
      });

      if (!toAdd.length) return prev; // nothing new
      const next = [...prev, ...toAdd];
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
    // exitData: { [legId]: { exitPremium, exitDate, entryPrice? } }
    setTrades(prev => {
      const next = prev.map(t => {
        if ((t.positionId || t.id) !== positionId) return t;
        const leg = exitData[t.id];
        if (!leg) return t;
        const updated = { ...t, status: 'CLOSED' };
        // Always update exit price and date if provided
        if (leg.exitPremium !== null && leg.exitPremium !== undefined) {
          updated.exitPremium = parseFloat(leg.exitPremium);
        }
        if (leg.exitDate) {
          updated.exitDate = leg.exitDate;
        }
        // Update entry price if broker provides a corrected one
        if (leg.entryPrice !== null && leg.entryPrice !== undefined && leg.entryPrice > 0) {
          updated.premium = parseFloat(leg.entryPrice);
        }
        return updated;
      });
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  // Partial exit tracking — add an exit tranche to a specific leg
  const addLegExit = useCallback((positionId, legId, exitTranche) => {
    // exitTranche: { quantity, exitPremium, exitDate }
    setTrades(prev => {
      const next = prev.map(t => {
        if ((t.positionId || t.id) !== positionId) return t;
        if (t.id !== legId) return t;
        const existingExits = t.exits || [];
        // Total exited quantity
        const totalExited = existingExits.reduce((s, e) => s + (e.quantity || 0), 0) + (exitTranche.quantity || 0);
        const isFullyExited = totalExited >= (t.quantity || 1);
        // Weighted average exit price
        const avgExit = [...existingExits, exitTranche].reduce((s, e) => s + (e.exitPremium || 0) * (e.quantity || 1), 0)
          / [...existingExits, exitTranche].reduce((s, e) => s + (e.quantity || 1), 0);
        return {
          ...t,
          exits: [...existingExits, exitTranche],
          exitPremium: avgExit,  // weighted avg shown in display
          exitDate: isFullyExited ? exitTranche.exitDate : t.exitDate,
          status: isFullyExited ? 'CLOSED' : t.status,
        };
      });
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  const removeLegExit = useCallback((positionId, legId, exitIndex) => {
    setTrades(prev => {
      const next = prev.map(t => {
        if ((t.positionId || t.id) !== positionId || t.id !== legId) return t;
        const exits = (t.exits || []).filter((_, i) => i !== exitIndex);
        const totalExited = exits.reduce((s, e) => s + (e.quantity || 0), 0);
        const avgExit = exits.length
          ? exits.reduce((s, e) => s + (e.exitPremium || 0) * (e.quantity || 1), 0) / exits.reduce((s, e) => s + (e.quantity || 1), 0)
          : null;
        return {
          ...t,
          exits,
          exitPremium: avgExit,
          exitDate: exits.length ? exits[exits.length-1].exitDate : null,
          status: totalExited < (t.quantity || 1) ? 'OPEN' : 'CLOSED',
        };
      });
      persist(accounts, next, settings);
      return next;
    });
  }, [accounts, settings, persist]);

  const reopenPosition = useCallback((positionId) => {
    setTrades(prev => {
      const next = prev.map(t => {
        if ((t.positionId || t.id) !== positionId) return t;
        const { exitPremium, exitDate, ...rest } = t;
        return { ...rest, status: 'OPEN' };
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
      updatePositionStrategy, updatePositionMeta, reopenPosition, addLegExit, removeLegExit,
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
