import { constants } from "node:fs";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { APP_VERSION } from "../src/core/constants.js";
import { getExportPlanPath, getRunConfigPath, getRunDir } from "../src/core/paths.js";
import {
  consultToolResponseSchema,
  mcpToolIdSchema,
  setupStatusToolResponseSchema,
} from "../src/domain/chat-native.js";
import {
  buildConsultationArtifacts,
  buildSetupDiagnosticsResponse,
  getMcpToolSchemas,
  hasClaudePluginArtifactsInstalled,
  oraculumCommandManifest,
  oraculumMcpToolSurface,
} from "../src/services/chat-native.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("chat-native MCP surface", () => {
  it("defines schemas for every declared MCP tool", () => {
    const declaredToolIds = oraculumMcpToolSurface.map((tool) => tool.id);

    expect(new Set(declaredToolIds)).toHaveLength(declaredToolIds.length);
    expect(new Set(declaredToolIds)).toEqual(new Set(mcpToolIdSchema.options));

    for (const tool of oraculumMcpToolSurface) {
      const schemas = getMcpToolSchemas(tool.id);
      expect(schemas.request).toBeDefined();
      expect(schemas.response).toBeDefined();
    }
  });

  it("keeps one shared command vocabulary on the orc prefix", () => {
    expect(oraculumCommandManifest.map((entry) => entry.path.join(" "))).toEqual([
      "consult",
      "verdict",
      "verdict archive",
      "crown",
      "draft",
      "init",
    ]);

    for (const entry of oraculumCommandManifest) {
      expect(entry.prefix).toBe("orc");
      expect(oraculumMcpToolSurface.some((tool) => tool.id === entry.mcpTool)).toBe(true);
    }
  });

  it("binds every MCP tool to real repo modules plus at most a thin adapter layer", async () => {
    for (const tool of oraculumMcpToolSurface) {
      for (const binding of tool.bindings) {
        const modulePath = join(process.cwd(), binding.module);
        await expect(access(modulePath, constants.F_OK)).resolves.toBeUndefined();
      }
    }
  });

  it("builds machine-readable consultation artifact paths for MCP responses", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "oraculum-chat-native-"));
    tempRoots.push(projectRoot);

    const artifacts = buildConsultationArtifacts(projectRoot, "run_20260409_demo");
    const parsed = consultToolResponseSchema.shape.artifacts.parse(artifacts);

    expect(parsed.consultationRoot).toBe(getRunDir(projectRoot, "run_20260409_demo"));
    expect(parsed.configPath).toBe(getRunConfigPath(projectRoot, "run_20260409_demo"));
    expect(parsed.crowningRecordPath).toBe(getExportPlanPath(projectRoot, "run_20260409_demo"));
  });

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
        ?.notes.some((note) => note.includes("oraculum setup --runtime claude-code")),
    ).toBe(true);
    expect(
      diagnostics.hosts
        .find((host) => host.host === "codex")
        ?.notes.some((note) => note.includes("oraculum setup --runtime codex")),
    ).toBe(true);
  });

  it("recognizes the Claude plugin cache layout created by Claude Code", async () => {
    const root = await mkdtemp(join(tmpdir(), "oraculum-claude-plugin-cache-"));
    tempRoots.push(root);
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
