import { readFileSync } from "node:fs";

export const APP_NAME = "oraculum";
export const APP_VERSION = readPackageVersion();
export const CONFIG_VERSION = 1;

function readPackageVersion(): string {
  const packageJsonPath = new URL("../../package.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    version?: unknown;
  };

  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("Failed to resolve package version from package.json");
  }

  return parsed.version;
}
