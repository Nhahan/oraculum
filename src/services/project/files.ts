import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export async function hasNonEmptyTextArtifact(path: string): Promise<boolean> {
  if (!(await pathExists(path))) {
    return false;
  }

  try {
    return (await readFile(path, "utf8")).trim().length > 0;
  } catch {
    return false;
  }
}

export function hasNonEmptyTextArtifactSync(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    return readFileSync(path, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  await writeTextFileAtomically(path, contents);
}

export async function writeTextFileAtomically(path: string, contents: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });

  const tempPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, contents, "utf8");
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
