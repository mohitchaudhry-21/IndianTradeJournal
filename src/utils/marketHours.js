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
