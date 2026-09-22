import type { ConnectionStatus, DataSource, ExecutionMode } from "./enums.js";
import type { DecimalString } from "./money.js";
import type { InstrumentRef } from "./intent.js";

export interface BrokerConnectionStatus {
  broker: string;
  status: ConnectionStatus;
  clientId?: string;
  lastValidatedAt?: string;
  lastError?: string;
  expiresAt?: string;
}

export interface BrokerProfile {
  broker: string;
  clientId: string;
  userName: string;
  email?: string;
  exchanges: string[];
  products: string[];
}

export interface Funds {
  equity: {
    available: DecimalString;
    usedMargin: DecimalString;
    openingBalance?: DecimalString;
    collateral?: DecimalString;
  };
  commodity?: {
    available: DecimalString;
    usedMargin: DecimalString;
  };
  asOf: string;
}

export interface Holding {
  instrument: InstrumentRef;
  quantity: DecimalString;
  averagePrice: DecimalString;
  lastPrice?: DecimalString;
  pnl?: DecimalString;
  product?: string;
}

export interface PositionSnapshot {
  instrument: InstrumentRef;
  product: string;
  quantity: DecimalString;
  averagePrice: DecimalString;
  lastPrice?: DecimalString;
  pnl?: DecimalString;
  overnightQuantity?: DecimalString;
  dayQuantity?: DecimalString;
}

export interface Quote {
  instrument: InstrumentRef;
  lastPrice: DecimalString;
  open?: DecimalString;
  high?: DecimalString;
  low?: DecimalString;
  close?: DecimalString;
  volume?: DecimalString;
  bid?: DecimalString;
  ask?: DecimalString;
  exchangeTimestamp?: string;
  receivedAt: string;
  source: DataSource;
}

export interface Tick {
  instrumentId: string;
  brokerInstrumentToken: string;
  symbol: string;
  exchange: string;
  lastPrice: DecimalString;
  exchangeTimestamp?: string;
  lastTradeTimestamp?: string;
  receivedAt: string;
  cumulativeDayVolume?: DecimalString;
  buyQuantity?: DecimalString;
  sellQuantity?: DecimalString;
  ohlc?: {
    open: DecimalString;
    high: DecimalString;
    low: DecimalString;
    previousClose: DecimalString;
  };
  depth?: unknown;
  source: DataSource;
}

export interface Instrument {
  instrumentId: string;
  brokerInstrumentToken: string;
  exchange: string;
  symbol: string;
  name: string;
  instrumentType: string;
  tickSize: DecimalString;
  lotSize: number;
  tradable: boolean;
}

export interface BrokerOrderRequest {
  exchange: string;
  symbol: string;
  transactionType: "BUY" | "SELL";
  quantity: number;
  orderType: "MARKET" | "LIMIT" | "SL" | "SL-M";
  product: "MIS" | "CNC" | "NRML";
  price?: DecimalString;
  triggerPrice?: DecimalString;
  validity?: "DAY" | "IOC";
  tag?: string;
  marketProtection?: number;
}

export interface BrokerOrder {
  brokerOrderId: string;
  status: string;
  exchange: string;
  symbol: string;
  quantity: number;
  filledQuantity: number;
  pendingQuantity: number;
  price?: DecimalString;
  averagePrice?: DecimalString;
  rawStatus?: string;
}

export interface OrderAcknowledgement {
  brokerOrderId: string;
  status: string;
}

export interface ApprovedTrade {
  approvalId: string;
  intentId: string;
  accountId: string;
  executionMode: ExecutionMode;
  instrument: InstrumentRef;
  direction: "LONG" | "SHORT";
  quantity: number;
  entryType: "MARKET" | "LIMIT";
  entryPrice: DecimalString;
  stopLoss: DecimalString;
  targets: DecimalString[];
  expiresAt: string;
  idempotencyKey: string;
}

export interface ApprovedCancellation {
  approvalId: string;
  orderId: string;
  reason: string;
}

export interface ExecutionAcknowledgement {
  attemptId: string;
  status: string;
  brokerOrderId?: string;
  message?: string;
}

export interface ReconciliationResult {
  matched: number;
  discrepancies: Array<{ code: string; detail: string }>;
}

export interface BrokerReadClient {
  getStatus(): Promise<BrokerConnectionStatus>;
  getProfile(): Promise<BrokerProfile>;
  getFunds(): Promise<Funds>;
  getPositions(): Promise<PositionSnapshot[]>;
  getHoldings(): Promise<Holding[]>;
}

export interface BrokerMarketDataClient {
  getInstruments(): Promise<Instrument[]>;
  getQuotes(instruments: InstrumentRef[]): Promise<Quote[]>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(instruments: InstrumentRef[]): Promise<void>;
  unsubscribe(instruments: InstrumentRef[]): Promise<void>;
}

export interface BrokerOrderClient {
  getOrders(): Promise<BrokerOrder[]>;
  placeOrder(order: BrokerOrderRequest): Promise<OrderAcknowledgement>;
  modifyOrder(id: string, change: Partial<BrokerOrderRequest>): Promise<OrderAcknowledgement>;
  cancelOrder(id: string): Promise<OrderAcknowledgement>;
}

export interface ExecutionAdapter {
  submit(trade: ApprovedTrade): Promise<ExecutionAcknowledgement>;
  cancel(action: ApprovedCancellation): Promise<ExecutionAcknowledgement>;
  reconcile(): Promise<ReconciliationResult>;
}
