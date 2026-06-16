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

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const data = await fetchLiveQuotes();
      setQuotes(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to fetch live prices');
    } finally {
      setLoading(false);
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
