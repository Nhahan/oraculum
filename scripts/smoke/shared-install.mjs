import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeNodeBinary(root, name, source) {
  const scriptPath = join(root, `${name}.cjs`);
  await writeFile(scriptPath, source, "utf8");

  if (process.platform === "win32") {
    const wrapperPath = join(root, `${name}.cmd`);
    const nodePath = process.execPath.replace(/"/g, '""');
    await writeFile(wrapperPath, `@echo off\r\n"${nodePath}" "%~dp0\\${name}.cjs" %*\r\n`, "utf8");
    return wrapperPath;
  }

  const wrapperPath = join(root, name);
  await writeFile(
    wrapperPath,
    `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8",
  );
  await chmod(wrapperPath, 0o755);
  return wrapperPath;
}

export function runOrThrow(command, args, options) {
  const shell =
    process.platform === "win32" &&
    (["bun", "npm", "npx", "pnpm", "yarn", "yarnpkg"].includes(command.toLowerCase()) ||
      /\.(cmd|bat)$/iu.test(command));
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    ...(shell ? { shell } : {}),
    stdio: "pipe",
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function resolvePackedInstallSpec(repoRoot, tempRoot, explicitSpec) {
  if (explicitSpec) {
    return explicitSpec;
  }

  if (!existsSync(join(repoRoot, "dist"))) {
    runOrThrow("npm", ["run", "build"], { cwd: repoRoot });
  }

  const pack = runOrThrow("npm", ["pack", "--json", "--pack-destination", tempRoot], {
    cwd: repoRoot,
  });
  const parsed = JSON.parse(pack.stdout);
  const filename = Array.isArray(parsed) ? parsed[0]?.filename : parsed?.filename;
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error(`Unable to determine packed artifact from npm pack output:\n${pack.stdout}`);
  }

  return join(tempRoot, filename);
}

export function joinPathEntries(entries) {
  return entries.filter((entry) => entry.length > 0).join(process.platform === "win32" ? ";" : ":");
}
