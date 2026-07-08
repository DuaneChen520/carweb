// ADR-0002：虚拟屏 smallest-width 锚定值 = 600dp，使设备触发大屏/平板布局。
// 注意：该值曾被无关提交 (07a950a) 误改为 800，现已回正为 600 以对齐决策文档。
export const SW_TARGET = 600;
export const ANDROID_MDPI_BASELINE = 160;

export function calculateDpi(width: number, height: number): number {
  return Math.round(Math.min(width, height) * ANDROID_MDPI_BASELINE / SW_TARGET);
}