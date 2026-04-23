import type {
  ProfileCommandCandidate,
  ProfileSkippedCommandCandidate,
} from "../../../domain/profile.js";

export interface ProfileCommandCatalogResult {
  commandCatalog: ProfileCommandCandidate[];
  skippedCommandCandidates: ProfileSkippedCommandCandidate[];
}
