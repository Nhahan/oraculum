import { readdir, readFile } from "node:fs/promises";
import { relative } from "node:path";

import {
  getExportPlanPath,
  getFinalistComparisonMarkdownPath,
  getProfileSelectionPath,
  getRunDir,
  getRunManifestPath,
  getRunsDir,
  getWinnerSelectionPath,
  resolveProjectRoot,
} from "../core/paths.js";
import { type RunManifest, runManifestSchema } from "../domain/run.js";

import { pathExists } from "./project.js";

export async function listRecentConsultations(cwd: string, limit = 10): Promise<RunManifest[]> {
  const projectRoot = resolveProjectRoot(cwd);
  const runsDir = getRunsDir(projectRoot);

  if (!(await pathExists(runsDir))) {
    return [];
  }

  const entries = await readdir(runsDir, { withFileTypes: true });
  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const manifestPath = getRunManifestPath(projectRoot, entry.name);
        if (!(await pathExists(manifestPath))) {
          return undefined;
        }

        try {
          return runManifestSchema.parse(
            JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
          );
        } catch {
          return undefined;
        }
      }),
  );

  return manifests
    .filter((manifest): manifest is RunManifest => Boolean(manifest))
    .sort((left, right) => {
      const timeDelta = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      if (timeDelta !== 0) {
        return timeDelta;
      }

      return right.id.localeCompare(left.id);
    })
    .slice(0, limit);
}

export async function renderConsultationSummary(
  manifest: RunManifest,
  cwd: string,
): Promise<string> {
  const projectRoot = resolveProjectRoot(cwd);
  const finalists = manifest.candidates.filter(
    (candidate) => candidate.status === "promoted" || candidate.status === "exported",
  );

  const lines = [
    `Consultation: ${manifest.id}`,
    `Opened: ${manifest.createdAt}`,
    `Task: ${manifest.taskPacket.title}`,
    `Agent: ${manifest.agent}`,
    `Candidates: ${manifest.candidateCount}`,
    `Status: ${manifest.status}`,
  ];

  if (manifest.recommendedWinner) {
    lines.push(
      `Recommended promotion: ${manifest.recommendedWinner.candidateId} (${manifest.recommendedWinner.confidence}, ${manifest.recommendedWinner.source})`,
      manifest.recommendedWinner.summary,
    );
  }
  if (manifest.profileSelection) {
    lines.push(
      `Auto profile: ${manifest.profileSelection.profileId} (${manifest.profileSelection.confidence}, ${manifest.profileSelection.source})`,
      manifest.profileSelection.summary,
    );
    if (manifest.profileSelection.missingCapabilities.length > 0) {
      lines.push(
        "Profile gaps:",
        ...manifest.profileSelection.missingCapabilities.map((item) => `- ${item}`),
      );
    }
  }

  lines.push("Entry paths:");
  const comparisonReportPath = getFinalistComparisonMarkdownPath(projectRoot, manifest.id);
  const winnerSelectionPath = getWinnerSelectionPath(projectRoot, manifest.id);
  const comparisonReportExists = await pathExists(comparisonReportPath);
  const winnerSelectionExists = await pathExists(winnerSelectionPath);
  lines.push(
    `- consultation root: ${toDisplayPath(projectRoot, getRunDir(projectRoot, manifest.id))}`,
  );
  lines.push(
    manifest.profileSelection
      ? `- profile selection: ${toDisplayPath(projectRoot, getProfileSelectionPath(projectRoot, manifest.id))}`
      : "- profile selection: not available",
  );
  lines.push(
    comparisonReportExists
      ? `- comparison report: ${toDisplayPath(projectRoot, comparisonReportPath)}`
      : "- comparison report: not available yet",
  );
  lines.push(
    winnerSelectionExists
      ? `- winner selection: ${toDisplayPath(projectRoot, winnerSelectionPath)}`
      : "- winner selection: not available yet",
  );

  const exportPlanPath = getExportPlanPath(projectRoot, manifest.id);
  const hasExportedCandidate = manifest.candidates.some(
    (candidate) => candidate.status === "exported",
  );
  const hasPromotionRecord = hasExportedCandidate && (await pathExists(exportPlanPath));
  lines.push(
    hasPromotionRecord
      ? `- promotion record: ${toDisplayPath(projectRoot, exportPlanPath)}`
      : "- promotion record: not created yet",
  );

  if (finalists.length === 0) {
    lines.push("No finalists yet. Candidate states:");
  } else {
    lines.push("Finalists:");
    for (const candidate of finalists) {
      lines.push(`- ${candidate.id}: ${candidate.strategyLabel}`);
    }
    lines.push("All candidates:");
  }

  for (const candidate of manifest.candidates) {
    lines.push(`- ${candidate.id}: ${candidate.status} (${candidate.strategyLabel})`);
  }

  lines.push("Next:");
  if (hasPromotionRecord) {
    lines.push(`- reopen the promotion record: ${toDisplayPath(projectRoot, exportPlanPath)}`);
  } else if (manifest.recommendedWinner) {
    lines.push("- promote the recommended result: oraculum promote --branch <branch-name>");
  } else if (manifest.status === "completed" && finalists.length > 0) {
    lines.push(
      "- inspect the comparison and choose a candidate manually: oraculum promote <candidate-id> --branch <branch-name>",
    );
  } else if (manifest.status === "completed") {
    lines.push("- review why no candidate survived: open the comparison report above.");
  } else {
    lines.push(`- reopen this consultation later: oraculum verdict consultation ${manifest.id}`);
  }
  lines.push("- reopen the latest consultation later: oraculum verdict");
  lines.push("- browse recent consultations: oraculum verdict archive");

  return `${lines.join("\n")}\n`;
}

export function renderConsultationArchive(manifests: RunManifest[]): string {
  if (manifests.length === 0) {
    return "No consultations yet. Start with `oraculum consult ...`.\n";
  }

  const lines = ["Recent consultations:"];
  for (const manifest of manifests) {
    const recommendation = manifest.recommendedWinner
      ? `recommended ${manifest.recommendedWinner.candidateId}`
      : "no recommendation yet";
    const profile = manifest.profileSelection
      ? `profile ${manifest.profileSelection.profileId}`
      : "no auto profile";
    lines.push(
      `- ${manifest.id} | ${manifest.status} | ${manifest.taskPacket.title} | ${profile} | ${recommendation}`,
      `  opened: ${manifest.createdAt}`,
      `  reopen: oraculum verdict consultation ${manifest.id}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function toDisplayPath(projectRoot: string, targetPath: string): string {
  const display = relative(projectRoot, targetPath).replaceAll("\\", "/");
  return display.length > 0 ? display : ".";
}
