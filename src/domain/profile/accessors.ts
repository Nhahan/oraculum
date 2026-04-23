import { consultationProfileIds } from "./constants.js";
import type { ConsultationProfileId } from "./schemas.js";

export function getValidationProfileId(
  selection:
    | {
        validationProfileId?: ConsultationProfileId | undefined;
      }
    | undefined,
): ConsultationProfileId | undefined;
export function getValidationProfileId(
  selection:
    | {
        validationProfileId?: string | undefined;
      }
    | undefined,
): string | undefined;
export function getValidationProfileId(
  selection:
    | {
        validationProfileId?: string | undefined;
      }
    | undefined,
): string | undefined {
  return selection?.validationProfileId;
}

export function isSupportedConsultationProfileId(value: string): value is ConsultationProfileId {
  return consultationProfileIds.includes(value as ConsultationProfileId);
}

export function getValidationSummary(
  selection:
    | {
        validationSummary?: string | undefined;
      }
    | undefined,
): string | undefined {
  return selection?.validationSummary;
}

export function getValidationSignals(
  selection:
    | {
        validationSignals?: string[] | undefined;
      }
    | undefined,
): string[] {
  return selection?.validationSignals ?? [];
}

export function getValidationGaps(
  selection:
    | {
        validationGaps?: string[] | undefined;
      }
    | undefined,
): string[] {
  return selection?.validationGaps ?? [];
}
