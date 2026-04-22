import { type MaterializedTaskPacket, materializedTaskPacketSchema } from "../../domain/task.js";

const CLARIFICATION_ANSWER_HEADER = "Planning clarification answer:";

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
