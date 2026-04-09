import {
  type PackagedHostArtifactLayout,
  packagedHostArtifactLayoutSchema,
} from "../domain/packaged-host-artifacts.js";

export const PACKAGED_HOST_ARTIFACTS_ROOT = "chat-native";

export const packagedHostArtifactLayout: PackagedHostArtifactLayout =
  packagedHostArtifactLayoutSchema.parse({
    rootDir: PACKAGED_HOST_ARTIFACTS_ROOT,
    commandManifestPath: `${PACKAGED_HOST_ARTIFACTS_ROOT}/command-manifest.json`,
    mcpToolSurfacePath: `${PACKAGED_HOST_ARTIFACTS_ROOT}/mcp-tool-surface.json`,
    hosts: [
      {
        host: "claude-code",
        rootDir: `${PACKAGED_HOST_ARTIFACTS_ROOT}/claude-code`,
        files: [
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/claude-code/README.md`,
            purpose: "Documents the packaged Claude Code host-artifact root.",
          },
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/claude-code/.claude-plugin/marketplace.json`,
            purpose: "Marketplace manifest for Claude Code plugin installation.",
          },
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/claude-code/commands/consult.md`,
            purpose: "Generated Claude command entry for consult.",
          },
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/claude-code/commands/verdict.md`,
            purpose: "Generated Claude command entry for verdict.",
          },
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/claude-code/commands/crown.md`,
            purpose: "Generated Claude command entry for crown.",
          },
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/claude-code/commands/draft.md`,
            purpose: "Generated Claude command entry for draft.",
          },
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/claude-code/commands/init.md`,
            purpose: "Generated Claude command entry for init.",
          },
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/claude-code/.claude-plugin/plugin.json`,
            purpose: "Generated Claude plugin manifest.",
          },
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/claude-code/.claude-plugin/.mcp.json`,
            purpose: "Generated Claude plugin MCP registration manifest.",
          },
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/claude-code/.claude-plugin/skills/consult/SKILL.md`,
            purpose: "Generated Claude exact-prefix consult skill.",
          },
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/claude-code/.claude-plugin/skills/verdict/SKILL.md`,
            purpose: "Generated Claude exact-prefix verdict skill.",
          },
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/claude-code/.claude-plugin/skills/crown/SKILL.md`,
            purpose: "Generated Claude exact-prefix crown skill.",
          },
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/claude-code/.claude-plugin/skills/draft/SKILL.md`,
            purpose: "Generated Claude exact-prefix draft skill.",
          },
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/claude-code/.claude-plugin/skills/init/SKILL.md`,
            purpose: "Generated Claude exact-prefix init skill.",
          },
        ],
      },
      {
        host: "codex",
        rootDir: `${PACKAGED_HOST_ARTIFACTS_ROOT}/codex`,
        files: [
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/codex/README.md`,
            purpose: "Documents the packaged Codex host-artifact root.",
          },
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/codex/skills/README.md`,
            purpose: "Placeholder root for generated Codex skill artifacts.",
          },
          {
            path: `${PACKAGED_HOST_ARTIFACTS_ROOT}/codex/rules/README.md`,
            purpose: "Placeholder root for generated Codex rule artifacts.",
          },
        ],
      },
    ],
  });
