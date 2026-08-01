import { createHash } from "node:crypto";
import { isIP } from "node:net";

export type ResolveHost = (hostname: string) => Promise<string[]>;
export type Fetcher = (url: URL, init?: RequestInit) => Promise<Response>;

function isUnsafeIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a >= 224;
}

function isUnsafeIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0]!;
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? isUnsafeIpv4(mapped) : false;
}

function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !isUnsafeIpv4(address);
  if (version === 6) return !isUnsafeIpv6(address);
  return false;
}

export async function validatePublicUrl(input: string, resolveHost: ResolveHost): Promise<URL> {
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("Unsafe or invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS protocols are allowed");
  }
  if (url.username || url.password) throw new Error("URL credentials are not allowed");
  if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) {
    throw new Error("Unsafe local hostname");
  }

  const literalVersion = isIP(url.hostname);
  const addresses = literalVersion ? [url.hostname] : await resolveHost(url.hostname);
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error("Hostname must resolve only to public addresses");
  }
  url.hash = "";
  return url;
}

function extractLinks(html: string, baseUrl: URL): URL[] {
  const links: URL[] = [];
  const pattern = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const link = new URL(match[1]!, baseUrl);
      link.hash = "";
      if (link.protocol === baseUrl.protocol && link.hostname === baseUrl.hostname && link.port === baseUrl.port) {
        links.push(link);
      }
    } catch {
      // Ignore malformed links discovered in untrusted HTML.
    }
  }
  return links;
}

function extractText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export interface CrawledPage {
  url: string;
  title?: string;
  text: string;
  contentHash: string;
  observedAt: string;
  trust: "untrusted_external";
}

export function createSafeCrawler(options: {
  resolveHost: ResolveHost;
  fetcher: Fetcher;
  maxPages: number;
  maxBytesPerPage: number;
}) {
  if (options.maxPages < 1 || options.maxBytesPerPage < 1) throw new Error("Crawler budgets must be positive");

  const fetchValidated = async (url: URL, root: URL): Promise<{ response: Response; finalUrl: URL }> => {
    let current = url;
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      current = await validatePublicUrl(current.toString(), options.resolveHost);
      if (current.hostname !== root.hostname || current.protocol !== root.protocol || current.port !== root.port) {
        throw new Error("Crawler redirect left the validated company origin");
      }
      const response = await options.fetcher(current, { redirect: "manual" });
      if (response.status < 300 || response.status >= 400) return { response, finalUrl: current };
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect response is missing a location");
      current = new URL(location, current);
    }
    throw new Error("Crawler redirect budget exceeded");
  };

  return {
    async crawl(input: string): Promise<{ rootUrl: string; pages: CrawledPage[] }> {
      const root = await validatePublicUrl(input, options.resolveHost);
      const queue = [root];
      const queued = new Set([root.toString()]);
      const pages: CrawledPage[] = [];

      while (queue.length > 0 && pages.length < options.maxPages) {
        const next = queue.shift()!;
        const { response, finalUrl } = await fetchValidated(next, root);
        if (!response.ok) throw new Error(`Crawler received HTTP ${response.status}`);
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("text/html")) throw new Error(`Unsupported crawler content type: ${contentType || "unknown"}`);
        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > options.maxBytesPerPage) {
          throw new Error("Crawler page exceeded its byte budget");
        }
        const html = await response.text();
        if (new TextEncoder().encode(html).byteLength > options.maxBytesPerPage) {
          throw new Error("Crawler page exceeded its byte budget");
        }

        const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
        const text = extractText(html);
        pages.push({
          url: finalUrl.toString(),
          ...(title ? { title } : {}),
          text,
          contentHash: `sha256:${createHash("sha256").update(html).digest("hex")}`,
          observedAt: new Date().toISOString(),
          trust: "untrusted_external",
        });

        for (const link of extractLinks(html, finalUrl)) {
          const key = link.toString();
          if (!queued.has(key) && pages.length + queue.length < options.maxPages) {
            queued.add(key);
            queue.push(link);
          }
        }
      }

      return { rootUrl: root.toString(), pages };
    },
  };
}
