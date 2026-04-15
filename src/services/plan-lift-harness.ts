export const planLiftPromptMarkers = {
  preflight:
    "You are deciding whether an Oraculum consultation is ready to proceed before any candidate is generated.",
  profileFields: ["validationProfileId", "selectedCommandIds"] as const,
  winner: "You are selecting the best Oraculum finalist.",
};

export function classifyPlanLiftHarnessPrompt(prompt: string): {
  isPreflight: boolean;
  isProfileSelection: boolean;
  isWinner: boolean;
} {
  return {
    isPreflight: prompt.includes(planLiftPromptMarkers.preflight),
    isProfileSelection: planLiftPromptMarkers.profileFields.every((field) =>
      prompt.includes(field),
    ),
    isWinner: prompt.includes(planLiftPromptMarkers.winner),
  };
}
