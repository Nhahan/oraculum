import { describe, expect, it } from "vitest";

import {
  classifyPublishedSmokePrompt,
  shouldPublishedSmokeMutateWorkspace,
} from "../scripts/published-smoke.mjs";

describe("published smoke prompt classification", () => {
  it("treats candidate prompts as the only mutating stage", () => {
    const prompt = [
      "You are implementing an Oraculum candidate patch.",
      "Candidate ID: cand-01",
      "Task ID: task-01",
    ].join("\n");

    expect(classifyPublishedSmokePrompt(prompt)).toBe("candidate");
    expect(shouldPublishedSmokeMutateWorkspace(prompt)).toBe(true);
  });

  it("keeps profile selection prompts read-only", () => {
    const prompt = [
      "You are selecting the best Oraculum consultation validation posture for the current repository.",
      "Choose exactly one currently supported validation posture option and synthesize the strongest default tournament settings for this consultation.",
    ].join("\n");

    expect(classifyPublishedSmokePrompt(prompt)).toBe("profile");
    expect(shouldPublishedSmokeMutateWorkspace(prompt)).toBe(false);
  });

  it("keeps unknown read-only prompts non-mutating", () => {
    const prompt = [
      "You are summarizing persisted consultation evidence for an operator.",
      "Return JSON only.",
    ].join("\n");

    expect(classifyPublishedSmokePrompt(prompt)).toBe("read-only");
    expect(shouldPublishedSmokeMutateWorkspace(prompt)).toBe(false);
  });
});
