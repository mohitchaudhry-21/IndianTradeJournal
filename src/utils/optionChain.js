import { blackScholes } from './blackscholes';

const SYNC_SERVER = 'http://localhost:5001';

// Fetch the option chain for a symbol, trying NSE first (broker-independent,
// free, no auth needed) and falling back to AngelOne's Option Greeks API
// only if NSE's scrape fails (site changes, bot-detection tightening, etc).
//
// isoExpiry: the position's stored expiry as an ISO date string (e.g.
// "2026-06-26") — converted internally to whichever format each broker's
// API actually expects, since NSE and AngelOne use different conventions.
//
// Returns a normalized shape regardless of source:
// { ok, source: 'nse' | 'angelone', underlyingValue, rows: [
//     { strike, expiry, CE: { ltp, iv, oi, delta, gamma, theta, vega },
//               PE: { ltp, iv, oi, delta, gamma, theta, vega } }, ... ] }
export async function fetchOptionChain(symbol, isoExpiry, r = 0.065) {
  const nseExpiry = toNseExpiryFormat(isoExpiry);
  const angelExpiry = toAngelOneExpiryFormat(isoExpiry);

  // ---- Try NSE first ----
  try {
    const res = await fetch(`${SYNC_SERVER}/optionchain/nse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    });
    const data = await res.json();
    if (data.success && data.records?.length) {
      const rows = normalizeNseRecords(data.records, nseExpiry, data.underlyingValue, r);
      if (rows.length) {
        return { ok: true, source: 'nse', underlyingValue: data.underlyingValue, rows };
      }
    }
  } catch (e) {
    // fall through to AngelOne
  }

  // ---- Fallback: AngelOne's Option Greeks API ----
  try {
    const res = await fetch(`${SYNC_SERVER}/optionchain/angelone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: symbol, expirydate: angelExpiry }),
    });
    const data = await res.json();
    if (data.success && data.chain?.length) {
      const rows = normalizeAngelOneChain(data.chain);
      return { ok: true, source: 'angelone', underlyingValue: null, rows };
    }
    return { ok: false, error: data.error || 'Both NSE and AngelOne option chain sources failed', rows: [] };
  } catch (e) {
    return { ok: false, error: e.message, rows: [] };
  }
}

// Fetch real, current LTP for specific option contracts directly from
// AngelOne — used only when the option chain came from the AngelOne
// fallback, since that source's Greeks API never includes LTP at all
// (confirmed against AngelOne's own documented response fields). Resolves
// each leg to its scrip-master token server-side, then batch-fetches LTP.
//
// legs: [{ instrument, strike, optionType, expiry (ISO date) }]
// Returns: { ok, quotesByKey: { "NIFTY_24200_CE_26JUN2026": 66.9, ... }, unresolved: [] }
export async function fetchAngelOneLtp(legs) {
  if (!legs.length) return { ok: false, quotesByKey: {}, unresolved: [] };
  try {
    const payload = legs.map(leg => ({
      instrument: leg.instrument,
      strike: leg.strike,
      optionType: leg.optionType,
      expiry: toAngelOneExpiryFormat(leg.expiry),
    }));
    const res = await fetch(`${SYNC_SERVER}/optionchain/angelone-ltp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs: payload }),
    });
    const data = await res.json();
    if (!data.success) return { ok: false, quotesByKey: {}, unresolved: data.unresolved || [], error: data.error };
    return { ok: true, quotesByKey: data.quotes || {}, unresolved: data.unresolved || [] };
  } catch (e) {
    return { ok: false, quotesByKey: {}, unresolved: [], error: e.message };
  }
}

// Build the same lookup key used server-side, so the frontend can match a
// leg back to its quote in the quotesByKey map.
export function angelOneLtpKey(leg) {
  return `${leg.instrument}_${leg.strike}_${leg.optionType}_${toAngelOneExpiryFormat(leg.expiry)}`;
}

// NSE gives IV, LTP, OI per strike but no pre-computed Greeks — calculate
// them locally with Black-Scholes using NSE's own market-implied IV.
function normalizeNseRecords(records, targetExpiry, spot, r) {
  const filtered = targetExpiry ? records.filter(rec => rec.expiryDate === targetExpiry) : records;
  const T = filtered[0] ? daysToExpiry(filtered[0].expiryDate) / 365 : 0;

  return filtered.map(rec => {
    const row = { strike: parseFloat(rec.strikePrice), expiry: rec.expiryDate };
    ['CE', 'PE'].forEach(type => {
      const leg = rec[type];
      if (!leg) { row[type] = null; return; }
      const iv = (parseFloat(leg.impliedVolatility) || 0) / 100;
      const greeks = iv > 0 && spot
        ? blackScholes(spot, row.strike, T, r, iv, type)
        : { delta: 0, gamma: 0, theta: 0, vega: 0 };
      row[type] = {
        ltp: parseFloat(leg.lastPrice) || 0,
        iv: parseFloat(leg.impliedVolatility) || 0,
        oi: parseFloat(leg.openInterest) || 0,
        changeInOi: parseFloat(leg.changeinOpenInterest) || 0,
        volume: parseFloat(leg.totalTradedVolume) || 0,
        bid: parseFloat(leg.bidprice) || 0,
        ask: parseFloat(leg.askPrice) || 0,
        delta: greeks.delta,
        gamma: greeks.gamma,
        theta: greeks.theta,
        vega: greeks.vega,
      };
    });
    return row;
  }).sort((a, b) => a.strike - b.strike);
}

// AngelOne's response already includes pre-computed Greeks — just reshape
// the flat list (one entry per strike+type) into strike-keyed rows.
function normalizeAngelOneChain(chain) {
  const byStrike = {};
  chain.forEach(item => {
    // AngelOne's API can return numeric fields as strings rather than
    // numbers — coerce every one explicitly. A single un-coerced string
    // field reaching a .toFixed() call anywhere downstream crashes the
    // whole page, so this isn't optional.
    const strike = parseFloat(item.strikePrice);
    if (!byStrike[strike]) byStrike[strike] = { strike, expiry: null };
    byStrike[strike][item.optionType] = {
      ltp: parseFloat(item.ltp) || 0,
      iv: parseFloat(item.impliedVolatility) || 0,
      oi: 0,
      changeInOi: 0,
      volume: parseFloat(item.tradeVolume) || 0,
      bid: 0,
      ask: 0,
      delta: parseFloat(item.delta) || 0,
      gamma: parseFloat(item.gamma) || 0,
      theta: parseFloat(item.theta) || 0,
      vega: parseFloat(item.vega) || 0,
    };
  });
  return Object.values(byStrike).sort((a, b) => a.strike - b.strike);
}

function daysToExpiry(expiryDateStr) {
  // NSE format: "26-Jun-2026"
  const parts = expiryDateStr.split('-');
  const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  const d = new Date(parseInt(parts[2]), months[parts[1]], parseInt(parts[0]));
  const diffMs = d - new Date();
  return Math.max(diffMs / (1000 * 60 * 60 * 24), 0);
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Convert a stored ISO date (e.g. "2026-06-26" or full ISO timestamp) into
// NSE's expiryDate format: "26-Jun-2026"
export function toNseExpiryFormat(isoDate) {
  const d = new Date(isoDate);
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTH_ABBR[d.getMonth()];
  return `${day}-${month}-${d.getFullYear()}`;
}

// Convert a stored ISO date into AngelOne's expirydate format: "26JUN2026"
export function toAngelOneExpiryFormat(isoDate) {
  const d = new Date(isoDate);
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTH_ABBR[d.getMonth()].toUpperCase();
  return `${day}${month}${d.getFullYear()}`;
}

// Fetch every available expiry for an instrument (powers the Strategy
// Builder's expiry dropdown, where there's no saved position to derive an
// expiry from). Returns AngelOne-format date strings (e.g. "26JUN2026"),
// since that's directly usable as the expiry param for chain/LTP lookups
// without a round-trip ISO conversion.
export async function fetchExpiryList(instrument) {
  try {
    const res = await fetch(`${SYNC_SERVER}/optionchain/expirylist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument }),
    });
    const data = await res.json();
    if (!data.success) return { ok: false, expiries: [], error: data.error };
    return { ok: true, expiries: data.expiries || [] };
  } catch (e) {
    return { ok: false, expiries: [], error: e.message };
  }
}

// Map a stored instrument name (e.g. "NIFTY", "SENSEX") to NSE's expected
// symbol param — these already match 1:1 for the indices OptionsDesk tracks.
export function toNseSymbol(instrument) {
  return (instrument || '').toUpperCase();
}
