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
  const cmd = includeSystem ? 'pm list packages' : 'pm list packages -3';
  const output = await runAdbCommand(adb, cmd);
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
        if (match) {
          console.log('[DEBUG-restore] getCurrentForegroundApp: 从 mResumedActivity 匹配到 =', match[1], ', displayId =', displayId);
          return match[1];
        }
      }

      // 备用: * Hist #0 开头的行也包含顶部 Activity
      if (line.includes('* Hist')) {
        const match = line.match(/\{[^}]*u0 ([^/]+)\//) || line.match(/ComponentInfo\{[^/]*\/([^/]+)\/[^}]*\}/);
        if (match) {
          console.log('[DEBUG-restore] getCurrentForegroundApp: 从 * Hist 匹配到 =', match[1], ', displayId =', displayId);
          return match[1];
        }
      }
    }

    console.log('[DEBUG-restore] getCurrentForegroundApp: 未匹配, displayId =', displayId);
    return null;
  } catch (error) {
    console.warn('[DEBUG-restore] 获取前台应用失败:', error);
    return null;
  }
}

export async function getVirtualDisplayId(adb: Adb): Promise<number | null> {
  try {
    const output = await runAdbCommand(adb, 'dumpsys display');
    console.log('[DEBUG-restore] getVirtualDisplayId: dumpsys display 前3000字符 =', output.substring(0, 3000));

    // 策略1: 解析 mViewports 行，格式:
    // DisplayViewport{type=VIRTUAL, valid=true, isActive=true, displayId=553, uniqueId='virtual:com.android.shell,2000,scrcpy,550', ...}
    // 这是最可靠的方式，单行包含 type + displayId + uniqueId
    const viewportMatches = [...output.matchAll(/DisplayViewport\{[^}]*type=VIRTUAL[^}]*displayId=(\d+)[^}]*uniqueId='[^']*scrcpy[^']*'[^}]*\}/g)];
    if (viewportMatches.length > 0) {
      // 取最后一个匹配（最新的虚拟屏）
      const id = parseInt(viewportMatches[viewportMatches.length - 1]![1]!, 10);
      console.log('[DEBUG-restore] getVirtualDisplayId: 从 mViewports 匹配到 scrcpy VIRTUAL display, id =', id);
      return id;
    }

    // 策略2: 解析 DisplayDeviceInfo + mDisplayId 配对
    // 格式: DisplayDeviceInfo{"scrcpy": ...FLAG_OWN_CONTENT_ONLY...} 后面跟 mDisplayId=N
    const lines = output.split('\n');
    let lastDeviceInfo = '';
    let lastDeviceDisplayId: number | null = null;

    // 收集所有 scrcpy display
    const scrcpyDisplays: Array<{
      id: number;
      hasOwnContent: boolean;
      hasTouchVirtual: boolean;
      isPrivate: boolean;
    }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      if (line.includes('DisplayDeviceInfo')) {
        lastDeviceInfo = line;
        lastDeviceDisplayId = null;
        // 在后续行中查找 mDisplayId
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          const idMatch = lines[j]!.match(/mDisplayId=(\d+)/);
          if (idMatch) {
            lastDeviceDisplayId = parseInt(idMatch[1]!, 10);
            break;
          }
          // 遇到下一个 DisplayDeviceInfo 就停止
          if (lines[j]!.includes('DisplayDeviceInfo')) break;
        }

        // 如果这个 DisplayDeviceInfo 是 scrcpy 且找到了 mDisplayId
        if (lastDeviceInfo.includes('scrcpy') && lastDeviceDisplayId !== null) {
          scrcpyDisplays.push({
            id: lastDeviceDisplayId,
            hasOwnContent: lastDeviceInfo.includes('FLAG_OWN_CONTENT_ONLY'),
            hasTouchVirtual: lastDeviceInfo.includes('touch VIRTUAL'),
            isPrivate: lastDeviceInfo.includes('FLAG_PRIVATE'),
          });
        }
      }
    }

    console.log('[DEBUG-restore] getVirtualDisplayId: 从 DisplayDeviceInfo 找到的 scrcpy displays =', JSON.stringify(scrcpyDisplays));

    // 按优先级选择: FLAG_OWN_CONTENT_ONLY > touch VIRTUAL > 非 PRIVATE > 兜底最后一个
    const ownContent = scrcpyDisplays.find(d => d.hasOwnContent);
    if (ownContent) {
      console.log('[DEBUG-restore] getVirtualDisplayId: 选择 FLAG_OWN_CONTENT_ONLY, id =', ownContent.id);
      return ownContent.id;
    }

    const touchVirtual = scrcpyDisplays.find(d => d.hasTouchVirtual);
    if (touchVirtual) {
      console.log('[DEBUG-restore] getVirtualDisplayId: 选择 touch VIRTUAL, id =', touchVirtual.id);
      return touchVirtual.id;
    }

    const nonPrivate = scrcpyDisplays.find(d => !d.isPrivate);
    if (nonPrivate) {
      console.log('[DEBUG-restore] getVirtualDisplayId: 选择非 PRIVATE, id =', nonPrivate.id);
      return nonPrivate.id;
    }

    const last = scrcpyDisplays[scrcpyDisplays.length - 1];
    if (last) {
      console.log('[DEBUG-restore] getVirtualDisplayId: 兜底选择最后一个, id =', last.id);
      return last.id;
    }

    console.log('[DEBUG-restore] getVirtualDisplayId: 未找到任何 scrcpy display');
    return null;
  } catch (error) {
    console.warn('[DEBUG-restore] 获取虚拟屏 displayId 失败:', error);
    return null;
  }
}

export async function startAppOnDisplay(adb: Adb, packageName: string, displayId: number): Promise<void> {
  try {
    const cmd = `am start --display ${displayId} ${packageName}`;
    console.log('[DEBUG-restore] startAppOnDisplay: 执行命令 =', cmd);
    const result = await runAdbCommand(adb, cmd);
    console.log('[DEBUG-restore] startAppOnDisplay: 命令结果 =', result);
  } catch (error) {
    console.warn('[DEBUG-restore] 在虚拟屏启动应用失败:', error);
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
