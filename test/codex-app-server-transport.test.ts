import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseOrcCommandLine, runCodexOfficialTransport } from "../src/services/chat-native.js";
import {
  createChatNativeTempRoot,
  registerChatNativeTempRootCleanup,
} from "./helpers/chat-native.js";

registerChatNativeTempRootCleanup();

const codexBinary = findCodexBinary();

describe("Codex official app-server transport", () => {
  it.skipIf(!codexBinary)(
    "executes an orc consult through app-server mcpServer/tool/call",
    async () => {
      const projectRoot = await createChatNativeTempRoot("oraculum-codex-official-transport-");
      const packet = parseOrcCommandLine('orc consult "안녕"', projectRoot);

      const result = await runCodexOfficialTransport(packet, {
        cwd: projectRoot,
        ...(codexBinary ? { command: codexBinary } : {}),
      });

      expect(result.threadId).toMatch(/\S/u);
      expect(
        result.startupEvents.some((event) => event.name === "orc" && event.status === "ready"),
      ).toBe(true);
      expect(result.toolResult).toMatchObject({
        structuredContent: {
          mode: "consult",
        },
      });
    },
  );
});

function findCodexBinary(): string | undefined {
  const candidates = (process.env.PATH ?? "")
    .split(delimiter)
    .map((segment) => join(segment, "codex"));
  return candidates.find((candidate) => existsSync(candidate));
}
