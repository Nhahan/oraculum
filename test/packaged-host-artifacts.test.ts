import { describe, expect, it } from "vitest";

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
});
