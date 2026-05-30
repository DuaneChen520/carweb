import type { Adb, AdbNoneProtocolProcess } from '@yume-chan/adb';
import { parseAndroidManifest } from './binary-xml';
import { resolveStringResource } from './resources-arsc';

function readProcessOutput(process: AdbNoneProtocolProcess): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const reader = process.output.getReader();
  return reader.read().then(function handle({ done, value }): Promise<ArrayBuffer> | ArrayBuffer {
    if (done) {
      reader.releaseLock();
      const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return result.buffer;
    }
    if (value) {
      if (value instanceof Uint8Array) {
        chunks.push(value);
      } else {
        chunks.push((value as { value: Uint8Array }).value);
      }
    }
    return reader.read().then(handle);
  });
}

/**
 * Download AndroidManifest.xml from an APK on the device.
 */
async function downloadAndroidManifest(adb: Adb, apkPath: string): Promise<ArrayBuffer | null> {
  try {
    const process = await adb.subprocess.noneProtocol.spawn(['unzip', '-p', apkPath, 'AndroidManifest.xml']);
    const buffer = await readProcessOutput(process);
    return buffer.byteLength >= 8 ? buffer : null;
  } catch (e) {
    console.error('[downloadAndroidManifest] error:', e);
    return null;
  }
}

/**
 * Download resources.arsc from an APK on the device.
 */
async function downloadResourcesArsc(adb: Adb, apkPath: string): Promise<ArrayBuffer | null> {
  try {
    const process = await adb.subprocess.noneProtocol.spawn(['unzip', '-p', apkPath, 'resources.arsc']);
    const buffer = await readProcessOutput(process);
    return buffer.byteLength >= 12 ? buffer : null;
  } catch (e) {
    console.error('[downloadResourcesArsc] error:', e);
    return null;
  }
}

/**
 * Get the APK path for a package from the device.
 */
export async function getApkPath(adb: Adb, pkg: string): Promise<string | null> {
  try {
    const output = await adb.subprocess.noneProtocol.spawnWaitText(['pm', 'path', pkg]);
    const match = output.match(/^package:(.+)$/m);
    return match ? match[1]!.trim() : null;
  } catch {
    return null;
  }
}

export interface AppMeta {
  label: string | null;
  iconResourceId: number | null;
}

/**
 * Extract app metadata (label and icon resource ID) from the APK's
 * AndroidManifest.xml and resources.arsc.
 */
export async function extractAppMeta(adb: Adb, pkg: string): Promise<AppMeta> {
  const apkPath = await getApkPath(adb, pkg);
  if (!apkPath) return { label: null, iconResourceId: null };

  const manifestBuffer = await downloadAndroidManifest(adb, apkPath);
  if (!manifestBuffer) return { label: null, iconResourceId: null };

  const manifest = parseAndroidManifest(manifestBuffer);
  if (!manifest.label && !manifest.icon) return { label: null, iconResourceId: null };

  let label: string | null = null;
  let iconResourceId: number | null = null;

  if (manifest.icon) {
    iconResourceId = manifest.icon;
  }

  if (manifest.label) {
    if (manifest.label.isString) {
      label = manifest.label.value;
    } else if (manifest.label.isString === false) {
      const arscBuffer = await downloadResourcesArsc(adb, apkPath);
      if (arscBuffer) {
        const resolved = resolveStringResource(arscBuffer, manifest.label.value);
        if (resolved) {
          label = resolved;
        }
      }
    }
  }

  return { label, iconResourceId };
}

/**
 * Extract an icon image from the APK given a resource ID.
 * Searches for drawable/mipmap files in the APK.
 */
export async function extractIconFromApk(adb: Adb, pkg: string): Promise<string | null> {
  const apkPath = await getApkPath(adb, pkg);
  if (!apkPath) return null;

  try {
    const listOutput = await adb.subprocess.noneProtocol.spawnWaitText(['unzip', '-l', apkPath]);
    const iconCandidates: string[] = [];

    for (const line of listOutput.split('\n')) {
      const fileMatch = line.match(/res\/(mipmap|drawable)[^ ]*\/([^ ]+\.(png|webp))/);
      if (fileMatch) iconCandidates.push(fileMatch[0]!);
    }

    const score = (path: string): number => {
      let s = 0;
      if (path.includes('ic_launcher_round')) s += 100;
      if (path.includes('ic_launcher')) s += 80;
      if (path.includes('/icon')) s += 60;
      if (path.includes('mipmap-xxxhdpi')) s += 50;
      if (path.includes('mipmap-xxhdpi')) s += 40;
      if (path.includes('mipmap-xhdpi')) s += 30;
      if (path.includes('mipmap-hdpi')) s += 20;
      return s;
    };
    iconCandidates.sort((a, b) => score(b) - score(a));

    for (const candidate of iconCandidates) {
      try {
        const process = await adb.subprocess.noneProtocol.spawn(['unzip', '-p', apkPath, candidate]);
        const buffer = await readProcessOutput(process);
        if (buffer.byteLength < 100) continue;

        const blob = new Blob([buffer], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        return url;
      } catch {
        continue;
      }
    }

    return null;
  } catch (e) {
    console.error('[extractIconFromApk] error:', e);
    return null;
  }
}