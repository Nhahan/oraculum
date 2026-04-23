import type { ExportMaterializationMode } from "./schema.js";

export function getExportMaterializationMode(plan: {
  materializationMode: ExportMaterializationMode;
}): ExportMaterializationMode {
  return plan.materializationMode;
}

export function getExportMaterializationPatchPath(plan: {
  patchPath?: string | undefined;
}): string | undefined {
  return plan.patchPath;
}
