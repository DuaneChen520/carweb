/**
 * 把已排序的应用包名数组切成每页 perPage 个的二维数组。
 * 用于桌面分页网格。空输入或非法 perPage 返回 []。
 *
 * 切片是简单的顺序等分（不跨页移动应用），应用排序由调用方在上游用
 * sortApps 完成后传入。第一页因含音乐卡片，容量是否扣除由 UI 层决定，
 * 本函数只做纯切片。
 */
export function paginateApps(sortedPackages: string[], perPage: number): string[][] {
  if (!sortedPackages || sortedPackages.length === 0) return [];
  if (!perPage || perPage <= 0) return [];

  const pages: string[][] = [];
  for (let i = 0; i < sortedPackages.length; i += perPage) {
    pages.push(sortedPackages.slice(i, i + perPage));
  }
  return pages;
}
