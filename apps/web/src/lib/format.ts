/** Display-only: clip to `places` digits after the dot. Never rounds. */

function plainAbs(n: number): string {
  const abs = Math.abs(n);
  let s = String(abs);
  if (!/[eE]/.test(s)) return s;
  const match = s.match(/^(\d+)(?:\.(\d+))?e([+-]?\d+)$/i);
  if (!match) return s;
  const digits = `${match[1] ?? ""}${match[2] ?? ""}`;
  const exp = Number(match[3]);
  const point = (match[1] ?? "").length + exp;
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`.replace(/0+$/, "") || "0";
  if (point >= digits.length) return `${digits}${"0".repeat(point - digits.length)}`;
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

export function showDec(value: string | number | null | undefined, places = 2): string {
  if (value == null || value === "") return "—";
  const raw = String(value).trim().replace(/,/g, "");
  if (!raw || raw === "—") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const body = /[eE]/.test(raw.replace(/^-/, "")) ? plainAbs(n) : raw.replace(/^-/, "");
  const [intPart, frac = ""] = body.split(".");
  if (places <= 0) return `${sign}${intPart || "0"}`;
  return `${sign}${intPart || "0"}.${frac.slice(0, places).padEnd(places, "0")}`;
}

export function showRupee(value: string | number | null | undefined, places = 2): string {
  const body = showDec(value, places);
  return body === "—" ? "—" : `₹${body}`;
}

export function showSignedRupee(value: string | number | null | undefined, places = 2): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}₹${showDec(Math.abs(n), places)}`;
}

export function showPct(value: number, places = 3): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${showDec(Math.abs(value), places)}%`;
}

export function showCompactRupee(value: string | number | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}₹${showDec(abs / 1000, 1)}k`;
  return `${sign}₹${showDec(abs, 0)}`;
}
