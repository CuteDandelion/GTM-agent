export type ConversationExportFormat = "markdown" | "json";

export interface DownloadedConversationExport {
  fileName: string;
  mimeType: string;
  contents: string;
}

export interface ConversationExportService {
  export(format: ConversationExportFormat): Promise<void>;
}

function origin(apiBaseUrl: string) {
  return apiBaseUrl.replace(/\/+$/, "");
}

function responseFileName(header: string | null, fallback: string) {
  const match = header?.match(/filename\*?=(?:UTF-8''|\")?([^";]+)/i);
  return match?.[1] ? decodeURIComponent(match[1].trim()) : fallback;
}

export async function downloadConversationExport(input: {
  apiBaseUrl: string;
  accessToken: string;
  conversationId: string;
  format: ConversationExportFormat;
  fetcher?: typeof fetch;
}): Promise<DownloadedConversationExport> {
  const response = await (input.fetcher ?? fetch)(
    `${origin(input.apiBaseUrl)}/api/v1/conversations/${encodeURIComponent(input.conversationId)}/export?format=${input.format}`,
    { headers: { authorization: `Bearer ${input.accessToken}` } },
  );
  if (!response.ok) throw new Error(`Conversation export failed with status ${response.status}`);
  const extension = input.format === "markdown" ? "md" : "json";
  return {
    fileName: responseFileName(response.headers.get("content-disposition"), `${input.conversationId}.${extension}`),
    mimeType: response.headers.get("content-type")?.split(";")[0]?.trim() || (input.format === "markdown" ? "text/markdown" : "application/json"),
    contents: await response.text(),
  };
}
