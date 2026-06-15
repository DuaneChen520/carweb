import { describe, it, expect } from 'vitest';
import { sortApps, LaunchCountData } from '../app-sorter';

describe('sortApps', () => {
  it('produces the example output from the spec', () => {
    const allPkgs = ['com.a', 'com.b', 'com.c', 'com.d', 'com.e'];
    const pinned = new Map([['com.c', 1], ['com.a', 0]]);
    const counts = new Map<string, LaunchCountData>([
      ['com.b', { localCount: 5, dexBaseline: 3 }],
      ['com.d', { localCount: 0, dexBaseline: 10 }],
      ['com.e', { localCount: 0, dexBaseline: 2 }],
    ]);

    const result = sortApps(allPkgs, pinned, counts);
    // pin order: com.c(1) > com.a(0) → com.c first
    expect(result).toEqual(['com.c', 'com.a', 'com.b', 'com.d', 'com.e']);
  });

  it('places pinned apps at top sorted by order', () => {
    const allPkgs = ['z', 'a', 'm'];
    const pinned = new Map([['z', 2], ['a', 0], ['m', 1]]);
    const counts = new Map();

    const result = sortApps(allPkgs, pinned, counts);
    // pin order: z(2) > m(1) > a(0) → z first
    expect(result).toEqual(['z', 'm', 'a']);
  });

  it('handles empty pinned map', () => {
    const allPkgs = ['com.x', 'com.y'];
    const pinned = new Map();
    const counts = new Map<string, LaunchCountData>([
      ['com.x', { localCount: 0, dexBaseline: 5 }],
      ['com.y', { localCount: 0, dexBaseline: 3 }],
    ]);

    const result = sortApps(allPkgs, pinned, counts);
    expect(result).toEqual(['com.x', 'com.y']);
  });

  it('handles empty launchCounts map', () => {
    const allPkgs = ['com.a', 'com.b'];
    const pinned = new Map();
    const counts = new Map();

    const result = sortApps(allPkgs, pinned, counts);
    // all have localCount=0, dexBaseline=0 → preserve original order
    expect(result).toEqual(['com.a', 'com.b']);
  });

  it('handles empty pinned and empty launchCounts', () => {
    const allPkgs = ['com.x', 'com.y'];
    const pinned = new Map();
    const counts = new Map();

    const result = sortApps(allPkgs, pinned, counts);
    expect(result).toEqual(['com.x', 'com.y']);
  });

  it('works when no apps have localCount > 0', () => {
    const allPkgs = ['com.a', 'com.b', 'com.c'];
    const pinned = new Map([['com.b', 0]]);
    const counts = new Map<string, LaunchCountData>([
      ['com.a', { localCount: 0, dexBaseline: 10 }],
      ['com.c', { localCount: 0, dexBaseline: 5 }],
    ]);

    const result = sortApps(allPkgs, pinned, counts);
    expect(result).toEqual(['com.b', 'com.a', 'com.c']);
  });

  it('works when all apps have localCount > 0', () => {
    const allPkgs = ['com.x', 'com.y', 'com.z'];
    const pinned = new Map();
    const counts = new Map<string, LaunchCountData>([
      ['com.x', { localCount: 1, dexBaseline: 99 }],
      ['com.y', { localCount: 3, dexBaseline: 0 }],
      ['com.z', { localCount: 2, dexBaseline: 0 }],
    ]);

    const result = sortApps(allPkgs, pinned, counts);
    expect(result).toEqual(['com.y', 'com.z', 'com.x']);
  });

  it('includes pinned apps not present in allPackages', () => {
    const allPkgs = ['com.a'];
    const pinned = new Map([['com.pinned-only', 0]]);
    const counts = new Map();

    const result = sortApps(allPkgs, pinned, counts);
    expect(result).toEqual(['com.pinned-only', 'com.a']);
  });

  it('treats apps missing from launchCounts as localCount=0, dexBaseline=0', () => {
    const allPkgs = ['com.a', 'com.b'];
    const pinned = new Map();
    const counts = new Map<string, LaunchCountData>([
      ['com.a', { localCount: 0, dexBaseline: 5 }],
      // com.b not in launchCounts
    ]);

    const result = sortApps(allPkgs, pinned, counts);
    expect(result).toEqual(['com.a', 'com.b']);
  });

  it('sorts frequent tier by localCount descending', () => {
    const allPkgs = ['com.low', 'com.high', 'com.medium'];
    const pinned = new Map();
    const counts = new Map<string, LaunchCountData>([
      ['com.low', { localCount: 1, dexBaseline: 0 }],
      ['com.high', { localCount: 10, dexBaseline: 0 }],
      ['com.medium', { localCount: 5, dexBaseline: 0 }],
    ]);

    const result = sortApps(allPkgs, pinned, counts);
    expect(result).toEqual(['com.high', 'com.medium', 'com.low']);
  });

  it('sorts other tier by dexBaseline descending', () => {
    const allPkgs = ['com.low', 'com.high', 'com.medium'];
    const pinned = new Map();
    const counts = new Map<string, LaunchCountData>([
      ['com.low', { localCount: 0, dexBaseline: 1 }],
      ['com.high', { localCount: 0, dexBaseline: 10 }],
      ['com.medium', { localCount: 0, dexBaseline: 5 }],
    ]);

    const result = sortApps(allPkgs, pinned, counts);
    expect(result).toEqual(['com.high', 'com.medium', 'com.low']);
  });

  it('preserves original allPackages order for same dexBaseline in other tier', () => {
    const allPkgs = ['com.z', 'com.y', 'com.x'];
    const pinned = new Map();
    const counts = new Map<string, LaunchCountData>([
      ['com.z', { localCount: 0, dexBaseline: 5 }],
      ['com.y', { localCount: 0, dexBaseline: 5 }],
      ['com.x', { localCount: 0, dexBaseline: 5 }],
    ]);

    const result = sortApps(allPkgs, pinned, counts);
    expect(result).toEqual(['com.z', 'com.y', 'com.x']);
  });

  it('preserves original allPackages order for same localCount in frequent tier', () => {
    const allPkgs = ['com.z', 'com.y', 'com.x'];
    const pinned = new Map();
    const counts = new Map<string, LaunchCountData>([
      ['com.z', { localCount: 3, dexBaseline: 0 }],
      ['com.y', { localCount: 3, dexBaseline: 0 }],
      ['com.x', { localCount: 3, dexBaseline: 0 }],
    ]);

    const result = sortApps(allPkgs, pinned, counts);
    expect(result).toEqual(['com.z', 'com.y', 'com.x']);
  });

  it('does not mutate input maps', () => {
    const allPkgs: string[] = [];
    const pinned = new Map([['com.x', 0]]);
    const counts = new Map<string, LaunchCountData>();

    const pinnedBefore = new Map(pinned);
    const countsBefore = new Map(counts);

    sortApps(allPkgs, pinned, counts);

    expect(pinned).toEqual(pinnedBefore);
    expect(counts).toEqual(countsBefore);
  });

  it('pinned apps still appear even if also in allPackages', () => {
    const allPkgs = ['com.a', 'com.b'];
    const pinned = new Map([['com.a', 1], ['com.b', 0]]);
    const counts = new Map<string, LaunchCountData>([
      ['com.a', { localCount: 99, dexBaseline: 0 }],
    ]);

    const result = sortApps(allPkgs, pinned, counts);
    // pin order: com.a(1) > com.b(0) → com.a first
    expect(result).toEqual(['com.a', 'com.b']);
  });

  it('handles three-tier mix correctly', () => {
    const allPkgs = ['com.p', 'com.q', 'com.r', 'com.s', 'com.t'];
    const pinned = new Map([['com.r', 0]]);
    const counts = new Map<string, LaunchCountData>([
      ['com.p', { localCount: 5, dexBaseline: 10 }],
      ['com.q', { localCount: 0, dexBaseline: 100 }],
      ['com.s', { localCount: 0, dexBaseline: 1 }],
      ['com.t', { localCount: 0, dexBaseline: 50 }],
    ]);

    const result = sortApps(allPkgs, pinned, counts);
    // pinned: com.r
    // frequent: com.p (local 5)
    // other: com.q (dex 100), com.t (dex 50), com.s (dex 1)
    expect(result).toEqual(['com.r', 'com.p', 'com.q', 'com.t', 'com.s']);
  });

  it('excludes pinned apps from frequent/other tiers', () => {
    const allPkgs = ['com.a', 'com.b'];
    const pinned = new Map([['com.a', 0]]);
    const counts = new Map<string, LaunchCountData>([
      ['com.a', { localCount: 99, dexBaseline: 999 }],
      ['com.b', { localCount: 0, dexBaseline: 0 }],
    ]);

    const result = sortApps(allPkgs, pinned, counts);
    expect(result).toEqual(['com.a', 'com.b']);
  });
});
