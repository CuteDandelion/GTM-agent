import { describe, expect, it, vi } from "vitest";

import { createSafeCrawler, validatePublicUrl } from "../src/index.js";

describe("public URL validation", () => {
  it("normalizes a public company URL", async () => {
    const result = await validatePublicUrl("acme.ai/about", async () => ["203.0.113.10"]);
    expect(result.toString()).toBe("https://acme.ai/about");
  });

  it.each([
    "http://localhost/admin",
    "http://127.0.0.1/private",
    "http://10.0.0.4/metadata",
    "http://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
    "https://user:pass@example.com",
  ])("rejects unsafe target %s", async (target) => {
    await expect(validatePublicUrl(target, async () => ["93.184.216.34"]))
      .rejects.toThrow(/unsafe|public|protocol|credentials/i);
  });

  it("rejects a hostname that resolves to a private address", async () => {
    await expect(validatePublicUrl("https://internal.example", async () => ["192.168.1.20"]))
      .rejects.toThrow(/public address/i);
  });
});

describe("bounded company crawler", () => {
  it("stays on the validated host and marks extracted content untrusted", async () => {
    const fetcher = vi.fn(async (url: URL) => new Response(
      url.pathname === "/"
        ? '<html><body>Acme support automation<a href="/product">Product</a><a href="https://other.example">Other</a></body></html>'
        : "<html><body>AI triage and routing</body></html>",
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ));
    const crawler = createSafeCrawler({
      resolveHost: async () => ["203.0.113.10"],
      fetcher,
      maxPages: 2,
      maxBytesPerPage: 10_000,
    });

    const result = await crawler.crawl("https://acme.ai");
    expect(result.pages).toHaveLength(2);
    expect(result.pages.map((page) => page.url)).toEqual([
      "https://acme.ai/",
      "https://acme.ai/product",
    ]);
    expect(result.pages[0]).toMatchObject({ trust: "untrusted_external" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the response exceeds the page budget", async () => {
    const crawler = createSafeCrawler({
      resolveHost: async () => ["203.0.113.10"],
      fetcher: async () => new Response("x".repeat(101), { headers: { "content-type": "text/html" } }),
      maxPages: 1,
      maxBytesPerPage: 100,
    });

    await expect(crawler.crawl("https://acme.ai")).rejects.toThrow(/byte budget/i);
  });
});
