# CarWeb - Agent 开发说明

## 项目定位

基于 `ya-webadb` 开源库构建的浏览器端 Android 屏幕镜像 Web 应用，核心场景是**车机浏览器通过 USB/WiFi 连接手机，创建自适应窗口尺寸的虚拟屏**。

## 核心依赖版本（关键）

| 包名 | 版本 | 用途 |
|------|------|------|
| `@yume-chan/adb-scrcpy` | **本地引用** | Scrcpy 客户端 |
| `@yume-chan/scrcpy` | **本地引用** | Scrcpy 协议定义 |
| `@yume-chan/media-codec` | **本地引用** | 媒体编解码支持 |
| `@yume-chan/scrcpy-decoder-webcodecs` | ^2.5.3 | WebCodecs 视频解码 |
| `@yume-chan/adb-daemon-webusb` | ^2.3.2 | WebUSB ADB 连接 |
| `@yume-chan/adb-credential-web` | ^2.1.0 | Web 端凭证存储 |
| `public/scrcpy-server.jar` | **v4.0** | 必须与 scrcpy 协议版本匹配 |

> **版本匹配是首要问题**：`scrcpy-server.jar` 版本必须与 `AdbScrcpyOptionsLatest` 客户端版本严格一致，否则会报 `scrcpy server exited prematurely`。

## 架构概览

```
App.tsx
├── ConnectionPanel.tsx          # 连接选择 UI（USB/WiFi 标签页）
│   ├── useUsbConnection.ts      # WebUSB 连接逻辑
│   ├── useWifiConnection.ts     # WiFi 连接逻辑（含局域网扫描）
│   └── useNetworkCheck.ts       # 网络环境检测（RTCPeerConnection 获取 IP）
│
└── VirtualScreen.tsx            # 虚拟屏显示 + 触摸转发
    └── ScrcpyContext             # Context Provider
        └── useScrcpySession     # 屏幕镜像核心（编排器）
            ├── useVideoDecoder  # 视频流处理
            ├── useAudioDecoder  # 音频流处理
            ├── useInputInjector # 触摸/文本/按键注入
            └── useAppManager    # 应用列表/标签/图标

useAdbStore.ts (Zustand)         # 全局状态：adb 实例、连接状态、设备信息
lib/adb-commands.ts              # ADB 命令抽象层
```

## 关键实现细节

### 1. 本地 ya-webadb 引用

项目使用本地修改的 `@yume-chan/scrcpy`、`@yume-chan/adb-scrcpy` 和 `@yume-chan/media-codec` 包，位于 `ya-webadb-main/libraries/` 目录。

**重要**：修改 scrcpy 协议时，需要：
1. 修改 `ya-webadb-main/libraries/scrcpy/src/` 下的源码
2. 同步修改 `ya-webadb-main/libraries/adb-scrcpy/src/` 下的对应文件
3. 确保 TypeScript 类型检查通过

### 2. Scrcpy 4.0 Flex Display 支持

已实现 scrcpy 4.0 的 flex display 功能，允许动态调整虚拟屏分辨率：

- **控制消息类型**：`TYPE_RESIZE_DISPLAY = 18`
- **消息格式**：`type(1B) + width(4B) + height(4B) + dpi(4B)` = 13 bytes
- **使用方式**：`resizeDisplay(width, height, dpi)` 方法

### 3. USB 连接 (`useUsbConnection.ts`)

- 使用 `AdbDaemonWebUsbDeviceManager.BROWSER.requestDevice()` 获取设备
- 认证使用 `AdbDaemonTransport.authenticate()` + `AdbWebCredentialStore`
- 凭证 key 名称为 `'carweb-adb-key'`，存储在 IndexedDB

### 4. Scrcpy 启动流程 (`useScrcpySession.ts`)

启动顺序：
1. `fetch('/scrcpy-server.jar')` 从 public 目录获取服务端 JAR
2. `AdbScrcpyClient.pushServer()` 推送到设备 `/data/local/tmp/scrcpy-server.jar`
3. `AdbScrcpyClient.start()` 启动 scrcpy 客户端
4. 获取 `videoStream` → 创建 `WebGLVideoFrameRenderer` → `WebCodecsVideoDecoder`
5. 手动 `pump()` 视频流到解码器

关键配置项：
```typescript
new AdbScrcpyOptionsLatest({
  video: true,
  videoCodec: 'h264',      // 字符串，非枚举
  videoBitRate: 8000000,
  maxFps: 60,
  audio: true,
  audioCodec: 'opus',
  audioSource: 'output',
  control: true,
  stayAwake: true,
  showTouches: true,
  flexDisplay: true,        // scrcpy 4.0: 启用动态调整
  newDisplay: new ScrcpyNewDisplay(width, height, dpi),
  captureOrientation: ScrcpyCaptureOrientation.Unlocked,
})
```

### 5. 自适应虚拟屏 (`VirtualScreen.tsx`)

- 使用 `ResizeObserver` 监听容器尺寸变化
- 保持手机原始宽高比，以 `contain` 方式适配容器
- Canvas 尺寸通过 CSS `width/height` 动态计算，非 canvas 属性
- 窗口 resize 时自动发送 resize 请求到设备

### 6. 触摸事件转发

坐标转换链：
```
屏幕坐标 (clientX, clientY)
  → getBoundingClientRect 获取 canvas 渲染区域
  → 归一化为 0-1 相对坐标
  → 乘以 videoWidth/videoHeight 得到视频坐标
  → injectTouch 发送到手机
```

指针 ID 规则：鼠标固定为 `-1n`，触摸设备使用 `BigInt(e.pointerId)`。

### 7. WiFi 连接现状

当前 `useWifiConnection.ts` 中的 `connectWifi` 是**占位实现**，会抛出错误提示用户先通过 USB 开启 ADB over WiFi。完整实现需要：
- 通过 TCP Socket 连接 `IP:5555`
- 复用 `AdbDaemonTransport.authenticate()` 进行认证
- 或使用 ADB Server 中转模式

### 8. 网络检测 (`useNetworkCheck.ts`)

使用 `RTCPeerConnection` + `createDataChannel` trick 获取本地 IP，用于：
- 显示本机 IP
- 判断是否处于热点环境（`192.168.43.x`、`172.20.10.x` 等网段）

## 已知限制与注意事项

1. **HTTPS 强制**：WebUSB 要求页面必须在 HTTPS 或 localhost 环境
2. **WiFi 首次需要 USB**：ADB over WiFi 必须先通过 USB 开启 `tcpip 5555`
3. **浏览器限制**：仅 Chrome/Edge 支持 WebUSB + WebCodecs
4. **server 版本锁定**：升级本地包时必须同步更新 `public/scrcpy-server.jar`
5. **开发服务器**：`vite dev` 默认 HTTP，WebUSB 在 localhost 可工作，外网访问需 HTTPS
6. **本地包 workspace 协议**：本地包使用 `workspace:^` 协议，npm 安装时需先替换为普通版本号

## 开发命令

```bash
# 开发
npm run dev          # 启动开发服务器

# 构建
npm run build        # 构建生产版本

# 检查
npm run check        # TypeScript 类型检查
npm run lint         # ESLint 检查
```

## 扩展方向

- WiFi 连接完整实现（TCP 直连 ADB Daemon）
- 多显示器支持（`displayId` 切换）
- 键盘事件转发（`injectKeyCode`）
- 剪贴板同步
- scrcpy 4.0 flex display 完整集成（窗口 resize 自动调整）
