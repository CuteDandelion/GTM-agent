import type { UploadableDocument } from "./document-upload-service";

type PickResult =
  | { canceled: true; result: null }
  | { canceled: false; result: UploadableDocument };

export function createDocumentPicker(pickFile: () => Promise<PickResult>) {
  return {
    async pick() {
      const result = await pickFile();
      return result.canceled ? undefined : result.result;
    },
  };
}

export type DocumentPickerService = ReturnType<typeof createDocumentPicker>;
