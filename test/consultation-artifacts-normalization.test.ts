import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeConsultationScopePath } from "../src/services/consultation-artifacts.js";
import {
  createInitializedProject,
  registerConsultationArtifactsTempRootCleanup,
} from "./helpers/consultation-artifacts.js";

registerConsultationArtifactsTempRootCleanup();

describe("consultation artifact scope normalization", () => {
  it("normalizes relative and in-repo absolute scope paths consistently", async () => {
    const cwd = await createInitializedProject();
    const absoluteInRepo = join(cwd, "docs", "PRD.md");
    const externalRelative = "../shared/PRD.md";
    const externalAbsolute = join(cwd, externalRelative);

    expect(normalizeConsultationScopePath(cwd, "docs/PRD.md")).toBe("docs/PRD.md");
    expect(normalizeConsultationScopePath(cwd, "./docs/PRD.md")).toBe("docs/PRD.md");
    expect(normalizeConsultationScopePath(cwd, absoluteInRepo)).toBe("docs/PRD.md");
    expect(normalizeConsultationScopePath(cwd, externalRelative)).toBe(externalAbsolute);
    expect(normalizeConsultationScopePath(cwd, externalAbsolute)).toBe(externalAbsolute);
  });
});
