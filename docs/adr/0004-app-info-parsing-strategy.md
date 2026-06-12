# ADR-0004: 应用信息解析策略（APK 解析获取名称与图标）

通过 `app-info-parser` 在浏览器端解析 APK 文件获取应用名称和图标，采用串行解析 + IndexedDB 持久化 + 内存峰值保护，避免依赖 ADB `pm dump` 的文本解析且支持跨会话复用。

## 状态

已采纳

## 日期

2026-06-13

## 背景

需要获取已安装应用的名称和图标用于展示。`ya-webadb` 的 `PackageManager` 只能获取包名和 APK 路径，无法解析 `AndroidManifest.xml` 中的 `label` 和资源文件中的图标。

## 决策

### 解析库

使用 `app-info-parser` 的 `ApkParser`，它解析 ZIP 中央目录后只提取 `AndroidManifest.xml`、`resources.arsc` 和图标文件，不全量解压。

### 数据传输

ADB sync 是文件级操作，无法按 ZIP 条目偏移量读取，因此必须全量下载 APK 到浏览器内存，再由 `app-info-parser` 做部分解析。

### 内存管理

- **峰值限制**：`navigator.deviceMemory / 4`（fallback 4GB）
- **估算模型**：APK 文件大小 = 内存占用
- **超限处理**：APK 大小 > 峰值限制 → 跳过解析，显示包名

### 解析策略

- **串行解析**：一次只解析一个应用，避免内存峰值叠加
- **排序**：按 APK 大小升序，小型应用优先，大型应用最后
- **持久化**：IndexedDB 存储 `{ packageName, label, iconBase64, versionCode, lastParsed }`，`versionCode` 变化时重新解析

## 被否方案

| 方案 | 原因 |
|------|------|
| `pm dump <package>` 获取应用名 | 文本解析脆弱，无法获取图标 |
| 流式 ZIP 解析（只读中央目录 + 条目） | ADB sync 不支持按偏移量读取，必须全量传输 |
| 队列并发解析 | 复杂度高，串行已满足车机场景（50-100 应用） |
| `localStorage` 持久化 | 5MB 限制，不适合存储图标 base64 |

## 影响

- 首次连接需逐应用下载解析，耗时与应用数量正相关
- 后续连接命中 IndexedDB 缓存，仅 `versionCode` 变化的应用需重新解析
- 超大 APK（> 峰值限制）跳过解析，用户看到包名而非应用名

## 关联

- `CONTEXT.md` — 应用信息解析术语定义
- `app-info-parser` npm 包
- `src/lib/adb-commands.ts` — ADB sync 读取 APK
