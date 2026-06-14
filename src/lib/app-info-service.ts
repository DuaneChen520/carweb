import type { Adb } from '@yume-chan/adb';
import { AppInfoCache, type AppInfo } from './app-info-cache';
import { parseApk, getMaxMemoryBytes } from './apk-parser';
import { getInstalledPackages, runAdbCommand } from './adb-commands';
import { DeviceAppParser } from './device-app-parser';

export type ParseProgress = {
  total: number;
  parsed: number;
  skipped: number;
  current: string;
};

export type ParseCallback = (progress: ParseProgress) => void;

export class AppInfoService {
  private cache = new AppInfoCache();
  private deviceParser = new DeviceAppParser();
  private parsing = false;
  private abortController: AbortController | null = null;

  getMemoryLimit(): number {
    return getMaxMemoryBytes();
  }

  async shouldParse(packageName: string, versionCode: number): Promise<boolean> {
    const cached = await this.cache.get(packageName);
    if (!cached) return true;
    return cached.versionCode !== versionCode;
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
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
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      // Try device-side parser first (faster, no APK download needed)
      console.log('[AppInfoService] 尝试使用设备端解析器...');
      const deviceResult = await this.deviceParser.parseAllApps(adb, signal);

      // Convert device parser results to AppInfo format
      const results = new Map<string, AppInfo>();
      for (const app of deviceResult.apps) {
        // Filter system apps when includeSystem is false
        if (
          !includeSystem &&
          (app.packageName.startsWith('android.') || app.packageName.startsWith('com.android.'))
        ) {
          continue;
        }

        const appInfo: AppInfo = {
          packageName: app.packageName,
          label: app.label,
          iconBase64: app.iconBase64,
          versionCode: app.versionCode,
          lastParsed: Date.now(),
        };
        // Fire-and-forget: cache writes are a write-behind optimization
        this.cache.set(app.packageName, appInfo);
        results.set(app.packageName, appInfo);
      }

      // Log partial errors from device parser
      if (deviceResult.errors.length > 0) {
        console.warn('[AppInfoService] 设备端解析部分应用失败:', deviceResult.errors);
      }

      console.log(`[AppInfoService] 设备端解析成功: ${results.size} 个应用`);
      onProgress?.({ total: results.size, parsed: results.size, skipped: 0, current: '' });

      return results;
    } catch (error) {
      // Device parser failed, fallback to browser-side parsing
      console.warn('[AppInfoService] 设备端解析失败，回退到浏览器端解析:', error);
      return this.parseAllAppsViaBrowser(adb, includeSystem, signal, onProgress);
    } finally {
      this.parsing = false;
      this.abortController = null;
    }
  }

  private async parseAllAppsViaBrowser(
    adb: Adb,
    includeSystem: boolean,
    signal: AbortSignal,
    onProgress?: ParseCallback
  ): Promise<Map<string, AppInfo>> {
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

      const packagesWithSize = await this.getPackageSizes(adb, packages);
      packagesWithSize.sort((a, b) => a.size - b.size);

      for (const pkg of packagesWithSize) {
        if (signal.aborted) break;

        progress.current = pkg.name;
        onProgress?.(progress);

        const cached = await this.cache.get(pkg.name);
        if (cached && cached.versionCode === pkg.versionCode) {
          results.set(pkg.name, cached);
          const iconOk = cached.iconBase64 ? '✓' : '✗';
          console.log(`[Cache] ${pkg.name} HIT label="${cached.label ?? ''}" icon=${iconOk}`);
          progress.parsed++;
          onProgress?.(progress);
          continue;
        } else if (cached) {
          console.log(`[Cache] ${pkg.name} STALE (version ${cached.versionCode} → ${pkg.versionCode})`);
        } else {
          console.log(`[Cache] ${pkg.name} MISS`);
        }

        if (pkg.size > memoryLimit) {
          console.warn(`[AppInfoService] Skipping ${pkg.name}: ${pkg.size} bytes exceeds limit ${memoryLimit}`);
          progress.skipped++;
          progress.parsed++;
          onProgress?.(progress);
          continue;
        }

        try {
          const apkData = await this.downloadApk(adb, pkg.apkPath);
          if (!apkData || signal.aborted) {
            progress.parsed++;
            continue;
          }

          const parsed = await parseApk(apkData, memoryLimit);
          if (!parsed) {
            console.log(`[Parse] ${pkg.name} ✗ parseApk returned null`);
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

          const iconOk = parsed.iconBase64 ? '✓' : '✗';
          console.log(`[Parse] ${pkg.name} ✓ label="${parsed.label ?? ''}" icon=${iconOk}`);

          await this.cache.set(pkg.name, appInfo);
          results.set(pkg.name, appInfo);
          progress.parsed++;
          onProgress?.(progress);
        } catch (e) {
          console.log(`[Parse] ${pkg.name} ✗ ${(e as Error)?.message ?? e}`);
          progress.parsed++;
        }
      }
    } finally {
      this.parsing = false;
      this.abortController = null;
    }

    return results;
  }

  async getAppInfo(packageName: string): Promise<AppInfo | null> {
    return this.cache.get(packageName);
  }

  async getCacheCount(): Promise<number> {
    return this.cache.count();
  }

  async getCacheSize(): Promise<number> {
    return this.cache.getCacheSize();
  }

  async clearCache(): Promise<void> {
    await this.cache.clear();
  }

  private async getPackageSizes(
    adb: Adb,
    packages: string[]
  ): Promise<Array<{ name: string; apkPath: string; size: number; versionCode: number }>> {
    const pathOutput = await runAdbCommand(adb, 'pm list packages -f');
    const pathMap = new Map<string, string>();
    for (const line of pathOutput.split('\n')) {
      const match = line.match(/package:(.+)=(.+)/);
      if (match) {
        pathMap.set(match[2]!, match[1]!);
      }
    }

    const results: Array<{ name: string; apkPath: string; size: number; versionCode: number }> = [];

    for (const pkg of packages) {
      const apkPath = pathMap.get(pkg);
      if (!apkPath) continue;

      try {
        const sizeOutput = await adb.subprocess.noneProtocol.spawnWaitText(['stat', '-c', '%s', apkPath]);
        const size = parseInt(sizeOutput.trim(), 10) || 0;

        const versionOutput = await runAdbCommand(adb, `dumpsys package ${pkg} | grep versionCode`);
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
