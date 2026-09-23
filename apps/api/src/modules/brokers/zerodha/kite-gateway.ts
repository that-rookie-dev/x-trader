export interface KiteSession {
  user_id: string;
  user_name?: string;
  email?: string;
  exchanges?: string[];
  products?: string[];
  access_token: string;
  login_time?: string;
}

export interface KiteProfile {
  user_id: string;
  user_name?: string;
  email?: string;
  exchanges?: string[];
  products?: string[];
  broker?: string;
}

export interface KiteMarginSegment {
  net?: number;
  available?: { live_balance?: number; cash?: number; collateral?: number };
  utilised?: { debits?: number; m2m_unrealised?: number };
}

export interface KiteQuote {
  instrument_token?: number;
  last_price?: number;
  volume?: number;
  oi?: number;
  average_price?: number;
  ohlc?: { open?: number; high?: number; low?: number; close?: number };
  depth?: { buy?: Array<{ price: number; quantity: number }>; sell?: Array<{ price: number; quantity: number }> };
  timestamp?: string;
  last_trade_time?: string;
}

export interface KiteGateway {
  loginUrl(redirectParams?: string): string | Promise<string>;
  generateSession(requestToken: string): Promise<KiteSession>;
  invalidateAccessToken(accessToken: string): Promise<void>;
  getProfile(accessToken: string): Promise<KiteProfile>;
  getMargins(accessToken: string): Promise<{ equity?: KiteMarginSegment; commodity?: KiteMarginSegment }>;
  getHoldings(accessToken: string): Promise<unknown[]>;
  getPositions(accessToken: string): Promise<{ net?: unknown[]; day?: unknown[] }>;
  getInstruments(accessToken: string, exchange?: string): Promise<unknown[]>;
  getQuote(accessToken: string, instruments: string[]): Promise<Record<string, KiteQuote>>;
  getLTP(accessToken: string, instruments: string[]): Promise<Record<string, { last_price?: number; instrument_token?: number }>>;
  getHistoricalData(
    accessToken: string,
    instrumentToken: string,
    interval: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ date: Date | string; open: number; high: number; low: number; close: number; volume: number }>>;
  placeOrder(accessToken: string, variety: string, params: Record<string, unknown>): Promise<{ order_id: string }>;
  modifyOrder(accessToken: string, variety: string, orderId: string, params: Record<string, unknown>): Promise<{ order_id: string }>;
  cancelOrder(accessToken: string, variety: string, orderId: string): Promise<{ order_id: string }>;
  getOrders(accessToken: string): Promise<unknown[]>;
}
