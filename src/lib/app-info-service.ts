import type { Adb } from '@yume-chan/adb';
import { AppInfoCache, type AppInfo } from './app-info-cache';
import { DeviceAppParser } from './device-app-parser';
import { DeviceAppsStore, type DeviceAppRecord } from './device-apps-store';
import { UserPreferencesStore } from './user-preferences-store';

export interface SyncResult {
  /** 需要解析的应用包名列表 */
  toParse: string[];
  /** 设备上所有应用的包名+版本号 */
  deviceApps: Map<string, number>;
  /** 本次是否因重入守卫被跳过（未产生任何写入） */
  skipped?: boolean;
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
  private prefsStore = new UserPreferencesStore();
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
    deviceSerial: string,
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
        const cached = await this.cache.get(deviceSerial, app.packageName);
        if (cached && cached.versionCode === app.versionCode) {
          results.set(app.packageName, cached);
          continue;
        }

        const appInfo: AppInfo = {
          deviceSerial,
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
        this.cache.setAll(deviceSerial, toCache).catch((err) => {
          console.warn(`[AppInfoService] 缓存批量写入失败:`, err);
        });
      }

      const existingRecords = await this.deviceAppsStore.getAll(deviceSerial);
      const existingMap = new Map(existingRecords.map(r => [r.packageName, r]));
      const now = Date.now();

      const updatedRecords: DeviceAppRecord[] = deviceResult.apps.map(app => {
        const existing = existingMap.get(app.packageName);
        return {
          deviceSerial,
          packageName: app.packageName,
          versionCode: app.versionCode,
          launchCount: app.launchCount ?? existing?.launchCount ?? 0,
          localCount: existing?.localCount ?? 0,
          pinned: existing?.pinned ?? false,
          pinOrder: existing?.pinOrder ?? -1,
          lastSynced: now,
        };
      });

      await this.deviceAppsStore.setAll(deviceSerial, updatedRecords);

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

  async syncWithDevice(adb: Adb, deviceSerial: string, signal?: AbortSignal): Promise<SyncResult> {
    if (this.syncing) {
      console.log('[AppInfoService] 同步正在进行中，跳过重复调用');
      return { toParse: [], deviceApps: new Map(), skipped: true };
    }

    this.syncing = true;
    console.log('[AppInfoService] 开始同步设备应用列表...');

    try {
      const { apps: quickApps } = await this.deviceParser.fetchQuickPackageList(adb, signal);

      const existingRecords = await this.deviceAppsStore.getAll(deviceSerial);
      const existingMap = new Map(existingRecords.map(r => [r.packageName, r]));

      const now = Date.now();
      const newRecords: DeviceAppRecord[] = quickApps.map(app => {
        const existing = existingMap.get(app.packageName);
        return {
          deviceSerial,
          packageName: app.packageName,
          versionCode: app.versionCode,
          launchCount: existing?.launchCount ?? 0,
          localCount: existing?.localCount ?? 0,
          pinned: existing?.pinned ?? false,
          pinOrder: existing?.pinOrder ?? -1,
          lastSynced: now,
        };
      });

      await this.deviceAppsStore.setAll(deviceSerial, newRecords);

      const toParse: string[] = [];
      for (const app of quickApps) {
        const cached = await this.cache.get(deviceSerial, app.packageName);
        if (!cached || cached.versionCode !== app.versionCode) {
          toParse.push(app.packageName);
        }
      }

      console.log(`[AppInfoService] 同步完成: 设备 ${quickApps.length} 个应用, 需解析 ${toParse.length} 个`);

      return {
        toParse,
        deviceApps: new Map(quickApps.map(a => [a.packageName, a.versionCode])),
        skipped: false,
      };
    } finally {
      this.syncing = false;
    }
  }

  /**
   * 连接/重连时的「同步并按需解析」入口：先轻量比对设备列表与缓存
   * （syncWithDevice），仅当 toParse>0（存在新增 / versionCode 变更包）时才跑全量 dex。
   *
   * 注意：设备端 fetcher（deviceParser.parseAllApps）经 app_process 一次性 dump
   * 全部应用元数据，不支持「只取 toParse 子集」；parseAllApps 内部已对每个包做
   * versionCode 比对、仅把变更项写入缓存（app-info-service.ts:58-77）。因此「增量」
   * 的语义是——仅在有变更时跑一次全量 dex，且只写差异到缓存，而非每次都重写。
   *
   * 这是「连接级自动同步」的单一调用点（恢复 f7391bb，被 9afad53 误删）：
   * 调用方（startScrcpy）在握有 live adb 句柄后 fire-and-forget 调用即可；
   * syncWithDevice 自带重入守卫（syncing 标志），重复/重连调用安全。
   */
  async syncAndParseIfNeeded(
    adb: Adb,
    deviceSerial: string,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const result = await this.syncWithDevice(adb, deviceSerial, signal);
    if (result.toParse.length > 0) {
      await this.parseAllApps(adb, deviceSerial, undefined);
    }
    return result;
  }

  async clearDeviceAppCache(deviceSerial: string): Promise<void> {
    await this.cache.clearForDevice(deviceSerial);
  }

  async clearDevicePreferences(deviceSerial: string): Promise<void> {
    await Promise.all([
      this.deviceAppsStore.clearForDevice(deviceSerial),
      this.prefsStore.clearAll(deviceSerial),
    ]);
  }

  async getDeviceCacheInfo(deviceSerial: string): Promise<{
    appCacheCount: number;
    appCacheSize: number;
    pinnedCount: number;
    launchCount: number;
  }> {
    const [appCacheCount, appCacheSize, pinnedRecords] = await Promise.all([
      this.cache.countForDevice(deviceSerial),
      this.cache.getCacheSizeForDevice(deviceSerial),
      this.deviceAppsStore.getPinnedApps(deviceSerial),
    ]);
    const launchCount = pinnedRecords.reduce((sum, r) => sum + r.localCount, 0);
    return {
      appCacheCount,
      appCacheSize,
      pinnedCount: pinnedRecords.filter(r => r.pinned).length,
      launchCount,
    };
  }

  async getAllDeviceSerials(): Promise<string[]> {
    const [cacheSerials, appsSerials] = await Promise.all([
      this.cache.allDeviceSerials(),
      this.deviceAppsStore.allDeviceSerials(),
    ]);
    return [...new Set([...cacheSerials, ...appsSerials])];
  }

  async getAllDeviceApps(deviceSerial: string): Promise<DeviceAppRecord[]> {
    return this.deviceAppsStore.getAll(deviceSerial);
  }

  async incrementLocalCount(deviceSerial: string, packageName: string): Promise<void> {
    await this.deviceAppsStore.incrementLocalCount(deviceSerial, packageName);
  }

  async togglePin(deviceSerial: string, packageName: string): Promise<boolean> {
    return this.deviceAppsStore.togglePin(deviceSerial, packageName);
  }

  async getPinnedApps(deviceSerial: string): Promise<DeviceAppRecord[]> {
    return this.deviceAppsStore.getPinnedApps(deviceSerial);
  }

  async getAppInfo(deviceSerial: string, packageName: string): Promise<AppInfo | null> {
    return this.cache.get(deviceSerial, packageName);
  }

  async getCachedPackagesForDevice(deviceSerial: string): Promise<AppInfo[]> {
    return this.cache.getAllForDevice(deviceSerial);
  }

  async getCacheCount(): Promise<number> {
    return this.cache.countAll();
  }

  async getCacheSize(): Promise<number> {
    return this.cache.getTotalCacheSize();
  }

  async clearCache(): Promise<void> {
    await this.cache.clearAll();
  }

  async clearDeviceApps(): Promise<void> {
    await this.deviceAppsStore.clearAll();
  }

  async clearAll(): Promise<void> {
    await Promise.all([
      this.cache.clearAll(),
      this.deviceAppsStore.clearAll(),
      this.prefsStore.clearAllDevices(),
    ]);
  }
}
