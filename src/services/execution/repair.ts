import type { AgentRepairContext } from "../../adapters/types.js";
import type { OracleVerdict } from "../../domain/oracle.js";

export function hasRepairableVerdicts(verdicts: OracleVerdict[]): boolean {
  return verdicts.some((verdict) => verdict.status === "repairable");
}

export function buildRepairContext(
  roundId: string,
  attempt: number,
  verdicts: OracleVerdict[],
): AgentRepairContext {
  const repairableVerdicts = verdicts.filter((verdict) => verdict.status === "repairable");

  return {
    roundId,
    attempt,
    verdicts: repairableVerdicts.map((verdict) => ({
      oracleId: verdict.oracleId,
      status: verdict.status,
      severity: verdict.severity,
      summary: verdict.summary,
      ...(verdict.repairHint ? { repairHint: verdict.repairHint } : {}),
    })),
    keyWitnesses: repairableVerdicts
      .flatMap((verdict) =>
        verdict.witnesses.map((witness) => ({
          title: witness.title,
          detail: witness.detail,
          kind: witness.kind,
        })),
      )
      .slice(0, 5),
  };
}
