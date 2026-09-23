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
  horizon?: "SWING" | "POSITION" | "INTRADAY";
  rsVsNifty?: number | null;
  atrStop?: string | null;
  rank?: number | null;
  edge?: string | null;
};

export type AgentMark = "BUY" | "SELL" | "NO_BUY" | "WAIT" | "CLOSED";

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
  shortPnl?: OptionPnl;
  heldSide?: "LONG" | "SHORT" | null;
  oi?: number | null;
  volume?: number | null;
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
  eodAi?: { close: string; low: string; high: string; note: string };
  activeClose?: string | number | null;
  predictionMode?: "ALGO" | "AI";
  aiReady?: boolean;
  learning?: {
    algo: { mae: number | null; hitRate: number | null; lastTuned: string | null; delta: Record<string, number> };
    ai: { mae: number | null; hitRate: number | null; lastTuned: string | null; delta: Record<string, number> };
  } | null;
  levels?: { supports: string[]; resistances: string[]; magnet: string };
  session?: { expectedLow: string; expectedHigh: string; magnet: string; pull?: number; invalidation?: string };
  desk?: {
    votes: Array<{ name: string; vote: number; detail: string }>;
    vwap: string | null;
    orbHigh: string | null;
    orbLow: string | null;
    pcr: number | null;
    maxPain: number | null;
    clock: string;
    ivRank?: number | null;
    ivAtm?: number | null;
    hv20?: number | null;
    adx?: number | null;
  };
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
  plays?: Play[];
  paramsVersion?: number | null;
  marketClosed?: boolean;
  predictionScore?: {
    predicted: number;
    actual: number | null;
    errorPct: number | null;
    kind: string;
    status: string;
  } | null;
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
};

export type StocksDesk = {
  buys: PlainIdea[];
  sells: PlainIdea[];
  today?: PlainIdea[];
  plays?: Play[];
};

export type PlayStatus = "OPEN" | "DISMISSED" | "FILLED" | "PARTIAL" | "MISSED" | "EXPIRED";

export type Play = {
  id: string;
  at: string;
  lane: "FNO" | "CASH";
  side: "CE" | "PE" | "EQ" | "FUT";
  contract: string;
  exchange: string;
  underlying: string;
  expiry: string | null;
  status: PlayStatus;
  entryZone: string;
  stop: string;
  targets: string[];
  holdUntil: string;
  invalidation: string;
  edgeAfterCost: string | null;
  confidence: number;
  regime: string;
  why: string[];
  eodSpot?: string | null;
  eodPremium?: string | null;
  pcr?: number | null;
  ivRank?: number | null;
  thetaNote?: string | null;
  horizon?: string;
  rsVsNifty?: number | null;
  atrStop?: string | null;
  rank?: number | null;
  dismissedAt?: string | null;
  brokerOrderId?: string | null;
  fillQty?: number | null;
  fillPx?: string | null;
  expectancyNote?: string | null;
};

export type QuoteTick = {
  exchange: string;
  symbol: string;
  lastPrice: string | null;
  prevPrice: string | null;
  change: number | null;
  oi?: number | null;
  volume?: number | null;
};

export type AlgoSignal = {
  id: string;
  at: string;
  underlying: string;
  expiry: string;
  contract: string;
  kind: string;
  strike: string;
  fromMark: string;
  toMark: string;
  why: string;
  spot: string | null;
  premium: string | null;
  net: string | null;
};
