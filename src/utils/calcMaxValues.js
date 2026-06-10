// Shared utility — calcMaxLoss and calcMaxProfit
// Handles standard spreads, condors, iron condors, debit and credit strategies

export function calcMaxLoss(position) {
  const { legs } = position;
  if (!legs || legs.length < 2) return null;
  const sells = legs.filter(l => l.transactionType === 'SELL');
  const buys  = legs.filter(l => l.transactionType === 'BUY');
  if (!buys.length) return null;

  const ref = sells[0] || buys[0];
  const lotSize = ref.lotSize || 1;
  const lots    = ref.quantity || 1;
  const net     = position.netPremiumCollected;

  const pe_sells = sells.filter(l => l.optionType === 'PE').sort((a,b) => a.strike - b.strike);
  const pe_buys  = buys.filter(l => l.optionType === 'PE').sort((a,b) => a.strike - b.strike);
  const ce_sells = sells.filter(l => l.optionType === 'CE').sort((a,b) => a.strike - b.strike);
  const ce_buys  = buys.filter(l => l.optionType === 'CE').sort((a,b) => a.strike - b.strike);

  let grossWidth = 0;

  // Standard spread: 1 sell + 1 buy
  if (pe_sells.length === 1 && pe_buys.length === 1)
    grossWidth = Math.max(grossWidth, Math.abs(pe_sells[0].strike - pe_buys[0].strike) * lotSize * lots);
  if (ce_sells.length === 1 && ce_buys.length === 1)
    grossWidth = Math.max(grossWidth, Math.abs(ce_sells[0].strike - ce_buys[0].strike) * lotSize * lots);

  // Condor: 2 sells + 2 buys — max loss is the wing width
  if (pe_sells.length >= 2 && pe_buys.length >= 2) {
    const lowerWing = Math.abs(pe_sells[0].strike - pe_buys[0].strike) * lotSize * lots;
    const upperWing = Math.abs(pe_buys[pe_buys.length-1].strike - pe_sells[pe_sells.length-1].strike) * lotSize * lots;
    grossWidth = Math.max(grossWidth, Math.max(lowerWing, upperWing));
  }
  if (ce_sells.length >= 2 && ce_buys.length >= 2) {
    const lowerWing = Math.abs(ce_sells[0].strike - ce_buys[0].strike) * lotSize * lots;
    const upperWing = Math.abs(ce_buys[ce_buys.length-1].strike - ce_sells[ce_sells.length-1].strike) * lotSize * lots;
    grossWidth = Math.max(grossWidth, Math.max(lowerWing, upperWing));
  }

  // Mixed legs (different counts)
  if (pe_sells.length >= 1 && pe_buys.length >= 1 && pe_buys.length !== pe_sells.length)
    grossWidth = Math.max(grossWidth, Math.abs(pe_sells[pe_sells.length-1].strike - pe_buys[0].strike) * lotSize * lots);
  if (ce_sells.length >= 1 && ce_buys.length >= 1 && ce_buys.length !== ce_sells.length)
    grossWidth = Math.max(grossWidth, Math.abs(ce_sells[0].strike - ce_buys[ce_buys.length-1].strike) * lotSize * lots);

  if (!grossWidth) return null;
  return net >= 0 ? grossWidth - net : Math.abs(net);
}

export function calcMaxProfit(position) {
  const net = position.netPremiumCollected;
  if (net >= 0) return net;
  const { legs } = position;
  if (!legs || legs.length < 2) return Math.abs(net);
  const sells = legs.filter(l => l.transactionType === 'SELL');
  const buys  = legs.filter(l => l.transactionType === 'BUY');
  const ref = sells[0] || buys[0];
  const lotSize = ref?.lotSize || 1;
  const lots = ref?.quantity || 1;
  const ce_sells = sells.filter(l => l.optionType === 'CE').sort((a,b) => a.strike - b.strike);
  const ce_buys  = buys.filter(l => l.optionType === 'CE').sort((a,b) => a.strike - b.strike);
  const pe_sells = sells.filter(l => l.optionType === 'PE').sort((a,b) => a.strike - b.strike);
  const pe_buys  = buys.filter(l => l.optionType === 'PE').sort((a,b) => a.strike - b.strike);
  let wingWidth = 0;
  if (ce_sells.length >= 1 && ce_buys.length >= 1)
    wingWidth = Math.max(wingWidth, Math.abs(ce_sells[0].strike - ce_buys[0].strike) * lotSize * lots);
  if (pe_sells.length >= 1 && pe_buys.length >= 1)
    wingWidth = Math.max(wingWidth, Math.abs(pe_sells[0].strike - pe_buys[0].strike) * lotSize * lots);
  return wingWidth > 0 ? wingWidth - Math.abs(net) : Math.abs(net);
}
