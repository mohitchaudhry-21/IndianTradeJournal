/**
 * Generates an array of valid NSE trading timestamps between fromMs and toMs.
 * NSE trades Mon–Fri, 09:15–15:30 IST (UTC+05:30), at 15-minute granularity.
 * Always includes fromMs (index 0 = "now") and toMs (last index = expiry).
 */
export function generateMarketTimestamps(fromMs, toMs) {
  const IST = 5.5 * 60 * 60 * 1000;
  const OPEN  = 9 * 60 + 15;   // 09:15 in minutes from midnight IST
  const CLOSE = 15 * 60 + 30;  // 15:30 in minutes from midnight IST
  const STEP  = 15;             // 15-minute steps
  const result = [fromMs];
  let cur = new Date(fromMs);
  const rem = cur.getMinutes() % STEP;
  if (rem !== 0) cur.setMinutes(cur.getMinutes() + (STEP - rem), 0, 0);
  else cur.setSeconds(0, 0);
  while (cur.getTime() <= toMs) {
    const istMs = cur.getTime() + IST;
    const d = new Date(istMs);
    const dow = d.getUTCDay();
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (dow >= 1 && dow <= 5 && mins >= OPEN && mins <= CLOSE) {
      const t = cur.getTime();
      if (t > fromMs && t < toMs) result.push(t);
    }
    cur = new Date(cur.getTime() + STEP * 60 * 1000);
  }
  result.push(toMs);
  return [...new Set(result)].sort((a, b) => a - b);
}

/**
 * Returns true if the given Date (or ms timestamp) is the last monthly
 * expiry weekday for that calendar month (last Thursday pre-Sep-2025,
 * last Tuesday post-Sep-2025 for Nifty/BankNifty).
 */
export function isMonthlyExpiry(dateOrMs) {
  const d = new Date(typeof dateOrMs === 'number' ? dateOrMs : dateOrMs.getTime());
  const yr = d.getFullYear(), mo = d.getMonth();
  // Post Sep 2025: Nifty weekly expires shifted to Tuesday (day 2)
  const targetDow = (yr > 2025 || (yr === 2025 && mo >= 8)) ? 2 : 4;
  // Find last occurrence of targetDow in this month
  const lastDay = new Date(yr, mo + 1, 0);
  while (lastDay.getDay() !== targetDow) lastDay.setDate(lastDay.getDate() - 1);
  return d.getDate() === lastDay.getDate() && d.getMonth() === mo;
}

// ─── Time-slider helpers ──────────────────────────────────────────────────────

/**
 * Generates an array of valid NSE trading timestamps between fromMs and toMs.
 * NSE trades Mon–Fri, 09:15–15:30 IST, at 15-minute granularity.
 * Always includes fromMs (index 0 = "now") and toMs (last index = expiry).
 * Used by the time slider in StrategyBuilder and OptionsAnalyzer so the
 * slider can only land on real trading moments.
 */
export function generateMarketTimestamps(fromMs, toMs) {
  const OPEN  = 9 * 60 + 15;   // 09:15 in minutes from midnight IST
  const CLOSE = 15 * 60 + 30;  // 15:30 in minutes from midnight IST
  const STEP  = 15;             // 15-minute steps
  const result = [fromMs];
  let cur = new Date(fromMs);
  const rem = cur.getMinutes() % STEP;
  if (rem !== 0) cur.setMinutes(cur.getMinutes() + (STEP - rem), 0, 0);
  else cur.setSeconds(0, 0);
  while (cur.getTime() <= toMs) {
    const { day, hours, minutes } = toIstParts(cur);
    const mins = hours * 60 + minutes;
    if (day >= 1 && day <= 5 && mins >= OPEN && mins <= CLOSE) {
      const t = cur.getTime();
      if (t > fromMs && t < toMs) result.push(t);
    }
    cur = new Date(cur.getTime() + STEP * 60 * 1000);
  }
  result.push(toMs);
  return [...new Set(result)].sort((a, b) => a - b);
}

/**
 * Returns true if the given Date (or ms timestamp) falls on the last
 * monthly-expiry weekday for that calendar month:
 *   • Pre-Sep-2025  → last Thursday of the month (traditional NSE expiry)
 *   • Sep-2025 onwards → last Tuesday of the month (Nifty/BankNifty shift)
 *
 * Used by the Futures tab to separate real monthly futures contracts from
 * synthetic (weekly) ones.
 */
export function isMonthlyExpiry(dateOrMs) {
  const d = new Date(typeof dateOrMs === 'number' ? dateOrMs : dateOrMs.getTime());
  const yr = d.getFullYear(), mo = d.getMonth();
  const targetDow = (yr > 2025 || (yr === 2025 && mo >= 8)) ? 2 : 4;
  const lastDay = new Date(yr, mo + 1, 0);
  while (lastDay.getDay() !== targetDow) lastDay.setDate(lastDay.getDate() - 1);
  return d.getDate() === lastDay.getDate() && d.getMonth() === mo;
}
