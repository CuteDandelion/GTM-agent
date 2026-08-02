import { createDocumentPicker } from "./document-picker";

describe("native document picker adapter", () => {
  it("returns the selected file and treats cancellation as no attachment", async () => {
    const file = {
      name: "brief.pdf",
      type: "application/pdf",
      size: 512,
      arrayBuffer: async () => new ArrayBuffer(512),
    };
    const selected = createDocumentPicker(async () => ({ canceled: false as const, result: file }));
    const cancelled = createDocumentPicker(async () => ({ canceled: true as const, result: null }));

    await expect(selected.pick()).resolves.toBe(file);
    await expect(cancelled.pick()).resolves.toBeUndefined();
  });
});
