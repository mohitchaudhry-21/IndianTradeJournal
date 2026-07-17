// Fetches accurate brokerage + statutory charges from Angel One's official
// Brokerage Calculator API for a given set of legs. Only works for legs
// that originated from a broker sync (have a brokerTradeId/token) — manually
// entered legs cannot be priced this way since Angel One needs the exact
// instrument token, not just strike/expiry.

const SYNC_SERVER = 'http://localhost:5001';

// Resolve a broker token for any legs missing one (e.g. manually-entered
// adjustment legs) using the scrip master, so margin/charges can still be
// fetched from AngelOne even though no real fill produced a brokerTradeId.
// Legs that already have a token pass through unchanged. Best-effort — if
// resolution fails or a leg can't be matched, it's returned as-is and simply
// won't be priceable (buildLegPayload already filters those out).
export async function resolveTokens(legs) {
  const needResolve = legs.filter(l => !l.brokerTradeId && l.instrument && l.strike && l.optionType && l.expiry);
  if (!needResolve.length) return legs;
  try {
    const res = await fetch(`${SYNC_SERVER}/optionchain/resolve-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        legs: needResolve.map(l => ({ instrument: l.instrument, strike: l.strike, optionType: l.optionType, expiry: l.expiry })),
      }),
    });
    const data = await res.json();
    if (!data.success || !data.tokens) return legs;
    return legs.map(l => {
      if (l.brokerTradeId) return l;
      const key = `${l.instrument}_${l.strike}_${l.optionType}_${l.expiry}`;
      const token = data.tokens[key];
      return token ? { ...l, brokerTradeId: token } : l;
    });
  } catch (e) {
    return legs; // resolution failed — caller's buildLegPayload will just skip unresolvable legs
  }
}

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
  const resolved = await resolveTokens(legs);
  const payload = buildLegPayload(resolved);
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

// Fetch charges for each partial exit tranche individually.
// Partial exits are stored in leg.exits[] as { quantity, exitPremium, exitDate }.
// Each tranche is a separate market order so charges must be calculated per
// tranche at the actual exit price, not averaged across tranches.
export async function fetchPartialExitCharges(legs) {
  const resolvedLegs = await resolveTokens(legs);
  const trancheLegs = [];
  resolvedLegs.forEach(leg => {
    if (!leg.brokerTradeId || !leg.exits || !leg.exits.length) return;
    const closingTx = leg.transactionType === 'SELL' ? 'BUY' : 'SELL';
    leg.exits.forEach(exit => {
      if (!exit.exitPremium) return;
      trancheLegs.push({
        token: leg.brokerTradeId,
        quantity: exit.quantity || 1,
        lotSize: leg.lotSize || 1,
        price: exit.exitPremium,
        transactionType: closingTx,
        symbolName: leg.tradingSymbol || '',
      });
    });
  });
  if (!trancheLegs.length) return { ok: false, error: 'No partial exit tranches to price' };
  try {
    const res = await fetch(`${SYNC_SERVER}/charges/angelone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs: trancheLegs }),
    });
    const data = await res.json();
    if (!data.success) return { ok: false, error: data.error || 'Failed to calculate partial exit charges' };
    return { ok: true, charges: data.totalCharges, breakdown: data.breakdown };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Calculate total charges for a position: entry charges always, plus exit
// charges once legs are fully closed, plus partial exit charges for any
// tranches that have already been exited (even if position is still OPEN).
export async function fetchTotalCharges(position) {
  const entryResult = await fetchEntryCharges(position.legs);
  if (!entryResult.ok) return entryResult;

  // Always include partial exit charges — they represent real completed trades
  // regardless of whether the position as a whole is still open.
  const hasPartialExits = position.legs.some(l => l.exits && l.exits.length > 0);
  const partialExitResult = hasPartialExits ? await fetchPartialExitCharges(position.legs) : null;
  const partialExitCharges = partialExitResult?.ok ? partialExitResult.charges : 0;

  const isClosed = position.status !== 'OPEN';
  if (!isClosed) {
    return {
      ok: true,
      charges: entryResult.charges + partialExitCharges,
      entryCharges: entryResult.charges,
      exitCharges: partialExitCharges,
      partialExitCharges,
    };
  }

  // Fully closed position: use leg-level exit prices for legs that were
  // closed in one shot; partial exit tranches are covered by partialExitResult.
  const legsWithSingleExit = position.legs.filter(
    l => l.brokerTradeId && l.exitPremium !== undefined && l.exitPremium !== null
      && (!l.exits || l.exits.length === 0) // only legs with no tranche history
  );
  let singleExitCharges = 0;
  if (legsWithSingleExit.length > 0) {
    const exitResult = await fetchExitCharges(legsWithSingleExit);
    singleExitCharges = exitResult.ok ? exitResult.charges : 0;
  }

  const totalExitCharges = singleExitCharges + partialExitCharges;
  return {
    ok: true,
    charges: entryResult.charges + totalExitCharges,
    entryCharges: entryResult.charges,
    exitCharges: totalExitCharges,
    partialExitCharges,
  };
}

// Fetch current margin requirement for a position's legs (Angel One Margin
// Calculator API). Intended to be called once, on the day the position is
// opened — margin requirements fluctuate with market volatility, so this
// is NOT recalculated automatically afterwards; it reflects margin blocked
// at entry time, not a live/floating figure.
export async function fetchMargin(legs) {
  const resolved = await resolveTokens(legs);
  const payload = buildLegPayload(resolved);
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
