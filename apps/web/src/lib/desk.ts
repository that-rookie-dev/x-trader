export type PlainIdea = {
  lane: "FNO" | "CASH";
  kind: "CE" | "PE" | "FUT" | "EQ";
  action: "BUY" | "SELL" | "HOLD";
  contract: string;
  exchange: string;
  label: string;
  title: string;
  why: string;
  when: string | null;
  premium?: string | null;
  stop?: string | null;
  target?: string | null;
  instrumentType: "EQUITY" | "OPTION" | "FUTURE";
  canPaper: boolean;
  lastPrice?: string;
};

export type AgentMark = "BUY" | "SELL" | "NO_BUY" | "WAIT";

export type ChargeLine = {
  brokerage: string;
  stt: string;
  exchange: string;
  sebi: string;
  stamp: string;
  gst: string;
  total: string;
};

export type OptionPnl = {
  qty: number;
  entry: string;
  exit: string;
  buyNotional: string;
  sellNotional: string;
  gross: string;
  charges: { buy: ChargeLine; sell: ChargeLine; total: string; note: string };
  net: string;
};

export type ChainLeg = {
  symbol: string;
  exchange?: string;
  lastPrice: string | null;
  prevPrice: string | null;
  change: number | null;
  mark: AgentMark;
  why: string;
  canPaper: boolean;
  lotSize?: number;
  eodPremium?: string;
  moneyness?: "ITM" | "ATM" | "OTM";
  eodMoneyness?: "ITM" | "ATM" | "OTM";
  pnl?: OptionPnl;
};

export type ChainRow = {
  strike: number;
  atm: boolean;
  ce: ChainLeg | null;
  pe: ChainLeg | null;
};

export type OptionsBoard = {
  symbol: string;
  exchange: string;
  expiry: string | null;
  expiryLabel: string;
  lastPrice: string;
  change: number | null;
  atm: number | null;
  trust: number;
  stance: string;
  bias: string;
  eod?: { close: string; low: string; high: string; note: string };
  levels?: { supports: string[]; resistances: string[]; magnet: string };
  session?: { expectedLow: string; expectedHigh: string; magnet: string; pull?: number };
  ai?: {
    close: string;
    low: string;
    high: string;
    note: string;
    direction: string;
    confidence: number;
    why: string;
    catalysts: string[];
    peStrike: number | null;
    ceStrike: number | null;
    studiedAt: string;
    skip: boolean;
  } | null;
  aiError?: string | null;
  compare?: { agree: boolean; delta: string; tag?: string; hint?: string } | null;
  aiPick?: { kind: "CE" | "PE"; strike: number | null } | null;
  future: { symbol: string; exchange?: string; lastPrice: string | null; mark: AgentMark; why: string; canPaper: boolean } | null;
  rows: ChainRow[];
  buys: PlainIdea[];
  sells: PlainIdea[];
  paperMode: boolean;
};

export type OptionsAdvice = {
  symbol: string;
  exchange: string;
  expiry: string | null;
  expiryLabel: string;
  lastPrice: string;
  trust: number;
  stance: string;
  ideas: PlainIdea[];
  wait: boolean;
  paperMode: boolean;
};

export type StocksDesk = {
  buys: PlainIdea[];
  sells: PlainIdea[];
  paperMode: boolean;
};

export type QuoteTick = {
  exchange: string;
  symbol: string;
  lastPrice: string | null;
  prevPrice: string | null;
  change: number | null;
};
