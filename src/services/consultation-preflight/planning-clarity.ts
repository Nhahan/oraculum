import { type ConsultationPreflight, consultationPreflightSchema } from "../../domain/run.js";
import { type MaterializedTaskPacket, materializedTaskPacketSchema } from "../../domain/task.js";

const CLARIFICATION_ANSWER_HEADER = "Planning clarification answer:";

const CONCRETE_PLAN_SIGNALS: RegExp[] = [
  /\b[\w/.-]+\.(?:ts|js|py|go|rs|java|tsx|jsx|vue|svelte|rb|c|cpp|h|css|scss|html|json|yaml|yml|toml|md)\b/u,
  /(?:src|lib|test|spec|app|pages|components|hooks|utils|services|api|docs|internal|scripts)\/\w+/u,
  /\b(?:function|class|method|interface|type|const|let|var|def|fn|struct|enum)\s+\w{2,}/iu,
  /\b[a-z]+(?:[A-Z][a-z]+)+\b/u,
  /\b[A-Z][a-z]+(?:[A-Z][a-z0-9]*)+\b/u,
  /\b[a-z]+(?:_[a-z]+)+\b/u,
  /(?:^|\s)#\d+\b/u,
  /(?:^|\n)\s*(?:\d+[.)]\s|-\s+\S|\*\s+\S)/mu,
  /\b(?:acceptance\s+criteria|test\s+(?:spec|plan|case)|success\s+criteria|non-?goals?)\b/iu,
  /\b(?:p(?:50|75|90|95|99)|latency|throughput|slo|sla)\b.*\b\d+(?:ms|s|%)?\b/iu,
  /\b(?:error:|bug\s*#?\d+|issue\s*#\d+|stack\s*trace|exception|TypeError|ReferenceError|SyntaxError)\b/iu,
  /```[\s\S]{20,}?```/u,
  /\b(?:PR\s*#\d+|commit\s+[0-9a-f]{7}|pull\s+request)\b/iu,
];

const VAGUE_PLACEHOLDER_PATTERN =
  /\b(?:this|that|it|thing|stuff|something|anything|everything|app|feature|system|better|nice|clean|cleanup|polish)\b/iu;

const BROAD_ACTION_PATTERN =
  /\b(?:add|build|create|make|improve|optimi[sz]e|refactor|redesign|rewrite|fix|implement|support|handle)\b/iu;

export function applyPlanningClarificationAnswer(
  taskPacket: MaterializedTaskPacket,
  clarificationAnswer?: string,
): MaterializedTaskPacket {
  const normalizedAnswer = clarificationAnswer?.trim();
  if (!normalizedAnswer) {
    return taskPacket;
  }

  return materializedTaskPacketSchema.parse({
    ...taskPacket,
    intent: `${taskPacket.intent.trim()}\n\n${CLARIFICATION_ANSWER_HEADER}\n${normalizedAnswer}`,
    acceptanceCriteria: [
      ...taskPacket.acceptanceCriteria,
      `Plan must honor the operator clarification: ${normalizedAnswer}`,
    ],
  });
}

export function recommendPlanningClarificationPreflight(
  taskPacket: MaterializedTaskPacket,
): ConsultationPreflight | undefined {
  if (isClearEnoughForPlanning(taskPacket)) {
    return undefined;
  }

  return consultationPreflightSchema.parse({
    decision: "needs-clarification",
    confidence: "medium",
    summary:
      "Plan clarity gate stopped before candidate planning because the task lacks a concrete result contract or judging basis.",
    researchPosture: "repo-only",
    clarificationQuestion: buildPlanningClarificationQuestion(taskPacket),
  });
}

function isClearEnoughForPlanning(taskPacket: MaterializedTaskPacket): boolean {
  if (
    taskPacket.targetArtifactPath ||
    taskPacket.artifactKind ||
    taskPacket.researchContext ||
    taskPacket.acceptanceCriteria.length > 0 ||
    taskPacket.contextFiles.length > 0 ||
    taskPacket.oracleHints.length > 0 ||
    taskPacket.strategyHints.length > 0
  ) {
    return true;
  }

  const text = buildPlanningClarityText(taskPacket);
  if (text.includes(CLARIFICATION_ANSWER_HEADER)) {
    return true;
  }
  if (CONCRETE_PLAN_SIGNALS.some((pattern) => pattern.test(text))) {
    return true;
  }

  const words = text.match(/[\p{Letter}\p{Number}_-]+/gu) ?? [];
  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
  if (uniqueWords.size >= 5 && !isMostlyVagueBroadAction(text)) {
    return true;
  }

  return false;
}

function isMostlyVagueBroadAction(text: string): boolean {
  return BROAD_ACTION_PATTERN.test(text) && VAGUE_PLACEHOLDER_PATTERN.test(text);
}

function buildPlanningClarificationQuestion(taskPacket: MaterializedTaskPacket): string {
  const text = buildPlanningClarityText(taskPacket).toLowerCase();

  if (
    /\b(?:auth|authentication|login|logout|session|permission|security|oauth|jwt)\b/iu.test(text)
  ) {
    return "Which auth or session flow should the plan target, what concrete behavior should change, and what is out of scope?";
  }
  if (/\b(?:performance|latency|throughput|slow|speed|optimi[sz]e)\b/iu.test(text)) {
    return "Which operation should the plan optimize, and what measurable target should define success?";
  }
  if (/\b(?:migration|migrate|schema|database|data|backfill)\b/iu.test(text)) {
    return "What migration scope, rollback constraint, and success check should the plan preserve?";
  }
  if (/\b(?:ui|ux|screen|page|component|layout|design)\b/iu.test(text)) {
    return "Which screen or component should the plan target, and what user-visible behavior should change?";
  }
  if (/\b(?:test|coverage|e2e|integration|unit)\b/iu.test(text)) {
    return "Which behavior should the tests prove, and which command or artifact should count as success?";
  }

  return "What concrete result should Oraculum plan for, and what should be explicitly out of scope?";
}

function buildPlanningClarityText(taskPacket: MaterializedTaskPacket): string {
  return [
    taskPacket.title,
    taskPacket.intent,
    ...taskPacket.nonGoals,
    ...taskPacket.acceptanceCriteria,
    ...taskPacket.risks,
    ...taskPacket.oracleHints,
    ...taskPacket.strategyHints,
    ...taskPacket.contextFiles,
  ].join("\n");
}
