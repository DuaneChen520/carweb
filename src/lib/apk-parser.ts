import AppInfoParser from 'app-info-parser';

export interface ParsedApkInfo {
  packageName: string;
  label: string | null;
  iconBase64: string | null;
  versionCode: number;
}

export function getMaxMemoryBytes(): number {
  // navigator.deviceMemory is a non-standard API, use 4GB fallback
  const deviceMemory = 'deviceMemory' in navigator ? Number(navigator.deviceMemory) : 4;
  return Math.floor((deviceMemory * 1024 * 1024 * 1024) / 4);
}

export async function parseApk(
  apkData: ArrayBuffer,
  maxMemoryBytes: number = getMaxMemoryBytes()
): Promise<ParsedApkInfo | null> {
  if (apkData.byteLength > maxMemoryBytes) {
    console.warn('[parseApk] APK exceeds memory limit, skipping');
    return null;
  }

  try {
    const blob = new Blob([apkData], { type: 'application/vnd.android.package-archive' });
    const parser = new AppInfoParser(blob);
    const result = await parser.parse();

    return {
      packageName: result.package || '',
      label: result.label || null,
      iconBase64: typeof result.icon === 'string' ? result.icon : null,
      versionCode: result.versionCode || 0,
    };
  } catch (e) {
    console.error('[parseApk] parsing failed:', e);
    return null;
  }
}

