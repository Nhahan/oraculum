import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const distServicePath = join(repoRoot, "dist", "services", "p3-evidence.js");

async function main() {
  if (!existsSync(distServicePath)) {
    throw new Error("dist/services/p3-evidence.js is missing. Run `npm run build` first.");
  }

  const args = process.argv.slice(2);
  const jsonOnly = args.includes("--json");
  const noWrite = args.includes("--no-write");
  const cwdArgument = args.find((entry) => !entry.startsWith("--"));
  const cwd = cwdArgument ? resolve(process.cwd(), cwdArgument) : process.cwd();
  const service = await import(pathToFileURL(distServicePath).href);

  if (noWrite) {
    const report = await service.collectP3Evidence(cwd);
    process.stdout.write(
      jsonOnly ? `${JSON.stringify(report, null, 2)}\n` : service.renderP3EvidenceSummary(report),
    );
    return;
  }

  const result = await service.writeP3EvidenceReport(cwd);
  process.stdout.write(
    jsonOnly
      ? `${JSON.stringify(result.report, null, 2)}\n`
      : service.renderP3EvidenceSummary(result.report, { artifactPath: result.path }),
  );
}

await main();
