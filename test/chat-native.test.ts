import { constants } from "node:fs";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { APP_VERSION } from "../src/core/constants.js";
import {
  getExportPlanPath,
  getFinalistComparisonMarkdownPath,
  getPreflightReadinessPath,
  getRunConfigPath,
  getRunDir,
} from "../src/core/paths.js";
import {
  consultToolResponseSchema,
  mcpToolIdSchema,
  setupStatusToolResponseSchema,
} from "../src/domain/chat-native.js";
import {
  buildConsultationArtifacts,
  buildSetupDiagnosticsResponse,
  filterSetupDiagnosticsResponse,
  getMcpToolSchemas,
  hasClaudePluginArtifactsInstalled,
  oraculumCommandManifest,
  oraculumMcpToolSurface,
  summarizeSetupDiagnosticsHosts,
} from "../src/services/chat-native.js";
import { createOraculumMcpServer } from "../src/services/mcp-server.js";
import { initializeProject } from "../src/services/project.js";

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

  it("publishes crown input schema without requiring branchName or materializationLabel", async () => {
    const mcpServer = createOraculumMcpServer();
    const requestHandlers = (
      mcpServer.server as unknown as {
        _requestHandlers: Map<string, unknown>;
      }
    )._requestHandlers;
    const listTools = requestHandlers.get("tools/list") as (request: {
      method: "tools/list";
      params: Record<string, never>;
    }) => Promise<{ tools: Array<{ inputSchema: Record<string, unknown>; name: string }> }>;

    const response = await listTools({
      method: "tools/list",
      params: {},
    });
    const crown = response.tools.find((tool) => tool.name === "oraculum_crown");

    expect(crown).toBeDefined();
    expect(crown?.inputSchema).toMatchObject({
      properties: {
        branchName: {
          minLength: 1,
          type: "string",
        },
        materializationLabel: {
          minLength: 1,
          type: "string",
        },
      },
      required: ["cwd"],
      type: "object",
    });
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
    const consultationId = "run_20260409_demo";

    await mkdir(getRunDir(projectRoot, consultationId), { recursive: true });
    await mkdir(join(getRunDir(projectRoot, consultationId), "reports"), { recursive: true });
    await writeFile(getRunConfigPath(projectRoot, consultationId), "{}\n", "utf8");
    await writeFile(getPreflightReadinessPath(projectRoot, consultationId), "{}\n", "utf8");
    await writeFile(getFinalistComparisonMarkdownPath(projectRoot, consultationId), "# report\n");
    await writeFile(getExportPlanPath(projectRoot, consultationId), "{}\n", "utf8");

    const artifacts = buildConsultationArtifacts(projectRoot, consultationId);
    const parsed = consultToolResponseSchema.shape.artifacts.parse(artifacts);

    expect(parsed.consultationRoot).toBe(getRunDir(projectRoot, consultationId));
    expect(parsed.configPath).toBe(getRunConfigPath(projectRoot, consultationId));
    expect(parsed.preflightReadinessPath).toBe(
      getPreflightReadinessPath(projectRoot, consultationId),
    );
    expect(parsed.comparisonMarkdownPath).toBe(
      getFinalistComparisonMarkdownPath(projectRoot, consultationId),
    );
    expect(parsed.crowningRecordPath).toBe(getExportPlanPath(projectRoot, consultationId));
    expect(parsed.profileSelectionPath).toBeUndefined();
  });

  it("resolves consultation artifacts from a nested cwd", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "oraculum-chat-native-nested-"));
    tempRoots.push(projectRoot);
    const nestedCwd = join(projectRoot, "packages", "app");
    const consultationId = "run_20260409_nested";

    await initializeProject({ cwd: projectRoot, force: false });
    await mkdir(nestedCwd, { recursive: true });
    await mkdir(join(getRunDir(projectRoot, consultationId), "reports"), { recursive: true });
    await writeFile(getRunConfigPath(projectRoot, consultationId), "{}\n", "utf8");
    await writeFile(getPreflightReadinessPath(projectRoot, consultationId), "{}\n", "utf8");

    const artifacts = buildConsultationArtifacts(nestedCwd, consultationId);
    const parsed = consultToolResponseSchema.shape.artifacts.parse(artifacts);

    expect(parsed.consultationRoot).toBe(getRunDir(projectRoot, consultationId));
    expect(parsed.configPath).toBe(getRunConfigPath(projectRoot, consultationId));
    expect(parsed.preflightReadinessPath).toBe(
      getPreflightReadinessPath(projectRoot, consultationId),
    );
  });

  it("omits artifact paths that do not exist on disk", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "oraculum-chat-native-missing-"));
    tempRoots.push(projectRoot);
    const consultationId = "run_20260409_missing";

    await mkdir(getRunDir(projectRoot, consultationId), { recursive: true });

    const artifacts = buildConsultationArtifacts(projectRoot, consultationId);
    const parsed = consultToolResponseSchema.shape.artifacts.parse(artifacts);

    expect(parsed.consultationRoot).toBe(getRunDir(projectRoot, consultationId));
    expect(parsed.configPath).toBeUndefined();
    expect(parsed.preflightReadinessPath).toBeUndefined();
    expect(parsed.profileSelectionPath).toBeUndefined();
    expect(parsed.comparisonMarkdownPath).toBeUndefined();
    expect(parsed.crowningRecordPath).toBeUndefined();
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
    const projectRoot = await mkdtemp(join(tmpdir(), "oraculum-setup-diagnostics-"));
    tempRoots.push(projectRoot);

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
