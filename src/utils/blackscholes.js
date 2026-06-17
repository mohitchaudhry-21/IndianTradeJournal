// Standard Black-Scholes / Black-76-style option pricing and Greeks for
// European-style index options (NIFTY, SENSEX options are European-style
// and cash-settled in India, so this is the correct model — not American).

function erf(x) {
  // Abramowitz-Stegun approximation
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t*Math.exp(-x*x);
  return sign * y;
}

function normCDF(x) { return 0.5 * (1 + erf(x / Math.sqrt(2))); }
function normPDF(x) { return Math.exp(-x*x/2) / Math.sqrt(2*Math.PI); }

// S = spot, K = strike, T = time to expiry in YEARS, r = risk-free rate (decimal),
// sigma = implied volatility (decimal), type = 'CE' | 'PE'
export function blackScholes(S, K, T, r, sigma, type) {
  if (T <= 0 || sigma <= 0) {
    // At/after expiry — Greeks collapse to intrinsic value behavior
    const intrinsic = type === 'CE' ? Math.max(S - K, 0) : Math.max(K - S, 0);
    return {
      price: intrinsic,
      delta: type === 'CE' ? (S > K ? 1 : 0) : (S < K ? -1 : 0),
      gamma: 0, theta: 0, vega: 0,
    };
  }

  const d1 = (Math.log(S / K) + (r + sigma*sigma/2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  const Nd1 = normCDF(d1);
  const Nd2 = normCDF(d2);
  const nd1 = normPDF(d1);

  let price, delta;
  if (type === 'CE') {
    price = S * Nd1 - K * Math.exp(-r*T) * Nd2;
    delta = Nd1;
  } else {
    price = K * Math.exp(-r*T) * normCDF(-d2) - S * normCDF(-d1);
    delta = Nd1 - 1; // = -N(-d1)
  }

  const gamma = nd1 / (S * sigma * Math.sqrt(T));
  const vega  = S * nd1 * Math.sqrt(T) / 100; // per 1% change in IV
  let theta;
  if (type === 'CE') {
    theta = (-S * nd1 * sigma / (2*Math.sqrt(T)) - r*K*Math.exp(-r*T)*Nd2) / 365;
  } else {
    theta = (-S * nd1 * sigma / (2*Math.sqrt(T)) - r*K*Math.exp(-r*T)*normCDF(-d2) * -1) / 365;
    // standard put theta:
    theta = (-S * nd1 * sigma / (2*Math.sqrt(T)) + r*K*Math.exp(-r*T)*normCDF(-d2)) / 365;
  }

  return { price, delta, gamma, theta, vega };
}

// Solve for implied volatility given a market price (Newton-Raphson)
export function impliedVolatility(marketPrice, S, K, T, r, type, guess = 0.20) {
  let sigma = guess;
  for (let i = 0; i < 50; i++) {
    const { price, vega } = blackScholes(S, K, T, r, sigma, type);
    const vegaFull = vega * 100; // undo the /100 scaling for the solver
    if (Math.abs(vegaFull) < 1e-8) break;
    const diff = price - marketPrice;
    if (Math.abs(diff) < 1e-4) break;
    sigma = sigma - diff / vegaFull;
    if (sigma <= 0.001) sigma = 0.001;
    if (sigma > 5) sigma = 5;
  }
  return sigma;
}
