import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchLiveQuotes } from '../utils/livePnL';

// Polls the local sync server every `intervalMs` for live LTP quotes.
// Returns { quotes, loading, error, lastUpdated, refresh }
// Auto-pauses when the tab is hidden, resumes when visible.
export function useLivePnL(intervalMs = 30000, enabled = true) {
  const [quotes, setQuotes]       = useState({});
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const intervalRef = useRef(null);
  const inFlight = useRef(false); // guards against overlapping requests piling up

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (inFlight.current) return; // previous request still running — skip this tick rather than stack another on top
    inFlight.current = true;
    setLoading(true);
    try {
      const data = await fetchLiveQuotes();
      // Merge rather than replace — if AngelOne is mid rate-limit-cooldown
      // (or any other transient hiccup), fetchLiveQuotes() resolves
      // successfully but with an empty/partial object rather than throwing.
      // Replacing wholesale would wipe out the last known-good quotes and
      // make the sidebar's Live P&L widget disappear every single time this
      // happens, instead of just holding its last value until the next
      // successful poll comes in.
      setQuotes(prev => ({ ...prev, ...data }));
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to fetch live prices');
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refresh(); // immediate fetch on mount

    const tick = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    intervalRef.current = setInterval(tick, intervalMs);
    return () => clearInterval(intervalRef.current);
  }, [enabled, intervalMs, refresh]);

  return { quotes, loading, error, lastUpdated, refresh };
}
