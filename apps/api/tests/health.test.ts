import { afterEach, describe, expect, it } from "vitest";

type ServerLike = {
  listen(options: { host: string; port: number }): Promise<string>;
  close(): Promise<void>;
};

const openServers: ServerLike[] = [];

async function loadServerModule() {
  return import("../src/server.js").catch(() => ({}));
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

describe("service health boundary", () => {
  it("serves health and readiness over a real HTTP socket", async () => {
    const serverModule = await loadServerModule();
    const buildServer = Reflect.get(serverModule, "buildServer");

    expect(typeof buildServer).toBe("function");

    const server = buildServer({ logger: false }) as ServerLike;
    openServers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });

    const healthResponse = await fetch(`${origin}/health`);
    const readinessResponse = await fetch(`${origin}/ready`);

    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toEqual({
      status: "ok",
      service: "gtm-orchestrator-api",
      version: "0.1.0"
    });
    expect(healthResponse.headers.get("x-request-id")).toBeTruthy();

    expect(readinessResponse.status).toBe(200);
    expect(await readinessResponse.json()).toEqual({
      status: "ready",
      checks: { configuration: "ok" }
    });
  });

  it("serves the schema-valid canonical conversation fixture", async () => {
    const serverModule = await loadServerModule();
    const buildServer = Reflect.get(serverModule, "buildServer");
    const server = buildServer({ logger: false }) as ServerLike;
    openServers.push(server);
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });

    const response = await fetch(`${origin}/api/v1/fixtures/acme`);
    const payload = await response.json() as {
      progress: { title: string };
      assessment: { company: string; icpScore: number };
      evidence: { items: unknown[] };
    };

    expect(response.status).toBe(200);
    expect(payload.progress.title).toBe("Researching Acme");
    expect(payload.assessment).toMatchObject({ company: "Acme", icpScore: 82 });
    expect(payload.evidence.items).toHaveLength(3);
  });
});
