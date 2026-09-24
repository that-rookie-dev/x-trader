import { desc, eq } from "drizzle-orm";
import { money } from "@xtrader/domain";
import type { Database } from "../../db/client.js";
import { volHistory } from "../../db/schema.js";
import { blackScholesIv, hv, ivRank } from "../indicators/index.js";

export type VolSnapshot = {
  ivAtm: number | null;
  hv20: number | null;
  hv60: number | null;
  ivRank: number | null;
  rich: boolean;
  preferBuyPremium: boolean;
};

export function yearsToExpiry(expiry: string | null, now = new Date()): number {
  if (!expiry) return 3 / 365;
  const end = new Date(`${expiry}T15:30:00+05:30`);
  const ms = end.getTime() - now.getTime();
  return Math.max(ms / (365.25 * 24 * 60 * 60 * 1000), 1 / 365);
}

export function invertAtmIv(input: {
  spot: number;
  strike: number;
  expiry: string | null;
  callMid?: number | null;
  putMid?: number | null;
  now?: Date;
}): number | null {
  const t = yearsToExpiry(input.expiry, input.now);
  const call = input.callMid != null && input.callMid > 0
    ? blackScholesIv(input.callMid, input.spot, input.strike, t, "CE")
    : null;
  const put = input.putMid != null && input.putMid > 0
    ? blackScholesIv(input.putMid, input.spot, input.strike, t, "PE")
    : null;
  if (call != null && put != null) return (call + put) / 2;
  return call ?? put;
}

export function richPremium(ivAtm: number | null, hv20: number | null): boolean {
  if (ivAtm == null || hv20 == null || hv20 <= 0) return false;
  return ivAtm > hv20 * 1.25;
}

export function preferBuyPremium(ivAtm: number | null, hv20: number | null): boolean {
  if (ivAtm == null || hv20 == null || hv20 <= 0) return false;
  return ivAtm < hv20;
}

export async function snapshotVol(
  db: Database,
  input: {
    symbol: string;
    spot: number;
    strike: number | null;
    expiry: string | null;
    callMid?: number | null;
    putMid?: number | null;
    dailyCloses: number[];
    now?: Date;
  },
): Promise<VolSnapshot> {
  const hv20 = hv(input.dailyCloses, 20);
  const hv60 = hv(input.dailyCloses, 60);
  const ivAtm =
    input.strike != null && input.spot > 0
      ? invertAtmIv({
          spot: input.spot,
          strike: input.strike,
          expiry: input.expiry,
          callMid: input.callMid,
          putMid: input.putMid,
          now: input.now,
        })
      : null;
  const today = (input.now ?? new Date()).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  if (ivAtm != null) {
    await db
      .insert(volHistory)
      .values({
        symbol: input.symbol,
        sessionDate: today,
        ivAtm: String(ivAtm),
        hv20: hv20 != null ? String(hv20) : null,
        hv60: hv60 != null ? String(hv60) : null,
      })
      .onConflictDoUpdate({
        target: [volHistory.symbol, volHistory.sessionDate],
        set: {
          ivAtm: String(ivAtm),
          hv20: hv20 != null ? String(hv20) : null,
          hv60: hv60 != null ? String(hv60) : null,
        },
      });
  }
  const rows = await db.select().from(volHistory).where(eq(volHistory.symbol, input.symbol)).orderBy(desc(volHistory.sessionDate)).limit(252);
  const history = rows.map((row) => Number(row.ivAtm)).filter((n) => Number.isFinite(n) && n > 0);
  const rank = ivAtm != null ? ivRank(ivAtm, history) : null;
  return {
    ivAtm,
    hv20,
    hv60,
    ivRank: rank,
    rich: richPremium(ivAtm, hv20),
    preferBuyPremium: preferBuyPremium(ivAtm, hv20),
  };
}

export function volWhy(vol: VolSnapshot): string[] {
  const lines: string[] = [];
  if (vol.ivAtm != null && vol.hv20 != null) {
    lines.push(`IV ${money(vol.ivAtm * 100, 1)}% vs HV20 ${money(vol.hv20 * 100, 1)}%`);
  }
  if (vol.ivRank != null) lines.push(`IV rank ${(vol.ivRank * 100).toFixed(0)}`);
  if (vol.rich) lines.push("Premium is rich vs realized vol — no new buy.");
  if (vol.preferBuyPremium) lines.push("IV cheap vs HV — buying premium is allowed.");
  return lines;
}

export function adxAgainstKind(
  adx: { adx: number; plusDi: number; minusDi: number } | null | undefined,
  kind: "CE" | "PE",
): boolean {
  if (!adx || adx.adx < 25) return false;
  if (kind === "CE" && adx.minusDi > adx.plusDi) return true;
  if (kind === "PE" && adx.plusDi > adx.minusDi) return true;
  return false;
}
