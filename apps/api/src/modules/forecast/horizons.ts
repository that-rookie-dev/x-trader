import { money } from "@xtrader/domain";

export const HORIZON_IDS = ["5m", "15m", "30m", "1h", "4h", "6h", "eod"] as const;
export type HorizonId = (typeof HORIZON_IDS)[number];

const MINUTES: Record<Exclude<HorizonId, "eod">, number> = {
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "6h": 360,
};

export type HorizonView = {
  id: HorizonId;
  label: string;
  targetAt: string;
  clamped: boolean;
  close: string;
  low: string;
  high: string;
  abstain: boolean;
  /** Short holds must clear a higher cost hurdle. */
  floorScale: number;
  /** Spot used when this path was built. The chart adds the live move on top. */
  anchor: string;
  samples?: number;
  within?: number | null;
};

function istParts(now: Date): { date: string; minutes: number } {
  const date = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return { date, minutes: hour * 60 + minute };
}

function closeAt(date: string): Date {
  return new Date(`${date}T15:30:00+05:30`);
}

function clockLabel(at: Date): string {
  return at.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function horizonTarget(now: Date, id: HorizonId): { at: Date; clamped: boolean; label: string } {
  const { date, minutes } = istParts(now);
  const close = closeAt(date);
  if (id === "eod") return { at: close, clamped: false, label: "EOD" };
  const at = new Date(now.getTime() + MINUTES[id] * 60 * 1000);
  if (at.getTime() >= close.getTime() || minutes >= 15 * 60 + 30) {
    return { at: close, clamped: true, label: "EOD" };
  }
  return { at, clamped: false, label: `by ${clockLabel(at)}` };
}

/** Expected price at this horizon. A Brownian bridge: the Algo or AI cash-close call is the terminal value, and the price expected along the way is the straight path from the live print to that close. The band still widens with the square root of time. */
export function horizonSpot(input: {
  last: number;
  eodClose: number;
  eodLow: number;
  eodHigh: number;
  minutesToTarget: number;
  minutesToClose: number;
}): { close: number; low: number; high: number } {
  const span = Math.max(input.minutesToClose, 1);
  const frac = Math.min(1, Math.max(0, input.minutesToTarget) / span);
  const close = input.last + (input.eodClose - input.last) * frac;
  const band = Math.max(Math.abs(input.eodHigh - input.eodLow) / 2, input.last * 0.001) * Math.sqrt(frac);
  return { close, low: close - band, high: close + band };
}

function signMove(last: number, close: number): number {
  const dead = Math.max(last * 0.0004, 4);
  if (close >= last + dead) return 1;
  if (close <= last - dead) return -1;
  return 0;
}

export function buildHorizons(input: {
  now?: Date;
  last: number;
  eodClose: number;
  eodLow: number;
  eodHigh: number;
  vwap?: number | null;
  /** 15m Sensex path disagrees with Nifty. */
  veto?: boolean;
}): HorizonView[] {
  const now = input.now ?? new Date();
  const { date, minutes } = istParts(now);
  const closeMin = 15 * 60 + 30;
  const minutesToClose = Math.max(0, closeMin - minutes);
  const spots = HORIZON_IDS.map((id) => {
    const target = horizonTarget(now, id);
    const minutesToTarget =
      id === "eod" ? minutesToClose : Math.max(0, Math.round((target.at.getTime() - now.getTime()) / 60000));
    const towardClose = horizonSpot({
      last: input.last,
      eodClose: input.eodClose,
      eodLow: input.eodLow,
      eodHigh: input.eodHigh,
      minutesToTarget: target.clamped ? minutesToClose : minutesToTarget,
      minutesToClose,
    });
    const close = towardClose.close;
    const band = Math.max(Math.abs(towardClose.high - towardClose.low) / 2, input.last * 0.001);
    const spot = { close, low: close - band, high: close + band };
    return { id, target, spot, date };
  });
  const five = spots.find((row) => row.id === "5m")!;
  const hour = spots.find((row) => row.id === "1h")!;
  const fiveSign = signMove(input.last, five.spot.close);
  const hourSign = signMove(input.last, hour.spot.close);
  const disagree = fiveSign !== 0 && hourSign !== 0 && fiveSign !== hourSign;
  return spots.map((row) => ({
    id: row.id,
    label: row.target.label,
    targetAt: row.target.at.toISOString(),
    clamped: row.target.clamped,
    close: money(row.spot.close, 2),
    low: money(row.spot.low, 2),
    high: money(row.spot.high, 2),
    abstain: (disagree && (row.id === "5m" || row.id === "15m")) || (Boolean(input.veto) && row.id === "15m"),
    floorScale: row.id === "5m" || row.id === "15m" ? 2 : 1,
    anchor: money(input.last, 2),
  }));
}
