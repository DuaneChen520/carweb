import type { Adb } from '@yume-chan/adb';

export interface RotationState {
  accel: string | null;
  userRot: string | null;
}

async function runAdbCommand(adb: Adb, command: string | string[]): Promise<string> {
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
  const output = await runAdbCommand(adb, `dumpsys package ${pkg}`);
  for (const line of output.split('\n')) {
    const idx = line.indexOf('label=');
    if (idx === -1) continue;
    const val = line.substring(idx + 6).replace(/['"]/g, '').trim();
    const word = val.split(/[\s}]/)[0] || '';
    if (word && word !== 'null' && !word.startsWith('0x') && !/^\d+$/.test(word)) {
      return word;
    }
  }
  return formatPackageName(pkg);
}

export async function batchGetAppLabels(adb: Adb, packages: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const pkgSet = new Set(packages);

  try {
    const output = await runAdbCommand(adb, "dumpsys package | grep -E 'Package \\[|label='");
    let currentPkg = '';

    for (const line of output.split('\n')) {
      const pkgMatch = line.match(/Package \[([^\]]+)\]/);
      if (pkgMatch) {
        currentPkg = pkgMatch[1]!;
        continue;
      }

      if (currentPkg && pkgSet.has(currentPkg) && !labels.has(currentPkg)) {
        const idx = line.indexOf('label=');
        if (idx !== -1) {
          const val = line.substring(idx + 6).replace(/['"]/g, '').trim();
          const word = val.split(/[\s}]/)[0] || '';
          if (word && word !== 'null' && !word.startsWith('0x') && !/^\d+$/.test(word)) {
            labels.set(currentPkg, word);
          }
        }
      }
    }
  } catch (e) {
    console.error('[batchGetAppLabels] error:', e);
  }

  for (const pkg of packages) {
    if (!labels.has(pkg)) {
      labels.set(pkg, formatPackageName(pkg));
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

function formatPackageName(pkg: string): string {
  const segments = pkg.split('.');
  const last = segments[segments.length - 1];
  return last
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}
