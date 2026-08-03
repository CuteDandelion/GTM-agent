import { createServer } from "node:http";

import type { FunctionToolAdapterDefinition, ToolRunContext } from "./index.js";

interface SessionRegistration {
  context: ToolRunContext;
  allowedTools: Set<string>;
  requiredTools: Set<string>;
  definitions: Record<string, FunctionToolAdapterDefinition>;
  usedTools: Set<string>;
}

export interface OpenCodeToolRegistration {
  usedTools(): string[];
  missingRequiredTools(): string[];
  dispose(): void;
}

export interface OpenCodeToolBridge {
  register(options: {
    sessionId: string;
    context: ToolRunContext;
    allowedTools: string[];
    requiredTools: string[];
    definitions: Record<string, FunctionToolAdapterDefinition>;
  }): OpenCodeToolRegistration;
  invoke(options: {
    secret: string;
    sessionId: string;
    toolName: string;
    input: unknown;
  }): Promise<unknown>;
}

export function createOpenCodeToolBridge(options: { secret: string }): OpenCodeToolBridge {
  if (!options.secret) throw new Error("OpenCode tool bridge secret is required");
  const sessions = new Map<string, SessionRegistration>();

  return {
    register(registrationOptions) {
      if (sessions.has(registrationOptions.sessionId)) {
        throw new Error(`OpenCode tool session is already registered: ${registrationOptions.sessionId}`);
      }
      const registration: SessionRegistration = {
        context: registrationOptions.context,
        allowedTools: new Set(registrationOptions.allowedTools),
        requiredTools: new Set(registrationOptions.requiredTools),
        definitions: registrationOptions.definitions,
        usedTools: new Set(),
      };
      sessions.set(registrationOptions.sessionId, registration);
      return {
        usedTools: () => [...registration.usedTools],
        missingRequiredTools: () => [...registration.requiredTools]
          .filter((toolName) => !registration.usedTools.has(toolName)),
        dispose: () => {
          if (sessions.get(registrationOptions.sessionId) === registration) {
            sessions.delete(registrationOptions.sessionId);
          }
        },
      };
    },

    async invoke(invokeOptions) {
      if (invokeOptions.secret !== options.secret) {
        throw new Error("Unauthorized OpenCode tool bridge request");
      }
      const registration = sessions.get(invokeOptions.sessionId);
      if (!registration) throw new Error(`Unknown OpenCode tool session: ${invokeOptions.sessionId}`);
      if (!registration.allowedTools.has(invokeOptions.toolName)) {
        throw new Error(`Tool ${invokeOptions.toolName} is not allowed for OpenCode session ${invokeOptions.sessionId}`);
      }
      const definition = registration.definitions[invokeOptions.toolName];
      if (!definition) throw new Error(`No OpenCode tool handler is configured for ${invokeOptions.toolName}`);
      const result = await definition.handler(invokeOptions.input, registration.context);
      registration.usedTools.add(invokeOptions.toolName);
      return result;
    },
  };
}

export async function startOpenCodeToolBridgeServer(options: {
  bridge: OpenCodeToolBridge;
  secret: string;
}): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method !== "POST" || request.url !== "/invoke") {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    if (request.headers.authorization !== `Bearer ${options.secret}`) {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 1_048_576) throw new Error("OpenCode tool request exceeds 1 MiB");
        chunks.push(buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        sessionId?: unknown;
        toolName?: unknown;
        input?: unknown;
      };
      if (typeof body.sessionId !== "string" || typeof body.toolName !== "string") {
        throw new Error("OpenCode tool request requires sessionId and toolName");
      }
      const output = await options.bridge.invoke({
        secret: options.secret,
        sessionId: body.sessionId,
        toolName: body.toolName,
        input: body.input,
      });
      response.statusCode = 200;
      response.end(JSON.stringify({ output }));
    } catch (error) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Tool invocation failed" }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to resolve OpenCode tool bridge address");
  return {
    url: `http://127.0.0.1:${address.port}/invoke`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
