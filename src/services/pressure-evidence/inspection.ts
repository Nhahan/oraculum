import { RunStore } from "../run-store.js";
import {
  type PressureCoverageGapRun,
  type PressureEvidenceCase,
  type PressureInspectionItem,
  pressureInspectionItemSchema,
} from "./schema.js";

export function buildClarifyInspectionQueue(
  projectRoot: string,
  cases: PressureEvidenceCase[],
  coverageGapRuns: PressureCoverageGapRun[],
): PressureInspectionItem[] {
  return [
    ...buildGapInspectionQueue(projectRoot, coverageGapRuns),
    ...buildInspectionQueue(cases, [
      {
        artifactKind: "clarify-follow-up",
        path: (item) => item.artifactPaths.clarifyFollowUpPath,
        reason: () =>
          "Inspect the persisted clarify follow-up artifact for bounded rerun guidance.",
      },
      {
        artifactKind: "research-brief",
        path: (item) => item.artifactPaths.researchBriefPath,
        reason: (item) =>
          item.kind === "external-research-required"
            ? "Review the bounded research artifact for this blocker."
            : undefined,
      },
      {
        artifactKind: "preflight-readiness",
        path: (item) => item.artifactPaths.preflightReadinessPath,
        reason: (item) =>
          item.preflightFallbackObserved
            ? "Inspect fallback preflight evidence and missing structured recommendation details."
            : "Inspect the structured preflight readiness artifact for this blocker.",
      },
    ]),
  ];
}

export function buildFinalistInspectionQueue(
  projectRoot: string,
  cases: PressureEvidenceCase[],
  coverageGapRuns: PressureCoverageGapRun[],
): PressureInspectionItem[] {
  return [
    ...buildGapInspectionQueue(projectRoot, coverageGapRuns),
    ...buildInspectionQueue(cases, [
      {
        artifactKind: "failure-analysis",
        path: (item) => item.artifactPaths.failureAnalysisPath,
        reason: (item) =>
          item.kind === "judge-abstain" || item.kind === "finalists-without-recommendation"
            ? "Inspect why the finalists did not produce a safe recommendation."
            : undefined,
      },
      {
        artifactKind: "winner-selection",
        path: (item) => item.artifactPaths.winnerSelectionPath,
        reason: (item) =>
          item.kind === "judge-abstain" || item.kind === "low-confidence-recommendation"
            ? "Inspect the judge output and confidence rationale."
            : undefined,
      },
      {
        artifactKind: "winner-selection-second-opinion",
        path: (item) => item.artifactPaths.secondOpinionWinnerSelectionPath,
        reason: (item) =>
          item.manualReviewRecommended
            ? "Inspect the advisory second-opinion judge before deciding whether the finalist pressure warrants escalation."
            : item.kind === "low-confidence-recommendation"
              ? "Inspect the advisory second-opinion judge for the low-confidence finalist decision."
              : undefined,
      },
      {
        artifactKind: "comparison-json",
        path: (item) => item.artifactPaths.comparisonJsonPath,
        reason: () => "Inspect finalist evidence and outcome comparisons in machine-readable form.",
      },
      {
        artifactKind: "comparison-markdown",
        path: (item) => item.artifactPaths.comparisonMarkdownPath,
        reason: () => "Inspect the human-readable finalist comparison narrative.",
      },
    ]),
  ];
}

function buildGapInspectionQueue(
  projectRoot: string,
  gapRuns: PressureCoverageGapRun[],
): PressureInspectionItem[] {
  const store = new RunStore(projectRoot);
  return [...gapRuns]
    .sort((left, right) => new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime())
    .map((item) =>
      pressureInspectionItemSchema.parse({
        artifactKind: "run-manifest",
        runId: item.runId,
        openedAt: item.openedAt,
        reason: `Inspect the run manifest because ${item.missingArtifactKinds.join(", ")} are missing for this pressure case.`,
        path: store.getRunPaths(item.runId).manifestPath,
      }),
    );
}

function buildInspectionQueue(
  cases: PressureEvidenceCase[],
  specs: Array<{
    artifactKind: PressureInspectionItem["artifactKind"];
    path: (item: PressureEvidenceCase) => string | undefined;
    reason: (item: PressureEvidenceCase) => string | undefined;
  }>,
): PressureInspectionItem[] {
  const items: PressureInspectionItem[] = [];
  const seenPaths = new Set<string>();

  for (const item of [...cases].sort(
    (left, right) => new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime(),
  )) {
    for (const spec of specs) {
      const path = spec.path(item);
      const reason = spec.reason(item);
      if (!path || !reason || seenPaths.has(path)) {
        continue;
      }

      seenPaths.add(path);
      items.push(
        pressureInspectionItemSchema.parse({
          artifactKind: spec.artifactKind,
          runId: item.runId,
          openedAt: item.openedAt,
          reason,
          path,
        }),
      );
    }
  }

  return items;
}
