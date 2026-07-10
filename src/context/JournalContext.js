import { restoreSupabase, cloudSave, cloudLoad, mergeAndSave, isSupabaseReady } from '../lib/supabase';
import { useLivePnL } from '../hooks/useLivePnL';
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { findBreakevens } from '../utils/optionsAnalysis';

const JournalContext = createContext(null);

const STORAGE_KEY = 'optionsdesk_data';

const DEFAULT_SETTINGS = {
  lotSizes: {
    NIFTY: 65,
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
  tickerSymbols: ['NIFTY', 'SENSEX'],  // symbols shown in the top ticker bar
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
  // Single shared live-quotes poll — all pages/components read from this
  // same instance via context, so every display shows identical numbers
  // instead of each component fetching its own slightly-offset snapshot.
  const { quotes: liveQuotes, loading: liveLoading, lastUpdated: liveLastUpdated, refresh: refreshLiveQuotes } = useLivePnL(5000, true);
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
  const isSaving  = React.useRef(false); // true while mergeAndSave is in-flight
  const recentlyDeletedIds = React.useRef(new Set()); // trade ids deleted in this session

  const [accounts, setAccounts] = useState(saved?.accounts || [
    { id: 'acc_default', name: 'Angel One', broker: 'angelone', capital: 1000000, color: '#F59E0B' },
  ]);
  const [trades, setTrades] = useState(() => {
    const raw = saved?.trades || [];
    // Migration: fix leg statuses — CLOSED but exits don't cover full qty → OPEN
    return raw.map(t => {
      if (t.status !== 'CLOSED') return t;
      const exits = t.exits || [];
      if (exits.length === 0) return t;
      const totalExited = exits.reduce((s, e) => s + (parseFloat(e.quantity) || 0), 0);
      if (totalExited < (parseFloat(t.quantity) || 1)) {
        return { ...t, status: 'OPEN', exitDate: undefined, exitPremium: undefined };
      }
      return t;
    });
  });
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS, ...(saved?.settings || {}) });

  // Fix trade statuses — leg marked CLOSED but exits don't cover full qty → reset to OPEN
  const fixTradeStatuses = React.useCallback((tradeList) => {
    return tradeList.map(t => {
      if (t.status !== 'CLOSED') return t;
      const exits = t.exits || [];
      if (exits.length === 0) return t; // no tranches — single exitPremium, keep CLOSED
      const totalExited = exits.reduce((s, e) => s + (parseFloat(e.quantity) || 0), 0);
      const totalQty = parseFloat(t.quantity) || 1;
      if (totalExited < totalQty) {
        // Partially exited — revert status to OPEN, keep exits array intact
        return { ...t, status: 'OPEN', exitDate: undefined, exitPremium: undefined };
      }
      return t;
    });
  }, []);

  const persist = useCallback((newAccounts, newTrades, newSettings, isDelete = false) => {
    saveData(newAccounts, newTrades, newSettings);
    // Debounced cloud sync — merges with latest cloud data before saving so
    // this save doesn't overwrite changes made by another user/device.
    // Deletes get a much shorter debounce (effectively immediate) since
    // waiting risks the periodic refresh resurrecting the deleted trade.
    if (isSupabaseReady()) {
      if (syncTimer.current) clearTimeout(syncTimer.current);
      const delay = isDelete ? 50 : 500;
      syncTimer.current = setTimeout(async () => {
        syncTimer.current = null; // timer fired — clear so it doesn't look "pending"
        isSaving.current = true;
        setSyncStatus('syncing');
        try {
          const result = await mergeAndSave(newAccounts, newTrades, newSettings, recentlyDeletedIds.current);
          if (result.ok) {
            setSyncStatus('synced');
            setLastSynced(new Date());
            if (result.merged) {
              const { accounts: ma, trades: mt, settings: ms } = result.merged;
              // Fix statuses before applying merged data
              const fixedMt = mt.map(t => {
                if (t.status !== 'CLOSED') return t;
                const exits = t.exits || [];
                if (exits.length === 0) return t;
                const totalExited = exits.reduce((s, e) => s + (parseFloat(e.quantity) || 0), 0);
                if (totalExited < (parseFloat(t.quantity) || 1)) {
                  return { ...t, status: 'OPEN', exitDate: undefined, exitPremium: undefined };
                }
                return t;
              });
              saveData(ma, fixedMt, ms);
              setAccounts(ma);
              setTrades(fixedMt);
              setSettings({ ...DEFAULT_SETTINGS, ...ms });
            }
          } else {
            setSyncStatus('error');
          }
        } finally {
          isSaving.current = false;
        }
      }, delay);
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
          // Merge cloud trades into local by ID — never overwrite local edits
          // Local state is always authoritative for existing IDs
          // Cloud only adds trades not present locally (e.g. from another device)
          if (data.trades) {
            setTrades(prevTrades => {
              const localById = {};
              prevTrades.forEach(t => { if (t?.id) localById[t.id] = t; });

              const merged = [...prevTrades];
              let changed = false;

              // Apply status fix to cloud trades before merging
              const fixedCloudTrades = (data.trades || []).map(t => {
                if (t.status !== 'CLOSED') return t;
                const exits = t.exits || [];
                if (exits.length === 0) return t;
                const totalExited = exits.reduce((s, e) => s + (parseFloat(e.quantity) || 0), 0);
                if (totalExited < (parseFloat(t.quantity) || 1)) {
                  return { ...t, status: 'OPEN', exitDate: undefined, exitPremium: undefined };
                }
                return t;
              });

              fixedCloudTrades.forEach(cloudTrade => {
                if (!cloudTrade?.id) return;
                const local = localById[cloudTrade.id];

                if (!local) {
                  // Trade only in cloud — add it
                  merged.push(cloudTrade);
                  changed = true;
                  return;
                }

                // Trade exists in both — pick the more complete version
                // "More complete" = has exit data / more fields filled in
                const localScore = (local.exitPremium != null ? 2 : 0)
                  + (local.positionMargin != null ? 1 : 0)
                  + (local.positionCharges != null ? 1 : 0)
                  + (local.positionNotes ? 1 : 0)
                  + ((local.exits || []).length);
                const cloudScore = (cloudTrade.exitPremium != null ? 2 : 0)
                  + (cloudTrade.positionMargin != null ? 1 : 0)
                  + (cloudTrade.positionCharges != null ? 1 : 0)
                  + (cloudTrade.positionNotes ? 1 : 0)
                  + ((cloudTrade.exits || []).length);

                if (cloudScore > localScore) {
                  // Cloud is more complete — use cloud but preserve any local-only meta
                  const idx = merged.findIndex(t => t?.id === cloudTrade.id);
                  if (idx >= 0) {
                    merged[idx] = {
                      ...cloudTrade,
                      // Always keep local meta if set — these are user edits
                      positionMargin: local.positionMargin ?? cloudTrade.positionMargin,
                      positionCharges: local.positionCharges ?? cloudTrade.positionCharges,
                      positionNotes: local.positionNotes || cloudTrade.positionNotes,
                      strategyName: local.strategyName || cloudTrade.strategyName,
                    };
                    changed = true;
                  }
                }
                // If local is same or more complete — keep local (no action needed)
              });

              if (!changed) return prevTrades;
              saveData(accounts, merged, settings);
              return merged;
            });
          }
          if (data.accounts) {
            setAccounts(prevAccounts => {
              const localIds = new Set(prevAccounts.map(a => a?.id).filter(Boolean));
              const additions = (data.accounts || []).filter(a => a?.id && !localIds.has(a.id));
              if (additions.length === 0) return prevAccounts;
              return [...prevAccounts, ...additions];
            });
          }
          if (data.settings) setSettings(prev => ({ ...DEFAULT_SETTINGS, ...prev, ...data.settings }));
          setSyncStatus('synced');
          setLastSynced(new Date());
        } else {
          setSyncStatus(ok ? 'idle' : 'error');
        }
      });
    }
  }, []); // eslint-disable-line

  // Flush pending cloud save immediately if the tab is hidden/closed
  // (handles refresh/close before the debounce timer fires)
  React.useEffect(() => {
    const flush = () => {
      if (syncTimer.current && isSupabaseReady() && !isSaving.current) {
        clearTimeout(syncTimer.current);
        syncTimer.current = null;
        mergeAndSave(accounts, trades, settings);
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', flush);
    };
  }, [accounts, trades, settings]);

  // Periodically pull latest cloud data (every 30s) — picks up changes
  // made by other users/devices. Skipped while a local save is pending.
  React.useEffect(() => {
    if (!isSupabaseReady()) return;
    const interval = setInterval(async () => {
      if (syncTimer.current || isSaving.current) return; // edit pending or save in-flight
      if (document.visibilityState !== 'visible') return;
      const { ok, data } = await cloudLoad();
      if (ok && data) {
        // Merge cloud data into local state by id rather than replacing outright —
        // protects against a stale read racing with a just-completed local save.
        // Cloud trades not present locally are added; local trades always kept.
        if (data.trades) {
          setTrades(prevTrades => {
            const localIds = new Set(prevTrades.map(t => t?.id).filter(Boolean));
            // Never resurrect a trade that was explicitly deleted locally,
            // even if the cloud snapshot we just read hasn't caught up yet.
            const additions = data.trades.filter(t =>
              t?.id && !localIds.has(t.id) && !recentlyDeletedIds.current.has(t.id)
            );
            if (additions.length === 0) return prevTrades; // nothing new from cloud
            const merged = [...prevTrades, ...additions];
            saveData(accounts, merged, settings);
            return merged;
          });
        }
        if (data.accounts) {
          setAccounts(prevAccounts => {
            const localIds = new Set(prevAccounts.map(a => a?.id).filter(Boolean));
            const additions = data.accounts.filter(a => a?.id && !localIds.has(a.id));
            if (additions.length === 0) return prevAccounts;
            return [...prevAccounts, ...additions];
          });
        }
        // Settings: don't auto-merge from periodic refresh — local settings
        // (lot sizes, broker credentials etc.) take priority and are only
        // updated via explicit user edits through persist().
        setLastSynced(new Date());
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [accounts, settings]);

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
      recentlyDeletedIds.current.add(id);
      const next = prev.filter(t => t.id !== id);
      persist(accounts, next, settings, true);
      return next;
    });
  }, [accounts, settings, persist]);

  const deletePosition = useCallback((positionId) => {
    setTrades(prev => {
      const removed = prev.filter(t => (t.positionId || t.id) === positionId);
      removed.forEach(t => { if (t.id) recentlyDeletedIds.current.add(t.id); });
      const next = prev.filter(t => (t.positionId || t.id) !== positionId);
      persist(accounts, next, settings, true); // isDelete=true — force immediate authoritative save
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
    // exitData: { [legId]: { exitPremium, exitDate, entryPrice?, remainingQty? } }
    setTrades(prev => {
      const next = prev.map(t => {
        if ((t.positionId || t.id) !== positionId) return t;
        const leg = exitData[t.id];
        if (!leg) return t;

        const existingExits = t.exits || [];
        const alreadyExitedQty = existingExits.reduce((s, e) => s + (e.quantity || 0), 0);
        const remainingQty = (leg.remainingQty !== undefined) ? leg.remainingQty : (t.quantity || 1) - alreadyExitedQty;

        let exits = existingExits;
        let exitPremium = leg.exitPremium !== null && leg.exitPremium !== undefined
          ? parseFloat(leg.exitPremium) : t.exitPremium;

        if (existingExits.length > 0 && remainingQty > 0 && leg.exitPremium) {
          // Has partial exits — add final tranche for remaining quantity
          const finalTranche = { quantity: remainingQty, exitPremium: parseFloat(leg.exitPremium), exitDate: leg.exitDate || new Date().toISOString().slice(0,10) };
          exits = [...existingExits, finalTranche];
          // Recalculate weighted avg exit price
          const totalQty = exits.reduce((s, e) => s + (e.quantity || 1), 0);
          exitPremium = exits.reduce((s, e) => s + (e.exitPremium || 0) * (e.quantity || 1), 0) / totalQty;
        }

        // Only mark CLOSED if all lots are actually exited
        const totalExitedQty = exits.reduce((s, e) => s + (e.quantity || 0), 0);
        const fullyExited = exits.length === 0
          ? (leg.exitPremium != null) // no tranches — single exit price set
          : totalExitedQty >= (t.quantity || 1);
        const updated = { ...t, exits, exitPremium, status: fullyExited ? 'CLOSED' : t.status || 'OPEN' };
        if (leg.exitDate) updated.exitDate = leg.exitDate;
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

  // Correct the stored entry price (premium) of one or more OPEN legs.
  // Used by broker sync when it detects the journal's entry price is stale
  // vs. AngelOne's CF-weighted-average price (e.g. legs imported before the
  // carry-forward blending fix existed, or a new CF day rolled in).
  // updates: [{ legId, premium }]
  const updateLegPremiums = useCallback((updates) => {
    if (!updates || !updates.length) return;
    const byId = new Map(updates.map(u => [u.legId, u.premium]));
    setTrades(prev => {
      let changed = false;
      const next = prev.map(t => {
        if (!byId.has(t.id)) return t;
        const newPremium = byId.get(t.id);
        if (newPremium == null || newPremium <= 0 || newPremium === t.premium) return t;
        changed = true;
        return { ...t, premium: newPremium };
      });
      if (!changed) return prev;
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
      const anyClosed = legs.some(l => l.status === 'CLOSED' || l.status === 'EXPIRED');
      const anyPartial = legs.some(l => {
        const totalExited = (l.exits || []).reduce((s, e) => s + (e.quantity || 0), 0);
        return totalExited > 0 && totalExited < (l.quantity || 1);
      });
      const status = allClosed
        ? (legs[0].status === 'EXPIRED' ? 'EXPIRED' : 'CLOSED')
        : (anyClosed || anyPartial) ? 'PARTIAL' : 'OPEN';

      // Net premium: SELL legs receive premium, BUY legs pay premium
      const netPremiumCollected = legs.reduce((sum, l) => {
        const lotSize = l.lotSize || settings.lotSizes[l.instrument] || 1;
        const mult = l.transactionType === 'SELL' ? 1 : -1;
        return sum + mult * (l.premium || 0) * l.quantity * lotSize;
      }, 0);

      // Realized P&L — includes fully closed legs AND partial exits from open legs
      const realizedPnL = legs.reduce((sum, l) => {
        const lotSize = l.lotSize || settings.lotSizes[l.instrument] || 1;
        const exits = l.exits || [];

        if (l.status === 'CLOSED' || l.status === 'EXPIRED') {
          // Fully closed leg — use exitPremium (weighted avg)
          const exitP = l.exitPremium !== undefined ? l.exitPremium : 0;
          if (l.transactionType === 'SELL') {
            return sum + (l.premium - exitP) * l.quantity * lotSize;
          } else {
            return sum + (exitP - l.premium) * l.quantity * lotSize;
          }
        }

        // Partially exited leg — sum up each exit tranche
        if (exits.length > 0) {
          return sum + exits.reduce((eSum, e) => {
            const exitP = e.exitPremium || 0;
            const qty = e.quantity || 0;
            if (l.transactionType === 'SELL') {
              return eSum + (l.premium - exitP) * qty * lotSize;
            } else {
              return eSum + (exitP - l.premium) * qty * lotSize;
            }
          }, 0);
        }

        return sum;
      }, 0);

      // Days to expiry
      const expiry = first.expiry;
      const daysToExpiry = expiry
        ? Math.ceil((new Date(expiry) - new Date()) / 86400000)
        : null;

      // Breakeven — same logic as Options Analyzer, computed from entry data
      const breakevens = (() => {
        if (!legs.length) return [];
        const strikes = legs.map(l => l.strike).filter(Boolean);
        if (!strikes.length) return [];
        const minStrike = Math.min(...strikes);
        const maxStrike = Math.max(...strikes);
        const pad = Math.max(500, (maxStrike - minStrike) * 2 || 2000);
        const points = findBreakevens(legs, Math.max(0, minStrike - pad), maxStrike + pad, 1);
        return points.map((v, i) => ({
          label: points.length === 1 ? 'Breakeven' : `BE ${i + 1}`,
          value: v,
        }));
      })();

      return {
        positionId: posId,
        strategyName: first.strategyName || 'Custom',
        instrument: first.instrument,
        expiry,
        daysToExpiry,
        accountId: first.accountId,
        status,
        legs,
        breakevens,
        netPremiumCollected,
        realizedPnL: (status !== 'OPEN' || realizedPnL !== 0) ? realizedPnL : null,
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
    const open = positions.filter(p => p.status === 'OPEN' || p.status === 'PARTIAL');
    const partial = positions.filter(p => p.status === 'PARTIAL');
    const totalPnL = [...closed, ...partial].reduce((s, p) => s + (p.realizedPnL || 0), 0);
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
    const thisMonth = [...closed, ...partial].filter(p => {
      // For partial positions — use the latest exit date from legs
      let d;
      if (p.status === 'PARTIAL') {
        const latestExit = (p.legs || []).flatMap(l => l.exits || [])
          .map(e => e.exitDate).filter(Boolean).sort().pop();
        d = new Date(latestExit || p.openDate);
      } else {
        d = new Date(p.closeDate || p.openDate);
      }
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
      const newAccounts  = a || [];
      const newTrades    = t || [];
      const newSettings  = { ...DEFAULT_SETTINGS, ...(s || {}) };
      setAccounts(newAccounts);
      setTrades(newTrades);
      setSettings(newSettings);
      saveData(newAccounts, newTrades, newSettings);
      // Push restored data to cloud immediately and authoritatively —
      // a backup restore should overwrite the cloud, not merge with it,
      // since the user is explicitly restoring a known-good state.
      if (isSupabaseReady()) {
        if (syncTimer.current) { clearTimeout(syncTimer.current); syncTimer.current = null; }
        isSaving.current = true;
        setSyncStatus('syncing');
        cloudSave(newAccounts, newTrades, newSettings).then(result => {
          setSyncStatus(result.ok ? 'synced' : 'error');
          if (result.ok) setLastSynced(new Date());
          isSaving.current = false;
        });
      }
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
      updatePositionStrategy, updatePositionMeta, reopenPosition, addLegExit, removeLegExit, updateLegPremiums,
      addTrade, addTrades, updateTrade, deleteTrade, deletePosition, closePosition,
      updateSettings,
      exportData, importData, cloudLoad, isSupabaseReady,
      liveQuotes, liveLoading, liveLastUpdated, refreshLiveQuotes,
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
