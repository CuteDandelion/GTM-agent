import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createOpencode as createSdkOpenCode } from "@opencode-ai/sdk/v2";

import type { OpenCodeSessionTransport } from "./opencode-runtime.js";
import {
  createOpenCodeToolBridge,
  startOpenCodeToolBridgeServer,
  type OpenCodeToolBridge,
} from "./opencode-tool-bridge.js";

interface SdkResult<T> {
  data?: T;
  error?: unknown;
}

export interface OpenCodeSdkClientLike {
  global?: {
    health(): Promise<SdkResult<{ healthy: boolean; version: string }>>;
  };
  session: {
    create(parameters: { title: string; directory: string }): Promise<SdkResult<{ id: string }>>;
    prompt(parameters: {
      sessionID: string;
      directory: string;
      agent: string;
      model: { providerID: string; modelID: string };
      variant?: string;
      system: string;
      parts: Array<{ type: "text"; text: string }>;
      tools: Record<string, boolean>;
      format: { type: "json_schema"; schema: Record<string, unknown>; retryCount: number };
    }): Promise<SdkResult<{
      info: { id: string; structured?: unknown; error?: unknown };
      parts: Array<{
        type: string;
        text?: string;
        tool?: string;
        state?: { status?: string };
      }>;
    }>>;
    delete(parameters: { sessionID: string; directory: string }): Promise<SdkResult<boolean>>;
  };
}

interface OpenCodeServerLike {
  url: string;
  close(): Promise<void>;
}

type CreateOpenCode = (options: {
  hostname: string;
  port: number;
  timeout: number;
  config: Record<string, unknown>;
}) => Promise<{ client: OpenCodeSdkClientLike; server: OpenCodeServerLike }>;

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const record = error as { message?: unknown; data?: { message?: unknown } };
    if (typeof record.message === "string") return record.message;
    if (typeof record.data?.message === "string") return record.data.message;
  }
  return fallback;
}

function requireData<T>(result: SdkResult<T>, operation: string): T {
  if (result.error) throw new Error(errorMessage(result.error, `OpenCode ${operation} failed`));
  if (result.data === undefined) throw new Error(`OpenCode ${operation} returned no data`);
  return result.data;
}

export function createOpenCodeSessionTransport(options: {
  client: OpenCodeSdkClientLike;
  directory: string;
}): OpenCodeSessionTransport {
  return {
    async createSession({ title }) {
      const data = requireData(await options.client.session.create({
        title,
        directory: options.directory,
      }), "session creation");
      return { id: data.id };
    },

    async prompt(promptOptions) {
      const data = requireData(await options.client.session.prompt({
        sessionID: promptOptions.sessionId,
        directory: options.directory,
        agent: "gtm-runtime",
        model: promptOptions.model,
        ...(promptOptions.variant ? { variant: promptOptions.variant } : {}),
        system: promptOptions.system,
        parts: [{ type: "text", text: promptOptions.text }],
        tools: promptOptions.tools,
        format: promptOptions.format,
      }), "prompt");
      if (data.info.error) {
        throw new Error(errorMessage(data.info.error, "OpenCode provider request failed"));
      }
      const text = data.parts
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");
      const toolNames = data.parts.flatMap((part) =>
        part.type === "tool" && part.state?.status === "completed" && typeof part.tool === "string"
          ? [part.tool]
          : []);
      return {
        messageId: data.info.id,
        ...(data.info.structured !== undefined ? { structuredOutput: data.info.structured } : {}),
        ...(text ? { text } : {}),
        toolNames,
      };
    },

    async deleteSession(sessionId) {
      requireData(await options.client.session.delete({
        sessionID: sessionId,
        directory: options.directory,
      }), "session deletion");
    },
  };
}

type ServiceEnvironmentName =
  | "GTM_TOOL_BRIDGE_URL"
  | "GTM_TOOL_BRIDGE_SECRET"
  | "XDG_DATA_HOME"
  | "XDG_CACHE_HOME"
  | "XDG_CONFIG_HOME"
  | "XDG_STATE_HOME"
  | "npm_config_cache";

function restoreEnvironment(name: ServiceEnvironmentName, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

export async function startOpenCodeAgentService(options: {
  directory: string;
  bridgeSecret?: string;
  createOpencode?: CreateOpenCode;
}): Promise<{
  transport: OpenCodeSessionTransport;
  bridge: OpenCodeToolBridge;
  isReady(): Promise<boolean>;
  close(): Promise<void>;
}> {
  const secret = options.bridgeSecret ?? randomBytes(32).toString("base64url");
  const previousUrl = process.env.GTM_TOOL_BRIDGE_URL;
  const previousSecret = process.env.GTM_TOOL_BRIDGE_SECRET;
  const previousDataHome = process.env.XDG_DATA_HOME;
  const previousCacheHome = process.env.XDG_CACHE_HOME;
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  const previousStateHome = process.env.XDG_STATE_HOME;
  const previousNpmCache = process.env.npm_config_cache;
  const bridge = createOpenCodeToolBridge({ secret });
  const bridgeServer = await startOpenCodeToolBridgeServer({ bridge, secret });
  process.env.GTM_TOOL_BRIDGE_URL = bridgeServer.url;
  process.env.GTM_TOOL_BRIDGE_SECRET = secret;
  const runtimeRoot = join(tmpdir(), "gtm-opencode", String(process.pid));
  process.env.XDG_DATA_HOME ??= join(runtimeRoot, "data");
  process.env.XDG_CACHE_HOME ??= join(runtimeRoot, "cache");
  process.env.XDG_CONFIG_HOME ??= join(runtimeRoot, "config");
  process.env.XDG_STATE_HOME ??= join(runtimeRoot, "state");
  process.env.npm_config_cache ??= join(runtimeRoot, "npm-cache");

  let started: { client: OpenCodeSdkClientLike; server: OpenCodeServerLike };
  try {
    const createOpencode = options.createOpencode ?? (createSdkOpenCode as unknown as CreateOpenCode);
    started = await createOpencode({
      hostname: "127.0.0.1",
      port: 0,
      timeout: 30_000,
      config: {
        autoupdate: false,
        share: "disabled",
        snapshot: false,
        formatter: false,
        lsp: false,
        default_agent: "gtm-runtime",
        provider: {
          "opencode-go": { options: { apiKey: "{env:OPENCODE_KEY}" } },
        },
        permission: { "*": "deny", StructuredOutput: "allow", websearch: "allow", "gtm_*": "allow" },
        agent: {
          "gtm-runtime": {
            mode: "primary",
            permission: { "*": "deny", StructuredOutput: "allow", websearch: "allow", "gtm_*": "allow" },
          },
        },
      },
    });
  } catch (error) {
    await bridgeServer.close();
    restoreEnvironment("GTM_TOOL_BRIDGE_URL", previousUrl);
    restoreEnvironment("GTM_TOOL_BRIDGE_SECRET", previousSecret);
    restoreEnvironment("XDG_DATA_HOME", previousDataHome);
    restoreEnvironment("XDG_CACHE_HOME", previousCacheHome);
    restoreEnvironment("XDG_CONFIG_HOME", previousConfigHome);
    restoreEnvironment("XDG_STATE_HOME", previousStateHome);
    restoreEnvironment("npm_config_cache", previousNpmCache);
    throw error;
  }

  let closed = false;
  return {
    transport: createOpenCodeSessionTransport({ client: started.client, directory: options.directory }),
    bridge,
    async isReady() {
      if (!started.client.global) return false;
      try {
        return requireData(await started.client.global.health(), "health check").healthy;
      } catch {
        return false;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled([started.server.close(), bridgeServer.close()]);
      restoreEnvironment("GTM_TOOL_BRIDGE_URL", previousUrl);
      restoreEnvironment("GTM_TOOL_BRIDGE_SECRET", previousSecret);
      restoreEnvironment("XDG_DATA_HOME", previousDataHome);
      restoreEnvironment("XDG_CACHE_HOME", previousCacheHome);
      restoreEnvironment("XDG_CONFIG_HOME", previousConfigHome);
      restoreEnvironment("XDG_STATE_HOME", previousStateHome);
      restoreEnvironment("npm_config_cache", previousNpmCache);
    },
  };
}
