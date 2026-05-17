# CarWeb - Agent 开发说明

## 项目定位

基于 `ya-webadb` 开源库构建的浏览器端 Android 屏幕镜像 Web 应用，核心场景是**车机浏览器通过 USB/WiFi 连接手机，创建自适应窗口尺寸的虚拟屏**。

## 核心依赖版本（关键）

| 包名 | 版本 | 用途 |
|------|------|------|
| `@yume-chan/adb-scrcpy` | ^2.3.2 | Scrcpy 客户端 |
| `@yume-chan/scrcpy` | ^2.3.0 | Scrcpy 协议定义 |
| `@yume-chan/scrcpy-decoder-webcodecs` | ^2.5.3 | WebCodecs 视频解码 |
| `@yume-chan/adb-daemon-webusb` | ^2.3.2 | WebUSB ADB 连接 |
| `@yume-chan/adb-credential-web` | ^2.1.0 | Web 端凭证存储 |
| `public/scrcpy-server.jar` | **v3.3.3** | 必须与服务端版本匹配 |

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
    └── useScrcpy.ts             # 屏幕镜像核心（推 server、启动 scrcpy、解码渲染）

useAdbStore.ts (Zustand)         # 全局状态：adb 实例、连接状态、设备信息
```

## 关键实现细节

### 1. USB 连接 (`useUsbConnection.ts`)

- 使用 `AdbDaemonWebUsbDeviceManager.BROWSER.requestDevice()` 获取设备
- 认证使用 `AdbDaemonTransport.authenticate()` + `AdbWebCredentialStore`
- 凭证 key 名称为 `'carweb-adb-key'`，存储在 IndexedDB

### 2. Scrcpy 启动流程 (`useScrcpy.ts`)

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
  audio: false,
  control: true,
  stayAwake: true,
  showTouches: true,
  displayId: 0,
})
```

### 3. 自适应虚拟屏 (`VirtualScreen.tsx`)

- 使用 `ResizeObserver` 监听容器尺寸变化
- 保持手机原始宽高比，以 `contain` 方式适配容器
- Canvas 尺寸通过 CSS `width/height` 动态计算，非 canvas 属性

### 4. 触摸事件转发

坐标转换链：
```
屏幕坐标 (clientX, clientY)
  → getBoundingClientRect 获取 canvas 渲染区域
  → 归一化为 0-1 相对坐标
  → 乘以 videoWidth/videoHeight 得到视频坐标
  → injectTouch 发送到手机
```

指针 ID 规则：鼠标固定为 `-1n`，触摸设备使用 `BigInt(e.pointerId)`。

### 5. WiFi 连接现状

当前 `useWifiConnection.ts` 中的 `connectWifi` 是**占位实现**，会抛出错误提示用户先通过 USB 开启 ADB over WiFi。完整实现需要：
- 通过 TCP Socket 连接 `IP:5555`
- 复用 `AdbDaemonTransport.authenticate()` 进行认证
- 或使用 ADB Server 中转模式

### 6. 网络检测 (`useNetworkCheck.ts`)

使用 `RTCPeerConnection` + `createDataChannel`  trick 获取本地 IP，用于：
- 显示本机 IP
- 判断是否处于热点环境（`192.168.43.x`、`172.20.10.x` 等网段）

## 已知限制与注意事项

1. **HTTPS 强制**：WebUSB 要求页面必须在 HTTPS 或 localhost 环境
2. **WiFi 首次需要 USB**：ADB over WiFi 必须先通过 USB 开启 `tcpip 5555`
3. **浏览器限制**：仅 Chrome/Edge 支持 WebUSB + WebCodecs
4. **server 版本锁定**：升级 `@yume-chan/adb-scrcpy` 时必须同步更新 `public/scrcpy-server.jar`
5. **开发服务器**：`vite dev` 默认 HTTP，WebUSB 在 localhost 可工作，外网访问需 HTTPS

## 扩展方向

- WiFi 连接完整实现（TCP 直连 ADB Daemon）
- 音频传输（`audio: true` + 音频解码器）
- 多显示器支持（`displayId` 切换）
- 键盘事件转发（`injectKeyCode`）
- 剪贴板同步
