// Fetches accurate brokerage + statutory charges from Angel One's official
// Brokerage Calculator API for a given set of legs. Only works for legs
// that originated from a broker sync (have a brokerTradeId/token) — manually
// entered legs cannot be priced this way since Angel One needs the exact
// instrument token, not just strike/expiry.

const SYNC_SERVER = 'http://localhost:5001';

// Build the {token, quantity, lotSize, price, transactionType} list for an
// array of legs. Uses brokerTradeId if available, otherwise resolves token
// from scrip master via the sync server (for Excel-imported legs).
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

// Resolve tokens for Excel-imported legs via scrip master, then build payload
async function buildLegPayloadWithLookup(legs) {
  const result = [];
  const noToken = legs.filter(l => !l.brokerTradeId);
  const hasToken = legs.filter(l => l.brokerTradeId);

  // Add broker-synced legs directly
  hasToken.forEach(l => result.push({
    token: l.brokerTradeId,
    quantity: l.quantity || 1,
    lotSize: l.lotSize || 1,
    price: l.premium || 0,
    transactionType: l.transactionType || 'BUY',
    symbolName: l.tradingSymbol || '',
  }));

  // Resolve tokens for Excel-imported legs
  if (noToken.length > 0) {
    try {
      const res = await fetch(`${SYNC_SERVER}/optionchain/resolve-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legs: noToken.map(l => ({
          instrument: l.instrument,
          strike: l.strike,
          optionType: l.optionType,
          expiry: l.expiry,
        })) }),
      });
      const data = await res.json();
      if (data.success && data.tokens) {
        noToken.forEach(l => {
          const key = `${l.instrument}_${l.strike}_${l.optionType}_${l.expiry}`;
          const token = data.tokens[key];
          if (token) {
            result.push({
              token,
              quantity: l.quantity || 1,
              lotSize: l.lotSize || 1,
              price: l.premium || 0,
              transactionType: l.transactionType || 'BUY',
              symbolName: `${l.instrument}${l.strike}${l.optionType}`,
            });
          }
        });
      }
    } catch (e) {
      // Token lookup failed — fall back to Excel tranche charges
    }
  }
  return result;
}

// Fetch ENTRY-side charges only (uses entry premium + entry transaction type)
export async function fetchEntryCharges(legs) {
  const payload = await buildLegPayloadWithLookup(legs);
  if (!payload.length) return { ok: false, error: 'No legs with resolvable tokens' };
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
  const trancheLegs = [];
  legs.forEach(leg => {
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
  // Sum any charges already stored on exit tranches (from Excel import)
  // These are exact broker-reported charges so use them directly
  const storedTrancheCharges = (position.legs || []).reduce((sum, leg) =>
    sum + (leg.exits || []).reduce((s, e) => s + (Math.abs(e.charges || 0)), 0), 0
  );

  const entryResult = await fetchEntryCharges(position.legs);
  if (!entryResult.ok) {
    // If we can't fetch from broker but have stored tranche charges, use those
    if (storedTrancheCharges > 0) return { ok: true, charges: storedTrancheCharges };
    return entryResult;
  }

  // Always include partial exit charges — they represent real completed trades
  // regardless of whether the position as a whole is still open.
  const hasPartialExits = position.legs.some(l => l.exits && l.exits.length > 0);
  // Only fetch partial exit charges for legs that have brokerTradeId
  // For Excel-imported legs, we already have storedTrancheCharges above
  const brokerSyncedLegsWithExits = position.legs.filter(l => l.brokerTradeId && l.exits?.length > 0);
  const partialExitResult = brokerSyncedLegsWithExits.length > 0
    ? await fetchPartialExitCharges(brokerSyncedLegsWithExits)
    : null;
  // Use stored tranche charges for excel-imported legs that broker can't price
  const excelOnlyLegsCharges = (position.legs || []).filter(l => !l.brokerTradeId)
    .reduce((sum, leg) => sum + (leg.exits || []).reduce((s, e) => s + Math.abs(e.charges || 0), 0), 0);
  const partialExitCharges = (partialExitResult?.ok ? partialExitResult.charges : 0) + excelOnlyLegsCharges;

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
