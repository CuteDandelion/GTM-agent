import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const contractPath = resolve(repositoryRoot, "openapi/openapi.json");

const expectedOperations = [
  "GET /health",
  "GET /ready",
  "GET /api/v1/seller-profile",
  "PUT /api/v1/seller-profile",
  "POST /api/v1/conversations",
  "GET /api/v1/conversations",
  "GET /api/v1/conversations/{conversationId}",
  "GET /api/v1/conversations/{conversationId}/messages",
  "GET /api/v1/conversations/{conversationId}/export",
  "GET /api/v1/conversations/{conversationId}/interactive-objects",
  "POST /api/v1/conversations/{conversationId}/messages",
  "GET /api/v1/runs/{runId}",
  "POST /api/v1/runs/{runId}/cancel",
  "POST /api/v1/runs/{runId}/resume",
  "POST /api/v1/interactive-objects/{objectId}/actions",
].sort();

function loadContract() {
  expect(existsSync(contractPath), "the release OpenAPI contract must exist").toBe(true);
  return JSON.parse(readFileSync(contractPath, "utf8")) as {
    openapi: string;
    paths: Record<string, Record<string, { responses?: unknown; security?: unknown }>>;
  };
}

describe("public OpenAPI contract", () => {
  it("documents every release operation and maps each operation to a real route", async () => {
    const contract = loadContract();
    const documentedOperations = Object.entries(contract.paths).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((method) => ["get", "post", "put", "patch", "delete"].includes(method))
        .map((method) => `${method.toUpperCase()} ${path}`),
    ).sort();

    expect(contract.openapi).toBe("3.1.0");
    expect(documentedOperations).toEqual(expectedOperations);

    const server = buildServer({ logger: false });
    await server.ready();
    try {
      for (const operation of documentedOperations) {
        const [method, path] = operation.split(" ");
        if (!method || !path) throw new Error(`invalid operation key: ${operation}`);
        const fastifyPath = path.replaceAll(/{([^}]+)}/g, ":$1");
        expect(server.hasRoute({ method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: fastifyPath }), operation).toBe(true);
      }
    } finally {
      await server.close();
    }
  });

  it("declares successful responses and bearer authentication for protected operations", () => {
    const contract = loadContract();

    for (const [path, item] of Object.entries(contract.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        expect(operation.responses, `${method.toUpperCase()} ${path} responses`).toBeDefined();
        expect(
          Object.keys(operation.responses ?? {}).some((status) => /^2\d\d$/.test(status)),
          `${method.toUpperCase()} ${path} successful response`,
        ).toBe(true);
        if (path !== "/health" && path !== "/ready") {
          expect(operation.security, `${method.toUpperCase()} ${path} security`).toEqual([{ bearerAuth: [] }]);
        }
      }
    }
  });
});
