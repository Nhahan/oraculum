import { chmodSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeNodeBinary(root, name, source) {
  await mkdir(root, { recursive: true });
  const scriptPath = join(root, `${name}.cjs`);
  await writeFile(scriptPath, source, "utf8");
  const wrapperPath = join(root, name);
  await writeFile(
    wrapperPath,
    `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8",
  );
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}
