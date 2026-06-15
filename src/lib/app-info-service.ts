import type { Adb } from '@yume-chan/adb';
import { AppInfoCache, type AppInfo } from './app-info-cache';
import { DeviceAppParser } from './device-app-parser';

export interface SyncResult {
  /** 需要解析的应用包名列表 */
  toParse: string[];
  /** 设备上所有应用的包名+版本号 */
  deviceApps: Map<string, number>;
}

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
  private syncing = false;
  private abortController: AbortController | null = null;

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async parseAllApps(
    adb: Adb,
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
        // Cache-hit optimization: skip if already cached with same versionCode
        const cached = await this.cache.get(app.packageName);
        if (cached && cached.versionCode === app.versionCode) {
          results.set(app.packageName, cached);
          continue;
        }

        const appInfo: AppInfo = {
          packageName: app.packageName,
          label: app.label,
          iconBase64: app.iconBase64,
          versionCode: app.versionCode,
          lastParsed: Date.now(),
        };
        // Write-behind cache: catch IndexedDB errors (quota, connection closed)
        this.cache.set(app.packageName, appInfo).catch((err) => {
          console.warn(`[AppInfoService] 缓存写入失败 (${app.packageName}):`, err);
        });
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
      console.error('[AppInfoService] 设备端解析失败:', error);
      throw error;
    } finally {
      this.parsing = false;
      this.abortController = null;
    }
  }

  async syncWithDevice(adb: Adb, signal?: AbortSignal): Promise<SyncResult> {
    // 防重入：如果正在同步，直接返回空结果
    if (this.syncing) {
      console.log('[AppInfoService] 同步正在进行中，跳过重复调用');
      return { toParse: [], deviceApps: new Map() };
    }

    this.syncing = true;
    console.log('[AppInfoService] 开始同步设备应用列表...');

    try {
      // 获取设备上的应用列表（快速，包含推送/清理逻辑）
      const { apps: deviceApps } = await this.deviceParser.fetchQuickPackageList(adb, signal);

      // 对比缓存
      const toParse: string[] = [];
      for (const app of deviceApps) {
        const cached = await this.cache.get(app.packageName);
        if (!cached || cached.versionCode !== app.versionCode) {
          toParse.push(app.packageName);
        }
      }

      console.log(`[AppInfoService] 同步完成: 设备 ${deviceApps.length} 个应用, 需解析 ${toParse.length} 个`);

      return {
        toParse,
        deviceApps: new Map(deviceApps.map(a => [a.packageName, a.versionCode])),
      };
    } finally {
      this.syncing = false;
    }
  }

  async getAppInfo(packageName: string): Promise<AppInfo | null> {
    return this.cache.get(packageName);
  }

  async getAllCachedPackages(): Promise<string[]> {
    return this.cache.getAllPackageNames();
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
}
