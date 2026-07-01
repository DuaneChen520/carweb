import { describe, it, expect } from 'vitest';
import { paginateApps } from '../app-pagination';

describe('paginateApps', () => {
  it('returns empty array for empty input', () => {
    expect(paginateApps([], 12)).toEqual([]);
  });

  it('returns single page when items fit', () => {
    const apps = ['a', 'b', 'c'];
    expect(paginateApps(apps, 12)).toEqual([['a', 'b', 'c']]);
  });

  it('splits into multiple pages exactly at boundary', () => {
    const apps = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(paginateApps(apps, 3)).toEqual([['a', 'b', 'c'], ['d', 'e', 'f']]);
  });

  it('last page is partial when not divisible', () => {
    const apps = ['a', 'b', 'c', 'd', 'e'];
    expect(paginateApps(apps, 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('preserves input order across pages', () => {
    const apps = Array.from({ length: 25 }, (_, i) => `app${i}`);
    const pages = paginateApps(apps, 12);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toHaveLength(12);
    expect(pages[1]).toHaveLength(12);
    expect(pages[2]).toHaveLength(1);
    expect(pages[0]![0]).toBe('app0');
    expect(pages[2]![0]).toBe('app24');
  });

  it('handles perPage of 1', () => {
    expect(paginateApps(['x', 'y'], 1)).toEqual([['x'], ['y']]);
  });

  it('returns empty array when perPage <= 0', () => {
    expect(paginateApps(['a', 'b'], 0)).toEqual([]);
    expect(paginateApps(['a', 'b'], -1)).toEqual([]);
  });
});
