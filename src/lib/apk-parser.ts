import * as AppInfoParserModule from 'app-info-parser';

// app-info-parser is CJS without types; namespace import works around Vite CJS→ESM missing default export
// The manifest object has label at result.application.label, icon is set on result.icon by ApkParser
interface AppInfoParserResult {
  package: string;
  application?: { label?: string | null; icon?: unknown };
  icon?: string | ArrayBuffer | null;
  versionCode?: number;
  [key: string]: unknown;
}
const AppInfoParser = AppInfoParserModule.default as new (file: File) => {
  parse(): Promise<AppInfoParserResult>;
};

import { parseAndroidManifest } from '@/utils/binary-xml';
import { resolveStringResource } from '@/utils/resources-arsc';
import { extractZipEntry } from './zip-reader';

export interface ParsedApkInfo {
  packageName: string;
  label: string | null;
  iconBase64: string | null;
  versionCode: number;
}

// Characters that appear in Simplified Chinese but NOT in Traditional
const SIMPLIFIED_ONLY = /[钱门国长东发风关华会体乐过时评语读说认识进还对间从这动开关历车龙党团发矿码补办夹层递竞杂称适钟链钓陆飞凤鸡龟齿齐]/u;
// Characters that appear in Traditional Chinese but NOT in Simplified
const TRADITIONAL_ONLY = /[錢門國長東發風關華會體樂過時評語讀說認識進還對間從這動開關臺灣電話當應爾雲學計訊視靜歷顯類萬數點與問間還進遠運動畫盡書員廣廠張歸飛馬魚鳥愛覺曆車龍黨團發礦碼補辦夾層遞競雜稱適鐘鏈釣陸飛鳳雞龜齒齊]/u;
// Japanese Hiragana + Katakana (unambiguous Japanese signal)
const JAPANESE_KANA = /[\u3040-\u309f\u30a0-\u30ff]/;

function cjkScore(value: string): 'simplified' | 'traditional' | 'japanese' | null {
  if (JAPANESE_KANA.test(value)) return 'japanese';
  if (SIMPLIFIED_ONLY.test(value)) return 'simplified';
  if (TRADITIONAL_ONLY.test(value)) return 'traditional';
  return null;
}

export function pickLabel(values: string[] | string | null | undefined, preferredLang: string): string | null {
  if (!values) return null;
  if (typeof values === 'string') return values || null;
  if (!values.length) return null;
  if (values.length === 1) return values[0];

  const preferSimplified = preferredLang.startsWith('zh-CN') || preferredLang.startsWith('zh-Hans');
  const preferTraditional = preferredLang.startsWith('zh-TW') || preferredLang.startsWith('zh-HK') || preferredLang.startsWith('zh-Hant');

  if (preferSimplified || preferTraditional) {
    // Pass 1: values with a clear Chinese classification (skip Japanese)
    for (const v of values) {
      const score = cjkScore(v);
      if (score === 'japanese') continue;
      if (preferSimplified && score === 'simplified') return v;
      if (preferTraditional && score === 'traditional') return v;
    }
    // Pass 2: any non-Japanese CJK value (ambiguous chars like 微信)
    for (const v of values) {
      const score = cjkScore(v);
      if (score === 'japanese') continue;
      if (/[\u4e00-\u9fff]/.test(v)) return v;
    }
    // Nothing found — fall through to return values[0]
  }

  // Non-Chinese user: prefer first non-CJK value
  for (const v of values) {
    if (cjkScore(v) === null) return v;
  }
  return values[0];
}

export function getMaxMemoryBytes(): number {
  const deviceMemory = 'deviceMemory' in navigator ? Number(navigator.deviceMemory) : 4;
  return Math.floor((deviceMemory * 1024 * 1024 * 1024) / 4);
}

async function extractLabelFallback(apkData: ArrayBuffer): Promise<string | null> {
  try {
    const manifestBuffer = extractZipEntry(apkData, 'AndroidManifest.xml');
    if (!manifestBuffer || manifestBuffer.byteLength < 8) return null;

    const manifest = parseAndroidManifest(manifestBuffer);
    if (!manifest.label) return null;

    if (manifest.label.isString) {
      return manifest.label.value;
    }

    // Resource reference: try to resolve from resources.arsc
    const arscBuffer = extractZipEntry(apkData, 'resources.arsc');
    if (arscBuffer && arscBuffer.byteLength >= 12) {
      const resolved = resolveStringResource(arscBuffer, manifest.label.value as number);
      if (resolved) return resolved;
    }
  } catch {
    // fallback failed silently
  }
  return null;
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
    const file = new File([apkData], 'app.apk', { type: 'application/vnd.android.package-archive' });
    const parser = new AppInfoParser(file);
    const result = await parser.parse();

    // label lives at result.application.label (collapsed from <application> element)
    // fallback to result.label for any other parser that puts it at top level
    const rawLabel: unknown = result.application?.label ?? (result as Record<string, unknown>).label ?? null;
    let label: string | null = pickLabel(rawLabel as string | string[] | null | undefined, navigator.language);

    // If app-info-parser didn't resolve the label, try our own extraction
    if (!label) {
      label = await extractLabelFallback(apkData);
    }

    return {
      packageName: result.package || '',
      label,
      iconBase64: typeof result.icon === 'string' ? result.icon : null,
      versionCode: result.versionCode || 0,
    };
  } catch (e) {
    console.error('[parseApk] parsing failed:', e);
    return null;
  }
}
