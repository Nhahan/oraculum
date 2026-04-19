import { describe, expect, it } from "vitest";

import { extractOrcCommandLine, sanitizeWrapperLine } from "../src/services/host-wrapper.js";

describe("host wrapper", () => {
  it("extracts launch-time orc prompt lines for official transport routing", () => {
    expect(extractOrcCommandLine("codex", ['orc consult "안녕"'])).toBe('orc consult "안녕"');
    expect(extractOrcCommandLine("claude-code", ["-p", "orc consult 안녕"])).toBe(
      "orc consult 안녕",
    );
    expect(extractOrcCommandLine("codex", ["--model", "gpt-5.4", "orc verdict"])).toBe(
      "orc verdict",
    );
    expect(extractOrcCommandLine("codex", ["review", "hello"])).toBeUndefined();
  });

  it("sanitizes ANSI wrapper lines before matching", () => {
    expect(sanitizeWrapperLine("\u001b[2m• Working (7s • esc to interrupt)\u001b[0m\r")).toBe(
      "• Working (7s • esc to interrupt)",
    );
  });
});
