import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const eas = JSON.parse(await readFile(new URL("../../apps/mobile/eas.json", import.meta.url), "utf8"));
const app = JSON.parse(await readFile(new URL("../../apps/mobile/app.json", import.meta.url), "utf8"));

test("EAS preview produces an installable Android APK", () => {
  assert.equal(eas.build.preview.distribution, "internal");
  assert.equal(eas.build.preview.android.buildType, "apk");
  assert.equal(app.expo.android.package, "com.cutedandelion.gtmresearch");
});

test("EAS includes a dedicated iOS Simulator target", () => {
  assert.equal(eas.build["ios-simulator"].ios.simulator, true);
  assert.equal(app.expo.ios.bundleIdentifier, "com.cutedandelion.gtmresearch");
});
