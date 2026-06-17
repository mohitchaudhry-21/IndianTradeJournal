import { blackScholes } from './blackscholes';

const RISK_FREE_RATE = 0.065;

// Calculate P&L for a set of legs at a given spot price and time-to-expiry.
// T=0 means at/after expiry (uses intrinsic value only).
export function payoffAt(legs, S, T, r = RISK_FREE_RATE) {
  let total = 0;
  legs.forEach(leg => {
    const qty = (leg.quantity || 1) * (leg.lotSize || 1);
    const sign = leg.transactionType === 'SELL' ? -1 : 1;
    const sigma = (leg.iv || 15) / 100;
    const value = T <= 0
      ? (leg.optionType === 'CE' ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0))
      : blackScholes(S, leg.strike, T, r, sigma, leg.optionType).price;
    total += sign * (value - leg.premium) * qty;
  });
  return total;
}

export function intrinsicAt(legs, S) {
  let total = 0;
  legs.forEach(leg => {
    const qty = (leg.quantity || 1) * (leg.lotSize || 1);
    const sign = leg.transactionType === 'SELL' ? -1 : 1;
    const intrinsic = leg.optionType === 'CE' ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
    total += sign * intrinsic * qty;
  });
  return total;
}

export function netPremium(legs) {
  let total = 0;
  legs.forEach(leg => {
    const qty = (leg.quantity || 1) * (leg.lotSize || 1);
    const sign = leg.transactionType === 'SELL' ? 1 : -1;
    total += sign * leg.premium * qty;
  });
  return total;
}

// Find breakeven spot prices by scanning the expiry payoff curve for sign changes.
export function findBreakevens(legs, spotMin, spotMax, step = 10) {
  if (!legs.length) return [];
  const points = [];
  let prevPnl = payoffAt(legs, spotMin, 0);
  for (let s = spotMin + step; s <= spotMax; s += step) {
    const pnl = payoffAt(legs, s, 0);
    if ((prevPnl < 0 && pnl >= 0) || (prevPnl >= 0 && pnl < 0)) points.push(s);
    prevPnl = pnl;
  }
  return points;
}

// Sum position-level Greeks across legs at a given spot/time, using each
// leg's own IV (e.g. from the live option chain).
export function positionGreeks(legs, S, T, r = RISK_FREE_RATE) {
  let delta = 0, gamma = 0, theta = 0, vega = 0;
  legs.forEach(leg => {
    const qty = (leg.quantity || 1) * (leg.lotSize || 1);
    const sign = leg.transactionType === 'SELL' ? -1 : 1;
    const sigma = (leg.iv || 15) / 100;
    const g = blackScholes(S, leg.strike, T, r, sigma, leg.optionType);
    delta += sign * g.delta * qty;
    gamma += sign * g.gamma * qty;
    theta += sign * g.theta * qty;
    vega  += sign * g.vega  * qty;
  });
  return { delta, gamma, theta, vega };
}

// Estimate max profit / max loss by scanning expiry P&L at the spot range
// boundaries and at each strike (sufficient for piecewise-linear option payoffs).
export function maxProfitLoss(legs, spotMin, spotMax) {
  if (!legs.length) return { maxProfit: null, maxLoss: null };
  const candidates = [spotMin, spotMax, ...legs.map(l => l.strike)];
  const pnls = candidates.map(s => payoffAt(legs, s, 0));
  return { maxProfit: Math.max(...pnls), maxLoss: Math.min(...pnls) };
}

export function impliedFuturesPrice(spot, T, r = RISK_FREE_RATE) {
  return spot * Math.exp(r * T);
}

// Standard deviation of spot move by target date, using average IV across legs.
export function standardDeviation(legs, spot, T) {
  if (!legs.length || T <= 0) return { sd1: 0, sd2: 0 };
  const avgIv = legs.reduce((s, l) => s + (l.iv || 15), 0) / legs.length / 100;
  const sd1 = spot * avgIv * Math.sqrt(T);
  return { sd1, sd2: sd1 * 2 };
}
