import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const harnessPath = path.join(testDirectory, "android-native-smoke.mjs");

test("installs and exercises the native authentication UI through adb", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gtm-android-native-smoke-"));
  const adbPath = path.join(directory, "adb");
  const apkPath = path.join(directory, "app-debug.apk");
  const statePath = path.join(directory, "state");
  const logPath = path.join(directory, "adb.log");
  const artifactsPath = path.join(directory, "artifacts");

  await writeFile(apkPath, "apk fixture");
  await writeFile(statePath, "signed-out");
  await writeFile(adbPath, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$FAKE_ADB_LOG"
if [ "$1" = "devices" ]; then
  printf 'List of devices attached\\nemulator-5554 device product:sdk model:sdk_gphone device:emu transport_id:1\\n'
  exit 0
fi
shift 2
case "\${1:-} \${2:-}" in
  "get-state ") printf 'device\\n' ;;
  "install -r") printf 'Success\\n' ;;
  "shell am") printf 'Status: ok\\n' ;;
  "shell input")
    if [ "$(cat "$FAKE_ADB_STATE")" = "signed-out" ]; then printf 'debug' > "$FAKE_ADB_STATE"; else printf 'invalid' > "$FAKE_ADB_STATE"; fi
    ;;
  "exec-out uiautomator")
    state=$(cat "$FAKE_ADB_STATE")
    if [ "$state" = "signed-out" ]; then
      printf '%s' '<hierarchy><node content-desc="Email" bounds="[10,100][300,160]"/><node content-desc="Password" bounds="[10,180][300,240]"/><node content-desc="Open auth debug panel" bounds="[10,260][200,310]"/><node content-desc="Sign in" bounds="[10,330][300,390]"/></hierarchy>'
    elif [ "$state" = "debug" ]; then
      printf '%s' '<hierarchy><node text="Auth diagnostics" bounds="[10,40][300,80]"/><node text="Credential values, session tokens, and keys are excluded." bounds="[10,90][350,130]"/><node content-desc="Sign in" bounds="[10,330][300,390]"/></hierarchy>'
    else
      printf '%s' '<hierarchy><node text="Enter your email and password." bounds="[10,280][350,320]"/><node content-desc="Sign in" bounds="[10,330][300,390]"/></hierarchy>'
    fi
    ;;
  "exec-out screencap") printf 'PNG' ;;
  *) printf 'unexpected fake adb call: %s\\n' "$*" >&2; exit 64 ;;
esac
`);
  await chmod(adbPath, 0o755);

  const result = spawnSync(process.execPath, [harnessPath, "--apk", apkPath, "--artifacts-dir", artifactsPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      ANDROID_ADB_PATH: adbPath,
      FAKE_ADB_LOG: logPath,
      FAKE_ADB_STATE: statePath,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PASS native Android authentication smoke/);
  assert.match(await readFile(logPath, "utf8"), /-s emulator-5554 install -r .*app-debug\.apk/);
  assert.match(await readFile(logPath, "utf8"), /-s emulator-5554 shell am start -W -n com\.cutedandelion\.gtmresearch\/\.MainActivity/);
  assert.equal(await readFile(path.join(artifactsPath, "final-ui.xml"), "utf8").then((value) => value.includes("Enter your email and password.")), true);
  assert.equal(await readFile(path.join(artifactsPath, "final.png"), "utf8"), "PNG");
});

test("drives the full conversation journey and proves persisted interactive state after relaunch", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gtm-android-native-conversation-"));
  const adbPath = path.join(directory, "adb");
  const apkPath = path.join(directory, "app-debug.apk");
  const statePath = path.join(directory, "state.json");
  const logPath = path.join(directory, "adb.log");
  const artifactsPath = path.join(directory, "artifacts");

  await writeFile(apkPath, "apk fixture");
  await writeFile(statePath, JSON.stringify({ screen: "signed-out", focus: "", draft: "", email: "", password: "", onboardingStep: 0, dumps: 0, evidenceTaps: 0 }));
  await writeFile(adbPath, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_ADB_LOG, args.join(" ") + "\\n");
const load = () => JSON.parse(fs.readFileSync(process.env.FAKE_ADB_STATE, "utf8"));
const save = (state) => fs.writeFileSync(process.env.FAKE_ADB_STATE, JSON.stringify(state));
const node = (attributes) => '<node ' + attributes + '/>';
const hierarchy = (nodes) => '<hierarchy>' + nodes.join('') + '</hierarchy>';
const composer = () => [
  node('resource-id="message-composer" content-desc="Message GTM Research Agent" bounds="[20,1900][880,2100]"'),
  node('content-desc="Send message" bounds="[900,1900][1070,2100]"'),
];
const conversation = (state, shortlisted = false) => hierarchy([
  node('text="Profile foodbegood.app for AI and agent automation sales fit." bounds="[20,200][1000,280]"'),
  node('text="Research its buyers next." bounds="[20,300][1000,380]"'),
  node('content-desc="Evidence" bounds="[20,700][300,800]"'),
  node('content-desc="' + (shortlisted ? 'Shortlisted' : 'Shortlist') + '" bounds="[320,700][620,800]"'),
  ...composer(),
]);

if (args[0] === "devices") {
  process.stdout.write('List of devices attached\\nemulator-5554 device product:sdk model:sdk_gphone device:emu transport_id:1\\n');
  process.exit(0);
}
const command = args.slice(2);
if (command[0] === "get-state") process.stdout.write("device\\n");
else if (command[0] === "install") process.stdout.write("Success\\n");
else if (command[0] === "shell" && command[1] === "pm" && command[2] === "clear") {
  save({ screen: "signed-out", focus: "", draft: "", email: "", password: "", onboardingStep: 0, dumps: 0, evidenceTaps: 0 });
  process.stdout.write("Success\\n");
} else if (command[0] === "shell" && command[1] === "am") {
  process.stdout.write("Status: ok\\n");
} else if (command[0] === "shell" && command[1] === "input" && command[2] === "tap") {
  const state = load();
  const x = Number(command[3]);
  const y = Number(command[4]);
  if (state.screen === "signed-out" && y >= 260 && y <= 310) state.screen = "debug";
  else if (state.screen === "debug" && y >= 330 && y <= 390) state.screen = "invalid";
  else if ((state.screen === "signed-out" || state.screen === "invalid") && y >= 100 && y <= 160) state.focus = "email";
  else if ((state.screen === "signed-out" || state.screen === "invalid") && y >= 180 && y <= 240) state.focus = "password";
  else if ((state.screen === "signed-out" || state.screen === "invalid") && y >= 330 && y <= 390) {
    state.screen = state.email && state.password ? "onboarding" : "invalid";
    state.focus = "";
  } else if (state.screen === "onboarding" && y >= 1900) {
    if (x < 900) state.focus = "composer";
    else if (state.draft) {
      state.onboardingStep += 1;
      state.draft = "";
      state.screen = state.onboardingStep === 4 ? "empty" : "onboarding";
    }
  } else if ((state.screen === "empty" || state.screen === "running" || state.screen === "queued" || state.screen === "complete") && y >= 1900) {
    if (x < 900) state.focus = "composer";
    else if (state.draft) {
      if (state.screen === "empty") { state.screen = "running"; state.dumps = 0; }
      else if (state.screen === "running") { state.screen = "queued"; state.dumps = 0; }
      state.draft = "";
    }
  } else if ((state.screen === "complete" || state.screen === "shortlisted") && y >= 700 && y <= 800) {
    if (x < 300) {
      state.evidenceTaps = (state.evidenceTaps ?? 0) + 1;
      if (state.evidenceTaps >= 2) state.screen = "evidence";
    }
    else state.screen = "shortlisted";
  } else if (state.screen === "evidence" && y >= 700 && y <= 800) state.screen = "complete";
  save(state);
} else if (command[0] === "shell" && command[1] === "input" && command[2] === "text") {
  const state = load();
  const value = (command[3] ?? "").replace(/%s/g, " ");
  if (state.focus === "email") state.email = value;
  else if (state.focus === "password") state.password = value;
  else if (state.focus === "composer") state.draft = value;
  save(state);
} else if (command[0] === "shell" && command[1] === "input" && command[2] === "keyevent") {
  const state = load();
  if (command[3] === "4") state.screen = "home";
  else if (command[3] === "66" && state.focus === "email") state.focus = "password";
  else if (command[3] === "66" && state.focus === "password") {
    state.screen = state.email && state.password ? "onboarding" : "invalid";
    state.focus = "";
  } else if (command[3] === "66" && state.focus === "composer" && state.draft) {
    if (state.screen === "onboarding") {
      state.onboardingStep += 1;
      state.screen = state.onboardingStep === 4 ? "empty" : "onboarding";
    } else if (state.screen === "empty") { state.screen = "running"; state.dumps = 0; }
    else if (state.screen === "running") { state.screen = "queued"; state.dumps = 0; }
    state.draft = "";
  }
  save(state);
} else if (command[0] === "shell" && command[1] === "input" && command[2] === "swipe") {
  process.stdout.write("");
} else if (command[0] === "exec-out" && command[1] === "uiautomator") {
  const state = load();
  state.dumps += 1;
  if (state.screen === "queued" && state.dumps >= 3) state.screen = "complete";
  save(state);
  if (state.screen === "signed-out" || state.screen === "invalid") {
    const error = state.screen === "invalid" ? [node('text="Enter your email and password." bounds="[20,420][900,480]"')] : [];
    process.stdout.write(hierarchy([
      node('text="Email" bounds="[10,40][500,80]"'),
      node('content-desc="Email" bounds="[10,100][500,160]"'),
      node('text="Password" bounds="[10,165][500,179]"'),
      node('content-desc="Password" bounds="[10,180][500,240]"'),
      node('content-desc="Open auth debug panel" bounds="[10,260][500,310]"'),
      node('content-desc="Sign in" bounds="[10,330][500,390]"'),
      ...error,
    ]));
  } else if (state.screen === "debug") process.stdout.write(hierarchy([
    node('text="Auth diagnostics" bounds="[20,100][1000,180]"'),
    node('text="Credential values, session tokens, and keys are excluded." bounds="[20,200][1000,280]"'),
    node('content-desc="Sign in" bounds="[10,330][500,390]"'),
  ]));
  else if (state.screen === "home") process.stdout.write(hierarchy([
    node('text="Home" bounds="[20,100][1000,180]"'),
  ]));
  else if (state.screen === "onboarding") process.stdout.write(hierarchy([
    node('text="Before we research companies, what should I call your business?" bounds="[20,100][1000,180]"'),
    ...composer(),
  ]));
  else if (state.screen === "empty") process.stdout.write(hierarchy([
    node('text="Start a new GTM conversation" bounds="[20,200][1000,280]"'),
    ...composer(),
  ]));
  else if (state.screen === "running") process.stdout.write(hierarchy([
    node('text="Profile foodbegood.app for AI and agent automation sales fit." bounds="[20,200][1000,280]"'),
    node('content-desc="waiting-agent-response" bounds="[20,400][1000,520]"'),
    ...composer(),
  ]));
  else if (state.screen === "queued") process.stdout.write(hierarchy([
    node('text="Profile foodbegood.app for AI and agent automation sales fit." bounds="[20,200][1000,280]"'),
    node('text="Research its buyers next." bounds="[20,300][1000,380]"'),
    node('text="Queued · position 2" bounds="[20,400][1000,480]"'),
    node('content-desc="workflow-progress" bounds="[20,500][1000,620]"'),
    ...composer(),
  ]));
  else if (state.screen === "evidence") process.stdout.write(hierarchy([
    node('content-desc="Close evidence" bounds="[20,700][500,800]"'),
  ]));
  else process.stdout.write(conversation(state, state.screen === "shortlisted"));
} else if (command[0] === "exec-out" && command[1] === "screencap") process.stdout.write("PNG");
else {
  process.stderr.write("unexpected fake adb call: " + args.join(" ") + "\\n");
  process.exit(64);
}
`);
  await chmod(adbPath, 0o755);

  const result = spawnSync(process.execPath, [
    harnessPath,
    "--apk", apkPath,
    "--artifacts-dir", artifactsPath,
    "--journey", "conversation",
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      ANDROID_ADB_PATH: adbPath,
      FAKE_ADB_LOG: logPath,
      FAKE_ADB_STATE: statePath,
      NATIVE_E2E_EMAIL: "gtm-native-e2e@example.test",
      NATIVE_E2E_PASSWORD: "Local-GTM-E2E-2026!",
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PASS native Android conversation journey/);
  const finalUi = await readFile(path.join(artifactsPath, "final-ui.xml"), "utf8");
  assert.match(finalUi, /Profile foodbegood\.app for AI and agent automation sales fit\./);
  assert.match(finalUi, /Research its buyers next\./);
  assert.match(finalUi, /Shortlisted/);
  assert.equal(await readFile(path.join(artifactsPath, "final.png"), "utf8"), "PNG");
});
