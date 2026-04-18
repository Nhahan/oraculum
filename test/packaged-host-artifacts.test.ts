import { describe, expect, it } from "vitest";

import { oraculumCommandManifest } from "../src/services/chat-native.js";
import {
  buildClaudeCommandFiles,
  buildClaudeSkillFiles,
} from "../src/services/claude-chat-native.js";
import { buildCodexRuleFiles, buildCodexSkillFiles } from "../src/services/codex-chat-native.js";
import { packagedHostArtifactLayout } from "../src/services/packaged-host-artifacts.js";

describe("packaged host artifact layout", () => {
  it("keeps all packaged host artifacts under the shared chat-native root", () => {
    expect(packagedHostArtifactLayout.rootDir).toBe("chat-native");
    expect(packagedHostArtifactLayout.commandManifestPath).toBe(
      "chat-native/command-manifest.json",
    );
    expect(packagedHostArtifactLayout.mcpToolSurfacePath).toBe("chat-native/mcp-tool-surface.json");

    for (const host of packagedHostArtifactLayout.hosts) {
      expect(host.rootDir.startsWith(`${packagedHostArtifactLayout.rootDir}/`)).toBe(true);
      for (const file of host.files) {
        expect(file.path.startsWith(`${packagedHostArtifactLayout.rootDir}/`)).toBe(true);
      }
    }
  });

  it("keeps packaged host artifact paths unique", () => {
    const paths = [
      packagedHostArtifactLayout.commandManifestPath,
      packagedHostArtifactLayout.mcpToolSurfacePath,
      ...packagedHostArtifactLayout.hosts.flatMap((host) => host.files.map((file) => file.path)),
    ];

    expect(new Set(paths)).toHaveLength(paths.length);
  });

  it("stays aligned with generated host artifact file paths", () => {
    const claudeHost = packagedHostArtifactLayout.hosts.find((host) => host.host === "claude-code");
    const codexHost = packagedHostArtifactLayout.hosts.find((host) => host.host === "codex");

    expect(claudeHost).toBeDefined();
    expect(codexHost).toBeDefined();

    const claudePaths = new Set(claudeHost?.files.map((file) => file.path) ?? []);
    const codexPaths = new Set(codexHost?.files.map((file) => file.path) ?? []);
    const claudeRoot = `${packagedHostArtifactLayout.rootDir}/claude-code`;
    const codexRoot = `${packagedHostArtifactLayout.rootDir}/codex`;

    for (const command of buildClaudeCommandFiles(oraculumCommandManifest)) {
      expect(claudePaths.has(`${claudeRoot}/${command.path}`)).toBe(true);
    }
    for (const skill of buildClaudeSkillFiles(oraculumCommandManifest)) {
      expect(claudePaths.has(`${claudeRoot}/${skill.path}`)).toBe(true);
    }
    for (const rule of buildCodexRuleFiles(oraculumCommandManifest)) {
      expect(codexPaths.has(`${codexRoot}/${rule.path}`)).toBe(true);
    }
    for (const skill of buildCodexSkillFiles(oraculumCommandManifest)) {
      expect(codexPaths.has(`${codexRoot}/${skill.path}`)).toBe(true);
    }
  });
});
