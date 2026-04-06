import type { Command } from "commander";

import { initializeProject } from "../services/project.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize quick-start config and working directories.")
    .option("-f, --force", "reset quick-start config and remove advanced overrides")
    .action(async (options: { force?: boolean }) => {
      const result = await initializeProject({
        cwd: process.cwd(),
        force: options.force ?? false,
      });

      process.stdout.write(`Initialized Oraculum in ${result.projectRoot}\n`);
      process.stdout.write(`Config: ${result.configPath}\n`);
      for (const createdPath of result.createdPaths) {
        process.stdout.write(`Created: ${createdPath}\n`);
      }
    });
}
