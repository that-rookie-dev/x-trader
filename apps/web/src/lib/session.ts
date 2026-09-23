/** NSE/BSE session helpers (IST). Shared by the shell clock badge. */

export const MARKET_OPEN_MIN = 9 * 60 + 15;
export const MARKET_CLOSE_SOON_MIN = 15 * 60 + 15;
export const MARKET_CLOSE_MIN = 15 * 60 + 30;

export type SessionPhase = "preopen" | "open" | "closing" | "closed";

export function istMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return (
    Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 +
    Number(parts.find((p) => p.type === "minute")?.value ?? 0)
  );
}

export function sessionPhase(now = new Date()): SessionPhase {
  const mins = istMinutes(now);
  if (mins < MARKET_OPEN_MIN) return "preopen";
  if (mins >= MARKET_CLOSE_MIN) return "closed";
  if (mins >= MARKET_CLOSE_SOON_MIN) return "closing";
  return "open";
}

export function sessionPhaseLabel(phase: SessionPhase): string {
  switch (phase) {
    case "preopen":
      return "PRE-OPEN";
    case "closing":
      return "LAST 15M";
    case "closed":
      return "CLOSED";
    default:
      return "OPEN";
  }
}
