import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const distServicePath = join(repoRoot, "dist", "services", "pressure-evidence.js");

async function main() {
  if (!existsSync(distServicePath)) {
    throw new Error("dist/services/pressure-evidence.js is missing. Run `npm run build` first.");
  }

  const args = process.argv.slice(2);
  const jsonOnly = args.includes("--json");
  const noWrite = args.includes("--no-write");
  const cwdArgument = args.find((entry) => !entry.startsWith("--"));
  const cwd = cwdArgument ? resolve(process.cwd(), cwdArgument) : process.cwd();
  const service = await import(pathToFileURL(distServicePath).href);

  if (noWrite) {
    const report = await service.collectPressureEvidence(cwd);
    process.stdout.write(
      jsonOnly
        ? `${JSON.stringify(report, null, 2)}\n`
        : service.renderPressureEvidenceSummary(report),
    );
    return;
  }

  const result = await service.writePressureEvidenceReport(cwd);
  process.stdout.write(
    jsonOnly
      ? `${JSON.stringify(result.report, null, 2)}\n`
      : service.renderPressureEvidenceSummary(result.report, { artifactPath: result.path }),
  );
}

await main();
