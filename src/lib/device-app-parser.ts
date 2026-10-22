import type { Adb } from '@yume-chan/adb';
import { ReadableStream } from '@yume-chan/stream-extra';

export interface AppInfo {
  packageName: string;
  label: string | null;
  iconBase64: string | null;
  versionCode: number;
  launchCount: number;
}

export interface AppError {
  packageName: string;
  error: string;
}

export interface ParseResult {
  apps: AppInfo[];
  errors: AppError[];
}

export interface QuickAppInfo {
  packageName: string;
  versionCode: number;
}

export interface QuickParseResult {
  apps: QuickAppInfo[];
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
  private static readonly QUICK_DEX_URL = import.meta.env.BASE_URL + 'app-info-fetcher-quick.dex';
  private static readonly DEFAULT_DEX_PATH = '/data/local/tmp/app-info-fetcher.dex';
  private static readonly QUICK_DEX_PATH = '/data/local/tmp/app-info-fetcher-quick.dex';
  private static readonly SCRIPT_PATH = '/data/local/tmp/run-app-info.sh';
  private static readonly QUICK_SCRIPT_PATH = '/data/local/tmp/run-app-info-quick.sh';
  private cachedDexData: ArrayBuffer | null = null;
  private cachedQuickDexData: ArrayBuffer | null = null;

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

  private async fetchQuickDexData(): Promise<ArrayBuffer> {
    if (this.cachedQuickDexData) {
      console.log('[DeviceAppParser] 使用缓存的 Quick DEX 数据');
      return this.cachedQuickDexData;
    }

    console.log('[DeviceAppParser] 从服务器下载 Quick DEX 文件...');
    const response = await fetch(DeviceAppParser.QUICK_DEX_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch Quick DEX file: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      throw new Error('Quick DEX file is empty');
    }

    console.log(`[DeviceAppParser] Quick DEX 下载完成: ${arrayBuffer.byteLength} bytes`);
    this.cachedQuickDexData = arrayBuffer;
    return arrayBuffer;
  }

  async pushDexToDevice(adb: Adb, dexPath?: string): Promise<boolean> {
    const targetPath = dexPath || DeviceAppParser.DEFAULT_DEX_PATH;
    validateTargetPath(targetPath);

    const arrayBuffer = await this.fetchDexData();
    console.log(`[DeviceAppParser] 推送 DEX 到设备: ${targetPath}`);
    // v3：adb.sync 从方法变为属性（AdbSync.Service 实例），不再 await
    const sync = adb.sync;
    await sync.write({
      path: targetPath,
      readable: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(arrayBuffer));
          controller.close();
        },
      }),
    });

    console.log('[DeviceAppParser] DEX 推送完成');
    return true;
  }

  async pushQuickDexToDevice(adb: Adb, dexPath?: string): Promise<boolean> {
    const targetPath = dexPath || DeviceAppParser.QUICK_DEX_PATH;
    validateTargetPath(targetPath);

    const arrayBuffer = await this.fetchQuickDexData();
    console.log(`[DeviceAppParser] 推送 Quick DEX 到设备: ${targetPath}`);
    const sync = adb.sync;
    await sync.write({
      path: targetPath,
      readable: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(arrayBuffer));
          controller.close();
        },
      }),
    });

    console.log('[DeviceAppParser] Quick DEX 推送完成');
    return true;
  }

  private generateScript(dexPath: string): string {
    return `#!/system/bin/sh
# Auto-generated script for running AppInfoFetcher
# Do not edit - this script is managed by CarWeb

# Debug output
echo "SCRIPT START" >&2
echo "ANDROID_DATA=$ANDROID_DATA" >&2
echo "ANDROID_ROOT=$ANDROID_ROOT" >&2
echo "CLASSPATH=${dexPath}" >&2

# Set ANDROID_DATA (required by app_process) - must be /data, not /data/local/tmp
export ANDROID_DATA=/data

# Set ANDROID_ROOT (required by app_process for framework classes)
export ANDROID_ROOT=/system

# Set CLASSPATH to the DEX file
export CLASSPATH=${dexPath}

# Create dalvik-cache directory if it doesn't exist
mkdir -p /data/dalvik-cache

# Check if DEX file exists
ls -la ${dexPath} >&2

# Run the AppInfoFetcher - stderr stays on stderr (diagnostic), stdout is JSON
echo "RUNNING APP_PROCESS..." >&2
app_process /system/bin com.carweb.appinfo.AppInfoFetcher
echo "APP_PROCESS EXIT CODE: $?" >&2
`;
  }

  private generateQuickScript(dexPath: string): string {
    return `#!/system/bin/sh
# Auto-generated script for running AppInfoFetcherQuick
# Do not edit - this script is managed by CarWeb

echo "QUICK SCRIPT START" >&2

export ANDROID_DATA=/data
export ANDROID_ROOT=/system
export CLASSPATH=${dexPath}

mkdir -p /data/dalvik-cache

ls -la ${dexPath} >&2

echo "RUNNING QUICK APP_PROCESS..." >&2
app_process /system/bin com.carweb.appinfo.AppInfoFetcherQuick
echo "APP_PROCESS EXIT CODE: $?" >&2
`;
  }

  private async pushScript(adb: Adb, scriptContent: string, targetPath?: string): Promise<void> {
    const encoder = new TextEncoder();
    const scriptBytes = encoder.encode(scriptContent);
    const scriptPath = targetPath || DeviceAppParser.SCRIPT_PATH;

    console.log(`[DeviceAppParser] 推送脚本到设备: ${scriptPath}`);
    const sync = adb.sync;
    await sync.write({
      path: scriptPath,
      readable: new ReadableStream({
        start(controller) {
          controller.enqueue(scriptBytes);
          controller.close();
        },
      }),
    });

    // Make script executable
    await adb.subprocess.noneProtocol.spawn(['chmod', '755', scriptPath]).wait();
    console.log('[DeviceAppParser] 脚本推送完成');
  }

  async executeDex(adb: Adb, dexPath?: string): Promise<ParseResult> {
    const targetPath = dexPath || DeviceAppParser.DEFAULT_DEX_PATH;
    validateTargetPath(targetPath);

    // Generate and push script
    const scriptContent = this.generateScript(targetPath);
    await this.pushScript(adb, scriptContent, DeviceAppParser.SCRIPT_PATH);

    console.log('[DeviceAppParser] 在设备上执行脚本...');
    console.log(`[DeviceAppParser] 脚本路径: ${DeviceAppParser.SCRIPT_PATH}`);
    const startTime = Date.now();
    const DEX_TIMEOUT_MS = 30_000;

    let resultPromise: Promise<string>;
    if (adb.subprocess.shellProtocol) {
      resultPromise = adb.subprocess.shellProtocol.spawn(['sh', DeviceAppParser.SCRIPT_PATH]).wait().toString()
        .then((waitResult) => {
          // Combine stdout and stderr for debugging
          const combined = waitResult.stdout + waitResult.stderr;
          console.log(`[DeviceAppParser] stdout: ${waitResult.stdout.substring(0, 200)}`);
          console.log(`[DeviceAppParser] stderr: ${waitResult.stderr.substring(0, 500)}`);
          return combined;
        });
    } else {
      resultPromise = adb.subprocess.noneProtocol.spawn(['sh', DeviceAppParser.SCRIPT_PATH]).wait().toString();
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DEX execution timed out')), DEX_TIMEOUT_MS)
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);
    const elapsed = Date.now() - startTime;
    console.log(`[DeviceAppParser] 脚本执行完成, 耗时: ${elapsed}ms`);
    console.log(`[DeviceAppParser] 原始响应前500字符: ${result.substring(0, 500)}`);
    return this.parseJsonResult(result);
  }

  async executeQuickDex(adb: Adb, dexPath?: string): Promise<QuickParseResult> {
    const targetPath = dexPath || DeviceAppParser.QUICK_DEX_PATH;
    validateTargetPath(targetPath);

    const scriptContent = this.generateQuickScript(targetPath);
    await this.pushScript(adb, scriptContent, DeviceAppParser.QUICK_SCRIPT_PATH);

    console.log('[DeviceAppParser] 在设备上执行 Quick 脚本...');
    const startTime = Date.now();
    const DEX_TIMEOUT_MS = 15_000;

    let resultPromise: Promise<string>;
    if (adb.subprocess.shellProtocol) {
      resultPromise = adb.subprocess.shellProtocol.spawn(['sh', DeviceAppParser.QUICK_SCRIPT_PATH]).wait().toString()
        .then((waitResult) => {
          const combined = waitResult.stdout + waitResult.stderr;
          console.log(`[DeviceAppParser] Quick stdout: ${waitResult.stdout.substring(0, 200)}`);
          console.log(`[DeviceAppParser] Quick stderr: ${waitResult.stderr.substring(0, 500)}`);
          return combined;
        });
    } else {
      resultPromise = adb.subprocess.noneProtocol.spawn(['sh', DeviceAppParser.QUICK_SCRIPT_PATH]).wait().toString();
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Quick DEX execution timed out')), DEX_TIMEOUT_MS)
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);
    const elapsed = Date.now() - startTime;
    console.log(`[DeviceAppParser] Quick 脚本执行完成, 耗时: ${elapsed}ms`);
    return this.parseQuickJsonResult(result);
  }

  parseQuickJsonResult(jsonString: string): QuickParseResult {
    console.log(`[DeviceAppParser] Quick 响应: ${jsonString.length} bytes`);

    if (jsonString.startsWith('Error:') || jsonString.startsWith('Exception:')) {
      throw new Error(`Quick DEX execution failed: ${jsonString}`);
    }

    const jsonEnd = jsonString.lastIndexOf('}');
    if (jsonEnd > 0) {
      jsonString = jsonString.substring(0, jsonEnd + 1);
    }

    const result = JSON.parse(jsonString) as Record<string, unknown>;

    if (!result.apps || !Array.isArray(result.apps)) {
      throw new Error('Invalid quick result structure: missing apps array');
    }

    const validApps: QuickAppInfo[] = [];
    for (const raw of result.apps) {
      if (raw == null || typeof raw !== 'object') continue;
      const app = raw as Record<string, unknown>;
      if (typeof app.packageName === 'string' && typeof app.versionCode === 'number') {
        validApps.push({
          packageName: app.packageName,
          versionCode: app.versionCode,
        });
      }
    }

    console.log(`[DeviceAppParser] Quick 解析完成: ${validApps.length} 个应用`);
    return { apps: validApps };
  }

  async fetchQuickPackageList(adb: Adb, signal?: AbortSignal): Promise<QuickParseResult> {
    const targetPath = DeviceAppParser.QUICK_DEX_PATH;
    const startTime = Date.now();

    console.log('[DeviceAppParser] ===== 开始快速获取应用列表 =====');
    signal?.throwIfAborted();

    await this.pushQuickDexToDevice(adb, targetPath);

    try {
      signal?.throwIfAborted();
      const result = await this.executeQuickDex(adb, targetPath);
      const totalElapsed = Date.now() - startTime;
      console.log(`[DeviceAppParser] ===== 快速获取完成: ${result.apps.length} 个应用, 总耗时: ${totalElapsed}ms =====`);
      return result;
    } finally {
      await this.cleanupQuickDex(adb, targetPath).catch(() => {});
    }
  }

  async cleanupQuickDex(adb: Adb, dexPath?: string): Promise<boolean> {
    const targetPath = dexPath || DeviceAppParser.QUICK_DEX_PATH;
    validateTargetPath(targetPath);

    console.log(`[DeviceAppParser] 清理 Quick 文件: ${targetPath}, ${DeviceAppParser.QUICK_SCRIPT_PATH}`);
    const command = `rm -f '${targetPath}' '${DeviceAppParser.QUICK_SCRIPT_PATH}'`;

    if (adb.subprocess.shellProtocol) {
      await adb.subprocess.shellProtocol.spawn(command).wait();
    } else {
      await adb.subprocess.noneProtocol.spawn(['sh', '-c', command]).wait();
    }

    console.log('[DeviceAppParser] Quick 清理完成');
    return true;
  }

  parseJsonResult(jsonString: string): ParseResult {
    console.log(`[DeviceAppParser] 收到响应: ${jsonString.length} bytes`);
    console.log(`[DeviceAppParser] 响应内容: ${jsonString.substring(0, 200)}`);
    console.log(`[DeviceAppParser] 响应末尾: ${jsonString.substring(jsonString.length - 200)}`);

    // Check if the response is an error message
    if (jsonString.startsWith('Error:') || jsonString.startsWith('Exception:')) {
      throw new Error(`DEX execution failed: ${jsonString}`);
    }

    // Try to find valid JSON - strip any trailing content after the first complete JSON object
    const jsonEnd = jsonString.lastIndexOf('}');
    if (jsonEnd > 0) {
      jsonString = jsonString.substring(0, jsonEnd + 1);
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
          iconBase64: typeof app.iconBase64 === 'string' ? `data:image/png;base64,${app.iconBase64}` : null,
          versionCode: app.versionCode,
          launchCount: typeof app.launchCount === 'number' ? app.launchCount : 0,
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

    console.log(`[DeviceAppParser] 清理设备上的文件: ${targetPath}, ${DeviceAppParser.SCRIPT_PATH}`);
    const command = `rm -f '${targetPath}' '${DeviceAppParser.SCRIPT_PATH}'`;

    if (adb.subprocess.shellProtocol) {
      await adb.subprocess.shellProtocol.spawn(command).wait();
    } else {
      await adb.subprocess.noneProtocol.spawn(['sh', '-c', command]).wait();
    }

    console.log('[DeviceAppParser] 清理完成');
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
