import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const distRoot = join(repoRoot, "dist");

async function main() {
  const [
    { oraculumCommandManifest, oraculumMcpToolSurface },
    { packagedHostArtifactLayout },
    {
      buildClaudeCommandFiles,
      buildClaudeMarketplaceManifest,
      buildClaudePluginManifest,
      buildClaudePluginMcpConfig,
      buildClaudeSkillFiles,
    },
  ] = await Promise.all([
    import("../dist/services/chat-native.js"),
    import("../dist/services/packaged-host-artifacts.js"),
    import("../dist/services/claude-chat-native.js"),
  ]);

  await writeJson(
    join(distRoot, packagedHostArtifactLayout.commandManifestPath),
    oraculumCommandManifest,
  );
  await writeJson(
    join(distRoot, packagedHostArtifactLayout.mcpToolSurfacePath),
    oraculumMcpToolSurface,
  );
  await writeJson(
    join(distRoot, packagedHostArtifactLayout.rootDir, "layout.json"),
    packagedHostArtifactLayout,
  );

  await writeText(
    join(distRoot, packagedHostArtifactLayout.rootDir, "claude-code", "README.md"),
    [
      "# Claude Code packaged artifacts",
      "",
      "Generated marketplace, plugin, command, and skill artifacts for Claude Code live under this directory.",
      "",
    ].join("\n"),
  );

  await writeJson(
    join(
      distRoot,
      packagedHostArtifactLayout.rootDir,
      "claude-code",
      ".claude-plugin",
      "marketplace.json",
    ),
    buildClaudeMarketplaceManifest(),
  );
  await writeJson(
    join(
      distRoot,
      packagedHostArtifactLayout.rootDir,
      "claude-code",
      ".claude-plugin",
      "plugin.json",
    ),
    buildClaudePluginManifest(),
  );
  await writeJson(
    join(
      distRoot,
      packagedHostArtifactLayout.rootDir,
      "claude-code",
      ".claude-plugin",
      ".mcp.json",
    ),
    buildClaudePluginMcpConfig(),
  );

  for (const file of buildClaudeCommandFiles(oraculumCommandManifest)) {
    await writeText(
      join(distRoot, packagedHostArtifactLayout.rootDir, "claude-code", file.path),
      file.content,
    );
  }

  for (const file of buildClaudeSkillFiles(oraculumCommandManifest)) {
    await writeText(
      join(distRoot, packagedHostArtifactLayout.rootDir, "claude-code", file.path),
      file.content,
    );
  }

  const codexHost = packagedHostArtifactLayout.hosts.find((host) => host.host === "codex");
  if (!codexHost) {
    throw new Error("Missing packaged Codex host layout.");
  }

  for (const file of codexHost.files) {
    await writeText(
      join(distRoot, file.path),
      [
        "# Codex packaged artifacts",
        "",
        file.purpose,
        "",
        "This file exists so the npm package ships a stable host-artifact directory layout before the generated Codex integration lands.",
        "",
      ].join("\n"),
    );
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

main().catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
