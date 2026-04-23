import { chmod, cp, lstat, mkdir, readlink, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { listManagedProjectEntries } from "./list.js";
import { getManagedMode } from "./rules.js";
import {
  normalizeManagedSymlinkTarget,
  readSymlinkTargetType,
  shouldManageSymlinkTarget,
} from "./symlinks.js";
import type { ManagedTreeOptions } from "./types.js";

export async function copyManagedProjectTree(
  sourceRoot: string,
  destinationRoot: string,
  options: ManagedTreeOptions = {},
): Promise<void> {
  const entries = await listManagedProjectEntries(sourceRoot, options);
  const { rules } = options;

  for (const entry of entries) {
    const sourcePath = join(sourceRoot, entry.path);
    const destinationPath = join(destinationRoot, entry.path);

    if (entry.kind === "dir") {
      await mkdir(destinationPath, { recursive: true });
      const sourceStats = await lstat(sourcePath);
      await chmod(destinationPath, getManagedMode(sourceStats.mode));
      continue;
    }

    if (entry.kind === "file") {
      await mkdir(dirname(destinationPath), { recursive: true });
      await cp(sourcePath, destinationPath, { force: true, recursive: false });
      const sourceStats = await lstat(sourcePath);
      await chmod(destinationPath, getManagedMode(sourceStats.mode));
      continue;
    }

    const target = await readlink(sourcePath);
    if (
      !shouldManageSymlinkTarget({
        ...(rules ? { rules } : {}),
        sourcePath,
        sourceRoot,
        target,
      })
    ) {
      continue;
    }
    const targetType = await readSymlinkTargetType(sourcePath);
    const replicatedTarget = normalizeManagedSymlinkTarget({
      destinationPath,
      destinationRoot,
      sourcePath,
      sourceRoot,
      target,
      targetType,
      ...(rules ? { rules } : {}),
    });
    await mkdir(dirname(destinationPath), { recursive: true });
    await symlink(replicatedTarget, destinationPath, targetType);
  }
}
