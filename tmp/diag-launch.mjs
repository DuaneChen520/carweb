// src/lib/adb-commands.ts
async function runAdbCommand(adb, command) {
  if (adb.subprocess.shellProtocol) {
    const cmd = Array.isArray(command) ? command.join(" ") : command;
    const result = await adb.subprocess.shellProtocol.spawnWaitText(cmd);
    return result.stdout.trim();
  } else {
    const args = Array.isArray(command) ? ["sh", "-c", `${command.join(" ")} 2>&1`] : ["sh", "-c", `${command} 2>&1`];
    const result = await adb.subprocess.noneProtocol.spawnWaitText(args);
    return result.trim();
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function isPackageRunning(adb, packageName) {
  try {
    const output = await runAdbCommand(adb, `pidof ${packageName} 2>/dev/null || true`);
    return output.trim().length > 0;
  } catch {
    return false;
  }
}
async function getAppDisplayLocations(adb, packageName) {
  try {
    const output = await runAdbCommand(adb, "dumpsys activity activities");
    const lines = output.split("\n");
    let cur = null;
    const found = [];
    for (const line of lines) {
      const dh = line.match(/Display #(\d+)/);
      if (dh) {
        cur = parseInt(dh[1], 10);
        continue;
      }
      if (line.includes(packageName) && cur !== null) {
        if (!found.includes(cur)) found.push(cur);
      }
    }
    return found;
  } catch {
    return [];
  }
}
async function resolveLauncherComponent(adb, pkg) {
  try {
    const r = (await runAdbCommand(adb, [
      "cmd",
      "package",
      "resolve-activity",
      "--brief",
      "-a",
      "android.intent.action.MAIN",
      "-c",
      "android.intent.category.LAUNCHER",
      pkg
    ])).trim();
    const line = r.split("\n").map((l) => l.trim()).filter(Boolean).find((l) => l.includes("/"));
    if (line && !/no activity found|unable to resolve/i.test(line)) return line;
  } catch {
  }
  try {
    const d = await runAdbCommand(
      adb,
      `dumpsys package ${pkg} 2>/dev/null | grep -A5 "android.intent.action.MAIN" | grep -oE "${pkg}/[A-Za-z0-9_.]+" | head -1 || true`
    );
    const c = d.trim();
    if (c) return c;
  } catch {
  }
  return null;
}
async function getAppTaskId(adb, pkg) {
  try {
    const out = await runAdbCommand(
      adb,
      `dumpsys activity activities 2>/dev/null | grep -E "Task\\{[^}]*${pkg}" | grep -oE "#[0-9]+" | head -1 | tr -d '#' || true`
    );
    const t = out.trim();
    return t ? parseInt(t, 10) : null;
  } catch {
    return null;
  }
}
async function startAppOnDisplay(adb, packageName, displayId) {
  try {
    const component = await resolveLauncherComponent(adb, packageName);
    console.log(`[launch-diag] resolve \u7EC4\u4EF6(${packageName}): ${component ?? "\u672A\u89E3\u6790\uFF08\u7528\u9690\u5F0F intent \u515C\u5E95\uFF09"}`);
    const buildStart = (comp, disp) => {
      const d = disp !== null ? `--display ${disp} ` : "";
      if (comp) return `am start -W ${d}-n ${comp}`;
      return `am start -W ${d}-a android.intent.action.MAIN -c android.intent.category.LAUNCHER ${packageName}`;
    };
    let cmd = buildStart(component, displayId);
    try {
      await runAdbCommand(adb, "logcat -c 2>/dev/null || true");
    } catch {
    }
    console.log(`[launch-diag] \u6267\u884C(\u7B56\u75651 \u76F4\u6295\u865A\u62DF\u5C4F): ${cmd}`);
    let out = await Promise.race([runAdbCommand(adb, cmd), sleep(8e3).then(() => "__TIMEOUT__")]);
    console.log(`[launch-diag] \u7B56\u75651 \u8F93\u51FA:
${out.trim()}`);
    await sleep(2e3);
    let running = await isPackageRunning(adb, packageName);
    let loc = await getAppDisplayLocations(adb, packageName);
    console.log(`[launch-diag] \u7B56\u75651 \u540E \u8FDB\u7A0B\u5B58\u6D3B:${running ? "\u662F" : "\u5426"} display\u5206\u6BB5:${loc.length ? loc.join(", ") : "\u65E0"}`);
    if (component && (!running || !loc.includes(displayId))) {
      console.warn(`[launch-diag] \u7B56\u75651 \u672A\u843D\u5230\u865A\u62DF\u5C4F\uFF0C\u542F\u7528\u7B56\u75652(\u4E3B\u5C4F\u542F\u52A8+\u642C\u8FD0\u4EFB\u52A1)`);
      cmd = buildStart(component, null);
      console.log(`[launch-diag] \u6267\u884C(\u7B56\u75652 \u4E3B\u5C4F): ${cmd}`);
      out = await Promise.race([runAdbCommand(adb, cmd), sleep(8e3).then(() => "__TIMEOUT__")]);
      console.log(`[launch-diag] \u7B56\u75652 \u8F93\u51FA:
${out.trim()}`);
      await sleep(2500);
      const taskId = await getAppTaskId(adb, packageName);
      if (taskId !== null) {
        console.log(`[launch-diag] \u7B56\u75652 \u627E\u5230 taskId=${taskId}\uFF0C\u642C\u8FD0\u5230 display#${displayId}`);
        const mv = await runAdbCommand(adb, `am task ${taskId} move-to-display ${displayId} 2>/dev/null || true`);
        console.log(`[launch-diag] move-to-display \u8F93\u51FA: ${mv.trim()}`);
      } else {
        console.warn(`[launch-diag] \u7B56\u75652 \u672A\u627E\u5230 ${packageName} \u7684 taskId`);
      }
      await sleep(1500);
      running = await isPackageRunning(adb, packageName);
      loc = await getAppDisplayLocations(adb, packageName);
    }
    if (!running && loc.length === 0) {
      console.warn(`[launch-diag] \u26A0\uFE0F \u4E24\u7B56\u7565\u5747\u5931\u8D25\uFF1A\u8FDB\u7A0B\u672A\u5B58\u6D3B\u4E14\u4E0D\u5728\u4EFB\u4F55 display`);
      const crash = await runAdbCommand(adb, `logcat -b main -b system -b crash -d 2>/dev/null | grep -iE "${packageName}|FATAL EXCEPTION|AndroidRuntime|am_anr|signal |tombstone|SecurityException|EGL|GL " | tail -50 || true`);
      if (crash.trim()) console.log(`[launch-diag] \u6E05\u5C4F\u540E\u65B0\u65E5\u5FD7:
${crash}`);
      else console.log(`[launch-diag] \u6E05\u5C4F\u540E\u65E0\u4EFB\u4F55\u76F8\u5173\u65E5\u5FD7`);
    } else if (!loc.includes(displayId)) {
      if (loc.includes(0)) console.warn(`[launch-diag] \u26A0\uFE0F \u6700\u7EC8\u843D\u5728\u4E3B\u5C4F(display#0) \u2192 \u767D\u5C4F\uFF08ROM \u7981\u6B62\u8BE5\u5E94\u7528\u8FDB\u5165\u865A\u62DF\u5C4F\uFF09`);
      else console.warn(`[launch-diag] \u26A0\uFE0F \u6700\u7EC8\u843D\u5728\u975E\u76EE\u6807 display: ${loc.join(", ")}`);
    } else {
      console.log(`[launch-diag] \u2705 ${packageName} \u5DF2\u843D\u5728\u76EE\u6807 display#${displayId}\uFF08\u82E5\u4ECD\u767D\u5C4F\u5219\u5C5E H2: \u6E32\u67D3\u9762\u672A\u6355\u83B7\uFF09`);
    }
  } catch (error) {
    console.warn("[DEBUG-restore] \u5728\u865A\u62DF\u5C4F\u542F\u52A8\u5E94\u7528\u5931\u8D25:", error);
  }
}

// _diag_launch.ts
function makeMockAdb(handler) {
  const log = [];
  const adb = {
    subprocess: {
      shellProtocol: {
        async spawnWaitText(cmd) {
          log.push(cmd);
          return { stdout: handler(cmd) };
        }
      }
    }
  };
  return { adb, log };
}
var PKG = "com.example.app";
var VDISP = 3;
function resolve(cmd) {
  if (cmd.includes("resolve-activity") && cmd.includes("LAUNCHER")) return `${PKG}/.MainActivity`;
  if (cmd.includes("resolve-activity") && cmd.includes("HOME")) return "com.android.launcher/.Launcher";
  return "";
}
function romHonorsDisplay(cmd) {
  const r = resolve(cmd);
  if (r) return r;
  if (cmd.startsWith("am start")) return "Starting: Intent ...\n";
  if (cmd.startsWith("pidof")) return "12345";
  if (cmd.includes("dumpsys activity activities")) {
    return `Display #0 (activities):
  mResumedActivity ...
Display #${VDISP} (activities):
  * Hist #1: ActivityRecord{${PKG}/.MainActivity}
`;
  }
  if (cmd.startsWith("am task")) return "";
  if (cmd.startsWith("logcat")) return "";
  return "";
}
function romIgnoresDisplay(cmd) {
  const r = resolve(cmd);
  if (r) return r;
  if (cmd.startsWith("am start")) return "Starting: Intent ...\n";
  if (cmd.startsWith("pidof")) return "12345";
  if (cmd.includes("dumpsys activity activities")) {
    return `Display #0 (activities):
  * Hist #1: ActivityRecord{${PKG}/.MainActivity}
Display #${VDISP} (activities):
  (empty)
`;
  }
  if (cmd.startsWith("am task")) return "move-to-display done";
  if (cmd.startsWith("logcat")) return "";
  return "";
}
async function runScenario(label, handler) {
  const { adb, log } = makeMockAdb(handler);
  console.log(`
===== \u573A\u666F ${label} =====`);
  await startAppOnDisplay(adb, PKG, VDISP);
  console.log("\u547D\u4EE4\u5E8F\u5217:");
  log.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
  const moved = log.some((c) => c.startsWith("am task") && c.includes("move-to-display"));
  console.log(`
\u5224\u5B9A: ${moved ? "\u26A0\uFE0F \u89E6\u53D1\u7B56\u75652 \u2192 \u5E94\u7528\u5148\u5728\u4E3B\u5C4F\u51FA\u73B0\u3001\u518D\u88AB move-to-display \u642C\u5230\u865A\u62DF\u5C4F\uFF08\u4E00\u6B21\u53EF\u89C1\u8DF3\u8F6C\uFF09" : "\u2705 \u7B56\u75651 \u76F4\u6295\u6210\u529F\uFF0C\u65E0\u642C\u8FD0\u8DF3\u8F6C"}`);
  return moved;
}
(async () => {
  const a = await runScenario("A (ROM \u652F\u6301 --display)", romHonorsDisplay);
  const b = await runScenario("B (ROM \u5FFD\u7565 --display)", romIgnoresDisplay);
  console.log("\n===== \u5FAA\u73AF\u7ED3\u8BBA =====");
  console.log(`\u7B56\u75652 \u53CC\u5C4F\u642C\u8FD0\u51FA\u73B0\u6B21\u6570: ${[a, b].filter(Boolean).length}/2`);
  if (b) console.log("\u786E\u8BA4\uFF1A\u5F53 --display \u88AB ROM \u5FFD\u7565\u65F6\uFF0CstartAppOnDisplay \u5FC5\u7136\u4EA7\u751F\u300C\u4E3B\u5C4F\u2192\u865A\u62DF\u5C4F\u300D\u7684\u53EF\u89C1\u8DF3\u8F6C\u3002");
})();
