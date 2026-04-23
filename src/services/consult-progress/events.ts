export type ConsultProgressEvent =
  | {
      kind: "consultation-started";
      message: string;
      phase: "planning";
    }
  | {
      kind: "planning-started";
      message: string;
      phase: "planning";
    }
  | {
      kind: "preflight-blocked";
      message: string;
      phase: "planning";
      decision: string;
    }
  | {
      kind: "candidates-launching";
      message: string;
      phase: "execution";
      candidateCount: number;
    }
  | {
      kind: "candidate-running" | "candidate-ready-for-checks" | "candidate-failed-before-checks";
      message: string;
      phase: "execution";
      candidateId: string;
      candidateIndex: number;
      candidateCount: number;
    }
  | {
      kind: "round-started";
      message: string;
      phase: "execution";
      roundId: string;
      roundLabel: string;
      candidateCount: number;
    }
  | {
      kind: "candidate-retrying";
      message: string;
      phase: "execution";
      candidateId: string;
      candidateIndex: number;
      candidateCount: number;
      roundId: string;
      roundLabel: string;
      repairAttempt: number;
    }
  | {
      kind: "candidate-passed-round" | "candidate-eliminated";
      message: string;
      phase: "execution";
      candidateId: string;
      candidateIndex: number;
      candidateCount: number;
      roundId: string;
      roundLabel: string;
    }
  | {
      kind: "round-completed";
      message: string;
      phase: "execution";
      roundId: string;
      roundLabel: string;
      remainingCandidates: number;
      inputCandidateCount: number;
    }
  | {
      kind: "comparing-finalists";
      message: string;
      phase: "judging";
      finalistCount: number;
    }
  | {
      kind: "no-survivors";
      message: string;
      phase: "judging";
    }
  | {
      kind: "second-opinion-requested" | "second-opinion-recorded";
      message: string;
      phase: "judging";
    }
  | {
      kind: "verdict-ready";
      message: string;
      phase: "completed";
    };

export type ConsultProgressReporter = (event: ConsultProgressEvent) => Promise<void> | void;

export function formatCandidateProgressLabel(
  position: number,
  total: number,
  candidateId: string,
): string {
  return `Candidate ${position}/${total} (${candidateId})`;
}

export function formatCandidateCount(value: number): string {
  return `${value} candidate${value === 1 ? "" : "s"}`;
}

export function consultationStartedEvent(): ConsultProgressEvent {
  return {
    kind: "consultation-started",
    phase: "planning",
    message: "Starting consultation",
  };
}

export function planningStartedEvent(): ConsultProgressEvent {
  return {
    kind: "planning-started",
    phase: "planning",
    message: "Planning consultation",
  };
}

export function preflightBlockedEvent(decision: string): ConsultProgressEvent {
  return {
    kind: "preflight-blocked",
    phase: "planning",
    decision,
    message: `Preflight blocked: ${decision}`,
  };
}

export function candidatesLaunchingEvent(candidateCount: number): ConsultProgressEvent {
  return {
    kind: "candidates-launching",
    phase: "execution",
    candidateCount,
    message: `Launching ${formatCandidateCount(candidateCount)}`,
  };
}

export function candidateRunningEvent(
  candidateId: string,
  candidateIndex: number,
  candidateCount: number,
): ConsultProgressEvent {
  return {
    kind: "candidate-running",
    phase: "execution",
    candidateId,
    candidateIndex,
    candidateCount,
    message: `${formatCandidateProgressLabel(candidateIndex, candidateCount, candidateId)} running`,
  };
}

export function candidateReadyForChecksEvent(
  candidateId: string,
  candidateIndex: number,
  candidateCount: number,
): ConsultProgressEvent {
  return {
    kind: "candidate-ready-for-checks",
    phase: "execution",
    candidateId,
    candidateIndex,
    candidateCount,
    message: `${formatCandidateProgressLabel(candidateIndex, candidateCount, candidateId)} ready for checks`,
  };
}

export function candidateFailedBeforeChecksEvent(
  candidateId: string,
  candidateIndex: number,
  candidateCount: number,
): ConsultProgressEvent {
  return {
    kind: "candidate-failed-before-checks",
    phase: "execution",
    candidateId,
    candidateIndex,
    candidateCount,
    message: `${formatCandidateProgressLabel(candidateIndex, candidateCount, candidateId)} failed before checks`,
  };
}

export function roundStartedEvent(
  roundId: string,
  roundLabel: string,
  candidateCount: number,
): ConsultProgressEvent {
  return {
    kind: "round-started",
    phase: "execution",
    roundId,
    roundLabel,
    candidateCount,
    message: `${roundLabel} checks starting for ${formatCandidateCount(candidateCount)}`,
  };
}

export function candidateRetryingEvent(options: {
  candidateId: string;
  candidateIndex: number;
  candidateCount: number;
  repairAttempt: number;
  roundId: string;
  roundLabel: string;
}): ConsultProgressEvent {
  return {
    kind: "candidate-retrying",
    phase: "execution",
    candidateId: options.candidateId,
    candidateIndex: options.candidateIndex,
    candidateCount: options.candidateCount,
    repairAttempt: options.repairAttempt,
    roundId: options.roundId,
    roundLabel: options.roundLabel,
    message: `${formatCandidateProgressLabel(options.candidateIndex, options.candidateCount, options.candidateId)} retrying ${options.roundLabel.toLowerCase()} checks (repair ${options.repairAttempt})`,
  };
}

export function candidatePassedRoundEvent(options: {
  candidateId: string;
  candidateIndex: number;
  candidateCount: number;
  roundId: string;
  roundLabel: string;
}): ConsultProgressEvent {
  return {
    kind: "candidate-passed-round",
    phase: "execution",
    candidateId: options.candidateId,
    candidateIndex: options.candidateIndex,
    candidateCount: options.candidateCount,
    roundId: options.roundId,
    roundLabel: options.roundLabel,
    message: `${options.roundLabel} checks: ${formatCandidateProgressLabel(options.candidateIndex, options.candidateCount, options.candidateId)} passed`,
  };
}

export function candidateEliminatedEvent(options: {
  candidateId: string;
  candidateIndex: number;
  candidateCount: number;
  roundId: string;
  roundLabel: string;
}): ConsultProgressEvent {
  return {
    kind: "candidate-eliminated",
    phase: "execution",
    candidateId: options.candidateId,
    candidateIndex: options.candidateIndex,
    candidateCount: options.candidateCount,
    roundId: options.roundId,
    roundLabel: options.roundLabel,
    message: `${options.roundLabel} checks: ${formatCandidateProgressLabel(options.candidateIndex, options.candidateCount, options.candidateId)} eliminated`,
  };
}

export function roundCompletedEvent(
  roundId: string,
  roundLabel: string,
  remainingCandidates: number,
  inputCandidateCount: number,
): ConsultProgressEvent {
  return {
    kind: "round-completed",
    phase: "execution",
    roundId,
    roundLabel,
    remainingCandidates,
    inputCandidateCount,
    message:
      remainingCandidates > 0
        ? `${roundLabel} checks complete: ${remainingCandidates}/${inputCandidateCount} ${remainingCandidates === 1 ? "candidate remains" : "candidates remain"}`
        : `${roundLabel} checks complete: no candidates remain`,
  };
}

export function comparingFinalistsEvent(finalistCount: number): ConsultProgressEvent {
  return {
    kind: "comparing-finalists",
    phase: "judging",
    finalistCount,
    message: `Comparing ${finalistCount} surviving candidate${finalistCount === 1 ? "" : "s"}`,
  };
}

export function noSurvivorsEvent(): ConsultProgressEvent {
  return {
    kind: "no-survivors",
    phase: "judging",
    message: "No candidates survived checks",
  };
}

export function secondOpinionRequestedEvent(): ConsultProgressEvent {
  return {
    kind: "second-opinion-requested",
    phase: "judging",
    message: "Requesting second opinion",
  };
}

export function secondOpinionRecordedEvent(): ConsultProgressEvent {
  return {
    kind: "second-opinion-recorded",
    phase: "judging",
    message: "Second opinion recorded",
  };
}

export function verdictReadyEvent(): ConsultProgressEvent {
  return {
    kind: "verdict-ready",
    phase: "completed",
    message: "Verdict ready",
  };
}
