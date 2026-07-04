import type { Adb } from '@yume-chan/adb';

export interface RotationState {
  accel: string | null;
  userRot: string | null;
}

export async function runAdbCommand(adb: Adb, command: string | string[]): Promise<string> {
  if (adb.subprocess.shellProtocol) {
    const cmd = Array.isArray(command) ? command.join(' ') : command;
    const result = await adb.subprocess.shellProtocol.spawnWaitText(cmd);
    return result.stdout.trim();
  } else {
    const args = Array.isArray(command) ? ['sh', '-c', `${command.join(' ')} 2>&1`] : ['sh', '-c', `${command} 2>&1`];
    const result = await adb.subprocess.noneProtocol.spawnWaitText(args);
    return result.trim();
  }
}

export async function getRotationState(adb: Adb): Promise<RotationState> {
  let accel = '';
  let userRot = '';
  try {
    accel = await runAdbCommand(adb, 'settings get global accelerometer_rotation');
  } catch (e) {
    console.warn('获取 accelerometer_rotation 失败:', e);
  }
  try {
    userRot = await runAdbCommand(adb, 'settings get system user_rotation');
  } catch (e) {
    console.warn('获取 user_rotation 失败:', e);
  }
  return { accel: accel || null, userRot: userRot || null };
}

export async function setRotationLocked(adb: Adb): Promise<void> {
  await runAdbCommand(adb, 'settings put global accelerometer_rotation 0');
  await runAdbCommand(adb, 'settings put system user_rotation 0');
}

export async function restoreRotation(adb: Adb, state: RotationState): Promise<void> {
  if (state.accel !== null) {
    await runAdbCommand(adb, `settings put global accelerometer_rotation ${state.accel}`);
  }
  if (state.userRot !== null) {
    await runAdbCommand(adb, `settings put system user_rotation ${state.userRot}`);
  }
}

export async function getDefaultIme(adb: Adb): Promise<string> {
  const output = await runAdbCommand(adb, 'ime list -s | head -1');
  return output.split('\n')[0]?.trim() || '';
}

export async function setIme(adb: Adb, ime: string): Promise<void> {
  await runAdbCommand(adb, [
    'settings put secure default_input_method',
    `"${ime}"`,
    '&&',
    'ime enable',
    ime,
    '&&',
    'ime set',
    ime,
  ]);
}

export async function hideIme(adb: Adb): Promise<void> {
  try {
    await runAdbCommand(adb, 'ime hide com.android.inputmethod.latin/.LatinIME');
  } catch {
    await runAdbCommand(adb, 'input keyevent 111');
  }
}

export async function getInstalledPackages(adb: Adb, includeSystem = false): Promise<string[]> {
  if (includeSystem) {
    const output = await runAdbCommand(adb, 'pm list packages');
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('package:'))
      .map((line) => line.slice(8))
      .sort();
  }

  // 获取所有 app 包名（DEX 端负责 launcher intent 过滤）
  const output = await runAdbCommand(adb, 'pm list packages');
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('package:'))
    .map((line) => line.slice(8))
    .sort();
}

export async function getAppLabel(adb: Adb, pkg: string): Promise<string> {
  try {
    const { extractAppMeta } = await import('@/utils/apk-utils');
    const meta = await extractAppMeta(adb, pkg);
    if (meta.label) {
      return meta.label;
    }
  } catch (e) {
    console.warn('[getAppLabel] extractAppMeta failed for', pkg, e);
  }
  return formatPackageName(pkg);
}

export async function batchGetAppLabels(adb: Adb, packages: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const { extractAppMeta } = await import('@/utils/apk-utils');

  // 并发获取，限制并发数为 5 避免过载
  const CONCURRENCY = 5;
  for (let i = 0; i < packages.length; i += CONCURRENCY) {
    const batch = packages.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (pkg) => {
        try {
          const meta = await extractAppMeta(adb, pkg);
          return [pkg, meta.label] as const;
        } catch {
          return [pkg, null] as const;
        }
      })
    );
    for (const [pkg, label] of results) {
      labels.set(pkg, label ?? formatPackageName(pkg));
    }
  }

  return labels;
}

export async function isScreenOn(adb: Adb): Promise<boolean> {
  try {
    const output = await runAdbCommand(adb, 'dumpsys power | grep mWakefulness');
    return output.includes('Awake');
  } catch {
    return true;
  }
}

export async function toggleScreen(adb: Adb): Promise<void> {
  await runAdbCommand(adb, 'input keyevent 26');
}

export async function turnOffScreen(adb: Adb): Promise<void> {
  if (await isScreenOn(adb)) {
    await toggleScreen(adb);
  }
}

export async function turnOnScreen(adb: Adb): Promise<void> {
  try {
    const output = await runAdbCommand(adb, 'dumpsys power | grep mWakefulness');
    if (output.includes('Asleep')) {
      await toggleScreen(adb);
    }
  } catch {
    await toggleScreen(adb);
  }
}

export async function resizeDisplay(
  adb: Adb,
  displayId: number,
  width: number,
  height: number,
  dpi: number
): Promise<void> {
  await runAdbCommand(adb, `wm size -d ${displayId} ${width}x${height}`);
  await runAdbCommand(adb, `wm density -d ${displayId} ${dpi}`);
}

export async function getCurrentForegroundApp(adb: Adb, displayId: number): Promise<string | null> {
  try {
    // 使用 dumpsys activity activities 完整输出，按 Display #N 分段解析
    const output = await runAdbCommand(adb, 'dumpsys activity activities');
    const lines = output.split('\n');
    let inTargetDisplay = false;

    for (const line of lines) {
      // 检测 Display 分段头: "Display #N (activities):" 或 "Display #N:"
      const displayHeader = line.match(/Display #(\d+)/);
      if (displayHeader) {
        inTargetDisplay = parseInt(displayHeader[1]!, 10) === displayId;
        continue;
      }

      if (!inTargetDisplay) continue;

      // 在目标 display 分段内查找 mResumedActivity
      if (line.includes('mResumedActivity')) {
        const match = line.match(/\{[^}]*u0 ([^/]+)\//);
        if (match) return match[1];
      }

      if (line.includes('* Hist')) {
        const match = line.match(/\{[^}]*u0 ([^/]+)\//) || line.match(/ComponentInfo\{[^/]*\/([^/]+)\/[^}]*\}/);
        if (match) return match[1];
      }
    }

    return null;
  } catch (error) {
    console.warn('[DEBUG-restore] 获取前台应用失败:', error);
    return null;
  }
}

export async function getVirtualDisplayId(adb: Adb): Promise<number | null> {
  try {
    const output = await runAdbCommand(adb, 'dumpsys display');

    const viewportMatches = [...output.matchAll(/DisplayViewport\{[^}]*type=VIRTUAL[^}]*displayId=(\d+)[^}]*uniqueId='[^']*scrcpy[^']*'[^}]*\}/g)];
    if (viewportMatches.length > 0) {
      return parseInt(viewportMatches[viewportMatches.length - 1]![1]!, 10);
    }

    const lines = output.split('\n');
    const scrcpyDisplays: Array<{ id: number; hasOwnContent: boolean; hasTouchVirtual: boolean; isPrivate: boolean; }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.includes('DisplayDeviceInfo')) {
        let displayId: number | null = null;
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          const idMatch = lines[j]!.match(/mDisplayId=(\d+)/);
          if (idMatch) { displayId = parseInt(idMatch[1]!, 10); break; }
          if (lines[j]!.includes('DisplayDeviceInfo')) break;
        }
        if (line.includes('scrcpy') && displayId !== null) {
          scrcpyDisplays.push({
            id: displayId,
            hasOwnContent: line.includes('FLAG_OWN_CONTENT_ONLY'),
            hasTouchVirtual: line.includes('touch VIRTUAL'),
            isPrivate: line.includes('FLAG_PRIVATE'),
          });
        }
      }
    }

    return scrcpyDisplays.find(d => d.hasOwnContent)?.id
      ?? scrcpyDisplays.find(d => d.hasTouchVirtual)?.id
      ?? scrcpyDisplays.find(d => !d.isPrivate)?.id
      ?? scrcpyDisplays[scrcpyDisplays.length - 1]?.id
      ?? null;
  } catch (error) {
    console.warn('[DEBUG-restore] 获取虚拟屏 displayId 失败:', error);
    return null;
  }
}

export async function startAppOnDisplay(adb: Adb, packageName: string, displayId: number): Promise<void> {
  try {
    const cmd = `am start --display ${displayId} ${packageName}`;
    await runAdbCommand(adb, cmd);
  } catch (error) {
    console.warn('[DEBUG-restore] 在虚拟屏启动应用失败:', error);
  }
}

export async function getDefaultHomePackage(adb: Adb): Promise<string | null> {
  try {
    const output = await runAdbCommand(adb, [
      'cmd', 'package', 'resolve-activity',
      '--brief', '-a', 'android.intent.action.MAIN',
      '-c', 'android.intent.category.HOME',
    ]);
    const pkg = output.split('/')[0]?.trim();
    return pkg || null;
  } catch {
    return null;
  }
}

export async function forceStopPackage(adb: Adb, packageName: string): Promise<void> {
  try {
    await runAdbCommand(adb, `am force-stop ${packageName}`);
  } catch {
    // ignore
  }
}

export async function killScrcpyServer(adb: Adb, deleteJar = false): Promise<void> {
  try {
    // 杀掉设备上所有 scrcpy 进程
    await runAdbCommand(adb, 'pkill -f scrcpy 2>/dev/null || true');
  } catch {
    // ignore
  }
  if (deleteJar) {
    try {
      await runAdbCommand(adb, 'rm -f /data/local/tmp/scrcpy-server.jar');
    } catch {
      // ignore
    }
  }
}

/**
 * 获取当前设备上所有 scrcpy server 进程的 PID。
 *
 * 多实例并发时会返回多个 PID（空格分隔）。
 * 调用方应在 AdbScrcpyClient.start() 成功后立即调用，
 * 与启动前的 PID 列表对比以确定本次启动的新 PID。
 */
export async function getScrcpyServerPids(adb: Adb): Promise<number[]> {
  try {
    const output = await runAdbCommand(adb, 'pidof scrcpy 2>/dev/null');
    return output
      .split(/\s+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
  } catch {
    return [];
  }
}

/**
 * 按 PID 精确 kill scrcpy server 进程。
 *
 * 用于多实例并发场景下替代 killScrcpyServer 的全杀模式，
 * 避免误杀其他 session 的 scrcpy 进程。
 */
export async function killScrcpyByPid(adb: Adb, pid: number): Promise<void> {
  try {
    await runAdbCommand(adb, `kill -9 ${pid} 2>/dev/null || true`);
  } catch {
    // ignore
  }
}

function formatPackageName(pkg: string): string {
  const segments = pkg.split('.');
  const last = segments[segments.length - 1];
  return last
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}
