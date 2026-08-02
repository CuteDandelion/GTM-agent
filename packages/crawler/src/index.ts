import { createHash } from "node:crypto";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

export type ResolveHost = (hostname: string) => Promise<string[]>;
export interface ValidatedConnection {
  validatedAddresses: string[];
}
export type Fetcher = (
  url: URL,
  init?: RequestInit,
  connection?: ValidatedConnection,
) => Promise<Response>;

function responseHeaders(headers: import("node:http").IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}

export function createPinnedNodeFetcher(): Fetcher {
  return async (url, init, connection) => {
    const validatedAddresses = connection?.validatedAddresses ?? [];
    if (validatedAddresses.length === 0) throw new Error("Pinned fetch requires a validated address");
    const headers = new Headers(init?.headers);
    if (!headers.has("accept")) headers.set("accept", "text/html,application/xhtml+xml");
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");
    if (!headers.has("user-agent")) headers.set("user-agent", "GTMResearchCrawler/0.1");

    let lastError: unknown;
    for (const pinnedAddress of validatedAddresses) {
      try {
        return await new Promise<Response>((resolve, reject) => {
          const family = isIP(pinnedAddress);
          if (family === 0) {
            reject(new Error("Pinned fetch received an invalid IP address"));
            return;
          }
          const lookup = ((_hostname: string, lookupOptions: { all?: boolean } | number, callback: (...args: unknown[]) => void) => {
            if (typeof lookupOptions === "object" && lookupOptions.all) {
              callback(null, [{ address: pinnedAddress, family }]);
              return;
            }
            callback(null, pinnedAddress, family);
          }) as LookupFunction;
          const request = (url.protocol === "https:" ? requestHttps : requestHttp)(url, {
            method: init?.method ?? "GET",
            headers: Object.fromEntries(headers.entries()),
            lookup,
            ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
          }, (incoming) => {
            const status = incoming.statusCode ?? 502;
            const bodyless = status === 101 || status === 204 || status === 205 || status === 304;
            const body = bodyless
              ? null
              : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
            resolve(new Response(body, {
              status,
              ...(incoming.statusMessage ? { statusText: incoming.statusMessage } : {}),
              headers: responseHeaders(incoming.headers),
            }));
          });
          request.once("error", reject);
          if (init?.signal) {
            if (init.signal.aborted) request.destroy(init.signal.reason);
            else init.signal.addEventListener("abort", () => request.destroy(init.signal?.reason), { once: true });
          }
          request.end();
        });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Pinned fetch failed");
  };
}

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

async function validatePublicUrlAndAddresses(
  input: string,
  resolveHost: ResolveHost,
): Promise<{ url: URL; addresses: string[] }> {
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
  return { url, addresses };
}

export async function validatePublicUrl(input: string, resolveHost: ResolveHost): Promise<URL> {
  return (await validatePublicUrlAndAddresses(input, resolveHost)).url;
}

async function readBodyWithinLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel("Crawler page exceeded its byte budget");
      throw new Error("Crawler page exceeded its byte budget");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
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
  textTruncated?: boolean;
  observedAt: string;
  trust: "untrusted_external";
}

export function createSafeCrawler(options: {
  resolveHost: ResolveHost;
  fetcher: Fetcher;
  maxPages: number;
  maxBytesPerPage: number;
  maxTextCharactersPerPage?: number;
}) {
  const maxTextCharactersPerPage = options.maxTextCharactersPerPage ?? 20_000;
  if (options.maxPages < 1 || options.maxBytesPerPage < 1 || maxTextCharactersPerPage < 1) throw new Error("Crawler budgets must be positive");

  const fetchValidated = async (url: URL, root: URL): Promise<{ response: Response; finalUrl: URL }> => {
    let current = url;
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const validated = await validatePublicUrlAndAddresses(current.toString(), options.resolveHost);
      current = validated.url;
      if (current.hostname !== root.hostname || current.protocol !== root.protocol || current.port !== root.port) {
        throw new Error("Crawler redirect left the validated company origin");
      }
      const response = await options.fetcher(
        current,
        { redirect: "manual" },
        { validatedAddresses: validated.addresses },
      );
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
        const html = await readBodyWithinLimit(response, options.maxBytesPerPage);

        const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
        const extractedText = extractText(html);
        const textTruncated = extractedText.length > maxTextCharactersPerPage;
        const text = extractedText.slice(0, maxTextCharactersPerPage);
        pages.push({
          url: finalUrl.toString(),
          ...(title ? { title } : {}),
          text,
          ...(textTruncated ? { textTruncated: true } : {}),
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
