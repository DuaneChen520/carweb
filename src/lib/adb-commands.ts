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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 进程是否存活。用于区分"启动被拒/秒退(H1a/H1b)"与"起来了但不渲染(H2)"。
 */
export async function isPackageRunning(adb: Adb, packageName: string): Promise<boolean> {
  try {
    const output = await runAdbCommand(adb, `pidof ${packageName} 2>/dev/null || true`);
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * 在 dumpsys activity activities 中扫描包含该包名的 Display 分段，
 * 返回应用 task 实际所在的 displayId 列表（按出现顺序去重）。
 * 直接判定 am start --display 是否真的把应用放到了目标虚拟屏，
 * 不受"mResumedActivity 是全局单例"导致的探测假象影响。
 */
export async function getAppDisplayLocations(adb: Adb, packageName: string): Promise<number[]> {
  try {
    const output = await runAdbCommand(adb, 'dumpsys activity activities');
    const lines = output.split('\n');
    let cur: number | null = null;
    const found: number[] = [];
    for (const line of lines) {
      const dh = line.match(/Display #(\d+)/);
      if (dh) { cur = parseInt(dh[1]!, 10); continue; }
      if (line.includes(packageName) && cur !== null) {
        if (!found.includes(cur)) found.push(cur);
      }
    }
    return found;
  } catch {
    return [];
  }
}

/**
 * 解析应用的 LAUNCHER 入口组件名(pkg/Activity)。
 * 优先用 resolve-activity；当 ROM 拒绝隐式解析(如高德地图报 "unable to resolve Intent")时，
 * 退而直接读 manifest(dumpsys package) 提取 MAIN/LAUNCHER activity，二者都能拿到显式组件。
 */
async function resolveLauncherComponent(adb: Adb, pkg: string): Promise<string | null> {
  // 方法1: resolve-activity --brief 直接返回 pkg/Activity
  try {
    const r = (await runAdbCommand(adb, ['cmd', 'package', 'resolve-activity', '--brief',
      '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', pkg])).trim();
    const line = r.split('\n').map((l) => l.trim()).filter(Boolean).find((l) => l.includes('/'));
    if (line && !/no activity found|unable to resolve/i.test(line)) return line;
  } catch { /* ignore */ }
  // 方法2: 直接读 manifest（隐式解析被拒时仍可用）
  try {
    const d = await runAdbCommand(adb,
      `dumpsys package ${pkg} 2>/dev/null | grep -A5 "android.intent.action.MAIN" | grep -oE "${pkg}/[A-Za-z0-9_.]+" | head -1 || true`);
    const c = d.trim();
    if (c) return c;
  } catch { /* ignore */ }
  return null;
}

/** 取应用当前任务栈的 taskId（用于 move-to-display 搬运）。 */
async function getAppTaskId(adb: Adb, pkg: string): Promise<number | null> {
  try {
    const out = await runAdbCommand(adb,
      `dumpsys activity activities 2>/dev/null | grep -E "Task\\{[^}]*${pkg}" | grep -oE "#[0-9]+" | head -1 | tr -d '#' || true`);
    const t = out.trim();
    return t ? parseInt(t, 10) : null;
  } catch {
    return null;
  }
}

export async function startAppOnDisplay(adb: Adb, packageName: string, displayId: number): Promise<void> {
  try {
    // [修复] 部分应用(如高德地图)用 `am start -a MAIN -c LAUNCHER <pkg>` 会报
    // "Activity not started, unable to resolve Intent"(aInfo is null) —— ROM 拒绝隐式解析。
    // 改用显式组件名 `-n pkg/Activity` 启动可绕过；仍失败时兜底"主屏启动 + am task move-to-display"。
    const component = await resolveLauncherComponent(adb, packageName);
    console.log(`[launch-diag] resolve 组件(${packageName}): ${component ?? '未解析（用隐式 intent 兜底）'}`);

    const buildStart = (comp: string | null, disp: number | null): string => {
      const d = disp !== null ? `--display ${disp} ` : '';
      if (comp) return `am start -W ${d}-n ${comp}`;
      return `am start -W ${d}-a android.intent.action.MAIN -c android.intent.category.LAUNCHER ${packageName}`;
    };

    // 策略1: 直接在目标虚拟屏启动
    let cmd = buildStart(component, displayId);
    try { await runAdbCommand(adb, 'logcat -c 2>/dev/null || true'); } catch { /* ignore */ }
    console.log(`[launch-diag] 执行(策略1 直投虚拟屏): ${cmd}`);
    let out = await Promise.race([runAdbCommand(adb, cmd), sleep(8000).then(() => '__TIMEOUT__')]) as string;
    console.log(`[launch-diag] 策略1 输出:\n${out.trim()}`);
    await sleep(2000);

    let running = await isPackageRunning(adb, packageName);
    let loc = await getAppDisplayLocations(adb, packageName);
    console.log(`[launch-diag] 策略1 后 进程存活:${running ? '是' : '否'} display分段:${loc.length ? loc.join(', ') : '无'}`);

    // 策略2: 兜底——先在主屏启动，再 am task move-to-display 搬运（应对 ROM 禁止 --display 直投）
    if (component && (!running || !loc.includes(displayId))) {
      console.warn(`[launch-diag] 策略1 未落到虚拟屏，启用策略2(主屏启动+搬运任务)`);
      cmd = buildStart(component, null);
      console.log(`[launch-diag] 执行(策略2 主屏): ${cmd}`);
      out = await Promise.race([runAdbCommand(adb, cmd), sleep(8000).then(() => '__TIMEOUT__')]) as string;
      console.log(`[launch-diag] 策略2 输出:\n${out.trim()}`);
      await sleep(2500);
      const taskId = await getAppTaskId(adb, packageName);
      if (taskId !== null) {
        console.log(`[launch-diag] 策略2 找到 taskId=${taskId}，搬运到 display#${displayId}`);
        const mv = await runAdbCommand(adb, `am task ${taskId} move-to-display ${displayId} 2>/dev/null || true`);
        console.log(`[launch-diag] move-to-display 输出: ${mv.trim()}`);
      } else {
        console.warn(`[launch-diag] 策略2 未找到 ${packageName} 的 taskId`);
      }
      await sleep(1500);
      running = await isPackageRunning(adb, packageName);
      loc = await getAppDisplayLocations(adb, packageName);
    }

    // 最终判定
    if (!running && loc.length === 0) {
      console.warn(`[launch-diag] ⚠️ 两策略均失败：进程未存活且不在任何 display`);
      const crash = await runAdbCommand(adb, `logcat -b main -b system -b crash -d 2>/dev/null | grep -iE "${packageName}|FATAL EXCEPTION|AndroidRuntime|am_anr|signal |tombstone|SecurityException|EGL|GL " | tail -50 || true`);
      if (crash.trim()) console.log(`[launch-diag] 清屏后新日志:\n${crash}`);
      else console.log(`[launch-diag] 清屏后无任何相关日志`);
    } else if (!loc.includes(displayId)) {
      if (loc.includes(0)) console.warn(`[launch-diag] ⚠️ 最终落在主屏(display#0) → 白屏（ROM 禁止该应用进入虚拟屏）`);
      else console.warn(`[launch-diag] ⚠️ 最终落在非目标 display: ${loc.join(', ')}`);
    } else {
      console.log(`[launch-diag] ✅ ${packageName} 已落在目标 display#${displayId}（若仍白屏则属 H2: 渲染面未捕获）`);
    }
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
