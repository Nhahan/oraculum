import type { ExportMaterializationMode, ExportMode } from "./schema.js";

export function getExportMaterializationMode(plan: {
  materializationMode: ExportMaterializationMode;
}): ExportMaterializationMode;
export function getExportMaterializationMode(plan: {
  materializationMode?: ExportMaterializationMode | undefined;
  mode: ExportMode;
}): ExportMaterializationMode;
export function getExportMaterializationMode(plan: {
  materializationMode?: ExportMaterializationMode | undefined;
  mode?: ExportMode | undefined;
}): ExportMaterializationMode {
  if (plan.materializationMode) {
    return plan.materializationMode;
  }

  if (plan.mode) {
    return plan.mode === "git-branch" ? "branch" : "workspace-sync";
  }

  return "workspace-sync";
}

export function getExportMaterializationPatchPath(plan: {
  materializationPatchPath?: string | undefined;
  patchPath?: string | undefined;
}): string | undefined {
  return plan.materializationPatchPath ?? plan.patchPath;
}
