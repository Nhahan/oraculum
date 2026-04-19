import type { HostWrapperFilterState } from "./types.js";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_ESCAPE_SEQUENCE = new RegExp(
  `${ESC}(?:\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)|\\[[0-9;?]*[ -/]*[@-~])`,
  "gu",
);

export function buildInitialFilterState(): HostWrapperFilterState {
  return {
    pendingOrcCommand: false,
    suppressTreeDetail: false,
  };
}

export function noteSubmittedLine(
  state: HostWrapperFilterState,
  line: string,
): HostWrapperFilterState {
  state.pendingOrcCommand = line.trimStart().startsWith("orc ");
  state.suppressTreeDetail = false;
  return state;
}

export function noteObservedOutputLine(
  state: HostWrapperFilterState,
  line: string,
): HostWrapperFilterState {
  if (/^(?:[›❯>]\s*)orc\s+/u.test(line)) {
    state.pendingOrcCommand = true;
    state.suppressTreeDetail = false;
  }

  return state;
}

export function sanitizeWrapperLine(line: string): string {
  return line.replace(ANSI_ESCAPE_SEQUENCE, "").replace(/\r/gu, "").trim();
}

export function findNextLineBreak(value: string): { endIndex: number } | undefined {
  const carriageReturnIndex = value.indexOf("\r");
  const newlineIndex = value.indexOf("\n");

  if (carriageReturnIndex === -1 && newlineIndex === -1) {
    return undefined;
  }

  const firstBreakIndex =
    carriageReturnIndex === -1
      ? newlineIndex
      : newlineIndex === -1
        ? carriageReturnIndex
        : Math.min(carriageReturnIndex, newlineIndex);

  if (firstBreakIndex === -1) {
    return undefined;
  }

  let endIndex = firstBreakIndex + 1;
  if (value[firstBreakIndex] === "\r" && value[firstBreakIndex + 1] === "\n") {
    endIndex += 1;
  }

  return { endIndex };
}
