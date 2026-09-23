/** Compare dotted semver-ish tags (v prefix optional). Returns -1 / 0 / 1. */
export function compareSemver(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^v/i, "");
}

function parse(raw: string): number[] {
  const core = normalizeTag(raw).split("-")[0] ?? "0";
  return core.split(".").map((p) => {
    const n = Number.parseInt(p.replace(/[^\d].*$/, ""), 10);
    return Number.isFinite(n) ? n : 0;
  });
}

export function isNewer(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}
