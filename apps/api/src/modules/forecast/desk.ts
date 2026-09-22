import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { positions } from "../../db/schema.js";
import type { ZerodhaReadAdapter } from "../brokers/zerodha/read-adapter.js";
import type { Idea } from "./levels.js";

export async function loadHeldKeys(db: Database, read: ZerodhaReadAdapter): Promise<Set<string>> {
  const held = new Set<string>();
  const paper = await db
    .select()
    .from(positions)
    .where(and(eq(positions.status, "OPEN"), eq(positions.executionMode, "PAPER")));
  for (const pos of paper) addHeld(held, pos.exchange, pos.symbol);
  try {
    for (const row of await read.getHoldings()) {
      if (Number(row.quantity) !== 0) addHeld(held, row.instrument.exchange, row.instrument.symbol);
    }
  } catch {
    /* broker session may be down */
  }
  try {
    for (const row of await read.getPositions()) {
      if (Number(row.quantity) !== 0) addHeld(held, row.instrument.exchange, row.instrument.symbol);
    }
  } catch {
    /* broker session may be down */
  }
  return held;
}

export async function paperHeldSymbols(db: Database): Promise<Set<string>> {
  const rows = await db
    .select()
    .from(positions)
    .where(and(eq(positions.status, "OPEN"), eq(positions.executionMode, "PAPER")));
  return new Set(rows.map((row) => row.symbol.toUpperCase()));
}

function addHeld(held: Set<string>, exchange: string, symbol: string): void {
  const s = symbol.toUpperCase();
  const e = exchange.toUpperCase();
  held.add(s);
  held.add(`${e}:${s}`);
}

export function isHeld(held: Set<string>, contract: string, exchange?: string): boolean {
  const u = contract.toUpperCase();
  if (held.has(u)) return true;
  if (exchange && held.has(`${exchange.toUpperCase()}:${u}`)) return true;
  for (const key of held) {
    const token = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
    if (token === u) return true;
  }
  return false;
}

export type PlainIdea = {
  lane: Idea["lane"];
  kind: Idea["kind"];
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
};

export function visibleIdeas(
  ideas: Idea[],
  held: Set<string>,
  paperHeld: Set<string>,
  lane?: "FNO" | "CASH",
): PlainIdea[] {
  return ideas
    .filter((idea) => !lane || idea.lane === lane)
    .filter((idea) => {
      if (idea.action === "SELL" || idea.action === "HOLD") return isHeld(held, idea.contract, idea.exchange);
      return idea.action === "BUY";
    })
    .map((idea) => toPlain(idea, paperHeld));
}

function toPlain(idea: Idea, paperHeld: Set<string>): PlainIdea {
  const instrumentType = idea.kind === "EQ" ? "EQUITY" : idea.kind === "FUT" ? "FUTURE" : "OPTION";
  const action = idea.action as "BUY" | "SELL" | "HOLD";
  return {
    lane: idea.lane,
    kind: idea.kind,
    action,
    contract: idea.contract,
    exchange: idea.exchange,
    label: labelOf(idea.kind),
    title:
      action === "BUY"
        ? idea.kind === "EQ"
          ? "Buy today"
          : `Buy ${labelOf(idea.kind)}`
        : action === "SELL"
          ? `Sell ${labelOf(idea.kind)}`
          : "Keep what you own",
    why: plainWhy(idea),
    when: action === "BUY" ? laterSellHint(idea) : idea.until ? `Before ${friendlyDate(idea.until)}.` : null,
    premium: idea.premium,
    stop: idea.stop,
    target: idea.target,
    instrumentType,
    canPaper: action === "BUY" || paperHeld.has(idea.contract.toUpperCase()),
  };
}

function labelOf(kind: Idea["kind"]): string {
  switch (kind) {
    case "CE":
      return "CE";
    case "PE":
      return "PE";
    case "FUT":
      return "FUT";
    default:
      return "Stock";
  }
}

export type AgentMark = "BUY" | "SELL" | "NO_BUY" | "WAIT";

export function markContract(
  ideas: Idea[],
  held: Set<string>,
  paperHeld: Set<string>,
  contract: string,
  kind: Idea["kind"],
): { mark: AgentMark; why: string; canPaper: boolean } {
  const exact = ideas.find((idea) => idea.contract.toUpperCase() === contract.toUpperCase());
  if (!exact) {
    return { mark: "NO_BUY", why: "Not the contract the helper picked.", canPaper: false };
  }
  if (exact.action === "BUY") {
    return {
      mark: "BUY",
      why: plainWhy(exact),
      canPaper: true,
    };
  }
  if (exact.action === "SELL" || exact.action === "HOLD") {
    if (isHeld(held, exact.contract, exact.exchange)) {
      return {
        mark: exact.action === "HOLD" ? "WAIT" : "SELL",
        why: plainWhy(exact),
        canPaper: paperHeld.has(exact.contract.toUpperCase()),
      };
    }
    return { mark: "NO_BUY", why: "Sell only if you already hold this contract.", canPaper: false };
  }
  if (exact.action === "WAIT") {
    return { mark: "WAIT", why: "Waiting for a clearer move.", canPaper: false };
  }
  return { mark: "NO_BUY", why: `Skip this ${kind}.`, canPaper: false };
}

function laterSellHint(idea: Idea): string | null {
  if (idea.kind === "EQ") return "Sell later only if the helper says you already own it and it is time.";
  if (idea.until) return `Sell if the move fails, or before ${friendlyDate(idea.until)}.`;
  return "Sell if the move fails, or before the date ends.";
}

function plainWhy(idea: Idea): string {
  if (idea.action === "BUY" && idea.kind === "CE") {
    return "CE: helper expects the name to move up.";
  }
  if (idea.action === "BUY" && idea.kind === "PE") {
    return "PE: helper expects the name to move down.";
  }
  if (idea.action === "BUY" && idea.kind === "FUT") {
    return "The helper thinks this name will keep moving the same way until the date you picked.";
  }
  if (idea.action === "BUY" && idea.kind === "EQ") {
    return "The helper thinks this stock is in a good place to buy today.";
  }
  if (idea.action === "SELL") return "You already own this. The helper thinks today is a good day to sell.";
  if (idea.action === "HOLD") return "You already own this. The helper thinks you should keep it for now.";
  return "The helper is watching this name.";
}

export function friendlyDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(`${iso.slice(0, 10)}T00:00:00+05:30`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export function stanceLine(bias: string): string {
  if (bias === "BULLISH") return "Looks like it may go up.";
  if (bias === "BEARISH") return "Looks like it may go down.";
  return "No clear direction yet. Waiting is fine.";
}
