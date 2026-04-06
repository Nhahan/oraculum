import { symlink } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";

export async function createDirectoryLink(target: string, linkPath: string): Promise<void> {
  await symlink(
    target,
    linkPath,
    process.platform === "win32" && isAbsolute(target) ? "junction" : "dir",
  );
}

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/gu, "\n");
}

export function normalizeLinkedPath(path: string): string {
  return normalize(path).replace(/[\\/]+$/u, "");
}

export function normalizePathForAssertion(path: string): string {
  return path.replaceAll("\\", "/");
}
