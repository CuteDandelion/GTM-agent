import { createSupabaseDocumentUploadService } from "./document-upload-service";

const ownerId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";

function createClient(metadataError?: string) {
  const uploaded: string[] = [];
  const removed: string[] = [];
  const row = {
    id: documentId,
    owner_id: ownerId,
    conversation_id: conversationId,
    bucket_id: "user-uploads",
    storage_path: `${ownerId}/${documentId}/sales-notes.txt`,
    file_name: "sales notes.txt",
    mime_type: "text/plain",
    size_bytes: 18,
    status: "uploaded",
    created_at: "2026-08-02T09:00:00.000Z",
    updated_at: "2026-08-02T09:00:00.000Z",
  };
  return {
    uploaded,
    removed,
    client: {
      auth: { getUser: async () => ({ data: { user: { id: ownerId } }, error: null }) },
      storage: {
        from: () => ({
          upload: async (path: string) => {
            uploaded.push(path);
            return { data: { path }, error: null };
          },
          remove: async (paths: string[]) => {
            removed.push(...paths);
            return { data: paths, error: null };
          },
        }),
      },
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => metadataError
              ? { data: null, error: { message: metadataError } }
              : { data: row, error: null },
          }),
        }),
      }),
    },
  };
}

describe("private document upload service", () => {
  it("uploads into the authenticated owner's private path and registers metadata", async () => {
    const { client, uploaded } = createClient();
    const service = createSupabaseDocumentUploadService(client as never, {
      createId: () => documentId,
      maxBytes: 10_000,
    });

    await expect(service.upload({
      conversationId,
      file: {
        name: "sales notes.txt",
        type: "text/plain",
        size: 18,
        arrayBuffer: async () => new TextEncoder().encode("controlled source").buffer,
      },
    })).resolves.toMatchObject({
      id: documentId,
      storagePath: `${ownerId}/${documentId}/sales-notes.txt`,
      status: "uploaded",
    });
    expect(uploaded).toEqual([`${ownerId}/${documentId}/sales-notes.txt`]);
  });

  it("removes the private object when metadata registration fails", async () => {
    const { client, removed } = createClient("database unavailable");
    const service = createSupabaseDocumentUploadService(client as never, {
      createId: () => documentId,
      maxBytes: 10_000,
    });

    await expect(service.upload({
      conversationId,
      file: {
        name: "sales notes.txt",
        type: "text/plain",
        size: 18,
        arrayBuffer: async () => new ArrayBuffer(18),
      },
    })).rejects.toThrow("Unable to register uploaded document");
    expect(removed).toEqual([`${ownerId}/${documentId}/sales-notes.txt`]);
  });
});
