/** NSE/BSE session helpers (IST). Shared by the shell clock badge. */

export const MARKET_OPEN_MIN = 9 * 60 + 15;
export const MARKET_CLOSE_SOON_MIN = 15 * 60 + 15;
export const MARKET_CLOSE_MIN = 15 * 60 + 30;

export type SessionPhase = "preopen" | "opening" | "open" | "closing" | "closed";

const OPEN_SEC = MARKET_OPEN_MIN * 60;
const CLOSE_SEC = MARKET_CLOSE_MIN * 60;
const SOON_SEC = 15 * 60;

export type MarketClock = {
  phase: SessionPhase;
  time: string;
  label: "OPENS IN" | "CLOSES IN";
  remain: string;
  title: string;
};

function istParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    weekday: pick("weekday"),
    hour: Number(pick("hour")),
    minute: Number(pick("minute")),
    second: Number(pick("second")),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatRemain(total: number): string {
  const left = Math.max(0, total);
  const days = Math.floor(left / 86400);
  const hours = Math.floor((left % 86400) / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = left % 60;
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

/** Next cash open or close, in whole seconds, for the IST session Mon–Fri 09:15–15:30. */
export function marketClock(now = new Date()): MarketClock {
  const parts = istParts(now);
  const sec = parts.hour * 3600 + parts.minute * 60 + parts.second;
  const weekend = parts.weekday === "Sat" || parts.weekday === "Sun";
  const time = `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)} IST`;

  if (!weekend && sec >= OPEN_SEC && sec < CLOSE_SEC) {
    const closing = CLOSE_SEC - sec <= SOON_SEC;
    return {
      phase: closing ? "closing" : "open",
      time,
      label: "CLOSES IN",
      remain: formatRemain(CLOSE_SEC - sec),
      title: closing ? "Last 15 minutes before the 15:30 IST close" : "Cash session is open until 15:30 IST",
    };
  }

  let untilOpen = OPEN_SEC - sec;
  if (weekend || sec >= CLOSE_SEC) {
    const extra =
      parts.weekday === "Fri" ? 3 : parts.weekday === "Sat" ? 2 : parts.weekday === "Sun" ? 1 : 1;
    untilOpen = 86400 - sec + (extra - 1) * 86400 + OPEN_SEC;
  }
  const opening = !weekend && untilOpen <= SOON_SEC;
  return {
    phase: opening ? "opening" : weekend || sec >= CLOSE_SEC ? "closed" : "preopen",
    time,
    label: "OPENS IN",
    remain: formatRemain(untilOpen),
    title: opening ? "Last 15 minutes before the 09:15 IST open" : "Cash session opens at 09:15 IST, Monday to Friday",
  };
}

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
  return marketClock(now).phase;
}

export function sessionPhaseLabel(phase: SessionPhase): string {
  switch (phase) {
    case "preopen":
      return "PRE-OPEN";
    case "opening":
      return "OPENS SOON";
    case "closing":
      return "LAST 15M";
    case "closed":
      return "CLOSED";
    default:
      return "OPEN";
  }
}
