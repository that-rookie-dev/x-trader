const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "metadata.google.internal"]);

export function isUrlSafeForFetch(url: string): boolean {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (BLOCKED_HOSTS.has(host) || BLOCKED_HOSTS.has(u.hostname.toLowerCase())) return false;
    if (host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^0\./.test(host)) {
      return false;
    }
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return false;
    if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export function assertSafeFetchUrl(url: string): void {
  if (!isUrlSafeForFetch(url)) throw new Error(`URL blocked by SSRF policy: ${url}`);
}

export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return url.trim();
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
