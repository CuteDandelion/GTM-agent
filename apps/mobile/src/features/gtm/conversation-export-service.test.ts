import { createConversationExportService } from "./conversation-export-service";

describe("conversation export service", () => {
  it("writes the downloaded export to a private cache file and opens native sharing", async () => {
    const writes: { fileName: string; contents: string }[] = [];
    const shares: { uri: string; mimeType: string }[] = [];
    const service = createConversationExportService({
      download: async () => ({ fileName: "conversation.md", mimeType: "text/markdown", contents: "# Export" }),
      isSharingAvailable: async () => true,
      write: async (fileName, contents) => {
        writes.push({ fileName, contents });
        return `file:///cache/${fileName}`;
      },
      share: async (uri, mimeType) => { shares.push({ uri, mimeType }); },
    });

    await service.export("markdown");

    expect(writes).toEqual([{ fileName: "conversation.md", contents: "# Export" }]);
    expect(shares).toEqual([{ uri: "file:///cache/conversation.md", mimeType: "text/markdown" }]);
  });

  it("fails clearly when native sharing is unavailable", async () => {
    const service = createConversationExportService({
      download: async () => ({ fileName: "conversation.json", mimeType: "application/json", contents: "{}" }),
      isSharingAvailable: async () => false,
      write: async () => "file:///cache/conversation.json",
      share: async () => undefined,
    });

    await expect(service.export("json")).rejects.toThrow("Sharing is not available on this device");
  });
});
