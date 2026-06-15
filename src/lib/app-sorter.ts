export interface LaunchCountData {
  localCount: number;
  dexBaseline: number;
}

export function sortApps(
  allPackages: string[],
  pinned: Map<string, number>,
  launchCounts: Map<string, LaunchCountData>,
): string[] {
  const originalIndex = new Map<string, number>();
  for (let i = 0; i < allPackages.length; i++) {
    originalIndex.set(allPackages[i], i);
  }

  const pinnedTier: { pkg: string; order: number }[] = [];
  const frequentTier: { pkg: string; count: number; index: number }[] = [];
  const otherTier: { pkg: string; baseline: number; index: number }[] = [];

  const seen = new Set<string>();

  for (const [pkg, order] of pinned) {
    pinnedTier.push({ pkg, order });
    seen.add(pkg);
  }

  for (const pkg of allPackages) {
    if (seen.has(pkg)) continue;

    const data = launchCounts.get(pkg);
    const localCount = data?.localCount ?? 0;
    const dexBaseline = data?.dexBaseline ?? 0;
    const index = originalIndex.get(pkg) ?? Infinity;

    if (localCount > 0) {
      frequentTier.push({ pkg, count: localCount, index });
    } else {
      otherTier.push({ pkg, baseline: dexBaseline, index });
    }
    seen.add(pkg);
  }

  pinnedTier.sort((a, b) => a.order - b.order);
  frequentTier.sort((a, b) => b.count - a.count || a.index - b.index);
  otherTier.sort((a, b) => b.baseline - a.baseline || a.index - b.index);

  return [
    ...pinnedTier.map((x) => x.pkg),
    ...frequentTier.map((x) => x.pkg),
    ...otherTier.map((x) => x.pkg),
  ];
}
