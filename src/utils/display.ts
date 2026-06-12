export const SW_TARGET = 800;
export const ANDROID_MDPI_BASELINE = 160;

export function calculateDpi(width: number, height: number): number {
  return Math.round(Math.min(width, height) * ANDROID_MDPI_BASELINE / SW_TARGET);
}