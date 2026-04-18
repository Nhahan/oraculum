export function sanitizeTmuxTranscript(value: string): string;
export function includesOraculumApprovalPrompt(transcript: string, toolName?: string): boolean;
export function parseMeaningfulTmuxTail(raw: string, maxLines?: number): string;
export function createTmuxHarness(options: {
  command: string;
  cwd: string;
  logPath?: string;
  sessionName?: string;
}): Promise<{
  logPath: string;
  root: string;
  sessionName: string;
  target: string;
}>;
export function destroyTmuxHarness(harness: { root: string; sessionName: string }): Promise<void>;
export function captureTmuxPane(
  harness: {
    sessionName: string;
    target: string;
  },
  startLine?: number,
): Promise<string>;
export function sendTmuxKeys(
  harness: {
    sessionName: string;
    target: string;
  },
  text: string,
  options?: {
    enter?: boolean;
  },
): Promise<void>;
export function sendTmuxControl(
  harness: {
    sessionName: string;
    target: string;
  },
  key: string,
): Promise<void>;
export function waitForInteractiveTranscript(
  harness: {
    sessionName: string;
    target: string;
  },
  options: {
    approvalChoice?: string;
    match: (transcript: string) => boolean;
    pollIntervalMs?: number;
    startLine?: number;
    timeoutMs: number;
    toolName?: string;
  },
): Promise<{
  approvalApplied: boolean;
  transcript: string;
}>;
export function sampleInteractiveTranscript(
  harness: {
    sessionName: string;
    target: string;
  },
  options: {
    approvalChoice?: string;
    durationMs: number;
    maxLines?: number;
    nudgeIfIdle?: boolean;
    pollIntervalMs?: number;
    progressMatchers: string[];
    promptEcho: string;
    startLine?: number;
    toolName?: string;
  },
): Promise<{
  approvalApplied: boolean;
  transcript: string;
  meaningfulTail: string;
}>;
