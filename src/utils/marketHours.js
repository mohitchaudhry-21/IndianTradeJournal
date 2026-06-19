// NSE's regular trading session is 9:15 AM to 3:30 PM IST, Monday to
// Friday (holidays aren't accounted for here — a closed-but-weekday
// market just shows "last available" data via the same path as evenings/
// weekends, which is a reasonable simplification for a personal journal).
//
// All checks are done in IST regardless of the device's local timezone,
// since NSE's hours are fixed to IST and a user travelling or with a
// misconfigured system clock shouldn't see incorrect market-open status.
const IST_OFFSET_MIN = 5 * 60 + 30; // UTC+5:30
function toIstParts(date) {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
  const istMs = utcMs + IST_OFFSET_MIN * 60000;
  const ist = new Date(istMs);
  return {
    day: ist.getDay(), // 0=Sun, 6=Sat
    hours: ist.getHours(),
    minutes: ist.getMinutes(),
    istDate: ist,
  };
}

// True between 9:15 AM and 3:30 PM IST on a weekday.
export function isMarketOpen(date = new Date()) {
  const { day, hours, minutes } = toIstParts(date);
  if (day === 0 || day === 6) return false;
  const mins = hours * 60 + minutes;
  return mins >= (9 * 60 + 15) && mins <= (15 * 60 + 30);
}

// Human-readable status for UI labels.
export function getMarketStatus(date = new Date()) {
  const { day, hours, minutes } = toIstParts(date);
  const mins = hours * 60 + minutes;
  if (day === 0 || day === 6) return 'closed-weekend';
  if (mins < 9 * 60 + 15) return 'closed-premarket';
  if (mins > 15 * 60 + 30) return 'closed-postmarket';
  return 'open';
}

// --- Position analysis snapshots ---
// While the market is open, the Analyzer continuously saves its last
// successful live read (spot + per-leg chain data) here. Once the market
// closes, there's nothing genuinely "live" to poll — broker Greeks APIs
// are built around live contracts and behave unreliably after hours — so
// the Analyzer instead loads this frozen snapshot and analyzes against it,
// the same way Sensibull lets you review a position using the last
// available data after close.
const SNAPSHOT_PREFIX = 'optionsdesk_snapshot_';
export function saveAnalysisSnapshot(positionId, snapshot) {
  try {
    localStorage.setItem(SNAPSHOT_PREFIX + positionId, JSON.stringify({ ...snapshot, savedAt: Date.now() }));
  } catch (e) {
    // localStorage can fail (quota, private browsing) — snapshotting is a
    // nice-to-have, not worth surfacing an error for.
  }
}
export function loadAnalysisSnapshot(positionId) {
  try {
    const raw = localStorage.getItem(SNAPSHOT_PREFIX + positionId);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
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
  const OPEN  = 9 * 60 + 15;
  const CLOSE = 15 * 60 + 30;
  const STEP  = 15;
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
 */
export function isMonthlyExpiry(dateOrMs) {
  const d = new Date(typeof dateOrMs === 'number' ? dateOrMs : dateOrMs.getTime());
  const yr = d.getFullYear(), mo = d.getMonth();
  const targetDow = (yr > 2025 || (yr === 2025 && mo >= 8)) ? 2 : 4;
  const lastDay = new Date(yr, mo + 1, 0);
  while (lastDay.getDay() !== targetDow) lastDay.setDate(lastDay.getDate() - 1);
  return d.getDate() === lastDay.getDate() && d.getMonth() === mo;
}
