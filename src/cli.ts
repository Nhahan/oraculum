#!/usr/bin/env node

import { buildProgram } from "./program.js";

try {
  const program = buildProgram();
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`[oraculum] ${message}\n`);
  process.exitCode =
    typeof error === "object" &&
    error !== null &&
    "exitCode" in error &&
    typeof error.exitCode === "number"
      ? error.exitCode
      : 1;
}
