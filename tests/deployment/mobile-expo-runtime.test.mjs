import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

test("Expo Router server can resolve its runtime peer from the installed workspace", () => {
  const cliPackage = require.resolve("@expo/cli/package.json");
  const routerServerEntry = join(dirname(cliPackage), "node_modules", "@expo", "router-server", "build", "index.js");
  const routerServerRequire = createRequire(routerServerEntry);

  assert.doesNotThrow(() => routerServerRequire.resolve("expo-router/_ctx-shared"));
  assert.doesNotThrow(() => routerServerRequire.resolve("expo-linking"));
});

test("Expo Router server can resolve React Native Web's style prefixer", () => {
  const cliPackage = require.resolve("@expo/cli/package.json");
  const routerServerEntry = join(dirname(cliPackage), "node_modules", "@expo", "router-server", "build", "index.js");
  const routerServerRequire = createRequire(routerServerEntry);

  assert.doesNotThrow(() =>
    routerServerRequire.resolve("inline-style-prefixer/lib/createPrefixer"),
  );
  assert.doesNotThrow(() => routerServerRequire.resolve("postcss-value-parser"));
});

test("the Expo application and React Native resolve one React runtime", () => {
  const mobileRequire = createRequire(new URL("../../apps/mobile/package.json", import.meta.url));
  const reactNativePackage = mobileRequire.resolve("react-native/package.json");
  const reactNativeRequire = createRequire(reactNativePackage);

  assert.equal(
    mobileRequire.resolve("react/package.json"),
    reactNativeRequire.resolve("react/package.json"),
  );
});

test("Metro treats SQLite wasm as a web asset", () => {
  const mobileRequire = createRequire(new URL("../../apps/mobile/package.json", import.meta.url));
  const metroConfig = mobileRequire("./metro.config.js");

  assert.ok(metroConfig.resolver.assetExts.includes("wasm"));
});
