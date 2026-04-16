import { registerConsultationsTempRootCleanup } from "./consultations.js";

let registered = false;

export function registerConsultationsPreflightTempRootCleanup(): void {
  if (registered) {
    return;
  }

  registered = true;
  registerConsultationsTempRootCleanup();
}
