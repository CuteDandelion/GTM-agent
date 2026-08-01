import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { createSupabaseWorkspaceService } from "../src/supabase-workspace.js";
import { buildServer } from "../src/server.js";
import { createSupabaseAuthService } from "../src/supabase-auth.js";

describe("Supabase workspace persistence", () => {
  it("provides a Supabase-backed workspace service", async () => {
    const module = await import("../src/supabase-workspace.js").catch(() => ({}));

    expect(typeof Reflect.get(module, "createSupabaseWorkspaceService")).toBe("function");
    expect(typeof Reflect.get(module, "createEnvironmentWorkspaceService")).toBe("function");
  });

  it.runIf(process.env.GTM_SUPABASE_INTEGRATION === "1")(
    "creates and updates one durable seller profile for an authenticated owner",
    async () => {
      const url = process.env.SUPABASE_URL;
      const secretKey = process.env.SUPABASE_SECRET_KEY;
      expect(url).toBeTruthy();
      expect(secretKey).toBeTruthy();
      const client = createClient(url!, secretKey!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const email = `gtm-workspace-${randomUUID()}@example.test`;
      const created = await client.auth.admin.createUser({ email, password: randomUUID(), email_confirm: true });
      expect(created.error).toBeNull();
      const ownerId = created.data.user?.id;
      expect(ownerId).toBeTruthy();

      try {
        const service = createSupabaseWorkspaceService(client);
        const first = await service.upsertSellerProfile(ownerId!, {
          businessName: "Dandelion AI",
          offerSummary: "AI and agent automation",
          capabilities: ["Agent orchestration"],
          proofPoints: ["Production deployments"],
          constraints: { externalWritesRequireApproval: true },
        }) as { id: string; businessName: string; offerSummary: string };
        const updated = await service.upsertSellerProfile(ownerId!, {
          businessName: "Dandelion AI Studio",
          offerSummary: "Evidence-led AI and agent automation",
          capabilities: ["Agent orchestration", "Workflow automation"],
          proofPoints: ["Production deployments"],
          constraints: { externalWritesRequireApproval: true },
        }) as { id: string; businessName: string; offerSummary: string };
        const loaded = await service.getSellerProfile(ownerId!) as typeof updated;

        expect(first.businessName).toBe("Dandelion AI");
        expect(updated.id).toBe(first.id);
        expect(loaded).toMatchObject({
          id: first.id,
          businessName: "Dandelion AI Studio",
          offerSummary: "Evidence-led AI and agent automation",
        });

        const conversation = await service.createConversation(ownerId!, {
          title: "Acme opportunity research",
          sellerProfileId: first.id,
        }) as { id: string; ownerId: string };
        await service.appendMessage(ownerId!, conversation.id, {
          role: "user",
          content: { text: "Analyze acme.ai", domains: ["acme.ai"] },
        });
        await service.appendMessage(ownerId!, conversation.id, {
          role: "assistant",
          content: { text: "Research started" },
        });
        const restoredMessages = await service.listMessages(ownerId!, conversation.id) as Array<{
          role: string;
          sequence: number;
          content: { text: string };
        }>;

        expect(await service.getConversation(ownerId!, conversation.id)).toMatchObject({
          id: conversation.id,
          title: "Acme opportunity research",
        });
        expect(restoredMessages.map(({ role, content }) => ({ role, text: content.text }))).toEqual([
          { role: "user", text: "Analyze acme.ai" },
          { role: "assistant", text: "Research started" },
        ]);
        expect(restoredMessages[1]!.sequence).toBe(restoredMessages[0]!.sequence + 1);
        const otherOwnerId = "55555555-5555-4555-8555-555555555555";
        expect(await service.getConversation(otherOwnerId, conversation.id)).toBeUndefined();
        expect(await service.listMessages(otherOwnerId, conversation.id)).toBeUndefined();
      } finally {
        if (ownerId) await client.auth.admin.deleteUser(ownerId);
      }
    },
  );

  it.runIf(process.env.GTM_SUPABASE_INTEGRATION === "1")(
    "enforces owner isolation through RLS for authenticated Data API clients",
    async () => {
      const url = process.env.SUPABASE_URL!;
      const secretKey = process.env.SUPABASE_SECRET_KEY!;
      const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
      expect(publishableKey).toBeTruthy();
      const admin = createClient(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const ownerPassword = `Owner-${randomUUID()}`;
      const otherPassword = `Other-${randomUUID()}`;
      const ownerResult = await admin.auth.admin.createUser({
        email: `gtm-rls-owner-${randomUUID()}@example.test`,
        password: ownerPassword,
        email_confirm: true,
      });
      const otherResult = await admin.auth.admin.createUser({
        email: `gtm-rls-other-${randomUUID()}@example.test`,
        password: otherPassword,
        email_confirm: true,
      });
      expect(ownerResult.error).toBeNull();
      expect(otherResult.error).toBeNull();
      const owner = ownerResult.data.user!;
      const other = otherResult.data.user!;

      try {
        const ownerClient = createClient(url, publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        const otherClient = createClient(url, publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        expect((await ownerClient.auth.signInWithPassword({ email: owner.email!, password: ownerPassword })).error).toBeNull();
        expect((await otherClient.auth.signInWithPassword({ email: other.email!, password: otherPassword })).error).toBeNull();

        const inserted = await ownerClient.from("seller_profiles").insert({
          owner_id: owner.id,
          business_name: "Owner profile",
          offer_summary: "Private owner data",
        }).select("id").single();
        expect(inserted.error).toBeNull();
        const profileId = inserted.data!.id as string;

        const hidden = await otherClient.from("seller_profiles").select("id,business_name").eq("id", profileId);
        expect(hidden.error).toBeNull();
        expect(hidden.data).toEqual([]);

        const deniedInsert = await otherClient.from("seller_profiles").insert({
          owner_id: owner.id,
          business_name: "Forged profile",
          offer_summary: "Must be denied",
        });
        expect(deniedInsert.error).not.toBeNull();
      } finally {
        await admin.auth.admin.deleteUser(owner.id);
        await admin.auth.admin.deleteUser(other.id);
      }
    },
  );

  it.runIf(process.env.GTM_SUPABASE_INTEGRATION === "1")(
    "keeps uploaded research documents private to the owner's Storage folder",
    async () => {
      const url = process.env.SUPABASE_URL!;
      const secretKey = process.env.SUPABASE_SECRET_KEY!;
      const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
      const admin = createClient(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const ownerPassword = `Owner-${randomUUID()}`;
      const otherPassword = `Other-${randomUUID()}`;
      const ownerResult = await admin.auth.admin.createUser({
        email: `gtm-storage-owner-${randomUUID()}@example.test`,
        password: ownerPassword,
        email_confirm: true,
      });
      const otherResult = await admin.auth.admin.createUser({
        email: `gtm-storage-other-${randomUUID()}@example.test`,
        password: otherPassword,
        email_confirm: true,
      });
      const owner = ownerResult.data.user!;
      const other = otherResult.data.user!;
      expect(ownerResult.error).toBeNull();
      expect(otherResult.error).toBeNull();

      try {
        const ownerClient = createClient(url, publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        const otherClient = createClient(url, publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        await ownerClient.auth.signInWithPassword({ email: owner.email!, password: ownerPassword });
        await otherClient.auth.signInWithPassword({ email: other.email!, password: otherPassword });
        const path = `${owner.id}/controlled-source.txt`;

        const uploaded = await ownerClient.storage.from("user-uploads").upload(
          path,
          new Blob(["controlled GTM research source"], { type: "text/plain" }),
        );
        expect(uploaded.error).toBeNull();
        const downloaded = await ownerClient.storage.from("user-uploads").download(path);
        expect(downloaded.error).toBeNull();
        expect(await downloaded.data!.text()).toBe("controlled GTM research source");

        const hidden = await otherClient.storage.from("user-uploads").download(path);
        expect(hidden.error).not.toBeNull();
        const deniedUpload = await otherClient.storage.from("user-uploads").upload(
          `${owner.id}/forged.txt`,
          new Blob(["must not be accepted"], { type: "text/plain" }),
        );
        expect(deniedUpload.error).not.toBeNull();

        expect((await ownerClient.storage.from("user-uploads").remove([path])).error).toBeNull();
      } finally {
        await admin.auth.admin.deleteUser(owner.id);
        await admin.auth.admin.deleteUser(other.id);
      }
    },
  );

  it.runIf(process.env.GTM_SUPABASE_INTEGRATION === "1")(
    "restores an authenticated conversation through the HTTP API after a server restart",
    async () => {
      const url = process.env.SUPABASE_URL!;
      const secretKey = process.env.SUPABASE_SECRET_KEY!;
      const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
      const admin = createClient(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const password = `Owner-${randomUUID()}`;
      const userResult = await admin.auth.admin.createUser({
        email: `gtm-http-owner-${randomUUID()}@example.test`,
        password,
        email_confirm: true,
      });
      const user = userResult.data.user!;
      expect(userResult.error).toBeNull();
      const userClient = createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const signedIn = await userClient.auth.signInWithPassword({ email: user.email!, password });
      expect(signedIn.error).toBeNull();
      const authorization = `Bearer ${signedIn.data.session!.access_token}`;
      const authService = createSupabaseAuthService(createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }));
      const researchService = {
        startDomainResearch: async () => ({ runId: "run-local-1", status: "queued" as const, interactiveObject: {} }),
        getRun: async () => undefined,
        cancelRun: async () => undefined,
        resumeRun: async () => undefined,
      };
      let server: ReturnType<typeof buildServer> | undefined;

      try {
        const makeServer = () => buildServer({
          logger: false,
          authService,
          researchService,
          workspaceService: createSupabaseWorkspaceService(admin),
        });
        server = makeServer();
        let origin = await server.listen({ host: "127.0.0.1", port: 0 });
        const headers = { authorization, "content-type": "application/json" };
        expect((await fetch(`${origin}/api/v1/seller-profile`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            businessName: "Local integration seller",
            offerSummary: "AI automation",
            capabilities: ["Agent orchestration"],
            proofPoints: [],
            constraints: { externalWritesRequireApproval: true },
          }),
        })).status).toBe(200);
        const conversationResponse = await fetch(`${origin}/api/v1/conversations`, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "Restart-safe conversation" }),
        });
        expect(conversationResponse.status).toBe(201);
        const conversation = await conversationResponse.json() as { id: string };
        expect((await fetch(`${origin}/api/v1/conversations/${conversation.id}/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({ message: "Analyze acme.ai", domains: ["acme.ai"] }),
        })).status).toBe(202);

        await server.close();
        server = makeServer();
        origin = await server.listen({ host: "127.0.0.1", port: 0 });
        const restored = await fetch(`${origin}/api/v1/conversations/${conversation.id}/messages`, { headers });

        expect(restored.status).toBe(200);
        expect(await restored.json()).toEqual([
          expect.objectContaining({ role: "user", content: expect.objectContaining({ text: "Analyze acme.ai" }) }),
        ]);
      } finally {
        await server?.close();
        await admin.auth.admin.deleteUser(user.id);
      }
    },
  );
});
