import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { APP_VERSION } from "../src/core/constants.js";
import { setupStatusToolResponseSchema } from "../src/domain/chat-native.js";
import {
  buildSetupDiagnosticsResponse,
  filterSetupDiagnosticsResponse,
  hasClaudeCommandArtifactsInstalled,
  hasClaudePluginArtifactsInstalled,
  hasCodexArtifactsInstalled,
  summarizeSetupDiagnosticsHosts,
} from "../src/services/chat-native.js";
import {
  createChatNativeTempRoot,
  registerChatNativeTempRootCleanup,
} from "./helpers/chat-native.js";

registerChatNativeTempRootCleanup();

describe("chat-native setup diagnostics", () => {
  it("describes launch-time setup diagnostics with actionable host readiness states", () => {
    const diagnostics = setupStatusToolResponseSchema.parse(
      buildSetupDiagnosticsResponse(process.cwd()),
    );

    expect(diagnostics.targetPrefix).toBe("orc");
    expect(diagnostics.hosts).toHaveLength(2);
    expect(diagnostics.summary).toContain("launch-time exact `orc ...`");
    for (const host of diagnostics.hosts) {
      expect(["ready", "partial", "needs-setup"]).toContain(host.status);
      if (host.status === "ready") {
        expect(host.launchTransport).toBe("official");
        expect(host.nextAction).toContain("launch-time exact `orc ...`");
      } else {
        expect(host.nextAction).toContain("oraculum setup --runtime");
      }
    }
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
          launchTransport: host.launchTransport,
        })),
      ),
    );
  });

  it("recognizes the Claude plugin cache layout created by Claude Code", async () => {
    const root = await createChatNativeTempRoot("oraculum-claude-plugin-cache-");
    const pluginsDir = join(root, "plugins");
    const installPath = join(pluginsDir, "cache", "oraculum", "orc", APP_VERSION);
    await mkdir(installPath, { recursive: true });
    await writeFile(
      join(installPath, "plugin.json"),
      `${JSON.stringify({ name: "orc", version: APP_VERSION }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(installPath, ".mcp.json"), "{}\n", "utf8");
    for (const dirName of [
      "consult",
      "plan",
      "verdict",
      "verdict-archive",
      "crown",
      "draft",
      "init",
    ]) {
      await mkdir(join(installPath, "skills", dirName), { recursive: true });
      await writeFile(join(installPath, "skills", dirName, "SKILL.md"), `${dirName}\n`, "utf8");
    }
    await writeFile(
      join(pluginsDir, "installed_plugins.json"),
      `${JSON.stringify(
        {
          version: 2,
          plugins: {
            "orc@oraculum": [
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

  it("requires concrete Codex skill files instead of only skill directories", async () => {
    const root = await createChatNativeTempRoot("oraculum-codex-skill-files-");
    const skillsDir = join(root, "skills");
    const rulesDir = join(root, "rules");
    await mkdir(rulesDir, { recursive: true });
    await writeFile(join(rulesDir, "oraculum.md"), "# Oraculum\n", "utf8");

    for (const dirName of [
      "route-consult",
      "route-plan",
      "route-verdict",
      "route-verdict-archive",
      "route-crown",
      "route-draft",
      "route-init",
    ]) {
      await mkdir(join(skillsDir, dirName), { recursive: true });
    }

    expect(hasCodexArtifactsInstalled(skillsDir, rulesDir)).toBe(false);

    for (const dirName of [
      "route-consult",
      "route-plan",
      "route-verdict",
      "route-verdict-archive",
      "route-crown",
      "route-draft",
      "route-init",
    ]) {
      await writeFile(join(skillsDir, dirName, "SKILL.md"), `${dirName}\n`, "utf8");
    }

    expect(hasCodexArtifactsInstalled(skillsDir, rulesDir)).toBe(true);
  });

  it("requires concrete Claude command files in the install root", async () => {
    const root = await createChatNativeTempRoot("oraculum-claude-command-files-");
    const installRoot = join(root, "install-root");
    await mkdir(join(installRoot, "commands"), { recursive: true });
    for (const name of ["consult", "verdict", "verdict-archive", "crown", "plan", "draft"]) {
      await writeFile(join(installRoot, "commands", `${name}.md`), `${name}\n`, "utf8");
    }

    expect(hasClaudeCommandArtifactsInstalled(installRoot)).toBe(false);

    await writeFile(join(installRoot, "commands", "init.md"), "init\n", "utf8");

    expect(hasClaudeCommandArtifactsInstalled(installRoot)).toBe(true);
  });
});
