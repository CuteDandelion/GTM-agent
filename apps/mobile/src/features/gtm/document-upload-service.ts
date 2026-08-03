export interface UploadableDocument {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface UploadedDocument {
  id: string;
  ownerId: string;
  conversationId: string;
  bucketId: "user-uploads";
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploaded" | "processing" | "ready" | "failed";
  createdAt: string;
  updatedAt: string;
}

interface DocumentClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>;
  };
  storage: {
    from(bucket: "user-uploads"): {
      upload(path: string, body: ArrayBuffer, options: { contentType: string; upsert: false }): Promise<{ data: unknown; error: { message: string } | null }>;
      remove(paths: string[]): Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
  from(table: "user_documents"): {
    insert(values: Record<string, unknown>): {
      select(columns: string): {
        single(): PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
}

type DocumentRow = {
  id: string;
  owner_id: string;
  conversation_id: string;
  bucket_id: "user-uploads";
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: UploadedDocument["status"];
  created_at: string;
  updated_at: string;
};

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/html",
  "application/xhtml+xml",
  "text/markdown",
  "text/plain",
  "application/json",
  "text/csv",
]);
const documentColumns = "id,owner_id,conversation_id,bucket_id,storage_path,file_name,mime_type,size_bytes,status,created_at,updated_at";

function safeFileName(fileName: string) {
  const normalized = fileName.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "document";
}

function mapDocument(value: unknown): UploadedDocument {
  if (typeof value !== "object" || value === null) throw new Error("Uploaded document response was invalid");
  const row = value as Partial<DocumentRow>;
  if (typeof row.id !== "string" || typeof row.owner_id !== "string" || typeof row.conversation_id !== "string"
    || row.bucket_id !== "user-uploads" || typeof row.storage_path !== "string" || typeof row.file_name !== "string"
    || typeof row.mime_type !== "string" || typeof row.size_bytes !== "number"
    || !["uploaded", "processing", "ready", "failed"].includes(String(row.status))
    || typeof row.created_at !== "string" || typeof row.updated_at !== "string") {
    throw new Error("Uploaded document response was invalid");
  }
  return {
    id: row.id,
    ownerId: row.owner_id,
    conversationId: row.conversation_id,
    bucketId: row.bucket_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    status: row.status as UploadedDocument["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSupabaseDocumentUploadService(
  client: DocumentClient,
  options: { maxBytes: number; createId?: () => string },
) {
  if (options.maxBytes < 1) throw new Error("Document upload budget must be positive");
  const createId = options.createId ?? (() => globalThis.crypto.randomUUID());
  return {
    async upload(input: { conversationId: string; file: UploadableDocument }) {
      const mimeType = input.file.type.toLowerCase().split(";")[0]!.trim();
      if (!allowedMimeTypes.has(mimeType)) throw new Error(`Unsupported document type: ${mimeType || "unknown"}`);
      if (input.file.size < 1 || input.file.size > options.maxBytes) throw new Error("Document exceeded its upload size limit");
      const userResult = await client.auth.getUser();
      if (userResult.error || !userResult.data.user) throw new Error("An authenticated user is required to upload documents");
      const ownerId = userResult.data.user.id;
      const documentId = createId();
      const storagePath = `${ownerId}/${documentId}/${safeFileName(input.file.name)}`;
      const bytes = await input.file.arrayBuffer();
      if (bytes.byteLength < 1 || bytes.byteLength > options.maxBytes) throw new Error("Document exceeded its upload size limit");

      const bucket = client.storage.from("user-uploads");
      const uploaded = await bucket.upload(storagePath, bytes, { contentType: mimeType, upsert: false });
      if (uploaded.error) throw new Error(`Unable to upload document: ${uploaded.error.message}`);
      const metadata = await client.from("user_documents").insert({
        id: documentId,
        owner_id: ownerId,
        conversation_id: input.conversationId,
        bucket_id: "user-uploads",
        storage_path: storagePath,
        file_name: input.file.name,
        mime_type: mimeType,
        size_bytes: bytes.byteLength,
        status: "uploaded",
      }).select(documentColumns).single();
      if (metadata.error) {
        await bucket.remove([storagePath]);
        throw new Error(`Unable to register uploaded document: ${metadata.error.message}`);
      }
      return mapDocument(metadata.data);
    },
  };
}

export type DocumentUploadService = ReturnType<typeof createSupabaseDocumentUploadService>;
