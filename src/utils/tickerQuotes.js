import { findSymbol } from './tickerSymbols';

const SYNC_SERVER = 'http://localhost:5001';

// Fetch live quotes for a list of symbol names (e.g. ['NIFTY', 'SENSEX']).
// Primary source: Yahoo Finance via the broker-independent /quote endpoint —
// works regardless of AngelOne connection status. Falls back to AngelOne's
// own quote API only if the Yahoo-backed endpoint is unavailable.
export async function fetchTickerQuotes(symbolNames) {
  if (!symbolNames.length) return { ok: false, error: 'No symbols provided', quotes: [] };

  // Try the broker-independent source first
  try {
    const res = await fetch(`${SYNC_SERVER}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: symbolNames }),
    });
    const data = await res.json();
    if (data.success && data.quotes?.length) {
      return { ok: true, quotes: data.quotes, source: 'yahoo' };
    }
  } catch (e) {
    // fall through to AngelOne fallback below
  }

  // Fallback: AngelOne's own quote API (requires broker connected)
  const symbols = symbolNames
    .map(name => findSymbol(name))
    .filter(Boolean)
    .map(s => ({ exchange: s.exchange, token: s.token, name: s.name }));

  if (!symbols.length) return { ok: false, error: 'No valid symbols for fallback', quotes: [] };

  try {
    const res = await fetch(`${SYNC_SERVER}/quote/angelone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols }),
    });
    const data = await res.json();
    if (!data.success) return { ok: false, error: data.error, quotes: [] };
    return { ok: true, quotes: data.quotes, source: 'angelone' };
  } catch (e) {
    return { ok: false, error: e.message, quotes: [] };
  }
}
