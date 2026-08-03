import { File } from "expo-file-system";

import { createDocumentPicker } from "./document-picker";

const supportedDocumentMimeTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/html",
  "application/xhtml+xml",
  "text/markdown",
  "text/plain",
  "application/json",
  "text/csv",
];

export const expoDocumentPicker = createDocumentPicker(() => File.pickFileAsync({
  mimeTypes: supportedDocumentMimeTypes,
  multipleFiles: false,
}));
