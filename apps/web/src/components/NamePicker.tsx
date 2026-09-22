"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

  useEffect(() => {
    function onDoc(ev: MouseEvent) {
      if (!root.current?.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

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

  return (
    <div className={`name-picker ${open ? "open" : ""}`} ref={root}>
      <button type="button" className="input name-picker-btn" onClick={() => setOpen((v) => !v)}>
        {selected?.label ?? "Search F&O"}
      </button>
      {open ? (
        <div className="name-picker-menu">
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
        </div>
      ) : null}
    </div>
  );
}
