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

### DPI 缩放补偿（devicePixelRatio Compensation）
虚拟屏分辨率计算时自动乘以 `window.devicePixelRatio`，以充分利用高分屏（HiDPI/Retina）的物理像素密度：
- 车机浏览器（DPR=1）：无影响，行为不变
- Windows 200% 缩放（DPR=2）：分辨率翻倍，画面更锐利
- macOS Retina（DPR=2）：同样受益

DPI 值也同步乘以 DPR，保证 Android UI 控件在不同缩放比例下的物理阅读尺寸一致。
码率与像素总数成正比：以 1080p×8Mbps 为基准等比计算（1Mbps~40Mbps 限幅）。