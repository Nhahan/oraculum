import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCommand } from "./process.mjs";

const ESC = "\u001B";
const BEL = "\u0007";
const OSC_SEQUENCE_PATTERN = new RegExp(`${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, "gu");
const CSI_SEQUENCE_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "gu");
const BOX_DRAWING_RE = /^[\s─═│║┌┐└┘┬┴├┤╔╗╚╝╠╣╦╩╬╟╢╤╧╪━┃┏┓┗┛┣┫┳┻╋┠┨┯┷┿╂]+$/u;
const UI_CHROME_RE = /^[◦⎿✻·◼]+/u;
const BARE_PROMPT_RE = /^[›❯>$%#]+$/u;
const HOST_SUGGESTION_RE =
  /^(Use \/skills to list available skills|Run \/review on my current changes|Improve documentation in @filename)$/u;
const MIN_ALNUM_RATIO = 0.1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizeTmuxTranscript(value) {
  return value
    .replace(OSC_SEQUENCE_PATTERN, "")
    .replace(CSI_SEQUENCE_PATTERN, "")
    .replace(/\r/gu, "")
    .replace(/[^\t\n\x20-\x7E\u00A0-\uFFFF]/gu, "")
    .replace(/^\\+\n?/u, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function includesOraculumApprovalPrompt(transcript, toolName = "oraculum_consult") {
  return (
    transcript.includes(`Allow the oraculum MCP server to run tool "${toolName}"?`) ||
    transcript.includes(`Allow the orc MCP server to run tool "${toolName}"?`)
  );
}

export function parseMeaningfulTmuxTail(raw, maxLines = 40) {
  const cleaned = sanitizeTmuxTranscript(raw);
  const meaningful = [];

  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (BOX_DRAWING_RE.test(trimmed)) continue;
    if (trimmed.startsWith("╭") || trimmed.startsWith("╰")) continue;
    if (trimmed.startsWith("│ ")) continue;
    if (trimmed.startsWith("Tip:")) continue;
    if (trimmed.startsWith("│ model:")) continue;
    if (trimmed.startsWith("│ directory:")) continue;
    if (trimmed.startsWith("model:")) continue;
    if (trimmed.startsWith("directory:")) continue;
    if (trimmed.startsWith("https://chatgpt.com/codex")) continue;
    if (trimmed.includes("OpenAI Codex")) continue;
    if (trimmed.startsWith("tmux focus-events off")) continue;
    if (HOST_SUGGESTION_RE.test(trimmed)) continue;
    if (UI_CHROME_RE.test(trimmed) && !trimmed.startsWith("•")) continue;
    if (BARE_PROMPT_RE.test(trimmed)) continue;
    const alnumCount = (trimmed.match(/[A-Za-z0-9가-힣]/gu) || []).length;
    if (trimmed.length >= 8 && alnumCount / trimmed.length < MIN_ALNUM_RATIO) continue;
    meaningful.push(trimmed);
  }

  return meaningful.slice(-maxLines).join("\n");
}

export async function createTmuxHarness(options) {
  const root = await mkdtemp(join(tmpdir(), "oraculum-tmux-smoke-"));
  const sessionNameBase = options.sessionName ?? `oraculum-host-smoke-${Date.now()}-${process.pid}`;
  let sessionName = sessionNameBase;
  let target = `${sessionName}:0.0`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    sessionName = attempt === 0 ? sessionNameBase : `${sessionNameBase}-${attempt}`;
    target = `${sessionName}:0.0`;
    try {
      await runCommand("tmux", ["new-session", "-d", "-s", sessionName, options.command], {
        cwd: options.cwd,
        label: `tmux new-session ${sessionName}`,
        timeoutMs: 30_000,
      });
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("duplicate session") || attempt === 4) {
        await rm(root, { force: true, recursive: true }).catch(() => undefined);
        throw error;
      }
    }
  }

  const logPath = options.logPath ?? join(root, `${sessionName}.log`);

  await runCommand("tmux", ["pipe-pane", "-t", target, "-o", `cat >> '${logPath}'`], {
    cwd: options.cwd,
    label: `tmux pipe-pane ${sessionName}`,
    timeoutMs: 30_000,
  });
  await runCommand("tmux", ["set-option", "-t", sessionName, "focus-events", "on"], {
    cwd: options.cwd,
    label: `tmux set-option ${sessionName} focus-events`,
    timeoutMs: 30_000,
  }).catch(() => undefined);

  return {
    logPath,
    root,
    sessionName,
    target,
  };
}

export async function destroyTmuxHarness(harness) {
  await runCommand("tmux", ["kill-session", "-t", harness.sessionName], {
    cwd: process.cwd(),
    label: `tmux kill-session ${harness.sessionName}`,
    timeoutMs: 30_000,
  }).catch(() => undefined);
  await rm(harness.root, { force: true, recursive: true }).catch(() => undefined);
}

export async function captureTmuxPane(harness, startLine = -240) {
  const result = await runCommand(
    "tmux",
    ["capture-pane", "-pt", harness.target, "-S", String(startLine)],
    {
      cwd: process.cwd(),
      label: `tmux capture-pane ${harness.sessionName}`,
      timeoutMs: 30_000,
    },
  );
  return result.stdout;
}

export async function sendTmuxKeys(harness, text, options = {}) {
  const args = ["send-keys", "-t", harness.target, text];
  if (options.enter !== false) {
    args.push("Enter");
  }
  await runCommand("tmux", args, {
    cwd: process.cwd(),
    label: `tmux send-keys ${harness.sessionName}`,
    timeoutMs: 30_000,
  });
}

export async function sendTmuxControl(harness, key) {
  await runCommand("tmux", ["send-keys", "-t", harness.target, key], {
    cwd: process.cwd(),
    label: `tmux send-keys ${key} ${harness.sessionName}`,
    timeoutMs: 30_000,
  });
}

export async function waitForInteractiveTranscript(harness, options) {
  const deadline = Date.now() + options.timeoutMs;
  let approvalApplied = false;
  let lastTranscript = "";

  while (Date.now() < deadline) {
    const transcript = sanitizeTmuxTranscript(await captureTmuxPane(harness, options.startLine));
    lastTranscript = transcript;

    if (!approvalApplied && includesOraculumApprovalPrompt(transcript, options.toolName)) {
      approvalApplied = true;
      await sendTmuxKeys(harness, options.approvalChoice ?? "3");
      await sleep(options.pollIntervalMs ?? 500);
      continue;
    }

    if (options.match(transcript)) {
      return {
        approvalApplied,
        transcript,
      };
    }

    await sleep(options.pollIntervalMs ?? 500);
  }

  throw new Error(
    [
      `Timed out waiting for interactive transcript in ${harness.sessionName}.`,
      lastTranscript,
    ].join("\n\n"),
  );
}

export async function sampleInteractiveTranscript(harness, options) {
  const deadline = Date.now() + options.durationMs;
  let approvalApplied = false;
  let transcript = "";
  let nudged = false;

  while (Date.now() < deadline) {
    transcript = sanitizeTmuxTranscript(await captureTmuxPane(harness, options.startLine));
    if (!approvalApplied && includesOraculumApprovalPrompt(transcript, options.toolName)) {
      approvalApplied = true;
      await sendTmuxKeys(harness, options.approvalChoice ?? "3");
    } else if (
      options.nudgeIfIdle &&
      !nudged &&
      transcript.includes(options.promptEcho) &&
      !options.progressMatchers.some((pattern) => transcript.includes(pattern))
    ) {
      nudged = true;
      await sendTmuxKeys(harness, "", { enter: true });
    }
    await sleep(options.pollIntervalMs ?? 500);
  }

  return {
    approvalApplied,
    transcript,
    meaningfulTail: parseMeaningfulTmuxTail(transcript, options.maxLines ?? 40),
  };
}
