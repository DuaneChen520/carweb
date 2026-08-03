# Quick DEX First Architecture

## 目标

侧边栏在页面刷新后立即从本地缓存加载，不依赖 ADB 连接。Quick DEX 提供排序骨架，Full DEX 提供显示皮肤。

## 核心流程

```
页面加载
  └─ 读取 IndexedDB device-apps 表 → 排序显示侧边栏

ADB 连接后
  ├─ Quick DEX → 包名 + 版本号 + 启动次数
  ├─ 写入 device-apps 表 → 刷新侧边栏
  └─ 后台 Full DEX → 标签 + 图标
       └─ 写入 app-info-cache 表 → 刷新侧边栏
```

## IndexedDB 表结构

### device-apps 表（新建）

存储 Quick DEX 结果 + 浏览器端统计 + 置顶标识。

```typescript
interface DeviceAppRecord {
  packageName: string;      // 主键
  versionCode: number;      // Quick DEX：应用版本号
  launchCount: number;      // Quick DEX：设备端累计启动次数
  localCount: number;       // 浏览器端：本地启动次数
  pinned: boolean;          // 是否置顶
  pinOrder: number;         // 置顶排序（未置顶为 -1）
  lastSynced: number;       // Quick DEX 同步时间戳
}
```

关键操作：
- `getAll()`: 读取所有记录（侧边栏排序用）
- `setAll(records)`: Quick DEX 完成后全量覆盖写入
- `updateLocalCount(pkg, count)`: 启动应用时更新 localCount
- `togglePin(pkg)`: 切换置顶状态
- `getPinnedApps()`: 获取置顶应用列表（按 pinOrder 排序）

### app-info-cache 表（保持不变）

存储 Full DEX 结果（标签 + 图标）。

```typescript
interface AppInfo {
  packageName: string;      // 主键
  label: string | null;     // 应用名称
  iconBase64: string | null; // 应用图标（base64）
  versionCode: number;      // 版本号
  lastParsed: number;       // 解析时间戳
}
```

## 侧边栏数据来源

```
侧边栏 = device-apps（排序骨架）+ app-info-cache（显示皮肤）
```

读取逻辑：
1. 从 `device-apps` 读取所有记录
2. 按三层排序：置顶 → 常用（localCount > 0）→ 其他
3. 对每个包名，从 `app-info-cache` 读取 label/icon
4. 有 label/icon → 显示完整应用；无 → 显示包名占位符

## 排序逻辑

```typescript
function sortDeviceApps(apps: DeviceAppRecord[]): DeviceAppRecord[] {
  const pinned = apps.filter(a => a.pinned).sort((a, b) => b.pinOrder - a.pinOrder);
  const frequent = apps.filter(a => !a.pinned && a.localCount > 0)
    .sort((a, b) => b.localCount - a.localCount);
  const other = apps.filter(a => !a.pinned && a.localCount === 0)
    .sort((a, b) => b.launchCount - a.launchCount);
  return [...pinned, ...frequent, ...other];
}
```

## 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src/lib/device-apps-store.ts` | 新建：device-apps 表的 CRUD 操作 |
| `src/lib/app-info-service.ts` | Quick DEX 结果写入 device-apps 表 |
| `src/hooks/useAppPreferences.ts` | 简化：不再维护 launch-counts 和 pinned 表 |
| `src/components/ControlSidebar.tsx` | 从 device-apps + app-info-cache 读取数据 |
| `src/hooks/scrcpy/useScrcpySession.ts` | 调整同步流程 |

## 同步流程

### 首次连接

```
1. ADB 连接成功
2. 运行 Quick DEX → 获取包名 + 版本号 + 启动次数
3. 写入 device-apps 表（全量覆盖）
4. 刷新侧边栏
5. 后台运行 Full DEX → 获取标签 + 图标
6. 写入 app-info-cache 表
7. 刷新侧边栏（标签/图标更新）
```

### 页面刷新后（已有缓存）

```
1. 页面加载 → 从 device-apps 读取缓存 → 立即显示侧边栏
2. ADB 连接成功
3. 运行 Quick DEX → 对比缓存版本号
4. 更新 device-apps 表 → 刷新侧边栏
5. 后台运行 Full DEX → 仅解析版本不一致的应用
6. 写入 app-info-cache 表 → 刷新侧边栏
```

## 移除的内容

- `src/lib/user-preferences-store.ts`: 移除 `launch-counts` 和 `pinned` 表（合并到 device-apps）
- `src/hooks/useAppPreferences.ts`: 简化或移除
- `src/components/ControlSidebar.tsx`: 移除 `getAppList` 调用
- `src/lib/adb-commands.ts`: `getInstalledPackages` 保留但侧边栏不再使用

## 验证标准

1. 页面刷新后，侧边栏立即显示上次的应用列表（从 device-apps 缓存）
2. ADB 连接后，侧边栏自动更新（Quick DEX 结果）
3. Full DEX 完成后，侧边栏显示完整标签和图标
4. 启动应用后，localCount +1，侧边栏重新排序
5. 置顶/取消置顶后，侧边栏立即更新
