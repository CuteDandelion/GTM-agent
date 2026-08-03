import { safeExportFileName } from "./expo-conversation-export-runtime";

describe("safeExportFileName", () => {
  it("keeps an export inside the private cache directory", () => {
    expect(safeExportFileName("../../prospect report.md")).toBe("prospect-report.md");
    expect(safeExportFileName("%2e%2e%2fsecrets.json")).toBe("secrets.json");
    expect(safeExportFileName("...")).toBe("gtm-research-export.txt");
  });
});
