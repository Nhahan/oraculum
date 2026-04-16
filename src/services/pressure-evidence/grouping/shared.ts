export function compareNewestOpenedAt(left: string, right: string): number {
  return new Date(right).getTime() - new Date(left).getTime();
}

export function compareOccurrenceThenLatest(
  leftOccurrenceCount: number,
  leftLatestOpenedAt: string,
  rightOccurrenceCount: number,
  rightLatestOpenedAt: string,
): number {
  if (rightOccurrenceCount !== leftOccurrenceCount) {
    return rightOccurrenceCount - leftOccurrenceCount;
  }

  return compareNewestOpenedAt(leftLatestOpenedAt, rightLatestOpenedAt);
}

export function isNewerOpenedAt(candidateOpenedAt: string, currentOpenedAt: string): boolean {
  return new Date(candidateOpenedAt).getTime() > new Date(currentOpenedAt).getTime();
}

export function sortStrings(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function uniqueSortedStrings(values: Iterable<string>): string[] {
  return sortStrings(new Set(values));
}
