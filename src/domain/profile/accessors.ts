import { consultationProfileIds } from "./constants.js";
import type { ConsultationProfileId } from "./schemas.js";

export function getValidationProfileId(
  selection:
    | {
        profileId?: ConsultationProfileId | undefined;
        validationProfileId?: ConsultationProfileId | undefined;
      }
    | undefined,
): ConsultationProfileId | undefined;
export function getValidationProfileId(
  selection:
    | {
        profileId?: string | undefined;
        validationProfileId?: string | undefined;
      }
    | undefined,
): string | undefined;
export function getValidationProfileId(
  selection:
    | {
        profileId?: string | undefined;
        validationProfileId?: string | undefined;
      }
    | undefined,
): string | undefined {
  return selection?.validationProfileId ?? selection?.profileId;
}

export function isSupportedConsultationProfileId(value: string): value is ConsultationProfileId {
  return consultationProfileIds.includes(value as ConsultationProfileId);
}

export function getValidationSummary(
  selection:
    | {
        summary?: string | undefined;
        validationSummary?: string | undefined;
      }
    | undefined,
): string | undefined {
  return selection?.validationSummary ?? selection?.summary;
}

export function getValidationSignals(
  selection:
    | {
        signals?: string[] | undefined;
        validationSignals?: string[] | undefined;
      }
    | undefined,
): string[] {
  return selection?.validationSignals ?? selection?.signals ?? [];
}

export function getValidationGaps(
  selection:
    | {
        missingCapabilities?: string[] | undefined;
        validationGaps?: string[] | undefined;
      }
    | undefined,
): string[] {
  return selection?.validationGaps ?? selection?.missingCapabilities ?? [];
}
