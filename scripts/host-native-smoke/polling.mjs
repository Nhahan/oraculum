import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function readLatestRunId(projectRoot) {
  const latest = JSON.parse(
    await readFile(join(projectRoot, ".oraculum", "latest-run.json"), "utf8"),
  );
  if (typeof latest.runId !== "string" || latest.runId.length === 0) {
    throw new Error(`latest-run.json does not contain a runId: ${JSON.stringify(latest)}`);
  }

  return latest.runId;
}

export async function waitForCompletedRun(projectRoot, options) {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const deadline = Date.now() + options.timeoutMs;
  let lastError = "latest-run.json was not written yet.";

  while (Date.now() < deadline) {
    try {
      const runId = await readLatestRunId(projectRoot);
      const runPath = join(projectRoot, ".oraculum", "runs", runId, "run.json");
      const manifest = JSON.parse(await readFile(runPath, "utf8"));
      if (manifest.status === "completed") {
        return { runId, manifest };
      }
      lastError = `run ${runId} is still ${manifest.status}.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(pollIntervalMs);
  }

  throw new Error(`${options.label} did not settle within ${options.timeoutMs}ms. ${lastError}`);
}

export async function waitForExportPlan(projectRoot, runId, options) {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const deadline = Date.now() + options.timeoutMs;
  const exportPlanPath = join(
    projectRoot,
    ".oraculum",
    "runs",
    runId,
    "reports",
    "export-plan.json",
  );
  const runPath = join(projectRoot, ".oraculum", "runs", runId, "run.json");
  let lastError = `export plan ${exportPlanPath} was not written yet.`;

  while (Date.now() < deadline) {
    try {
      await readFile(exportPlanPath, "utf8");
      const manifest = JSON.parse(await readFile(runPath, "utf8"));
      const exportedCandidateIds = Array.isArray(manifest.candidates)
        ? manifest.candidates.filter((candidate) => candidate?.status === "exported")
        : [];
      if (exportedCandidateIds.length > 0) {
        return;
      }
      lastError = `export plan exists, but run ${runId} has not recorded an exported candidate yet.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(pollIntervalMs);
  }

  throw new Error(
    `${options.label} did not persist its export plan within ${options.timeoutMs}ms. ${lastError}`,
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}
