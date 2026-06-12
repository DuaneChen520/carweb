# CarWeb 项目术语表

## 术语定义

### 虚拟屏（Virtual Display / `newDisplay`）
使用 Scrcpy `newDisplay` 参数在手机上创建一个全新的虚拟显示屏，而非镜像物理屏幕。尺寸由车机浏览器窗口尺寸决定。

### 镜像模式（Mirror Mode）
直接镜像手机物理屏幕，不创建新的虚拟显示屏。

### 分辨率"翻转"问题
当前问题：当虚拟屏以 **800×600（4:3 横向）** 创建后，某些 Android 应用（如 Launcher）启动后会**请求竖屏方向**，导致虚拟屏显示内容旋转为 **600×800（3:4 纵向）**。 
- **窗口/容器尺寸**（车机浏览器侧）不变，仍为 800×600
- **scrcpy 视频流**报告的 `videoWidth`/`videoHeight` 翻转
- **Canvas 渲染区域**重新计算适配，导致在 800×600 容器内出现 3:4 竖屏画面

**解决方案**：使用 `captureOrientation: LockedInitial` 锁定视频捕捉方向。

### `ScrcpyCaptureOrientation`
Scrcpy 3.x 新增的选项（替代旧的 `lockVideoOrientation`），控制视频流的捕捉方向。可选值：
- `LockedInitial` (`@`): 锁定到**初始捕捉方向**。即使设备/屏幕旋转，视频流始终保持最初的方向
- `LockedValue` + `Orient0` (`@0`): 锁定到**0°方向**
- `Unlocked`: 不锁定，跟随设备/屏幕旋转

### `ScrcpyNewDisplay`
虚拟屏尺寸描述，option 值为 `{width}x{height}/{dpi}` 格式（如 `800x600/320`）。

### 分辨率预设（Resolution Preset）
用户可选的虚拟屏画质档位，在保持窗口宽高比的前提下按比例缩放：
- **原画（Original）**: 1x 缩放，跟随浏览器窗口分辨率
- **超清（Ultra）**: ~0.75x 缩放，轻微减负
- **高清（HD）**: ~0.5x 缩放，明显减负
- **流畅（Smooth）**: ~0.25x 缩放，极致减负

### Smallest Width（sw）
Android 概念，指设备可用屏幕区域在宽度和高度两个维度中的较小值（以 dp 为单位）：
```
sw(dp) = min(width_px, height_px) × 160 / dpi
```
应用通过 sw 来判断设备尺寸类别。标准大屏阈值为 `sw ≥ 600dp`，超过该值的设备被视为平板/可折叠大屏，触发响应式布局。

### sw 锚点 DPI 计算
虚拟屏的 DPI 不再使用固定基数乘以倍率，而是以目标 sw 值（600dp）为锚点反向计算：
```
dpi = min(width, height) × 160 / 600
```
这样保证任意分辨率下应用的 sw 判定一致，均达到大屏阈值。

### DPR 与 DPI 解耦
`window.devicePixelRatio`（DPR）会影响分辨率宽高（w/h），但 DPI 由 sw 公式自动响应：DPR 翻倍 → w/h 翻倍 → DPI 翻倍 → sw 不变。跨设备（不同 DPR）下 sw 表现一致，无需额外补偿。

### 码率计算
码率与像素总数成正比：以 1080p×8Mbps 为基准等比计算（1Mbps~40Mbps 限幅）。

### 应用信息解析（App Info Parsing）
通过 ADB 从 Android 设备获取应用名称和图标的机制。

**解析流程**：
1. 通过 `adb.sync().read()` 全量下载 APK 文件到浏览器
2. 使用 `app-info-parser` 的 `ApkParser` 部分解析（AndroidManifest.xml + resources.arsc + 图标）
3. 解析结果持久化到 IndexedDB，避免重复解析

**内存管理**：
- **峰值限制**：车机内存的 1/4（通过 `navigator.deviceMemory` 获取，fallback 到 4GB）
- **估算模型**：APK 文件大小 = 内存占用
- **超限处理**：单个应用 APK 大小 > 峰值限制 → 跳过解析，显示包名

**解析策略**：
- **串行解析**：一次只解析一个应用，避免内存峰值叠加
- **排序优化**：小型应用优先解析（按 APK 大小升序），大型应用最后
- **进度反馈**：实时显示解析进度（已解析/总数）

**持久化存储**：
- **存储位置**：IndexedDB（以 `packageName` 为 key）
- **存储内容**：`{ packageName, label, iconBase64, versionCode, lastParsed }`
- **失效策略**：`versionCode` 变化时重新解析