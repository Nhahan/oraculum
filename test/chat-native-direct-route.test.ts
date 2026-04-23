import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { rewriteDirectRouteInvocation } from "../src/services/chat-native/direct-route.js";
import { createTempRootHarness } from "./helpers/fs.js";
import { withProcessPlatform } from "./helpers/profile-command-collectors.js";

const tempRootHarness = createTempRootHarness("oraculum-direct-route-");
tempRootHarness.registerCleanup();

describe("chat-native direct route rewriting", () => {
  it("uses Windows-compatible quoting when embedding the local CLI path", async () => {
    const root = await tempRootHarness.createTempRoot("oraculum-direct-route-win32-");
    const artifactRoot = join(root, "artifacts");
    const skillPath = join(artifactRoot, "skills", "route-consult", "SKILL.md");
    await mkdir(join(artifactRoot, "skills", "route-consult"), { recursive: true });
    await writeFile(
      skillPath,
      "Command: oraculum orc consult\nUse `oraculum orc consult` immediately.\n",
      "utf8",
    );

    await withProcessPlatform("win32", async () => {
      await rewriteDirectRouteInvocation({
        root: artifactRoot,
        invocation: {
          command: "C:\\Program Files\\nodejs\\node.exe",
          args: ["C:\\Users\\tester\\My Oraculum\\dist\\cli.js"],
        },
      });
    });

    await expect(readFile(skillPath, "utf8")).resolves.toContain(
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\tester\\My Oraculum\\dist\\cli.js" orc consult',
    );
  });
});
