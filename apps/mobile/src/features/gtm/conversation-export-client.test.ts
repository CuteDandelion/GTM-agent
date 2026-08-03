import { downloadConversationExport } from "./conversation-export-client";

describe("conversation export client", () => {
  it("downloads an authenticated Markdown export", async () => {
    const fetcher = jest.fn(async () => new Response("# GTM research export\n", {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": "attachment; filename=\"conversation-1.md\"",
      },
    }));

    await expect(downloadConversationExport({
      apiBaseUrl: "https://api.example.com/",
      accessToken: "access-token",
      conversationId: "conversation-1",
      format: "markdown",
      fetcher: fetcher as typeof fetch,
    })).resolves.toEqual({
      fileName: "conversation-1.md",
      mimeType: "text/markdown",
      contents: "# GTM research export\n",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/conversations/conversation-1/export?format=markdown",
      { headers: { authorization: "Bearer access-token" } },
    );
  });
});
