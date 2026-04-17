export function writeNodeBinary(root: string, name: string, source: string): Promise<string>;

export function runOrThrow(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
): {
  stdout: string;
  stderr: string;
};

export function resolvePackedInstallSpec(
  repoRoot: string,
  tempRoot: string,
  explicitSpec?: string,
): string;

export function joinPathEntries(entries: string[]): string;
