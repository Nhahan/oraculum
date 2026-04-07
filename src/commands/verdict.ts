import { type Command, InvalidArgumentError } from "commander";

import {
  listRecentConsultations,
  renderConsultationArchive,
  renderConsultationSummary,
} from "../services/consultations.js";
import { readLatestRunManifest, readRunManifest } from "../services/runs.js";

export function registerVerdictCommand(program: Command): void {
  const verdict = program
    .command("verdict")
    .description("Reopen the latest verdict or inspect a specific consultation.")
    .argument("[consultation-id]", "consultation identifier; defaults to the latest consultation")
    .action(async (consultationId?: string) => {
      await writeVerdict(consultationId);
    });

  verdict
    .command("consultation")
    .description("Inspect a specific consultation by id.")
    .argument("<consultation-id>", "consultation identifier")
    .action(async (consultationId: string) => {
      await writeVerdict(consultationId);
    });

  verdict
    .command("archive")
    .description("Browse recent consultations.")
    .argument(
      "[count]",
      "maximum number of recent consultations to show",
      parsePositiveInteger("archive count"),
    )
    .action(async (count?: number) => {
      const manifests = await listRecentConsultations(process.cwd(), count ?? 10);
      process.stdout.write(renderConsultationArchive(manifests));
    });
}

async function writeVerdict(consultationId?: string): Promise<void> {
  const manifest = consultationId
    ? await readRunManifest(process.cwd(), consultationId)
    : await readLatestRunManifest(process.cwd());
  process.stdout.write(await renderConsultationSummary(manifest, process.cwd()));
}

function parsePositiveInteger(label: string): (value: string) => number {
  return (value: string) => {
    const normalized = value.trim();
    if (!/^[1-9]\d*$/u.test(normalized)) {
      throw new InvalidArgumentError(`${label} must be a positive integer.`);
    }

    const parsed = Number(normalized);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new InvalidArgumentError(`${label} must be a positive integer.`);
    }

    return parsed;
  };
}
