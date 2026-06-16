// Fetches accurate brokerage + statutory charges from Angel One's official
// Brokerage Calculator API for a given set of legs. Only works for legs
// that originated from a broker sync (have a brokerTradeId/token) — manually
// entered legs cannot be priced this way since Angel One needs the exact
// instrument token, not just strike/expiry.

const SYNC_SERVER = 'http://localhost:5001';

// Build the {token, quantity, lotSize, price, transactionType} list for an
// array of legs, skipping any leg that lacks a usable broker token.
function buildLegPayload(legs) {
  return legs
    .filter(l => l.brokerTradeId) // only broker-synced legs have a token
    .map(l => ({
      token: l.brokerTradeId,
      quantity: l.quantity || 1,
      lotSize: l.lotSize || 1,
      price: l.premium || 0,
      transactionType: l.transactionType || 'BUY',
      symbolName: l.tradingSymbol || '',
    }));
}

// Fetch ENTRY-side charges only (uses entry premium + entry transaction type)
export async function fetchEntryCharges(legs) {
  const payload = buildLegPayload(legs);
  if (!payload.length) return { ok: false, error: 'No broker-synced legs to price' };
  try {
    const res = await fetch(`${SYNC_SERVER}/charges/angelone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs: payload }),
    });
    const data = await res.json();
    if (!data.success) return { ok: false, error: data.error || 'Failed to calculate charges' };
    return { ok: true, charges: data.totalCharges, breakdown: data.breakdown };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Fetch EXIT-side charges only — uses exit premium and the OPPOSITE
// transaction type (closing a SELL is a BUY order, and vice versa)
export async function fetchExitCharges(legs) {
  const exitLegs = legs
    .filter(l => l.brokerTradeId && l.exitPremium !== undefined && l.exitPremium !== null)
    .map(l => ({
      ...l,
      premium: l.exitPremium, // price the exit leg at the exit premium
      transactionType: l.transactionType === 'SELL' ? 'BUY' : 'SELL', // closing order is opposite side
    }));
  if (!exitLegs.length) return { ok: false, error: 'No closed broker-synced legs to price' };
  return fetchEntryCharges(exitLegs); // same calculation, different inputs
}

// Calculate total charges for a position: entry charges always, exit
// charges added only once the position is closed (has exit prices).
export async function fetchTotalCharges(position) {
  const entryResult = await fetchEntryCharges(position.legs);
  if (!entryResult.ok) return entryResult;

  const isClosed = position.status !== 'OPEN';
  if (!isClosed) {
    // Position still open — only entry charges apply so far
    return { ok: true, charges: entryResult.charges, entryCharges: entryResult.charges, exitCharges: 0 };
  }

  const exitResult = await fetchExitCharges(position.legs);
  const exitCharges = exitResult.ok ? exitResult.charges : 0;
  return {
    ok: true,
    charges: entryResult.charges + exitCharges,
    entryCharges: entryResult.charges,
    exitCharges,
  };
}

// Fetch current margin requirement for a position's legs (Angel One Margin
// Calculator API). Intended to be called once, on the day the position is
// opened — margin requirements fluctuate with market volatility, so this
// is NOT recalculated automatically afterwards; it reflects margin blocked
// at entry time, not a live/floating figure.
export async function fetchMargin(legs) {
  const payload = buildLegPayload(legs);
  if (!payload.length) return { ok: false, error: 'No broker-synced legs to price' };
  try {
    const res = await fetch(`${SYNC_SERVER}/margin/angelone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs: payload }),
    });
    const data = await res.json();
    if (!data.success) return { ok: false, error: data.error || 'Failed to calculate margin' };
    return { ok: true, margin: data.totalMargin };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
