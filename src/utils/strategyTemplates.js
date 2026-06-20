/**
 * Strategy definitions for both the Ready-made grid (Strategy Builder)
 * and the Strategy Wizard computation engine.
 *
 * Each entry has:
 *   name         — display name
 *   category     — 'Bullish' | 'Bearish' | 'Neutral' | 'Others'
 *   type         — 'hedged' | 'unhedged' (for wizard filters)
 *   desc         — plain English "how does this work?"
 *   path         — SVG path d for 80x50 viewBox thumbnail (zero line at y=30)
 *   legs(off)    — function(off) → leg template array
 *                  off(n) returns the strike n steps from ATM in sorted chain
 *                  returns [{ optionType, transactionType, stepsFromAtm, qty }]
 */

export const STRATEGY_TEMPLATES = [
  // ─── Bullish ──────────────────────────────────────────────────────────────
  {
    name: 'Buy Call', category: 'Bullish', type: 'hedged',
    desc: 'You make money if the market rises above the breakeven. Loss is limited to the premium paid.',
    path: 'M5,44 L38,44 L75,6',
    legs: (off) => [
      { optionType:'CE', transactionType:'BUY', stepsFromAtm: 0, qty:1 },
    ],
  },
  {
    name: 'Sell Put', category: 'Bullish', type: 'unhedged',
    desc: 'You collect a premium and make money if the market stays above the breakeven. Loss can be large if market falls sharply.',
    path: 'M5,6 L35,6 L55,44 L75,44',
    legs: () => [
      { optionType:'PE', transactionType:'SELL', stepsFromAtm: 0, qty:1 },
    ],
  },
  {
    name: 'Bull Call Spread', category: 'Bullish', type: 'hedged',
    desc: 'You pay a small net premium and profit if the market rises. Both profit and loss are capped.',
    path: 'M5,40 L25,40 L55,14 L75,14',
    legs: () => [
      { optionType:'CE', transactionType:'BUY', stepsFromAtm: 0, qty:1 },
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 2, qty:1 },
    ],
  },
  {
    name: 'Bull Put Spread', category: 'Bullish', type: 'hedged',
    desc: 'You collect a net credit. You profit if the market stays above the higher put strike. Both profit and loss are capped.',
    path: 'M5,40 L25,40 L50,14 L75,14',
    legs: () => [
      { optionType:'PE', transactionType:'SELL', stepsFromAtm: 0, qty:1 },
      { optionType:'PE', transactionType:'BUY', stepsFromAtm:-2, qty:1 },
    ],
  },
  {
    name: 'Call Ratio Back Spread', category: 'Bullish', type: 'hedged',
    desc: 'Sell 1 lower call, buy 2 higher calls. You make money if market moves up significantly. Small profit or credit if market stays flat.',
    path: 'M5,14 L28,14 L38,44 L52,44 L75,6',
    legs: () => [
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 0, qty:1 },
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 2, qty:2 },
    ],
  },
  {
    name: 'Long Calendar (Calls)', category: 'Bullish', type: 'hedged',
    desc: 'Buy a longer-dated call, sell a nearer-dated call at the same strike. Profits from time decay difference when market stays near ATM.',
    path: 'M5,32 L30,14 L55,32 L75,32',
    legs: () => [
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 0, qty:1, nextExpiry: true },
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 0, qty:1 },
    ],
  },
  {
    name: 'Bull Condor', category: 'Bullish', type: 'hedged',
    desc: 'Buy low strike, sell two middle strikes, buy high strike call. Profits in a moderate upward move.',
    path: 'M5,44 L20,44 L32,14 L52,14 L65,44 L75,44',
    legs: () => [
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm:-2, qty:1 },
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 0, qty:1 },
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 2, qty:1 },
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 4, qty:1 },
    ],
  },
  {
    name: 'Bull Butterfly', category: 'Bullish', type: 'hedged',
    desc: 'Buy low strike call, sell two ATM calls, buy high strike call. Max profit just above ATM.',
    path: 'M5,44 L22,44 L40,8 L58,44 L75,44',
    legs: () => [
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 0, qty:1 },
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 2, qty:2 },
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 4, qty:1 },
    ],
  },
  {
    name: 'Range Forward', category: 'Bullish', type: 'hedged',
    desc: 'Sell OTM put, buy OTM call. Profit if market rises above call strike. Protected between put and call strikes.',
    path: 'M5,44 L25,44 L38,22 L52,22 L62,8 L75,8',
    legs: () => [
      { optionType:'PE', transactionType:'SELL', stepsFromAtm:-2, qty:1 },
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 2, qty:1 },
    ],
  },
  {
    name: 'Long Synthetic Future', category: 'Bullish', type: 'unhedged',
    desc: 'Buy call and sell put at the same ATM strike. Behaves like owning a futures contract. Profits if market rises.',
    path: 'M5,44 L75,6',
    legs: () => [
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 0, qty:1 },
      { optionType:'PE', transactionType:'SELL', stepsFromAtm: 0, qty:1 },
    ],
  },

  // ─── Bearish ──────────────────────────────────────────────────────────────
  {
    name: 'Buy Put', category: 'Bearish', type: 'hedged',
    desc: 'You make money if the market falls below the breakeven. Loss is limited to the premium paid.',
    path: 'M5,6 L40,6 L75,44',
    legs: () => [
      { optionType:'PE', transactionType:'BUY', stepsFromAtm: 0, qty:1 },
    ],
  },
  {
    name: 'Sell Call', category: 'Bearish', type: 'unhedged',
    desc: 'You collect a premium and profit if the market stays below the breakeven. Loss can be large if market rises sharply.',
    path: 'M5,14 L38,14 L58,44 L75,44',
    legs: () => [
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 0, qty:1 },
    ],
  },
  {
    name: 'Bear Call Spread', category: 'Bearish', type: 'hedged',
    desc: 'Sell lower call, buy higher call for protection. Profit from credit if market stays below lower strike.',
    path: 'M5,14 L25,14 L52,40 L75,40',
    legs: () => [
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 0, qty:1 },
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 2, qty:1 },
    ],
  },
  {
    name: 'Bear Put Spread', category: 'Bearish', type: 'hedged',
    desc: 'Buy higher put, sell lower put. Pay net debit and profit if market falls below higher put strike.',
    path: 'M5,14 L28,14 L55,40 L75,40',
    legs: () => [
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm: 0, qty:1 },
      { optionType:'PE', transactionType:'SELL', stepsFromAtm:-2, qty:1 },
    ],
  },
  {
    name: 'Put Ratio Back Spread', category: 'Bearish', type: 'hedged',
    desc: 'Sell 1 higher put, buy 2 lower puts. Profits when market falls significantly. Small gain or credit if market stays flat.',
    path: 'M5,6 L28,44 L42,44 L55,14 L75,14',
    legs: () => [
      { optionType:'PE', transactionType:'SELL', stepsFromAtm: 0, qty:1 },
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm:-2, qty:2 },
    ],
  },
  {
    name: 'Long Calendar (Puts)', category: 'Bearish', type: 'hedged',
    desc: 'Buy longer-dated put, sell nearer-dated put at the same strike. Benefits from time decay difference.',
    path: 'M5,32 L30,14 L55,32 L75,32',
    legs: () => [
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm: 0, qty:1, nextExpiry: true },
      { optionType:'PE', transactionType:'SELL', stepsFromAtm: 0, qty:1 },
    ],
  },
  {
    name: 'Bear Condor', category: 'Bearish', type: 'hedged',
    desc: 'Bearish condor using puts. Profits in a moderate downward move.',
    path: 'M5,44 L20,44 L32,14 L52,14 L65,44 L75,44',
    legs: () => [
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm: 0, qty:1 },
      { optionType:'PE', transactionType:'SELL', stepsFromAtm:-2, qty:1 },
      { optionType:'PE', transactionType:'SELL', stepsFromAtm:-4, qty:1 },
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm:-6, qty:1 },
    ],
  },
  {
    name: 'Bear Butterfly', category: 'Bearish', type: 'hedged',
    desc: 'Sell 2 ATM puts, buy 1 ITM and 1 OTM put. Max profit when market falls to ATM.',
    path: 'M5,44 L22,44 L40,8 L58,44 L75,44',
    legs: () => [
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm: 0, qty:1 },
      { optionType:'PE', transactionType:'SELL', stepsFromAtm:-2, qty:2 },
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm:-4, qty:1 },
    ],
  },
  {
    name: 'Risk Reversal', category: 'Bearish', type: 'hedged',
    desc: 'Buy OTM put, sell OTM call. Profit if market falls. Funded partly by selling the call.',
    path: 'M5,6 L32,22 L75,44',
    legs: () => [
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 2, qty:1 },
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm:-2, qty:1 },
    ],
  },
  {
    name: 'Short Synthetic Future', category: 'Bearish', type: 'unhedged',
    desc: 'Sell call and buy put at the same ATM strike. Behaves like being short futures. Profits if market falls.',
    path: 'M5,6 L75,44',
    legs: () => [
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 0, qty:1 },
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm: 0, qty:1 },
    ],
  },

  // ─── Neutral ──────────────────────────────────────────────────────────────
  {
    name: 'Short Straddle', category: 'Neutral', type: 'unhedged',
    desc: 'Sell ATM call and put. Profit if market stays near current levels. Loss if big move in either direction.',
    path: 'M5,44 L40,6 L75,44',
    legs: () => [
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 0, qty:1 },
      { optionType:'PE', transactionType:'SELL', stepsFromAtm: 0, qty:1 },
    ],
  },
  {
    name: 'Iron Butterfly', category: 'Neutral', type: 'hedged',
    desc: 'Sell ATM straddle, buy OTM call and put for protection. Profit if market stays near ATM.',
    path: 'M5,44 L22,44 L40,8 L58,44 L75,44',
    legs: () => [
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm:-2, qty:1 },
      { optionType:'PE', transactionType:'SELL', stepsFromAtm: 0, qty:1 },
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 0, qty:1 },
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 2, qty:1 },
    ],
  },
  {
    name: 'Short Strangle', category: 'Neutral', type: 'unhedged',
    desc: 'Sell OTM call and put. Profit if market stays within a range. Unlimited risk on both sides.',
    path: 'M5,44 L20,44 L35,8 L55,8 L70,44 L75,44',
    legs: () => [
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 2, qty:1 },
      { optionType:'PE', transactionType:'SELL', stepsFromAtm:-2, qty:1 },
    ],
  },
  {
    name: 'Short Iron Condor', category: 'Neutral', type: 'hedged',
    desc: 'Sell strangle with protection. Profit if market stays within the sold strikes. Both risk and reward are limited.',
    path: 'M5,44 L15,44 L25,10 L45,10 L58,44 L75,44',
    legs: () => [
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm:-4, qty:1 },
      { optionType:'PE', transactionType:'SELL', stepsFromAtm:-2, qty:1 },
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 2, qty:1 },
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 4, qty:1 },
    ],
  },
  {
    name: 'Batman', category: 'Neutral', type: 'hedged',
    desc: 'A complex neutral strategy with two profit peaks. Profits when market stays near ATM or makes small moves.',
    path: 'M5,44 L15,44 L25,12 L35,44 L45,44 L55,12 L65,44 L75,44',
    legs: () => [
      { optionType:'PE', transactionType:'SELL', stepsFromAtm:-2, qty:2 },
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm:-4, qty:1 },
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 2, qty:2 },
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 4, qty:1 },
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 0, qty:1 },
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm: 0, qty:1 },
    ],
  },
  {
    name: 'Double Plateau', category: 'Neutral', type: 'hedged',
    desc: 'Two profit zones around ATM. Profits in a moderate range, loss at extremes.',
    path: 'M5,44 L15,44 L22,12 L35,12 L45,44 L55,44 L62,12 L75,12',
    legs: () => [
      { optionType:'PE', transactionType:'SELL', stepsFromAtm:-1, qty:1 },
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm:-3, qty:1 },
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 1, qty:1 },
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 3, qty:1 },
    ],
  },
  {
    name: 'Jade Lizard', category: 'Neutral', type: 'hedged',
    desc: 'Sell OTM call spread + sell OTM put. Profit across a wide range. No upside risk if premium > spread width.',
    path: 'M5,44 L25,44 L40,10 L60,10 L75,22',
    legs: () => [
      { optionType:'PE', transactionType:'SELL', stepsFromAtm:-2, qty:1 },
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 2, qty:1 },
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 4, qty:1 },
    ],
  },
  {
    name: 'Reverse Jade Lizard', category: 'Neutral', type: 'hedged',
    desc: 'Buy OTM call + sell OTM put spread. No downside risk if premium collected > put spread width.',
    path: 'M5,22 L25,10 L45,10 L58,44 L75,44',
    legs: () => [
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 2, qty:1 },
      { optionType:'PE', transactionType:'SELL', stepsFromAtm:-2, qty:1 },
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm:-4, qty:1 },
    ],
  },

  // ─── Others ───────────────────────────────────────────────────────────────
  {
    name: 'Call Ratio Spread', category: 'Others', type: 'hedged',
    desc: 'Buy 1 lower call, sell 2 higher calls. Profits in a moderate upward move. Risk if market surges far above.',
    path: 'M5,44 L25,44 L40,10 L58,10 L75,38',
    legs: () => [
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 0, qty:1 },
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 2, qty:2 },
    ],
  },
  {
    name: 'Put Ratio Spread', category: 'Others', type: 'hedged',
    desc: 'Buy 1 higher put, sell 2 lower puts. Profits in a moderate downward move. Risk if market crashes far below.',
    path: 'M5,38 L20,10 L38,10 L55,44 L75,44',
    legs: () => [
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm: 0, qty:1 },
      { optionType:'PE', transactionType:'SELL', stepsFromAtm:-2, qty:2 },
    ],
  },
  {
    name: 'Long Straddle', category: 'Others', type: 'hedged',
    desc: 'Buy ATM call and put. Profit from a large move in either direction. Premium paid is the max loss.',
    path: 'M5,8 L40,44 L75,8',
    legs: () => [
      { optionType:'CE', transactionType:'BUY', stepsFromAtm: 0, qty:1 },
      { optionType:'PE', transactionType:'BUY', stepsFromAtm: 0, qty:1 },
    ],
  },
  {
    name: 'Long Iron Butterfly', category: 'Others', type: 'hedged',
    desc: 'Buy ATM straddle, sell OTM call and put. Profits from a large move. Loss is capped.',
    path: 'M5,10 L22,10 L40,44 L58,10 L75,10',
    legs: () => [
      { optionType:'PE', transactionType:'SELL', stepsFromAtm:-2, qty:1 },
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm: 0, qty:1 },
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 0, qty:1 },
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 2, qty:1 },
    ],
  },
  {
    name: 'Long Strangle', category: 'Others', type: 'hedged',
    desc: 'Buy OTM call and put. Profits from a large move in either direction. Cheaper than straddle.',
    path: 'M5,8 L25,44 L55,44 L75,8',
    legs: () => [
      { optionType:'CE', transactionType:'BUY', stepsFromAtm: 2, qty:1 },
      { optionType:'PE', transactionType:'BUY', stepsFromAtm:-2, qty:1 },
    ],
  },
  {
    name: 'Long Iron Condor', category: 'Others', type: 'hedged',
    desc: 'Buy strangle and sell a tighter strangle. Profits from a big move in either direction. Risk and reward both capped.',
    path: 'M5,10 L15,10 L25,38 L50,38 L62,10 L75,10',
    legs: () => [
      { optionType:'PE', transactionType:'BUY',  stepsFromAtm:-4, qty:1 },
      { optionType:'PE', transactionType:'SELL', stepsFromAtm:-2, qty:1 },
      { optionType:'CE', transactionType:'SELL', stepsFromAtm: 2, qty:1 },
      { optionType:'CE', transactionType:'BUY',  stepsFromAtm: 4, qty:1 },
    ],
  },
  {
    name: 'Strip', category: 'Others', type: 'hedged',
    desc: 'Buy 1 ATM call and 2 ATM puts. Profits from a large move but more from a downward move.',
    path: 'M5,6 L38,44 L75,16',
    legs: () => [
      { optionType:'CE', transactionType:'BUY', stepsFromAtm: 0, qty:1 },
      { optionType:'PE', transactionType:'BUY', stepsFromAtm: 0, qty:2 },
    ],
  },
  {
    name: 'Strap', category: 'Others', type: 'hedged',
    desc: 'Buy 2 ATM calls and 1 ATM put. Profits from a large move but more from an upward move.',
    path: 'M5,16 L40,44 L75,6',
    legs: () => [
      { optionType:'CE', transactionType:'BUY', stepsFromAtm: 0, qty:2 },
      { optionType:'PE', transactionType:'BUY', stepsFromAtm: 0, qty:1 },
    ],
  },
];

export const STRATEGY_CATEGORIES = ['Bullish', 'Bearish', 'Neutral', 'Others'];

// Badge colours for wizard result rows
export const STRATEGY_BADGE = {
  'Buy Call': { label:'BULL', color:'#10D9A0', bg:'rgba(16,217,160,0.15)' },
  'Sell Put':  { label:'BULL', color:'#10D9A0', bg:'rgba(16,217,160,0.15)' },
  'Bull Call Spread': { label:'BULL', color:'#10D9A0', bg:'rgba(16,217,160,0.15)' },
  'Bull Put Spread':  { label:'BULL', color:'#10D9A0', bg:'rgba(16,217,160,0.15)' },
  'Buy Put':   { label:'BEAR', color:'#F0566E', bg:'rgba(240,86,110,0.15)' },
  'Sell Call': { label:'SELL', color:'#F0566E', bg:'rgba(240,86,110,0.15)' },
  'Bear Call Spread': { label:'BEAR', color:'#F0566E', bg:'rgba(240,86,110,0.15)' },
  'Bear Put Spread':  { label:'BEAR', color:'#F0566E', bg:'rgba(240,86,110,0.15)' },
  'Short Straddle':   { label:'SELL', color:'#A78BFA', bg:'rgba(167,139,250,0.15)' },
  'Short Strangle':   { label:'SELL', color:'#A78BFA', bg:'rgba(167,139,250,0.15)' },
  'Iron Butterfly':   { label:'IRON', color:'#60A5FA', bg:'rgba(96,165,250,0.15)' },
  'Short Iron Condor':{ label:'IRON', color:'#60A5FA', bg:'rgba(96,165,250,0.15)' },
};
export function getBadge(name) {
  const b = STRATEGY_BADGE[name];
  if (b) return b;
  if (name.includes('Spread')) return { label:'SPRD', color:'#FFA53D', bg:'rgba(255,165,61,0.15)' };
  if (name.includes('Iron') || name.includes('Butterfly') || name.includes('Condor'))
    return { label:'IRON', color:'#60A5FA', bg:'rgba(96,165,250,0.15)' };
  return { label:'OPT', color:'#8A97B0', bg:'rgba(138,151,176,0.15)' };
}
