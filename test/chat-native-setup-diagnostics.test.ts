import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { APP_VERSION } from "../src/core/constants.js";
import { setupStatusToolResponseSchema } from "../src/domain/chat-native.js";
import {
  buildSetupDiagnosticsResponse,
  filterSetupDiagnosticsResponse,
  hasClaudePluginArtifactsInstalled,
  summarizeSetupDiagnosticsHosts,
} from "../src/services/chat-native.js";
import {
  createChatNativeTempRoot,
  registerChatNativeTempRootCleanup,
} from "./helpers/chat-native.js";

registerChatNativeTempRootCleanup();

describe("chat-native setup diagnostics", () => {
  it("describes setup diagnostics with actionable host readiness states", () => {
    const diagnostics = setupStatusToolResponseSchema.parse(
      buildSetupDiagnosticsResponse(process.cwd()),
    );

    expect(diagnostics.targetPrefix).toBe("orc");
    expect(diagnostics.hosts).toHaveLength(2);
    expect(diagnostics.summary).toContain("host-native");
    for (const host of diagnostics.hosts) {
      expect(["ready", "partial", "needs-setup"]).toContain(host.status);
      if (host.status === "ready") {
        expect(host.nextAction.startsWith("Use `orc ...` directly in ")).toBe(true);
      } else {
        expect(host.nextAction).toContain("oraculum setup --runtime");
      }
    }
    expect(
      diagnostics.hosts
        .find((host) => host.host === "claude-code")
        ?.notes.some(
          (note) =>
            note.includes("oraculum setup --runtime claude-code") ||
            note.includes(".claude/plugins"),
        ),
    ).toBe(true);
    expect(
      diagnostics.hosts
        .find((host) => host.host === "claude-code")
        ?.notes.some((note) => note.includes(".claude/plugins")),
    ).toBe(true);
    expect(
      diagnostics.hosts
        .find((host) => host.host === "codex")
        ?.notes.some((note) => note.includes("oraculum setup --runtime codex")),
    ).toBe(true);
  });

  it("omits project config paths from setup diagnostics when the project is not initialized", async () => {
    const projectRoot = await createChatNativeTempRoot("oraculum-setup-diagnostics-");

    const diagnostics = setupStatusToolResponseSchema.parse(
      buildSetupDiagnosticsResponse(projectRoot),
    );

    expect(diagnostics.projectInitialized).toBe(false);
    expect(diagnostics.configPath).toBeUndefined();
    expect(diagnostics.advancedConfigPath).toBeUndefined();
  });

  it("filters setup diagnostics by host and recomputes the summary", () => {
    const diagnostics = setupStatusToolResponseSchema.parse(
      buildSetupDiagnosticsResponse(process.cwd()),
    );

    const filtered = filterSetupDiagnosticsResponse(diagnostics, "codex");

    expect(filtered.hosts).toHaveLength(1);
    expect(filtered.hosts[0]?.host).toBe("codex");
    expect(filtered.summary).toBe(
      summarizeSetupDiagnosticsHosts(
        filtered.hosts.map((host) => ({
          host: host.host,
          status: host.status,
          registered: host.registered,
          artifactsInstalled: host.artifactsInstalled,
        })),
      ),
    );
  });

  it("recognizes the Claude plugin cache layout created by Claude Code", async () => {
    const root = await createChatNativeTempRoot("oraculum-claude-plugin-cache-");
    const pluginsDir = join(root, "plugins");
    const installPath = join(pluginsDir, "cache", "oraculum", "oraculum", APP_VERSION);
    await mkdir(installPath, { recursive: true });
    await writeFile(join(installPath, "plugin.json"), "{}\n", "utf8");
    await writeFile(
      join(pluginsDir, "installed_plugins.json"),
      `${JSON.stringify(
        {
          version: 2,
          plugins: {
            "oraculum@oraculum": [
              {
                installPath,
                scope: "user",
                version: APP_VERSION,
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    expect(hasClaudePluginArtifactsInstalled(pluginsDir)).toBe(true);
  });
});
