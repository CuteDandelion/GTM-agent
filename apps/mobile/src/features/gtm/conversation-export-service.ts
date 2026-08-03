import type {
  ConversationExportFormat,
  ConversationExportService,
  DownloadedConversationExport,
} from "./conversation-export-client";

export function createConversationExportService(options: {
  download(format: ConversationExportFormat): Promise<DownloadedConversationExport>;
  isSharingAvailable(): Promise<boolean>;
  write(fileName: string, contents: string): Promise<string>;
  share(uri: string, mimeType: string): Promise<void>;
}): ConversationExportService {
  return {
    async export(format) {
      if (!await options.isSharingAvailable()) {
        throw new Error("Sharing is not available on this device");
      }
      const downloaded = await options.download(format);
      const uri = await options.write(downloaded.fileName, downloaded.contents);
      await options.share(uri, downloaded.mimeType);
    },
  };
}
