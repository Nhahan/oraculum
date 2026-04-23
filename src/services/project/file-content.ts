import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";

export async function hashFileContent(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);

  try {
    for await (const chunk of stream) {
      hash.update(chunk);
    }
  } catch (error) {
    stream.destroy();
    throw error;
  }

  return hash.digest("hex");
}

export async function fileContentsEqual(leftPath: string, rightPath: string): Promise<boolean> {
  const [leftStats, rightStats] = await Promise.all([lstat(leftPath), lstat(rightPath)]);
  if (!leftStats.isFile() || !rightStats.isFile()) {
    return false;
  }

  if (leftStats.size !== rightStats.size) {
    return false;
  }

  const [leftHash, rightHash] = await Promise.all([
    hashFileContent(leftPath),
    hashFileContent(rightPath),
  ]);
  return leftHash === rightHash;
}
