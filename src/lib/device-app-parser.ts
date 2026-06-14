import type { Adb } from '@yume-chan/adb';
import { ReadableStream } from '@yume-chan/stream-extra';

export interface AppInfo {
  packageName: string;
  label: string | null;
  iconBase64: string | null;
  versionCode: number;
}

export interface AppError {
  packageName: string;
  error: string;
}

export interface ParseResult {
  apps: AppInfo[];
  errors: AppError[];
}

const SAFE_PATH_PATTERN = /^\/data\/local\/tmp\/[\w.-]+\.dex$/;

function validateTargetPath(path: string): void {
  if (!SAFE_PATH_PATTERN.test(path)) {
    throw new Error(
      `Invalid target path: "${path}". Must match /data/local/tmp/<name>.dex`
    );
  }
}

export class DeviceAppParser {
  private static readonly DEX_URL = import.meta.env.BASE_URL + 'app-info-fetcher.dex';
  private static readonly DEFAULT_DEX_PATH = '/data/local/tmp/app-info-fetcher.dex';
  private cachedDexData: ArrayBuffer | null = null;

  private async fetchDexData(): Promise<ArrayBuffer> {
    if (this.cachedDexData) {
      console.log('[DeviceAppParser] 使用缓存的 DEX 数据');
      return this.cachedDexData;
    }

    console.log('[DeviceAppParser] 从服务器下载 DEX 文件...');
    const response = await fetch(DeviceAppParser.DEX_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch DEX file: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      throw new Error('DEX file is empty');
    }

    console.log(`[DeviceAppParser] DEX 下载完成: ${arrayBuffer.byteLength} bytes`);
    this.cachedDexData = arrayBuffer;
    return arrayBuffer;
  }

  async pushDexToDevice(adb: Adb, dexPath?: string): Promise<boolean> {
    const targetPath = dexPath || DeviceAppParser.DEFAULT_DEX_PATH;
    validateTargetPath(targetPath);

    const arrayBuffer = await this.fetchDexData();
    console.log(`[DeviceAppParser] 推送 DEX 到设备: ${targetPath}`);
    const sync = await adb.sync();
    await sync.write({
      filename: targetPath,
      file: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(arrayBuffer));
          controller.close();
        },
      }),
    });

    console.log('[DeviceAppParser] DEX 推送完成');
    return true;
  }

  async executeDex(adb: Adb, dexPath?: string): Promise<ParseResult> {
    const targetPath = dexPath || DeviceAppParser.DEFAULT_DEX_PATH;
    validateTargetPath(targetPath);

    // Redirect stderr to stdout to capture error messages
    const command = `CLASSPATH=${targetPath} app_process / com.carweb.appinfo.AppInfoFetcher 2>&1`;

    console.log('[DeviceAppParser] 在设备上执行 DEX...');
    console.log(`[DeviceAppParser] 命令: ${command}`);
    const startTime = Date.now();
    const DEX_TIMEOUT_MS = 30_000;

    let resultPromise: Promise<string>;
    if (adb.subprocess.shellProtocol) {
      resultPromise = adb.subprocess.shellProtocol.spawnWaitText(['sh', '-c', command])
        .then((waitResult) => waitResult.stdout);
    } else {
      resultPromise = adb.subprocess.noneProtocol.spawnWaitText(['sh', '-c', command]);
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DEX execution timed out')), DEX_TIMEOUT_MS)
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);
    const elapsed = Date.now() - startTime;
    console.log(`[DeviceAppParser] DEX 执行完成, 耗时: ${elapsed}ms`);
    console.log(`[DeviceAppParser] 原始响应前500字符: ${result.substring(0, 500)}`);
    return this.parseJsonResult(result);
  }

  parseJsonResult(jsonString: string): ParseResult {
    console.log(`[DeviceAppParser] 收到响应: ${jsonString.length} bytes`);
    console.log(`[DeviceAppParser] 响应内容: ${jsonString.substring(0, 500)}`);

    // Check if the response is an error message
    if (jsonString.startsWith('Error:') || jsonString.startsWith('Exception:')) {
      throw new Error(`DEX execution failed: ${jsonString}`);
    }

    const result = JSON.parse(jsonString) as Record<string, unknown>;

    if (!result.apps || !Array.isArray(result.apps)) {
      throw new Error('Invalid result structure: missing apps array');
    }

    console.log(`[DeviceAppParser] 设备返回 ${result.apps.length} 个应用, ${Array.isArray(result.errors) ? result.errors.length : 0} 个错误`);

    const validApps: AppInfo[] = [];
    for (const raw of result.apps) {
      if (raw == null || typeof raw !== 'object') continue;
      const app = raw as Record<string, unknown>;
      if (
        typeof app.packageName === 'string' &&
        typeof app.versionCode === 'number'
      ) {
        validApps.push({
          packageName: app.packageName,
          label: (typeof app.label === 'string' ? app.label : null) as string | null,
          iconBase64: (typeof app.iconBase64 === 'string' ? app.iconBase64 : null) as string | null,
          versionCode: app.versionCode,
        });
      }
    }

    console.log(`[DeviceAppParser] 解析完成: ${validApps.length} 个有效应用`);

    // Validate errors array
    const validErrors: AppError[] = [];
    if (Array.isArray(result.errors)) {
      for (const err of result.errors) {
        if (err && typeof err === 'object' && typeof err.packageName === 'string') {
          validErrors.push({
            packageName: err.packageName,
            error: typeof err.error === 'string' ? err.error : 'Unknown error',
          });
        }
      }
    }

    return {
      apps: validApps,
      errors: validErrors,
    };
  }

  async cleanupDex(adb: Adb, dexPath?: string): Promise<boolean> {
    const targetPath = dexPath || DeviceAppParser.DEFAULT_DEX_PATH;
    validateTargetPath(targetPath);

    console.log(`[DeviceAppParser] 清理设备上的 DEX: ${targetPath}`);
    const command = `rm -f '${targetPath}'`;

    if (adb.subprocess.shellProtocol) {
      await adb.subprocess.shellProtocol.spawnWaitText(command);
    } else {
      await adb.subprocess.noneProtocol.spawnWaitText(['sh', '-c', command]);
    }

    console.log('[DeviceAppParser] DEX 清理完成');
    return true;
  }

  async parseAllApps(adb: Adb, signal?: AbortSignal): Promise<ParseResult> {
    const targetPath = DeviceAppParser.DEFAULT_DEX_PATH;
    const startTime = Date.now();

    console.log('[DeviceAppParser] ===== 开始设备端应用解析 =====');
    signal?.throwIfAborted();

    await this.pushDexToDevice(adb, targetPath);

    try {
      signal?.throwIfAborted();
      const result = await this.executeDex(adb, targetPath);
      const totalElapsed = Date.now() - startTime;
      console.log(`[DeviceAppParser] ===== 解析完成: ${result.apps.length} 个应用, ${result.errors.length} 个错误, 总耗时: ${totalElapsed}ms =====`);
      return result;
    } finally {
      await this.cleanupDex(adb, targetPath).catch(() => {});
    }
  }
}
