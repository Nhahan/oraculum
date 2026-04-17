import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getResearchBriefPath } from "../src/core/paths.js";
import { consultationResearchBriefSchema } from "../src/domain/run.js";
import { createInitializedProject } from "./helpers/consultations.js";
import {
  createTimedOutPreflightAdapter,
  registerConsultationsPreflightTempRootCleanup,
  runConsultationPreflightScenario,
  writePreflightTaskPacket,
} from "./helpers/consultations-preflight.js";

registerConsultationsPreflightTempRootCleanup();

describe("consultation preflight fallback policy", () => {
  it("falls back to needs-clarification for vague low-contract tasks when runtime preflight times out", async () => {
    const cwd = await createInitializedProject();
    await mkdir(join(cwd, "dogfood-tasks"), { recursive: true });
    const taskPacket = await writePreflightTaskPacket({
      contents: [
        "Improve the release guidance so it is better and more complete.",
        "",
        "Notes:",
        "- Keep the change small.",
        "- Use the right artifact if one should change.",
        "- Make the result obviously better for operators.",
        "",
      ].join("\n"),
      cwd,
      id: "ambiguous-release-guidance",
      intent: [
        "Improve the release guidance so it is better and more complete.",
        "",
        "Notes:",
        "- Keep the change small.",
        "- Use the right artifact if one should change.",
        "- Make the result obviously better for operators.",
      ].join("\n"),
      runId: "run_ambiguous_timeout",
      sourcePath: join(cwd, "dogfood-tasks", "ambiguous-release-guidance.md"),
      title: "ambiguous release guidance",
    });

    const result = await runConsultationPreflightScenario({
      adapter: createTimedOutPreflightAdapter(),
      cwd,
      runId: "run_ambiguous_timeout",
      taskPacket,
    });

    expect(result.preflight).toEqual({
      decision: "needs-clarification",
      confidence: "low",
      summary:
        "Runtime preflight did not return a structured recommendation. The task still lacks a concrete target artifact or result contract for safe execution.",
      researchPosture: "repo-only",
      clarificationQuestion:
        "Which file or artifact should Oraculum update, and what concrete result should it produce?",
    });
  });

  it("falls back to external-research-required for official current-version doc tasks when runtime preflight times out", async () => {
    const cwd = await createInitializedProject();
    await mkdir(join(cwd, "dogfood-tasks"), { recursive: true });
    const intent = [
      "Document whether the current Oraculum docs match the latest official OpenAI guidance for structured tool output and prompt-based JSON schema generation.",
      "",
      "Target outcome:",
      "- If repo-only evidence is enough, proceed conservatively.",
      "- If repo-only evidence is insufficient, do not guess. Require bounded external research and preserve a reusable research artifact.",
    ].join("\n");
    const taskPacket = await writePreflightTaskPacket({
      contents: `${intent}\n`,
      cwd,
      id: "external-doc-alignment",
      intent,
      runId: "run_external_doc_timeout",
      sourcePath: join(cwd, "dogfood-tasks", "external-doc-alignment.md"),
      title: "external doc alignment",
    });

    const result = await runConsultationPreflightScenario({
      adapter: createTimedOutPreflightAdapter(),
      cwd,
      runId: "run_external_doc_timeout",
      taskPacket,
    });

    expect(result.preflight).toEqual({
      decision: "external-research-required",
      confidence: "low",
      summary:
        "Runtime preflight did not return a structured recommendation. Official current-version documentation is still required before safe execution.",
      researchPosture: "external-research-required",
      researchQuestion:
        "What do the official current-version docs say about the requested behavior or guidance?",
    });
    const researchBrief = consultationResearchBriefSchema.parse(
      JSON.parse(
        await readFile(getResearchBriefPath(cwd, "run_external_doc_timeout"), "utf8"),
      ) as unknown,
    );
    expect(researchBrief.question).toBe(
      "What do the official current-version docs say about the requested behavior or guidance?",
    );
  });
});
