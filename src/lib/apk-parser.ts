import { ApkParser } from 'app-info-parser';

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
    const parser = new ApkParser();
    const result = await parser.parse(apkData);

    let iconBase64: string | null = null;
    if (result.icon) {
      if (result.icon instanceof ArrayBuffer) {
        const blob = new Blob([result.icon], { type: 'image/png' });
        iconBase64 = await blobToBase64(blob);
      } else if (typeof result.icon === 'string') {
        iconBase64 = result.icon;
      }
    }

    return {
      packageName: result.package || '',
      label: result.label || null,
      iconBase64,
      versionCode: result.versionCode || 0,
    };
  } catch (e) {
    console.error('[parseApk] parsing failed:', e);
    return null;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
