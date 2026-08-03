import { describe, expect, it } from "vitest";

import { createSupabaseDocumentService } from "../src/supabase-documents.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";

function createClient(blobType = "text/plain") {
  const updates: Record<string, unknown>[] = [];
  const row = {
    id: documentId,
    owner_id: ownerId,
    conversation_id: conversationId,
    bucket_id: "user-uploads",
    storage_path: `${ownerId}/${documentId}/brief.txt`,
    file_name: "brief.txt",
    mime_type: "text/plain",
    size_bytes: 17,
    status: "uploaded",
  };
  return {
    updates,
    client: {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
          }),
        }),
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          return { eq: () => ({ eq: async () => ({ data: null, error: null }) }) };
        },
      }),
      storage: {
        from: () => ({
          download: async () => ({
            data: new Blob(["controlled source"], { type: blobType }),
            error: null,
          }),
        }),
      },
    },
  };
}

describe("Supabase document processing", () => {
  it("downloads an owner-scoped document and returns bounded untrusted text", async () => {
    const { client, updates } = createClient();
    const service = createSupabaseDocumentService(client as never, {
      maxBytes: 10_485_760,
      maxCharacters: 100_000,
    });

    await expect(service.readDocument(ownerId, documentId)).resolves.toMatchObject({
      documentId,
      fileName: "brief.txt",
      text: "controlled source",
      trust: "untrusted_document",
    });
    expect(updates).toEqual([
      expect.objectContaining({ status: "processing" }),
      expect.objectContaining({ status: "ready", content_hash: expect.stringMatching(/^sha256:/) }),
    ]);
  });

  it("rejects a stored MIME mismatch and records a safe failure state", async () => {
    const { client, updates } = createClient("application/pdf");
    const service = createSupabaseDocumentService(client as never, {
      maxBytes: 10_485_760,
      maxCharacters: 100_000,
    });

    await expect(service.readDocument(ownerId, documentId)).rejects.toThrow("Stored document MIME type did not match metadata");
    expect(updates.at(-1)).toMatchObject({
      status: "failed",
      error: { code: "document_processing_failed" },
    });
  });
});
