"use client";

import { useEffect, useMemo, useState } from "react";

export type CoachStep = {
  id: string;
  title: string;
  body: string;
  target: string;
};

export const TOURS: Record<string, CoachStep[]> = {
  options: [
    { id: "und", title: "Pick the name", body: "Start here. This is the index or stock the desk is watching.", target: "und" },
    { id: "exp", title: "Pick the expiry", body: "F&O lives on a weekly clock. Use this week’s expiry unless you mean later.", target: "exp" },
    { id: "spot", title: "Spot, PCR, cutoff", body: "Live spot plus put-call ratio and the session cutoff. After cutoff, no new buys.", target: "spot" },
    { id: "votes", title: "Why the algo leans", body: "Each chip is one model. Green helps calls. Red helps puts.", target: "votes" },
    { id: "chain", title: "The chain mark", body: "BUY is a cheap-side contract the forecast says can pay after charges.", target: "chain" },
    { id: "pnl", title: "Net after costs", body: "This box is the edge after brokerage, STT and GST. If net is thin, skip.", target: "pnl" },
    { id: "chart", title: "VWAP and ORB", body: "Open the chart to see VWAP and the opening range the votes use.", target: "chart" },
    { id: "study", title: "Study is on you", body: "Study does not auto-run. Tap it only when you want a second opinion.", target: "study" },
    { id: "tape", title: "The alert tape", body: "When a mark flips to BUY or dies, it lands here. That is the alert.", target: "tape" },
    { id: "dismiss", title: "Dismiss after you act", body: "You trade on Zerodha. Then tap Dismiss. We read fills. We never place the live order.", target: "dismiss" },
  ],
  stocks: [
    { id: "swing", title: "Swing is the book", body: "Cash is ranked for days and weeks, not the same session clock as options.", target: "swing" },
    { id: "today", title: "Today is extra", body: "Same-day volume breakouts sit here. They expire at 15:15 IST.", target: "today" },
    { id: "card", title: "Open a buy card", body: "Rank, relative strength vs Nifty, and the ATR stop live on the card.", target: "card" },
    { id: "rs", title: "RS and ATR", body: "RS vs Nifty tells you if the stock is stronger than the index. ATR sizes the stop.", target: "rs" },
    { id: "instruct", title: "Copy the instruction", body: "Copy the instruction and place it on Zerodha. This app never sends the order.", target: "instruct" },
  ],
  zerodha: [
    { id: "connect", title: "Connect Zerodha", body: "Connect so the helper can read prices, funds, and later your orders.", target: "connect" },
    { id: "funds", title: "Your cash stays there", body: "This number is your real cash at Zerodha. The app does not move it.", target: "funds" },
    { id: "read-only", title: "We only read", body: "After you trade on Zerodha, we match the order to the play. No order leaves this app.", target: "read-only" },
  ],
  alerts: [
    { id: "buy-meaning", title: "What BUY means", body: "BUY is an order instruction after costs — not an order. You still decide on Zerodha.", target: "buy-meaning" },
    { id: "dismiss", title: "Dismiss vs fill", body: "Dismiss means you saw it. If Zerodha shows the contract, we mark FILLED and learn.", target: "dismiss" },
    { id: "fill", title: "Missed is not a win", body: "If the window ends with no order, it is MISSED. We do not pretend that was profit.", target: "fill" },
  ],
};

const SEEN_KEY = "coach.seen";

export function tourForPath(path: string): string {
  if (path.startsWith("/stocks")) return "stocks";
  if (path.startsWith("/account")) return "zerodha";
  return "options";
}

export function readSeen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function markSeen(tour: string) {
  const next = { ...readSeen(), [tour]: true };
  localStorage.setItem(SEEN_KEY, JSON.stringify(next));
}

export function Coach({
  tour,
  onClose,
}: {
  tour: string | null;
  onClose: () => void;
}) {
  const steps = tour ? TOURS[tour] ?? [] : [];
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const step = steps[index] ?? null;

  useEffect(() => {
    setIndex(0);
  }, [tour]);

  useEffect(() => {
    if (!step) return;
    const find = () => {
      const el = document.querySelector(`[data-coach="${step.target}"]`) as HTMLElement | null;
      setBox(el?.getBoundingClientRect() ?? null);
    };
    find();
    const id = window.setInterval(find, 400);
    return () => window.clearInterval(id);
  }, [step]);

  useEffect(() => {
    if (!step) return;
    function onClick(ev: MouseEvent) {
      const el = document.querySelector(`[data-coach="${step.target}"]`);
      if (el && el.contains(ev.target as Node)) {
        ev.stopPropagation();
        next();
      }
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [step, index]);

  const cardStyle = useMemo(() => {
    if (!box) return { top: "30%", left: "50%", transform: "translateX(-50%)" } as const;
    const below = box.bottom + 12 + 160 < window.innerHeight;
    const top = below ? box.bottom + 10 : Math.max(8, box.top - 170);
    const left = Math.min(Math.max(12, box.left), window.innerWidth - 300);
    return { top, left };
  }, [box]);

  if (!tour || !step) return null;

  function next() {
    if (index + 1 >= steps.length) {
      if (tour) markSeen(tour);
      onClose();
      return;
    }
    setIndex(index + 1);
  }

  return (
    <div className="coach" role="dialog" aria-label="Tutorial">
      <div className="coach-veil" />
      {box ? (
        <div
          className="coach-spot"
          style={{ top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8 }}
        />
      ) : null}
      <aside className="coach-card" style={cardStyle}>
        <p className="eyebrow">
          {index + 1} / {steps.length}
        </p>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="btn primary" onClick={next}>
            {index + 1 >= steps.length ? "Done" : "Next"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (tour) markSeen(tour);
              onClose();
            }}
          >
            Skip
          </button>
        </div>
      </aside>
    </div>
  );
}
