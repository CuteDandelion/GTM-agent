import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";

import { createPinnedNodeFetcher, createSafeCrawler, validatePublicUrl } from "../src/index.js";

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
  it("connects to a validated IP without resolving the untrusted hostname again", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><body>Pinned</body></html>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
      const fetcher = createPinnedNodeFetcher();
      const response = await fetcher(
        new URL(`http://dns-rebinding.invalid:${address.port}/`),
        { redirect: "manual" },
        { validatedAddresses: ["127.0.0.1"] },
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Pinned");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

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

  it("pins every fetch to the public addresses validated for that request", async () => {
    const crawler = createSafeCrawler({
      resolveHost: async () => ["203.0.113.10", "2001:db8::10"],
      fetcher: async (_url, _init, connection) => {
        if (JSON.stringify(connection?.validatedAddresses) !== JSON.stringify(["203.0.113.10", "2001:db8::10"])) {
          throw new Error("fetch was not pinned to the validated addresses");
        }
        return new Response("<html><body>Safe</body></html>", {
          headers: { "content-type": "text/html" },
        });
      },
      maxPages: 1,
      maxBytesPerPage: 1_000,
    });

    await expect(crawler.crawl("https://acme.ai")).resolves.toMatchObject({
      pages: [{ text: "Safe" }],
    });
  });

  it("cancels an oversized streaming response before buffering the remaining body", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 1_000) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array([120]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const crawler = createSafeCrawler({
      resolveHost: async () => ["203.0.113.10"],
      fetcher: async () => new Response(body, { headers: { "content-type": "text/html" } }),
      maxPages: 1,
      maxBytesPerPage: 100,
    });

    await expect(crawler.crawl("https://acme.ai")).rejects.toThrow(/byte budget/i);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(102);
  });

  it("bounds model-visible text while hashing the complete accepted page", async () => {
    const crawler = createSafeCrawler({
      resolveHost: async () => ["203.0.113.10"],
      fetcher: async () => new Response(`<html><body>${"grounded evidence ".repeat(20)}</body></html>`, { headers: { "content-type": "text/html" } }),
      maxPages: 1,
      maxBytesPerPage: 10_000,
      maxTextCharactersPerPage: 40,
    });

    const result = await crawler.crawl("https://acme.ai");
    expect(result.pages[0]?.text).toHaveLength(40);
    expect(result.pages[0]?.textTruncated).toBe(true);
    expect(result.pages[0]?.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
