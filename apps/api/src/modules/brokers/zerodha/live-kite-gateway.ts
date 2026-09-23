import { KiteConnect } from "kiteconnect";
import { AppError } from "@xtrader/domain";
import type { KiteGateway, KiteProfile, KiteSession } from "./kite-gateway.js";
import type { KiteCredentialsVault } from "./credentials-vault.js";

export class LiveKiteGateway implements KiteGateway {
  constructor(private readonly vault: KiteCredentialsVault) {}

  private async creds() {
    const c = await this.vault.get();
    if (!c?.apiKey || !c.apiSecret) {
      throw new AppError("KITE_NOT_CONFIGURED", "Add your Zerodha API key and secret first", 503);
    }
    return c;
  }

  private async client(accessToken?: string) {
    const { apiKey } = await this.creds();
    const kc = new KiteConnect({ api_key: apiKey });
    if (accessToken) kc.setAccessToken(accessToken);
    return kc;
  }

  async loginUrl(redirectParams?: string): Promise<string> {
    const base = (await this.client()).getLoginURL();
    if (!redirectParams) return base;
    const url = new URL(base);
    url.searchParams.set("redirect_params", redirectParams);
    return url.toString();
  }

  async generateSession(requestToken: string): Promise<KiteSession> {
    const { apiSecret } = await this.creds();
    const session = await (await this.client()).generateSession(requestToken, apiSecret);
    return session as KiteSession;
  }

  async invalidateAccessToken(accessToken: string): Promise<void> {
    await (await this.client(accessToken)).invalidateAccessToken(accessToken);
  }

  async getProfile(accessToken: string): Promise<KiteProfile> {
    return (await (await this.client(accessToken)).getProfile()) as KiteProfile;
  }

  async getMargins(accessToken: string) {
    return (await (await this.client(accessToken)).getMargins()) as {
      equity?: { net?: number; available?: { live_balance?: number; cash?: number; collateral?: number }; utilised?: { debits?: number } };
      commodity?: { net?: number; available?: { live_balance?: number } };
    };
  }

  async getHoldings(accessToken: string): Promise<unknown[]> {
    return (await (await this.client(accessToken)).getHoldings()) as unknown[];
  }

  async getPositions(accessToken: string) {
    return (await (await this.client(accessToken)).getPositions()) as { net?: unknown[]; day?: unknown[] };
  }

  async getInstruments(accessToken: string, exchange?: string): Promise<unknown[]> {
    const kc = await this.client(accessToken);
    if (exchange) return (await kc.getInstruments(exchange as never)) as unknown[];
    return (await kc.getInstruments()) as unknown[];
  }

  async getQuote(accessToken: string, instruments: string[]) {
    return (await (await this.client(accessToken)).getQuote(instruments)) as Record<string, never>;
  }

  async getLTP(accessToken: string, instruments: string[]) {
    return (await (await this.client(accessToken)).getLTP(instruments)) as Record<string, { last_price?: number }>;
  }

  async getHistoricalData(accessToken: string, instrumentToken: string, interval: string, from: Date, to: Date) {
    const rows = (await (await this.client(accessToken)).getHistoricalData(
      Number(instrumentToken),
      interval as "5minute" | "minute" | "15minute" | "60minute" | "day",
      from,
      to,
    )) as Array<{ date: Date | string; open: number; high: number; low: number; close: number; volume: number }>;
    return rows;
  }

  async placeOrder(accessToken: string, variety: string, params: Record<string, unknown>) {
    const result = (await (await this.client(accessToken)).placeOrder(variety as never, params as never)) as { order_id: string };
    return result;
  }

  async modifyOrder(accessToken: string, variety: string, orderId: string, params: Record<string, unknown>) {
    return (await (await this.client(accessToken)).modifyOrder(variety as never, orderId, params as never)) as { order_id: string };
  }

  async cancelOrder(accessToken: string, variety: string, orderId: string) {
    return (await (await this.client(accessToken)).cancelOrder(variety as never, orderId)) as { order_id: string };
  }

  async getOrders(accessToken: string): Promise<unknown[]> {
    return (await (await this.client(accessToken)).getOrders()) as unknown[];
  }
}
