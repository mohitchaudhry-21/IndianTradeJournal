import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchTickerQuotes } from '../utils/tickerQuotes';

// Polls live quotes for a list of selected symbol names every `intervalMs`.
// Pass `paused=true` to stop polling without unmounting (e.g. a pause button).
// Returns { quotes, loading, error, refresh }
export function useTickerQuotes(symbolNames, intervalMs = 5000, paused = false) {
  const [quotes, setQuotes]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const intervalRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!symbolNames.length) { setQuotes([]); return; }
    setLoading(true);
    const result = await fetchTickerQuotes(symbolNames);
    setLoading(false);
    if (result.ok) { setQuotes(result.quotes); setError(null); }
    else setError(result.error);
  }, [symbolNames.join(',')]); // eslint-disable-line

  useEffect(() => {
    if (!symbolNames.length) { setQuotes([]); return; }
    if (paused) { clearInterval(intervalRef.current); return; }
    refresh();
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    intervalRef.current = setInterval(tick, intervalMs);
    return () => clearInterval(intervalRef.current);
  }, [symbolNames.join(','), intervalMs, paused, refresh]); // eslint-disable-line

  return { quotes, loading, error, refresh };
}
