import {
  AppError,
  type BrokerConnectionStatus,
  type BrokerProfile,
  type BrokerReadClient,
  type Funds,
  type Holding,
  type PositionSnapshot,
} from "@xtrader/domain";
import type { ZerodhaAuthService } from "./auth-service.js";
import { mapFunds, mapHoldings, mapPositions } from "./auth-service.js";
import type { KiteGateway } from "./kite-gateway.js";

export class ZerodhaReadAdapter implements BrokerReadClient {
  constructor(
    private readonly auth: ZerodhaAuthService,
    private readonly kite: KiteGateway,
  ) {}

  private async token(): Promise<string> {
    const access = await this.auth.getAccessToken();
    if (!access) throw new AppError("BROKER_DISCONNECTED", "Zerodha is not connected", 401);
    return access.token;
  }

  async getStatus(): Promise<BrokerConnectionStatus> {
    return this.auth.status() as Promise<BrokerConnectionStatus>;
  }

  async getProfile(): Promise<BrokerProfile> {
    const access = await this.auth.getAccessToken();
    if (!access) throw new AppError("BROKER_DISCONNECTED", "Zerodha is not connected", 401);
    const profile = await this.kite.getProfile(access.token);
    await this.auth.markValidated(access.accountId);
    return {
      broker: "zerodha",
      clientId: profile.user_id,
      userName: profile.user_name ?? profile.user_id,
      email: profile.email,
      exchanges: profile.exchanges ?? [],
      products: profile.products ?? [],
    };
  }

  async getFunds(): Promise<Funds> {
    const token = await this.token();
    const margins = await this.kite.getMargins(token);
    return mapFunds(margins);
  }

  async getHoldings(): Promise<Holding[]> {
    const token = await this.token();
    const holdings = await this.kite.getHoldings(token);
    return mapHoldings(holdings);
  }

  async getPositions(): Promise<PositionSnapshot[]> {
    const token = await this.token();
    const positions = await this.kite.getPositions(token);
    return mapPositions(positions);
  }
}
