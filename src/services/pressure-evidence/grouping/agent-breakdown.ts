import {
  type PressureAgentBreakdown,
  type PressureEvidenceCase,
  pressureAgentBreakdownSchema,
} from "../schema.js";

export function buildAgentBreakdown(cases: PressureEvidenceCase[]): PressureAgentBreakdown[] {
  const grouped = new Map<
    PressureEvidenceCase["agent"],
    {
      caseCount: number;
      runIds: Set<string>;
    }
  >();

  for (const item of cases) {
    const current = grouped.get(item.agent);
    if (!current) {
      grouped.set(item.agent, {
        caseCount: 1,
        runIds: new Set([item.runId]),
      });
      continue;
    }

    current.caseCount += 1;
    current.runIds.add(item.runId);
  }

  return [...grouped.entries()]
    .sort((left, right) => {
      if (right[1].caseCount !== left[1].caseCount) {
        return right[1].caseCount - left[1].caseCount;
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([agent, item]) =>
      pressureAgentBreakdownSchema.parse({
        agent,
        caseCount: item.caseCount,
        consultationCount: item.runIds.size,
      }),
    );
}
