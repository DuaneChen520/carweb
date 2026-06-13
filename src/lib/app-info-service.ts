import type { Adb } from '@yume-chan/adb';
import { AppInfoCache, type AppInfo } from './app-info-cache';
import { parseApk, getMaxMemoryBytes } from './apk-parser';
import { getApkPath } from '@/utils/apk-utils';
import { getInstalledPackages } from './adb-commands';

export type ParseProgress = {
  total: number;
  parsed: number;
  skipped: number;
  current: string;
};

export type ParseCallback = (progress: ParseProgress) => void;

export class AppInfoService {
  private cache = new AppInfoCache();
  private parsing = false;

  getMemoryLimit(): number {
    return getMaxMemoryBytes();
  }

  async shouldParse(packageName: string, versionCode: number): Promise<boolean> {
    const cached = await this.cache.get(packageName);
    if (!cached) return true;
    return cached.versionCode !== versionCode;
  }

  async parseAllApps(
    adb: Adb,
    includeSystem: boolean = false,
    onProgress?: ParseCallback
  ): Promise<Map<string, AppInfo>> {
    if (this.parsing) {
      throw new Error('Already parsing');
    }

    this.parsing = true;
    const results = new Map<string, AppInfo>();
    const memoryLimit = this.getMemoryLimit();

    try {
      const packages = await getInstalledPackages(adb, includeSystem);
      const progress: ParseProgress = {
        total: packages.length,
        parsed: 0,
        skipped: 0,
        current: '',
      };

      // Sort by size ascending - need to get sizes first
      const packagesWithSize = await this.getPackageSizes(adb, packages);
      packagesWithSize.sort((a, b) => a.size - b.size);

      for (const pkg of packagesWithSize) {
        progress.current = pkg.name;
        onProgress?.(progress);

        // Check cache first
        const cached = await this.cache.get(pkg.name);
        if (cached && cached.versionCode === pkg.versionCode) {
          results.set(pkg.name, cached);
          progress.parsed++;
          continue;
        }

        // Check memory limit
        if (pkg.size > memoryLimit) {
          console.warn(`[AppInfoService] Skipping ${pkg.name}: ${pkg.size} bytes exceeds limit ${memoryLimit}`);
          progress.skipped++;
          progress.parsed++;
          continue;
        }

        // Download and parse APK
        try {
          const apkData = await this.downloadApk(adb, pkg.apkPath);
          if (!apkData) {
            progress.parsed++;
            continue;
          }

          const parsed = await parseApk(apkData, memoryLimit);
          if (!parsed) {
            progress.parsed++;
            continue;
          }

          const appInfo: AppInfo = {
            packageName: pkg.name,
            label: parsed.label,
            iconBase64: parsed.iconBase64,
            versionCode: pkg.versionCode,
            lastParsed: Date.now(),
          };

          await this.cache.set(pkg.name, appInfo);
          results.set(pkg.name, appInfo);
          progress.parsed++;
          onProgress?.(progress);
        } catch (e) {
          console.error(`[AppInfoService] Failed to parse ${pkg.name}:`, e);
          progress.parsed++;
        }
      }
    } finally {
      this.parsing = false;
    }

    return results;
  }

  async getAppInfo(packageName: string): Promise<AppInfo | null> {
    return this.cache.get(packageName);
  }

  private async getPackageSizes(
    adb: Adb,
    packages: string[]
  ): Promise<Array<{ name: string; apkPath: string; size: number; versionCode: number }>> {
    const results: Array<{ name: string; apkPath: string; size: number; versionCode: number }> = [];

    for (const pkg of packages) {
      try {
        const apkPath = await getApkPath(adb, pkg);
        if (!apkPath) continue;

        const sizeOutput = await adb.subprocess.noneProtocol.spawnWaitText(['stat', '-c', '%s', apkPath]);
        const size = parseInt(sizeOutput.trim(), 10) || 0;

        const versionOutput = await adb.subprocess.noneProtocol.spawnWaitText([
          'sh', '-c', `dumpsys package ${pkg} | grep versionCode`,
        ]);
        const versionMatch = versionOutput.match(/versionCode=(\d+)/);
        const versionCode = versionMatch ? parseInt(versionMatch[1], 10) : 0;

        results.push({ name: pkg, apkPath, size, versionCode });
      } catch (e) {
        console.warn(`[AppInfoService] Failed to get size for ${pkg}:`, e);
      }
    }

    return results;
  }

  private async downloadApk(adb: Adb, apkPath: string): Promise<ArrayBuffer | null> {
    try {
      const process = await adb.subprocess.noneProtocol.spawn(['cat', apkPath]);
      const chunks: Uint8Array[] = [];
      const reader = process.output.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value instanceof Uint8Array ? value : (value as { value: Uint8Array }).value);
        }
      }

      const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }

      return result.buffer;
    } catch (e) {
      console.error('[AppInfoService] Failed to download APK:', e);
      return null;
    }
  }
}
