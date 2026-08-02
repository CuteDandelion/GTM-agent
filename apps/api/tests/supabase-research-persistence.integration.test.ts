import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { DagScheduler, defineWorkflow } from "@gtm/orchestration";
import { describe, expect, it } from "vitest";

describe("Supabase research persistence", () => {
  it("provides a shared durable run and checkpoint persistence factory", async () => {
    const module = await import("../src/supabase-research-persistence.js").catch(() => ({}));

    expect(typeof Reflect.get(module, "createSupabaseResearchPersistence")).toBe("function");
    expect(typeof Reflect.get(module, "createEnvironmentResearchPersistence")).toBe("function");
  });

  it.runIf(process.env.GTM_SUPABASE_INTEGRATION === "1")(
    "atomically claims prompts FIFO per conversation across worker processes",
    async () => {
      const { createSupabaseResearchPersistence } = await import("../src/supabase-research-persistence.js");
      const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const userResult = await admin.auth.admin.createUser({
        email: `gtm-queue-owner-${randomUUID()}@example.test`,
        password: `Owner-${randomUUID()}`,
        email_confirm: true,
      });
      expect(userResult.error).toBeNull();
      const owner = userResult.data.user!;
      const conversationResult = await admin.from("conversations").insert({
        owner_id: owner.id,
        title: "FIFO queue integration",
      }).select("id").single();
      expect(conversationResult.error).toBeNull();
      const conversationId = String(conversationResult.data!.id);
      const [firstRunId, secondRunId] = [randomUUID(), randomUUID()];
      const creator = createSupabaseResearchPersistence(admin);

      try {
        for (const [runId, createdAt] of [
          [firstRunId, "2026-08-02T10:00:00.000Z"],
          [secondRunId, "2026-08-02T10:00:01.000Z"],
        ] as const) {
          await creator.runStore.save({
            runId,
            conversationId,
            status: "queued",
            input: { ownerId: owner.id, conversationId, message: `Analyze ${runId}.example`, domains: [`${runId}.example`], documentIds: [] },
            createdAt,
            updatedAt: createdAt,
          });
        }

        const workers = [createSupabaseResearchPersistence(admin), createSupabaseResearchPersistence(admin)] as const;
        const claims = await Promise.all(workers.map((worker) => worker.runStore.claimNextForConversation!(
          conversationId,
          "2026-08-02T10:00:02.000Z",
        )));
        expect(claims.filter(Boolean)).toHaveLength(1);
        expect(claims.find(Boolean)).toMatchObject({ runId: firstRunId, status: "running" });

        const winnerIndex = claims.findIndex(Boolean);
        const first = claims[winnerIndex]!;
        await workers[winnerIndex]!.runStore.save({
          ...first,
          status: "completed",
          updatedAt: "2026-08-02T10:00:03.000Z",
        });
        await expect(createSupabaseResearchPersistence(admin).runStore.claimNextForConversation!(
          conversationId,
          "2026-08-02T10:00:04.000Z",
        )).resolves.toMatchObject({ runId: secondRunId, status: "running" });
      } finally {
        await admin.auth.admin.deleteUser(owner.id);
      }
    },
    20_000,
  );

  it.runIf(process.env.GTM_SUPABASE_INTEGRATION === "1")(
    "preserves the last DAG checkpoint when a later failed-run update omits it",
    async () => {
      const module = await import("../src/supabase-research-persistence.js");
      const createPersistence = module.createSupabaseResearchPersistence;
      const url = process.env.SUPABASE_URL!;
      const secretKey = process.env.SUPABASE_SECRET_KEY!;
      const admin = createClient(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const ownerPassword = `Owner-${randomUUID()}`;
      const userResult = await admin.auth.admin.createUser({
        email: `gtm-run-owner-${randomUUID()}@example.test`,
        password: ownerPassword,
        email_confirm: true,
      });
      expect(userResult.error).toBeNull();
      const owner = userResult.data.user!;
      const attackerResult = await admin.auth.admin.createUser({
        email: `gtm-run-attacker-${randomUUID()}@example.test`,
        password: `Attacker-${randomUUID()}`,
        email_confirm: true,
      });
      expect(attackerResult.error).toBeNull();
      const attacker = attackerResult.data.user!;
      const conversationResult = await admin.from("conversations").insert({
        owner_id: owner.id,
        title: "Durable Acme research",
      }).select("id").single();
      expect(conversationResult.error).toBeNull();
      const conversationId = conversationResult.data!.id as string;
      const runId = randomUUID();
      const createdAt = "2026-08-01T20:00:00.000Z";
      const completedAt = "2026-08-01T20:01:00.000Z";
      const checkpoint = {
        runId,
        workflowId: "company-domain-research-v1",
        status: "completed" as const,
        executionCount: 7,
        nodes: {
          synthesis: {
            status: "completed" as const,
            attempts: 1,
            toolsUsed: ["get_company_profile"],
            output: { company: "Acme" },
          },
        },
      };

      try {
        const firstProcess = createPersistence(admin);
        await firstProcess.runStore.save({
          runId,
          conversationId,
          status: "queued",
          input: {
            ownerId: owner.id,
            conversationId,
            message: "Analyze acme.ai",
            domains: ["acme.ai"],
            documentIds: [],
          },
          createdAt,
          updatedAt: createdAt,
        });
        const claimers = [createPersistence(admin), createPersistence(admin)] as const;
        const claimSnapshots = await Promise.all(claimers.map((persistence) => persistence.runStore.load(runId)));
        const claims = await Promise.allSettled(claimers.map((persistence, index) => persistence.runStore.save({
          ...claimSnapshots[index]!,
          status: "running",
          updatedAt: createdAt,
        })));
        expect(claims.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(claims.filter((result) => result.status === "rejected")).toHaveLength(1);
        const originalWorker = claimers[claims.findIndex((result) => result.status === "fulfilled")]!;
        const initialRun = claimSnapshots[0]!;

        const prematureRecovery = createPersistence(admin);
        await expect(prematureRecovery.runStore.save({
          ...initialRun,
          status: "queued",
          updatedAt: completedAt,
        })).rejects.toThrow(/invalid workflow run transition/i);
        const expired = await admin.from("workflow_runs").update({
          lease_expires_at: "2020-01-01T00:00:00.000Z",
        }).eq("id", runId);
        expect(expired.error).toBeNull();
        await expect(originalWorker.checkpointStore.save({ ...checkpoint, executionCount: 5 }))
          .rejects.toThrow(/worker lease expired/i);
        await expect(originalWorker.runStore.save({
          ...initialRun,
          status: "failed",
          error: "expired worker",
          updatedAt: completedAt,
        })).rejects.toThrow(/invalid workflow run transition/i);
        const recoveredProcess = createPersistence(admin);
        const interrupted = (await recoveredProcess.runStore.load(runId))!;
        expect(interrupted.status).toBe("running");
        await recoveredProcess.runStore.save({ ...interrupted, status: "queued", updatedAt: completedAt });
        await recoveredProcess.runStore.save({ ...interrupted, status: "running", updatedAt: completedAt });
        await expect(originalWorker.checkpointStore.save({ ...checkpoint, executionCount: 6 }))
          .rejects.toThrow(/worker lease conflict/i);

        const nearlyExpired = await admin.from("workflow_runs").update({
          lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
        }).eq("id", runId);
        expect(nearlyExpired.error).toBeNull();
        await recoveredProcess.checkpointStore.save(checkpoint);
        const renewedLease = await admin.from("workflow_runs").select("lease_expires_at")
          .eq("id", runId).single();
        expect(renewedLease.error).toBeNull();
        expect(new Date(renewedLease.data!.lease_expires_at as string).getTime())
          .toBeGreaterThan(Date.now() + 10 * 60_000);
        await Promise.all([
          recoveredProcess.checkpointStore.save({ ...checkpoint, status: "running", executionCount: 8 }),
          recoveredProcess.checkpointStore.save({ ...checkpoint, executionCount: 9 }),
        ]);
        await recoveredProcess.artifactStore.saveCrawledPages(
          { ownerId: owner.id, runId },
          "acme.ai",
          [],
        );
        await recoveredProcess.artifactStore.saveEvidence(
          { ownerId: owner.id, runId },
          { title: "Owner-scoped evidence" },
        );
        await recoveredProcess.runStore.save({
          runId,
          conversationId,
          status: "failed",
          input: {
            ownerId: owner.id,
            conversationId,
            message: "Analyze acme.ai",
            domains: ["acme.ai"],
            documentIds: [],
          },
          error: "provider timeout",
          createdAt,
          updatedAt: completedAt,
        });
        await expect(recoveredProcess.checkpointStore.save({ ...checkpoint, executionCount: 99 }))
          .rejects.toThrow(/not running/i);

        const restartedProcess = createPersistence(admin);
        await expect(restartedProcess.runStore.save({
          runId,
          conversationId,
          status: "running",
          input: {
            ownerId: randomUUID(),
            conversationId,
            message: "Attempt owner mutation",
            domains: ["acme.ai"],
            documentIds: [],
          },
          createdAt,
          updatedAt: completedAt,
        })).rejects.toThrow(/another owner/i);
        await expect(restartedProcess.runStore.load(runId)).resolves.toMatchObject({
          runId,
          conversationId,
          status: "failed",
          checkpoint: { executionCount: 9 },
          error: "provider timeout",
          createdAt,
          updatedAt: completedAt,
        });
        await expect(restartedProcess.checkpointStore.load(runId)).resolves.toEqual({
          ...checkpoint,
          executionCount: 9,
        });
        await expect(restartedProcess.artifactStore.listCrawledPages({ ownerId: owner.id, runId }))
          .resolves.toEqual([{ domain: "acme.ai", pages: [] }]);
        await expect(restartedProcess.artifactStore.listEvidence({ ownerId: owner.id, runId }))
          .resolves.toEqual([{ title: "Owner-scoped evidence" }]);
        await expect(restartedProcess.artifactStore.listEvidence({ ownerId: randomUUID(), runId }))
          .rejects.toThrow(/does not belong/i);
        const resumedWorkerLeaseId = randomUUID();
        const thirdProcess = createPersistence(admin, { workerLeaseId: resumedWorkerLeaseId });
        const failedRun = (await thirdProcess.runStore.load(runId))!;
        await thirdProcess.runStore.save({ ...failedRun, status: "queued", updatedAt: completedAt });
        await thirdProcess.runStore.save({ ...failedRun, status: "running", updatedAt: completedAt });
        await thirdProcess.checkpointStore.save({ ...checkpoint, executionCount: 10 });
        await expect(thirdProcess.checkpointStore.load(runId)).resolves.toEqual({
          ...checkpoint,
          executionCount: 10,
        });
        const fourthProcess = createPersistence(admin, { workerLeaseId: resumedWorkerLeaseId });
        const fifthProcess = createPersistence(admin, { workerLeaseId: resumedWorkerLeaseId });
        await Promise.all([
          fourthProcess.checkpointStore.load(runId),
          fifthProcess.checkpointStore.load(runId),
        ]);
        const competing = await Promise.allSettled([
          fourthProcess.checkpointStore.save({ ...checkpoint, executionCount: 11 }),
          fifthProcess.checkpointStore.save({ ...checkpoint, executionCount: 12 }),
        ]);
        expect(competing.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(competing.filter((result) => result.status === "rejected")).toHaveLength(1);
        const winningCheckpoint = await createPersistence(admin).checkpointStore.load(runId);
        expect([11, 12]).toContain(winningCheckpoint?.executionCount);
        const winningWriter = [fourthProcess, fifthProcess][
          competing.findIndex((result) => result.status === "fulfilled")
        ]!;
        await winningWriter.checkpointStore.save({
          runId,
          workflowId: "cancel-resume-test",
          status: "running",
          executionCount: 2,
          nodes: {
            done: { status: "completed", attempts: 1, toolsUsed: [], output: { retained: true } },
            interrupted: { status: "running", attempts: 1, toolsUsed: [] },
          },
        });

        const cancellingProcess = createPersistence(admin);
        const activeRun = (await cancellingProcess.runStore.load(runId))!;
        await cancellingProcess.runStore.save({ ...activeRun, status: "cancelled", updatedAt: completedAt });
        const cancelledCheckpoint = await createPersistence(admin).checkpointStore.load(runId);
        expect(cancelledCheckpoint?.status).toBe("cancelled");

        const postCancelWorkerLeaseId = randomUUID();
        const postCancelProcess = createPersistence(admin, { workerLeaseId: postCancelWorkerLeaseId });
        const cancelledRun = (await postCancelProcess.runStore.load(runId))!;
        await postCancelProcess.runStore.save({ ...cancelledRun, status: "queued", updatedAt: completedAt });
        await postCancelProcess.runStore.save({ ...cancelledRun, status: "running", updatedAt: completedAt });
        const executed: string[] = [];
        const scheduler = new DagScheduler({
          workflow: defineWorkflow({
            id: "cancel-resume-test",
            budget: { maxNodeExecutions: 4 },
            nodes: [
              { id: "done", dependencies: [], role: "deterministic", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
              { id: "interrupted", dependencies: ["done"], role: "deterministic", allowedTools: [], requiredTools: [], retries: 0, timeoutMs: 1_000 },
            ],
          }),
          checkpoints: postCancelProcess.checkpointStore,
          executor: async ({ node }) => {
            executed.push(node.id);
            return { resumed: node.id };
          },
        });
        const resumedCheckpoint = await scheduler.resume(runId, {});
        expect(resumedCheckpoint.status).toBe("completed");
        expect(executed).toEqual(["interrupted"]);
        expect(resumedCheckpoint.nodes.done?.attempts).toBe(1);
        expect(resumedCheckpoint.nodes.interrupted?.attempts).toBe(2);

        const poisoned = await admin.from("research_artifacts").insert({
          workflow_run_id: runId,
          owner_id: attacker.id,
          artifact_kind: "evidence",
          artifact_key: randomUUID(),
          payload: { title: "cross-owner poison" },
        });
        expect(poisoned.error?.message).toMatch(/foreign key/i);

        const ownerClient = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        const signedIn = await ownerClient.auth.signInWithPassword({
          email: owner.email!,
          password: ownerPassword,
        });
        expect(signedIn.error).toBeNull();
        const directWrite = await ownerClient.from("research_artifacts").insert({
          owner_id: owner.id,
          workflow_run_id: runId,
          artifact_kind: "evidence",
          artifact_key: randomUUID(),
          payload: { title: "client-side write" },
        });
        expect(directWrite.error?.message).toMatch(/permission denied/i);
      } finally {
        await admin.auth.admin.deleteUser(attacker.id);
        await admin.auth.admin.deleteUser(owner.id);
      }
    },
    20_000,
  );
});
