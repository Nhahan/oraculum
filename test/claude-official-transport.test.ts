import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseOrcCommandLine, runClaudeOfficialTransport } from "../src/services/chat-native.js";
import {
  createChatNativeTempRoot,
  registerChatNativeTempRootCleanup,
} from "./helpers/chat-native.js";

registerChatNativeTempRootCleanup();

const claudeBinary = findClaudeBinary();

describe("Claude official stream-json transport", () => {
  it.skipIf(!claudeBinary)(
    "executes an orc consult through stream-json and returns the MCP tool result",
    async () => {
      const projectRoot = await createChatNativeTempRoot("oraculum-claude-official-transport-");
      const packet = parseOrcCommandLine('orc consult "안녕"', projectRoot);

      const result = await runClaudeOfficialTransport(packet, {
        cwd: projectRoot,
        ...(claudeBinary ? { command: claudeBinary } : {}),
      });

      expect(result.streamEvents.some((event) => event.type === "assistant")).toBe(true);
      expect(result.streamEvents.some((event) => event.type === "result")).toBe(true);
      expect(result.toolResult).toMatchObject({
        mode: "consult",
      });
      expect(result.finalResult).toContain("needs-clarification");
      expect(result.toolResult).toMatchObject({
        consultation: {
          id: expect.stringMatching(/^run_/u),
        },
      });
    },
  );
});

function findClaudeBinary(): string | undefined {
  const candidates = (process.env.PATH ?? "")
    .split(delimiter)
    .map((segment) => join(segment, "claude"));
  return candidates.find((candidate) => existsSync(candidate));
}
