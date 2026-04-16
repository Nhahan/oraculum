import { initializeProject } from "../../src/services/project.js";
import { createTempRootHarness } from "./fs.js";

const tempRootHarness = createTempRootHarness("oraculum-");

export function registerProjectTempRootCleanup(): void {
  tempRootHarness.registerCleanup();
}

export async function createTempProject(): Promise<string> {
  return tempRootHarness.createTempRoot();
}

export async function createInitializedProject(): Promise<string> {
  const cwd = await createTempProject();
  await initializeProject({ cwd, force: false });
  return cwd;
}
