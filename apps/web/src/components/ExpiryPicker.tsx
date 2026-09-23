"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ExpiryOption = { date: string; label: string };

export function ExpiryPicker({
  options,
  value,
  onChange,
}: {
  options: ExpiryOption[];
  value: string;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.date === value) ?? options[0];

  useLayoutEffect(() => {
    if (!open || !root.current) {
      setMenuBox(null);
      return;
    }
    const rect = root.current.getBoundingClientRect();
    setMenuBox({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 160) });
  }, [open]);

  useEffect(() => {
    function onDoc(ev: MouseEvent) {
      const target = ev.target as Node;
      if (root.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.(".expiry-picker-menu")) return;
      setOpen(false);
    }
    function onScroll() {
      if (!open || !root.current) return;
      const rect = root.current.getBoundingClientRect();
      setMenuBox({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 160) });
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

  const menu =
    open && menuBox
      ? createPortal(
          <div
            className="expiry-picker-menu portal-menu"
            role="listbox"
            style={{ top: menuBox.top, left: menuBox.left, width: menuBox.width }}
          >
            {options.map((item) => (
              <button
                key={item.date}
                type="button"
                role="option"
                aria-selected={item.date === value}
                className={item.date === value ? "on" : ""}
                onClick={() => {
                  onChange(item.date);
                  setOpen(false);
                }}
              >
                {item.label}
              </button>
            ))}
            {!options.length ? <p className="muted pad">No expiries</p> : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={`expiry-picker ${open ? "open" : ""}`} ref={root}>
      <button type="button" className="input expiry-picker-btn" onClick={() => setOpen((v) => !v)}>
        {selected?.label ?? "Pick expiry"}
      </button>
      {menu}
    </div>
  );
}
