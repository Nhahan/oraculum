import { describe, expect, it } from "vitest";

import {
  includesOraculumApprovalPrompt,
  parseMeaningfulTmuxTail,
  sanitizeTmuxTranscript,
} from "../scripts/host-native-smoke/tmux.mjs";

describe("host-native tmux helpers", () => {
  it("strips terminal control sequences from pane captures", () => {
    const raw =
      '\u001b]0;oraculum\u001b\\\\\u001b[1;1H\u001b[?25h\n› orc consult "안녕"\r\n\u001b[2mWorking (7s • esc to interrupt)\u001b[0m\n';

    expect(sanitizeTmuxTranscript(raw)).toBe(
      '› orc consult "안녕"\nWorking (7s • esc to interrupt)',
    );
  });

  it("detects the Oraculum MCP approval prompt", () => {
    expect(
      includesOraculumApprovalPrompt('Allow the orc MCP server to run tool "oraculum_consult"?'),
    ).toBe(true);
    expect(
      includesOraculumApprovalPrompt(
        'Allow the oraculum MCP server to run tool "oraculum_consult"?',
      ),
    ).toBe(true);
    expect(includesOraculumApprovalPrompt("No prompt here")).toBe(false);
  });

  it("keeps only meaningful interactive lines for smoke assertions", () => {
    const raw = [
      "\u001b[2m╭─────────────────────────────────────────────╮\u001b[0m",
      "│ >_ OpenAI Codex (v0.121.0)                  │",
      "│ model:     gpt-5.4 xhigh   /model to change │",
      "https://chatgpt.com/codex?app-landing-page=true",
      '› orc consult "안녕"',
      "",
      "• Calling",
      '  └ oraculum.oraculum_consult({"cwd":"/tmp/project","taskInput":"안녕"})',
      "Use /skills to list available skills",
      'Allow the orc MCP server to run tool "oraculum_consult"?',
      "1. Allow",
    ].join("\n");

    expect(parseMeaningfulTmuxTail(raw)).toBe(
      [
        '› orc consult "안녕"',
        "• Calling",
        '└ oraculum.oraculum_consult({"cwd":"/tmp/project","taskInput":"안녕"})',
        'Allow the orc MCP server to run tool "oraculum_consult"?',
        "1. Allow",
      ].join("\n"),
    );
  });
});
