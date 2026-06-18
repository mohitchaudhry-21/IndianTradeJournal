// NSE/BSE F&O lot sizes by instrument. These change periodically when the
// exchange revises them (typically once or twice a year) — if a lot size
// here goes stale, margin/quantity math will be off by that factor, so this
// table may need updating from NSE's official lot size circular occasionally.
export const LOT_SIZES = {
  NIFTY: 65,
  BANKNIFTY: 30,
  FINNIFTY: 65,
  MIDCPNIFTY: 120,
  SENSEX: 20,
  BANKEX: 30,
};

export function getLotSize(instrument) {
  return LOT_SIZES[instrument] || 1;
}
