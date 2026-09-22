import { describe, expect, it } from "vitest";
import { isUrlSafeForFetch } from "./ssrf.js";

describe("SSRF policy", () => {
  it("allows public https", () => {
    expect(isUrlSafeForFetch("https://news.google.com/rss")).toBe(true);
  });

  it("blocks loopback and private ranges", () => {
    expect(isUrlSafeForFetch("http://127.0.0.1/secret")).toBe(false);
    expect(isUrlSafeForFetch("http://localhost:4000")).toBe(false);
    expect(isUrlSafeForFetch("http://192.168.1.9/admin")).toBe(false);
    expect(isUrlSafeForFetch("http://10.0.0.2")).toBe(false);
    expect(isUrlSafeForFetch("http://169.254.169.254/latest/meta-data")).toBe(false);
  });
});
