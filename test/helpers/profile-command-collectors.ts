import { createTempRootHarness } from "./fs.js";

const tempRootHarness = createTempRootHarness("oraculum-profile-collectors-");

export function registerProfileCommandCollectorsCleanup(): void {
  tempRootHarness.registerCleanup();
}

export async function createProfileCollectorsTempRoot(): Promise<string> {
  return tempRootHarness.createTempRoot();
}

export async function withProcessPlatform<T>(
  platform: NodeJS.Platform,
  callback: () => Promise<T>,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(process, "platform", descriptor);
    }
  }
}
