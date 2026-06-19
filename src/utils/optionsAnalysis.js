import { blackScholes, impliedVolatility as solveIV } from './blackscholes';

const RISK_FREE_RATE = 0.065;

// Calibrate IV for each leg from its real entry LTP, so that Black-Scholes
// reproduces the actual market price at the time of entry. This makes the
// P&L chart consistent with real quoted premiums rather than drifting based
// on the chain's per-strike model IV.
export function calibrateLegsIV(legs, S, T, r = RISK_FREE_RATE) {
  if (T <= 0) return legs;
  return legs.map(leg => {
    const marketPrice = leg.ltp ?? leg.premium;
    if (!marketPrice || marketPrice <= 0) return leg;
    try {
      const calibratedSigma = solveIV(marketPrice, S, leg.strike, T, r, leg.optionType, (leg.iv || 15) / 100);
      if (calibratedSigma > 0.001 && calibratedSigma < 5) {
        return { ...leg, iv: calibratedSigma * 100 };
      }
    } catch (e) { /* fall through to original IV */ }
    return leg;
  });
}

// Calculate P&L for a set of legs at a given spot price and time-to-expiry.
// T=0 means at/after expiry (uses intrinsic value only).
//
// useRealLtp: when true (the "right now" scenario), legs with a real
// chain-quoted LTP use that directly instead of a Black-Scholes theoretical
// price — this keeps the analyzer's current-moment P&L consistent with the
// live P&L shown elsewhere in the app, which is based on actual quoted
// prices, not a model. Black-Scholes only takes over for genuine
// what-if scenarios (a different spot and/or a future target date), where
// no real quote for that hypothetical exists.
export function payoffAt(legs, S, T, r = RISK_FREE_RATE, useRealLtp = false) {
  let total = 0;
  legs.forEach(leg => {
    const qty = (leg.quantity || 1) * (leg.lotSize || 1);
    const sign = leg.transactionType === 'SELL' ? -1 : 1;
    const sigma = (leg.iv || 15) / 100;
    let value;
    if (T <= 0) {
      value = leg.optionType === 'CE' ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
    } else if (useRealLtp && leg.ltp !== undefined && leg.ltp !== null) {
      value = leg.ltp;
    } else {
      value = blackScholes(S, leg.strike, T, r, sigma, leg.optionType).price;
    }
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
