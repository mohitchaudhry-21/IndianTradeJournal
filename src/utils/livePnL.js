// Live/unrealised P&L utilities
// Fetches current LTP from the local sync server and calculates unrealised P&L
// for open positions based on entry premium vs current market price.

const SYNC_SERVER = 'http://localhost:5001';

// Build the same key format used by the server's /livePnL endpoints
function legKey(leg) {
  const expiry = (leg.expiry || '').slice(0, 10).replace(/-/g, '');
  // Server normalises expiry to YYYY-MM-DD, so match that format
  const normExpiry = (leg.expiry || '').slice(0, 10);
  return `${leg.instrument}_${leg.strike}_${leg.optionType}_${normExpiry}`;
}

// Fetch live quotes from both brokers, merge into one quotes map
export async function fetchLiveQuotes() {
  const results = {};
  const fetches = [
    fetch(`${SYNC_SERVER}/livePnL/angelone`).then(r => r.json()).catch(() => null),
    fetch(`${SYNC_SERVER}/livePnL/kotak`).then(r => r.json()).catch(() => null),
  ];
  const [angelRes, kotakRes] = await Promise.all(fetches);
  if (angelRes?.success) Object.assign(results, angelRes.quotes);
  if (kotakRes?.success) Object.assign(results, kotakRes.quotes);
  return results;
}

// Calculate unrealised P&L for a single open position given a quotes map
// Returns null if any leg is missing a live quote (can't calculate fully)
export function calcUnrealizedPnL(position, quotes) {
  if (!position?.legs?.length || (position.status !== 'OPEN' && position.status !== 'PARTIAL')) return null;
  let total = 0;
  let allFound = true;

  position.legs.forEach(leg => {
    // A leg has no remaining open quantity either because its exit tranches
    // already cover it, OR because it was closed directly (status set to
    // CLOSED/EXPIRED with a top-level exitPremium, e.g. via the Edit Trade
    // popup) without ever populating the exits array. Checking only the
    // exits tally missed that second case — it would keep demanding a live
    // quote for an already-closed leg that the broker will never report
    // again, permanently blocking this position's whole calculation even
    // when its genuinely open legs already have perfectly good quotes.
    if (leg.status === 'CLOSED' || leg.status === 'EXPIRED') return;
    const exitedQty = (leg.exits || []).reduce((s, e) => s + (e.quantity || 0), 0);
    const remainingQty = (leg.quantity || 1) - exitedQty;
    if (remainingQty <= 0) return; // nothing open on this leg

    const key = legKey(leg);
    const ltp = quotes[key];
    if (ltp === undefined || ltp === null) {
      allFound = false;
      return;
    }
    const lotSize = leg.lotSize || 1;
    const entry = leg.premium || 0;
    // SELL: profit when price falls (entry - current); BUY: profit when price rises (current - entry)
    const legPnl = (leg.transactionType === 'SELL' ? (entry - ltp) : (ltp - entry)) * remainingQty * lotSize;
    total += legPnl;
  });

  return allFound ? total : null;
}

export { legKey };
