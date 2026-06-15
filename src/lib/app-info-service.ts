import type { Adb } from '@yume-chan/adb';
import { AppInfoCache, type AppInfo } from './app-info-cache';
import { DeviceAppParser } from './device-app-parser';
import { DeviceAppsStore, type DeviceAppRecord } from './device-apps-store';

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
  private deviceAppsStore = new DeviceAppsStore();
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
      console.log('[AppInfoService] 尝试使用设备端解析器...');
      const deviceResult = await this.deviceParser.parseAllApps(adb, signal);

      const results = new Map<string, AppInfo>();
      const toCache: AppInfo[] = [];
      for (const app of deviceResult.apps) {
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
        toCache.push(appInfo);
        results.set(app.packageName, appInfo);
      }

      if (toCache.length > 0) {
        this.cache.setAll(toCache).catch((err) => {
          console.warn(`[AppInfoService] 缓存批量写入失败:`, err);
        });
      }

      const existingRecords = await this.deviceAppsStore.getAll();
      const existingMap = new Map(existingRecords.map(r => [r.packageName, r]));
      const now = Date.now();

      const updatedRecords: DeviceAppRecord[] = deviceResult.apps.map(app => {
        const existing = existingMap.get(app.packageName);
        return {
          packageName: app.packageName,
          versionCode: app.versionCode,
          launchCount: app.launchCount ?? existing?.launchCount ?? 0,
          localCount: existing?.localCount ?? 0,
          pinned: existing?.pinned ?? false,
          pinOrder: existing?.pinOrder ?? -1,
          lastSynced: now,
        };
      });

      await this.deviceAppsStore.setAll(updatedRecords);

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
    if (this.syncing) {
      console.log('[AppInfoService] 同步正在进行中，跳过重复调用');
      return { toParse: [], deviceApps: new Map() };
    }

    this.syncing = true;
    console.log('[AppInfoService] 开始同步设备应用列表...');

    try {
      const { apps: quickApps } = await this.deviceParser.fetchQuickPackageList(adb, signal);

      const existingRecords = await this.deviceAppsStore.getAll();
      const existingMap = new Map(existingRecords.map(r => [r.packageName, r]));

      const now = Date.now();
      const newRecords: DeviceAppRecord[] = quickApps.map(app => {
        const existing = existingMap.get(app.packageName);
        return {
          packageName: app.packageName,
          versionCode: app.versionCode,
          launchCount: existing?.launchCount ?? 0,
          localCount: existing?.localCount ?? 0,
          pinned: existing?.pinned ?? false,
          pinOrder: existing?.pinOrder ?? -1,
          lastSynced: now,
        };
      });

      await this.deviceAppsStore.setAll(newRecords);

      const toParse: string[] = [];
      for (const app of quickApps) {
        const cached = await this.cache.get(app.packageName);
        if (!cached || cached.versionCode !== app.versionCode) {
          toParse.push(app.packageName);
        }
      }

      console.log(`[AppInfoService] 同步完成: 设备 ${quickApps.length} 个应用, 需解析 ${toParse.length} 个`);

      return {
        toParse,
        deviceApps: new Map(quickApps.map(a => [a.packageName, a.versionCode])),
      };
    } finally {
      this.syncing = false;
    }
  }

  async getAllDeviceApps(): Promise<DeviceAppRecord[]> {
    return this.deviceAppsStore.getAll();
  }

  async incrementLocalCount(packageName: string): Promise<void> {
    await this.deviceAppsStore.incrementLocalCount(packageName);
  }

  async togglePin(packageName: string): Promise<boolean> {
    return this.deviceAppsStore.togglePin(packageName);
  }

  async getPinnedApps(): Promise<DeviceAppRecord[]> {
    return this.deviceAppsStore.getPinnedApps();
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

  async clearDeviceApps(): Promise<void> {
    await this.deviceAppsStore.clear();
  }

  async clearAll(): Promise<void> {
    await Promise.all([
      this.cache.clear(),
      this.deviceAppsStore.clear(),
    ]);
  }
}
