import { mkdir } from "node:fs/promises";

import { writeJsonFile } from "../project.js";
import { RunStore } from "../run-store.js";
import { collectPressureEvidence } from "./collect.js";
import type { PressureEvidenceReport } from "./schema.js";

export async function writePressureEvidenceReport(cwd: string): Promise<{
  path: string;
  projectRoot: string;
  report: PressureEvidenceReport;
}> {
  const report = await collectPressureEvidence(cwd);
  const store = new RunStore(report.projectRoot);
  const path = store.pressureEvidencePath;
  await mkdir(store.oraculumDir, { recursive: true });
  await writeJsonFile(path, report);
  return {
    path,
    projectRoot: report.projectRoot,
    report,
  };
}
