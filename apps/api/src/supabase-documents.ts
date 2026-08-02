import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createDocumentReader, type ExtractedDocument } from "@gtm/documents";
import { createSupabaseFetch } from "./supabase-fetch.js";

type DocumentRow = {
  id: string;
  owner_id: string;
  conversation_id: string;
  bucket_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: "uploaded" | "processing" | "ready" | "failed" | "deleted";
};

export type ProcessedDocument = ExtractedDocument & {
  documentId: string;
};

export interface DocumentService {
  readDocument(ownerId: string, documentId: string): Promise<ProcessedDocument>;
}

const documentColumns = "id,owner_id,conversation_id,bucket_id,storage_path,file_name,mime_type,size_bytes,status";

function normalizedMime(value: string) {
  return value.toLowerCase().split(";")[0]!.trim();
}

export function createSupabaseDocumentService(
  client: SupabaseClient,
  options: { maxBytes: number; maxCharacters: number },
): DocumentService {
  const reader = createDocumentReader(options);

  async function updateDocument(ownerId: string, documentId: string, values: Record<string, unknown>) {
    const result = await client
      .from("user_documents")
      .update(values)
      .eq("id", documentId)
      .eq("owner_id", ownerId);
    if (result.error) throw new Error(`Unable to update document state: ${result.error.message}`);
  }

  return {
    async readDocument(ownerId, documentId) {
      const selected = await client
        .from("user_documents")
        .select(documentColumns)
        .eq("id", documentId)
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (selected.error) throw new Error(`Unable to load document metadata: ${selected.error.message}`);
      if (!selected.data) throw new Error("Document not found");

      const row = selected.data as DocumentRow;
      if (row.bucket_id !== "user-uploads" || !row.storage_path.startsWith(`${ownerId}/`)) {
        throw new Error("Document storage path is not authorized for this owner");
      }

      try {
        await updateDocument(ownerId, documentId, { status: "processing", error: null });
        const downloaded = await client.storage.from(row.bucket_id).download(row.storage_path);
        if (downloaded.error || !downloaded.data) {
          throw new Error(`Unable to download document: ${downloaded.error?.message ?? "empty response"}`);
        }

        const observedMime = normalizedMime(downloaded.data.type);
        const expectedMime = normalizedMime(row.mime_type);
        if (observedMime && observedMime !== expectedMime) {
          throw new Error("Stored document MIME type did not match metadata");
        }

        const extracted = await reader.read({
          fileName: row.file_name,
          mimeType: expectedMime,
          bytes: new Uint8Array(await downloaded.data.arrayBuffer()),
        });
        await updateDocument(ownerId, documentId, {
          status: "ready",
          content_hash: extracted.contentHash,
          extraction_metadata: {
            characterCount: extracted.characterCount,
            observedAt: extracted.observedAt,
            trust: extracted.trust,
            modelBoundary: extracted.modelBoundary,
          },
          error: null,
        });
        return { documentId, ...extracted };
      } catch (error) {
        await updateDocument(ownerId, documentId, {
          status: "failed",
          error: { code: "document_processing_failed" },
        });
        throw error;
      }
    },
  };
}

export function createEnvironmentDocumentService(
  environment: NodeJS.ProcessEnv = process.env,
): DocumentService | undefined {
  const url = environment.SUPABASE_URL;
  const secretKey = environment.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return undefined;
  return createSupabaseDocumentService(createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createSupabaseFetch() },
  }), {
    maxBytes: 10_485_760,
    maxCharacters: 100_000,
  });
}
