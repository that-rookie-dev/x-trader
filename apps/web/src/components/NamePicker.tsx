"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type DeskName = {
  exchange: string;
  symbol: string;
  label: string;
  kind?: "INDEX" | "EQ";
  nextExpiry?: string | null;
};

export function NamePicker({
  names,
  value,
  onChange,
}: {
  names: DeskName[];
  value: string;
  onChange: (name: DeskName) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const selected = names.find((n) => n.symbol === value) ?? names[0];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return names;
    return names.filter((n) => `${n.label} ${n.symbol} ${n.exchange}`.toLowerCase().includes(q));
  }, [names, query]);

  const indexes = filtered.filter((n) => n.kind === "INDEX");
  const stocks = filtered.filter((n) => n.kind !== "INDEX");

  useLayoutEffect(() => {
    if (!open || !root.current) {
      setMenuBox(null);
      return;
    }
    const rect = root.current.getBoundingClientRect();
    setMenuBox({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 280) });
  }, [open]);

  useEffect(() => {
    function onDoc(ev: MouseEvent) {
      const target = ev.target as Node;
      if (root.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.(".name-picker-menu")) return;
      setOpen(false);
    }
    function onScroll() {
      if (!open || !root.current) return;
      const rect = root.current.getBoundingClientRect();
      setMenuBox({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 280) });
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      window.setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  function pick(name: DeskName) {
    onChange(name);
    setOpen(false);
  }

  const menu =
    open && menuBox
      ? createPortal(
          <div
            className="name-picker-menu portal-menu"
            style={{ top: menuBox.top, left: menuBox.left, width: menuBox.width }}
          >
            <input
              ref={input}
              className="input"
              placeholder="Search index or stock"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && filtered[0]) pick(filtered[0]);
              }}
            />
            <div className="name-picker-list">
              {indexes.length ? <p className="name-picker-group">INDEX</p> : null}
              {indexes.map((n) => (
                <button
                  key={`${n.exchange}:${n.symbol}`}
                  type="button"
                  className={n.symbol === value ? "on" : ""}
                  onClick={() => pick(n)}
                >
                  <b>{n.label}</b>
                  <span>{n.symbol}</span>
                </button>
              ))}
              {stocks.length ? <p className="name-picker-group">STOCKS</p> : null}
              {stocks.map((n) => (
                <button
                  key={`${n.exchange}:${n.symbol}`}
                  type="button"
                  className={n.symbol === value ? "on" : ""}
                  onClick={() => pick(n)}
                >
                  <b>{n.label}</b>
                  <span>{n.exchange}</span>
                </button>
              ))}
              {!filtered.length ? <p className="muted pad">No F&O name matches.</p> : null}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={`name-picker ${open ? "open" : ""}`} ref={root}>
      <button type="button" className="input name-picker-btn" onClick={() => setOpen((v) => !v)}>
        {selected?.label ?? "Search F&O"}
      </button>
      {menu}
    </div>
  );
}
