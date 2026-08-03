#!/usr/bin/env node

import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const applicationId = "com.cutedandelion.gtmresearch";
const activity = `${applicationId}/.MainActivity`;

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Expected a value after ${key ?? "argument"}`);
    options[key.slice(2)] = value;
  }
  if (!options.apk) throw new Error("--apk is required");
  if (!options["artifacts-dir"]) throw new Error("--artifacts-dir is required");
  const journey = options.journey ?? "authentication";
  if (journey !== "authentication" && journey !== "conversation") {
    throw new Error("--journey must be authentication or conversation");
  }
  return {
    apkPath: path.resolve(options.apk),
    artifactsPath: path.resolve(options["artifacts-dir"]),
    journey,
  };
}

function run(command, args, { encoding = "utf8" } = {}) {
  const result = spawnSync(command, args, { encoding, env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr;
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : result.stdout;
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${stderr || stdout}`);
  }
  return result.stdout;
}

function connectedSerial(adbPath) {
  if (process.env.ANDROID_SERIAL) return process.env.ANDROID_SERIAL;
  const output = run(adbPath, ["devices", "-l"]);
  const serials = output
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([, state]) => state === "device")
    .map(([serial]) => serial);
  if (serials.length !== 1) {
    throw new Error(`Expected exactly one ready Android emulator/device, found ${serials.length}. Set ANDROID_SERIAL to choose one.`);
  }
  return serials[0];
}

function nodeForLabel(xml, label) {
  const nodes = xml.match(/<node\b[^>]*>/g) ?? [];
  return nodes.find((node) => node.includes(`content-desc="${label}"`))
    ?? nodes.find((node) => node.includes(`resource-id="${label}"`) || node.includes(`:id/${label}"`))
    ?? nodes.find((node) => node.includes(`text="${label}"`));
}

function containsLabel(xml, label) {
  return nodeForLabel(xml, label) !== undefined;
}

function dumpUi(adbPath, serial) {
  return run(adbPath, ["-s", serial, "exec-out", "uiautomator", "dump", "/dev/tty"]);
}

function waitForLabels(adbPath, serial, labels, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let xml = "";
  do {
    xml = dumpUi(adbPath, serial);
    if (labels.every((label) => containsLabel(xml, label))) return xml;
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for native labels: ${labels.join(", ")}`);
}

function waitForAnyLabel(adbPath, serial, labels, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let xml = "";
  do {
    xml = dumpUi(adbPath, serial);
    const label = labels.find((candidate) => containsLabel(xml, candidate));
    if (label) return { xml, label };
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for any native label: ${labels.join(", ")}`);
}

function waitForQueuedMessage(adbPath, serial, message, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let xml = "";
  do {
    xml = dumpUi(adbPath, serial);
    const queuePosition = Number(xml.match(/(?:text|content-desc)="Queued · position (\d+)"/)?.[1] ?? 0);
    if (containsLabel(xml, message) && queuePosition >= 2) return xml;
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for queued native message: ${message}`);
}

function tapLabel(adbPath, serial, xml, label) {
  const node = nodeForLabel(xml, label);
  if (!node) throw new Error(`Native element not found: ${label}`);
  const match = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!match) throw new Error(`Native element has no bounds: ${label}`);
  const [, left, top, right, bottom] = match.map(Number);
  run(adbPath, ["-s", serial, "shell", "input", "tap", String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2))]);
}

function tapUntilLabelAppears(adbPath, serial, triggerLabel, targetLabel, attempts = 3, revealTimeoutMs = 60_000) {
  let xml = revealLabel(adbPath, serial, triggerLabel, revealTimeoutMs);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    tapLabel(adbPath, serial, xml, triggerLabel);
    try {
      return waitForLabels(adbPath, serial, [targetLabel], 5_000);
    } catch {
      if (attempt === attempts - 1) break;
      xml = revealLabel(adbPath, serial, triggerLabel, 10_000);
    }
  }
  throw new Error(`Timed out opening native label: ${targetLabel}`);
}

function typeIntoLabel(adbPath, serial, label, value) {
  const xml = waitForLabels(adbPath, serial, [label]);
  tapLabel(adbPath, serial, xml, label);
  run(adbPath, ["-s", serial, "shell", "input", "text", value.replace(/ /g, "%s")]);
}

function pressEnter(adbPath, serial) {
  run(adbPath, ["-s", serial, "shell", "input", "keyevent", "66"]);
}

function sendComposerMessage(adbPath, serial, message) {
  typeIntoLabel(adbPath, serial, "message-composer", message);
  pressEnter(adbPath, serial);
}

function revealLabel(adbPath, serial, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let xml = "";
  let swipeUp = true;
  let swipeCount = 0;
  do {
    xml = dumpUi(adbPath, serial);
    if (containsLabel(xml, label)) return xml;
    run(adbPath, [
      "-s", serial, "shell", "input", "swipe",
      "540", swipeUp ? "1900" : "600", "540", swipeUp ? "600" : "1900", "250",
    ]);
    swipeCount += 1;
    if (swipeCount % 12 === 0) swipeUp = !swipeUp;
  } while (Date.now() < deadline);
  throw new Error(`Timed out revealing native label: ${label}`);
}

async function writeFinalArtifacts(adbPath, serial, artifactsPath, xml) {
  await writeFile(path.join(artifactsPath, "final-ui.xml"), xml);
  const screenshot = run(adbPath, ["-s", serial, "exec-out", "screencap", "-p"], { encoding: null });
  await writeFile(path.join(artifactsPath, "final.png"), screenshot);
}

async function runConversationJourney({ adbPath, serial, artifactsPath }) {
  const email = process.env.NATIVE_E2E_EMAIL;
  const password = process.env.NATIVE_E2E_PASSWORD;
  if (!email || !password) throw new Error("NATIVE_E2E_EMAIL and NATIVE_E2E_PASSWORD are required for the conversation journey");

  const signedOut = waitForLabels(adbPath, serial, ["Email", "Password", "Sign in"]);
  tapLabel(adbPath, serial, signedOut, "Sign in");
  waitForLabels(adbPath, serial, ["Enter your email and password."]);
  typeIntoLabel(adbPath, serial, "Email", email);
  pressEnter(adbPath, serial);
  typeIntoLabel(adbPath, serial, "Password", password);
  pressEnter(adbPath, serial);

  waitForLabels(adbPath, serial, ["Before we research companies, what should I call your business?"]);
  for (const answer of [
    "Dandelion AI Studio",
    "AI and agent automation",
    "Agent orchestration, Workflow automation",
    "Human-approved delivery",
  ]) {
    sendComposerMessage(adbPath, serial, answer);
  }
  waitForLabels(adbPath, serial, ["Start a new GTM conversation"]);

  const firstPrompt = "Profile foodbegood.app for AI and agent automation sales fit.";
  const queuedFollowUp = "Research its buyers next.";
  sendComposerMessage(adbPath, serial, firstPrompt);
  waitForLabels(adbPath, serial, [firstPrompt]);
  waitForAnyLabel(adbPath, serial, ["waiting-agent-response", "workflow-progress"]);

  sendComposerMessage(adbPath, serial, queuedFollowUp);
  waitForQueuedMessage(adbPath, serial, queuedFollowUp);

  let xml = tapUntilLabelAppears(adbPath, serial, "Evidence", "Close evidence", 3, 300_000);
  tapLabel(adbPath, serial, xml, "Close evidence");

  xml = revealLabel(adbPath, serial, "Shortlist");
  tapLabel(adbPath, serial, xml, "Shortlist");
  revealLabel(adbPath, serial, "Shortlisted", 30_000);

  run(adbPath, ["-s", serial, "shell", "am", "force-stop", applicationId]);
  run(adbPath, ["-s", serial, "shell", "am", "start", "-W", "-n", activity]);
  revealLabel(adbPath, serial, firstPrompt, 45_000);
  revealLabel(adbPath, serial, queuedFollowUp, 45_000);
  const finalUi = revealLabel(adbPath, serial, "Shortlisted", 45_000);
  await writeFinalArtifacts(adbPath, serial, artifactsPath, finalUi);
}

async function main() {
  const { apkPath, artifactsPath, journey } = parseArguments(process.argv.slice(2));
  const adbPath = process.env.ANDROID_ADB_PATH ?? path.join(process.env.HOME ?? "", "Library/Android/sdk/platform-tools/adb");
  await Promise.all([access(adbPath), access(apkPath)]);
  await mkdir(artifactsPath, { recursive: true });

  const serial = connectedSerial(adbPath);
  run(adbPath, ["-s", serial, "get-state"]);
  run(adbPath, ["-s", serial, "install", "-r", apkPath]);
  if (journey === "conversation") {
    run(adbPath, ["-s", serial, "shell", "pm", "clear", applicationId]);
  }
  run(adbPath, ["-s", serial, "shell", "am", "force-stop", applicationId]);
  run(adbPath, ["-s", serial, "shell", "am", "start", "-W", "-n", activity]);

  if (journey === "conversation") {
    await runConversationJourney({ adbPath, serial, artifactsPath });
    process.stdout.write(`PASS native Android conversation journey (${serial})\n`);
    return;
  }

  const signedOut = waitForLabels(adbPath, serial, ["Email", "Password", "Open auth debug panel", "Sign in"]);
  tapLabel(adbPath, serial, signedOut, "Open auth debug panel");
  const diagnostics = waitForLabels(adbPath, serial, ["Auth diagnostics", "Credential values, session tokens, and keys are excluded.", "Sign in"]);
  tapLabel(adbPath, serial, diagnostics, "Sign in");
  const finalUi = waitForLabels(adbPath, serial, ["Enter your email and password."]);

  await writeFinalArtifacts(adbPath, serial, artifactsPath, finalUi);
  process.stdout.write(`PASS native Android authentication smoke (${serial})\n`);
}

main().catch((error) => {
  process.stderr.write(`FAIL native Android journey: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
