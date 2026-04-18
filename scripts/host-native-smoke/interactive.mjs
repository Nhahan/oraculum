import {
  createTmuxHarness,
  destroyTmuxHarness,
  sampleInteractiveTranscript,
  sendTmuxControl,
  sendTmuxKeys,
  waitForInteractiveTranscript,
} from "./tmux.mjs";

export function getInteractiveHostProfile(runtime) {
  if (runtime === "codex") {
    return {
      command: (cwd) => wrapInteractiveCommand(`cd ${shellQuote(cwd)} && codex --no-alt-screen`),
      durationMs: 15_000,
      readyTimeoutMs: 30_000,
      resetBeforePrompt: true,
      progressMatchers: [
        "Working",
        "Calling",
        "Allow the orc MCP server",
        "Allow the oraculum MCP server",
        "Starting consultation",
        "Planning consultation",
        "Candidate ",
        "Verdict ready",
      ],
      readyMatch: (transcript) =>
        transcript.includes("OpenAI Codex") && transcript.includes("directory:"),
      toolName: "oraculum_consult",
    };
  }

  if (runtime === "claude-code") {
    return {
      command: (cwd) =>
        wrapInteractiveCommand(
          `cd ${shellQuote(cwd)} && claude --permission-mode bypassPermissions --model sonnet`,
        ),
      durationMs: 20_000,
      readyTimeoutMs: 45_000,
      resetBeforePrompt: false,
      progressMatchers: [
        "Calling",
        "Starting consultation",
        "Planning consultation",
        "Candidate ",
        "Verdict ready",
      ],
      readyMatch: (transcript) =>
        transcript.includes("Claude Code") ||
        transcript.includes("Bypassing Permissions") ||
        transcript.includes("Start by asking Claude"),
      toolName: "oraculum_consult",
    };
  }

  throw new Error(`Unsupported interactive runtime: ${runtime}`);
}

export async function runInteractiveHostSmoke(options) {
  const profile = getInteractiveHostProfile(options.runtime);
  const harness = await createTmuxHarness({
    command: profile.command(options.cwd),
    cwd: options.cwd,
    sessionName: options.sessionName,
  });

  try {
    await waitForInteractiveTranscript(harness, {
      match: profile.readyMatch,
      startLine: -120,
      timeoutMs: options.readyTimeoutMs ?? profile.readyTimeoutMs ?? 30_000,
      toolName: profile.toolName,
    });

    if (profile.resetBeforePrompt) {
      await sendTmuxControl(harness, "C-c");
      await sendTmuxControl(harness, "C-c");
    }
    await sendTmuxKeys(harness, options.prompt);

    return await sampleInteractiveTranscript(harness, {
      approvalChoice: "3",
      durationMs: options.durationMs ?? profile.durationMs ?? 15_000,
      maxLines: options.maxLines ?? 40,
      nudgeIfIdle: options.runtime === "codex",
      pollIntervalMs: 750,
      progressMatchers: profile.progressMatchers,
      promptEcho: options.prompt,
      startLine: -220,
      toolName: profile.toolName,
    });
  } finally {
    await destroyTmuxHarness(harness);
  }
}

function shellQuote(value) {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function wrapInteractiveCommand(command) {
  return `/bin/zsh -lc ${shellQuote(`${command}; code=$?; printf "\\n[interactive-exit:$code]\\n"; sleep 5; exit $code`)}`;
}
