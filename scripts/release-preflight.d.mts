export interface ReleasePreflightStep {
  label: string;
  command: string;
  args: string[];
  skipFlag: string;
}

export interface ReleasePreflightBuildResult {
  args: Set<string>;
  steps: ReleasePreflightStep[];
}

export interface ReleasePreflightRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  run?: (
    command: string,
    args: string[],
  ) => {
    status: number | null | undefined;
  };
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
}

export function buildReleasePreflightSteps(rawArgs: string[]): ReleasePreflightBuildResult;

export function runReleasePreflight(
  rawArgs: string[],
  options?: ReleasePreflightRunOptions,
): number;
