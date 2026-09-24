import type { OptionPnl } from "./desk";

const RATES = {
  brokerageCap: 20,
  brokeragePct: 0.0003,
  sttSellPct: 0.0015,
  sttExercisePct: 0.0015,
  exchangePct: 0.0003553,
  sebiPct: 0.000001,
  stampBuyPct: 0.00003,
  gstPct: 0.18,
};

const NOTE =
  "NSE F&O option estimate: brokerage ₹20/order or 0.03%, STT 0.15% on sell premium, exchange+IPFT 0.03553%, SEBI ₹10/crore, stamp 0.003% on buy, GST 18% on brokerage+exchange+SEBI.";

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  const [i, f = ""] = String(Math.abs(n)).replace(/,/g, "").split(".");
  return `${sign}${i || "0"}.${f.slice(0, 2).padEnd(2, "0")}`;
}

function brokerage(turnover: number): number {
  return Math.min(RATES.brokerageCap, turnover * RATES.brokeragePct);
}

function line(premium: number, qty: number, side: "BUY" | "SELL") {
  const turnover = Math.max(0, premium) * Math.max(1, qty);
  const brok = brokerage(turnover);
  const stt = side === "SELL" ? turnover * RATES.sttSellPct : 0;
  const exchange = turnover * RATES.exchangePct;
  const sebi = turnover * RATES.sebiPct;
  const stamp = side === "BUY" ? turnover * RATES.stampBuyPct : 0;
  const gst = (brok + exchange + sebi) * RATES.gstPct;
  const total = brok + stt + exchange + sebi + stamp + gst;
  return {
    brokerage: money(brok),
    stt: money(stt),
    exchange: money(exchange),
    sebi: money(sebi),
    stamp: money(stamp),
    gst: money(gst),
    total: money(total),
  };
}

export function clientOptionPnl(input: { entry: number; exit: number; qty: number }): OptionPnl {
  const qty = Math.max(1, Math.floor(input.qty));
  const buyNotional = input.entry * qty;
  const sellNotional = input.exit * qty;
  const buy = line(input.entry, qty, "BUY");
  const sell = line(input.exit, qty, "SELL");
  const chargesTotal = Number(buy.total) + Number(sell.total);
  const gross = sellNotional - buyNotional;
  return {
    qty,
    entry: money(input.entry),
    exit: money(input.exit),
    buyNotional: money(buyNotional),
    sellNotional: money(sellNotional),
    gross: money(gross),
    charges: { buy, sell, total: money(chargesTotal), note: NOTE },
    net: money(gross - chargesTotal),
  };
}

/** Sell now, buy back at exit (short / write). exerciseIntrinsic adds writer STT when the option expires ITM. */
export function clientOptionPnlShort(input: { entry: number; exit: number; qty: number; exerciseIntrinsic?: number }): OptionPnl {
  const qty = Math.max(1, Math.floor(input.qty));
  const sellNotional = input.entry * qty;
  const buyNotional = input.exit * qty;
  const sell = line(input.entry, qty, "SELL");
  const buy = line(input.exit, qty, "BUY");
  const exercised = Math.max(0, input.exerciseIntrinsic ?? 0) * qty * RATES.sttExercisePct;
  const chargesTotal = Number(buy.total) + Number(sell.total) + exercised;
  const gross = sellNotional - buyNotional;
  return {
    qty,
    entry: money(input.entry),
    exit: money(input.exit),
    buyNotional: money(buyNotional),
    sellNotional: money(sellNotional),
    gross: money(gross),
    charges: { buy, sell, total: money(chargesTotal), note: NOTE },
    net: money(gross - chargesTotal),
  };
}
