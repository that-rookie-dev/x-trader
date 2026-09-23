import { d, money } from "@xtrader/domain";

/** Zerodha-style NSE F&O option charges. Rates are published-style estimates. */
export const OPTION_CHARGE_RATES = {
  brokerageCap: 20,
  brokeragePct: 0.0003,
  sttSellPct: 0.001,
  exchangePct: 0.0003503,
  sebiPct: 0.000001,
  stampBuyPct: 0.00003,
  gstPct: 0.18,
};

export type ChargeLine = {
  brokerage: string;
  stt: string;
  exchange: string;
  sebi: string;
  stamp: string;
  gst: string;
  total: string;
};

export type OptionRoundTrip = {
  buy: ChargeLine;
  sell: ChargeLine;
  total: string;
  note: string;
};

function brokerage(premiumTurnover: number): number {
  return Math.min(OPTION_CHARGE_RATES.brokerageCap, premiumTurnover * OPTION_CHARGE_RATES.brokeragePct);
}

function line(input: { premium: number; qty: number; side: "BUY" | "SELL" }): ChargeLine {
  const turnover = Math.max(0, input.premium) * Math.max(1, input.qty);
  const brok = brokerage(turnover);
  const stt = input.side === "SELL" ? turnover * OPTION_CHARGE_RATES.sttSellPct : 0;
  const exchange = turnover * OPTION_CHARGE_RATES.exchangePct;
  const sebi = turnover * OPTION_CHARGE_RATES.sebiPct;
  const stamp = input.side === "BUY" ? turnover * OPTION_CHARGE_RATES.stampBuyPct : 0;
  const gst = (brok + exchange + sebi) * OPTION_CHARGE_RATES.gstPct;
  const total = brok + stt + exchange + sebi + stamp + gst;
  return {
    brokerage: money(brok, 2),
    stt: money(stt, 2),
    exchange: money(exchange, 2),
    sebi: money(sebi, 2),
    stamp: money(stamp, 2),
    gst: money(gst, 2),
    total: money(total, 2),
  };
}

export function optionRoundTrip(input: { buyPremium: number; sellPremium: number; qty: number }): OptionRoundTrip {
  const buy = line({ premium: input.buyPremium, qty: input.qty, side: "BUY" });
  const sell = line({ premium: input.sellPremium, qty: input.qty, side: "SELL" });
  return {
    buy,
    sell,
    total: money(d(buy.total).plus(sell.total), 2),
    note: "NSE F&O option estimate: brokerage ₹20/order or 0.03%, STT 0.1% on sell premium, exchange 0.03503%, SEBI ₹10/crore, stamp 0.003% on buy, GST 18% on brokerage+exchange+SEBI.",
  };
}

export function optionPnl(input: { entry: number; exit: number; qty: number }): {
  qty: number;
  entry: string;
  exit: string;
  buyNotional: string;
  sellNotional: string;
  gross: string;
  charges: OptionRoundTrip;
  net: string;
} {
  const qty = Math.max(1, Math.floor(input.qty));
  const buyNotional = input.entry * qty;
  const sellNotional = input.exit * qty;
  const charges = optionRoundTrip({ buyPremium: input.entry, sellPremium: input.exit, qty });
  const gross = sellNotional - buyNotional;
  const net = gross - Number(charges.total);
  return {
    qty,
    entry: money(input.entry, 2),
    exit: money(input.exit, 2),
    buyNotional: money(buyNotional, 2),
    sellNotional: money(sellNotional, 2),
    gross: money(gross, 2),
    charges,
    net: money(net, 2),
  };
}

/** Sell premium now, buy back at EOD (write / short). */
export function optionPnlShort(input: { entry: number; exit: number; qty: number }): ReturnType<typeof optionPnl> {
  const qty = Math.max(1, Math.floor(input.qty));
  const sellNotional = input.entry * qty;
  const buyNotional = input.exit * qty;
  const charges = optionRoundTrip({ buyPremium: input.exit, sellPremium: input.entry, qty });
  const gross = sellNotional - buyNotional;
  const net = gross - Number(charges.total);
  return {
    qty,
    entry: money(input.entry, 2),
    exit: money(input.exit, 2),
    buyNotional: money(buyNotional, 2),
    sellNotional: money(sellNotional, 2),
    gross: money(gross, 2),
    charges,
    net: money(net, 2),
  };
}
