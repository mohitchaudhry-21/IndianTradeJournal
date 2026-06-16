// Known index symbols and their Angel One exchange/token pairs, for use in
// the top ticker bar. This list covers the most commonly watched indices;
// more can be added here if needed.

export const KNOWN_SYMBOLS = [
  { name: 'NIFTY',      exchange: 'NSE', token: '26000' },
  { name: 'BANKNIFTY',  exchange: 'NSE', token: '26009' },
  { name: 'FINNIFTY',   exchange: 'NSE', token: '26037' },
  { name: 'MIDCPNIFTY', exchange: 'NSE', token: '26074' },
  { name: 'SENSEX',     exchange: 'BSE', token: '99919000' },
  { name: 'BANKEX',     exchange: 'BSE', token: '99919012' },
];

export function findSymbol(name) {
  return KNOWN_SYMBOLS.find(s => s.name === name);
}
