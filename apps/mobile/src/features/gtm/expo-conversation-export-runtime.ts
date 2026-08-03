import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { downloadConversationExport } from "./conversation-export-client";
import { createConversationExportService } from "./conversation-export-service";

export function safeExportFileName(fileName: string): string {
  let decoded = fileName;
  try {
    decoded = decodeURIComponent(fileName);
  } catch {
    // A malformed server filename is treated as opaque untrusted text.
  }
  const basename = decoded.split(/[\\/]/).at(-1) ?? "";
  const safe = basename
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^\.+/, "")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return safe || "gtm-research-export.txt";
}

export function createExpoConversationExportService(input: {
  apiBaseUrl: string;
  accessToken: string;
  conversationId: string;
  fetcher?: typeof fetch;
}) {
  return createConversationExportService({
    download: (format) => downloadConversationExport({ ...input, format }),
    isSharingAvailable: () => Sharing.isAvailableAsync(),
    write: async (fileName, contents) => {
      const file = new File(Paths.cache, safeExportFileName(fileName));
      file.create({ intermediates: true, overwrite: true });
      file.write(contents);
      return file.uri;
    },
    share: (uri, mimeType) => Sharing.shareAsync(uri, {
      mimeType,
      dialogTitle: "Share GTM research export",
    }),
  });
}
