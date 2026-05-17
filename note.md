# CarWeb 项目复盘

## 项目概述

基于 `ya-webadb` 开源库构建的浏览器端 Android 屏幕镜像 Web 应用，核心场景是**车机浏览器通过 USB/WiFi 连接手机，创建自适应窗口尺寸的虚拟屏**。

---

## 一、技术栈与核心依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| `@yume-chan/adb-scrcpy` | ^2.3.2 | Scrcpy 客户端 |
| `@yume-chan/scrcpy` | ^2.3.0 | Scrcpy 协议定义 |
| `@yume-chan/scrcpy-decoder-webcodecs` | ^2.5.3 | WebCodecs 视频解码 |
| `@yume-chan/adb-daemon-webusb` | ^2.3.2 | WebUSB ADB 连接 |
| `@yume-chan/adb-credential-web` | ^2.1.0 | Web 端凭证存储 |
| `zustand` | ^5.0.3 | 全局状态管理 |
| `tailwindcss` | ^3.4.17 | 样式框架 |
| `lucide-react` | ^0.511.0 | 图标库 |

> **关键教训**：`scrcpy-server.jar` 版本必须与客户端版本严格一致，否则会报 `scrcpy server exited prematurely`。

---

## 二、架构设计

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

---

## 三、核心实现收获

### 3.1 WebUSB 连接与 ADB 认证

```typescript
const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
const device = await manager.requestDevice();
const connection = await device.connect();

// 使用凭证管理器进行认证
const credentialManager = new AdbWebCredentialStore('carweb-adb-key');
const transport = await AdbDaemonTransport.authenticate({
  serial: device.serial,
  connection,
  credentialStore: credentialManager,
});

const adb = new Adb(transport);
```

**收获点**：
- WebUSB API 仅 Chrome/Edge 支持，且需要 HTTPS 或 localhost
- ADB 认证使用 RSA 密钥对，通过 `AdbWebCredentialStore` 存储在 IndexedDB
- 凭证 key 名称自定义为 `'carweb-adb-key'`，便于隔离管理

### 3.2 Scrcpy 启动流程

启动顺序：
1. `fetch('/scrcpy-server.jar')` 从 public 目录获取服务端 JAR
2. `AdbScrcpyClient.pushServer()` 推送到设备 `/data/local/tmp/scrcpy-server.jar`
3. `AdbScrcpyClient.start()` 启动 scrcpy 客户端
4. 获取 `videoStream` → 创建 `WebGLVideoFrameRenderer` → `WebCodecsVideoDecoder`
5. 手动 `pump()` 视频流到解码器

**关键配置**：
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

**收获点**：
- 使用动态导入 (`await import()`) 减少首屏加载体积
- `ReadableStream` 需要手动封装 `Uint8Array` 为流式数据
- 视频流通过 `getReader()` 手动 pump 到解码器，而非直接管道连接
- `WebGLVideoFrameRenderer` 利用 WebGL 进行高效 YUV→RGB 转换

### 3.3 自适应虚拟屏与 ResizeObserver

```typescript
const resizeObserver = new ResizeObserver((entries) => {
  const entry = entries[0];
  if (entry) {
    const { width, height } = entry.contentRect;
    setContainerSize({ width, height });
  }
});
resizeObserver.observe(container);
```

**自适应尺寸计算**（保持原始宽高比，contain 模式）：
```typescript
const videoAspect = videoWidth / videoHeight;
const containerAspect = containerSize.width / containerSize.height;

if (containerAspect > videoAspect) {
  renderHeight = containerSize.height;
  renderWidth = renderHeight * videoAspect;
} else {
  renderWidth = containerSize.width;
  renderHeight = renderWidth / videoAspect;
}
```

**收获点**：
- Canvas 渲染尺寸通过 CSS `width/height` 动态计算，非 canvas 属性
- 使用 `ResizeObserver` 而非 `window.resize` 事件，能精确监听元素尺寸变化
- `getBoundingClientRect()` 获取的是实际渲染尺寸，包含 CSS 变换后的值

### 3.4 触摸事件转发与坐标转换

坐标转换链：
```
屏幕坐标 (clientX, clientY)
  → getBoundingClientRect 获取 canvas 渲染区域
  → 归一化为 0-1 相对坐标
  → 乘以 videoWidth/videoHeight 得到视频坐标
  → injectTouch 发送到手机
```

**指针 ID 规则**：
- 鼠标固定为 `-1n`
- 触摸设备使用 `BigInt(e.pointerId)`

**动作映射**：
| 事件类型 | Scrcpy 动作 |
|---------|------------|
| pointerdown | `AndroidMotionEventAction.Down` |
| pointermove (按下) | `AndroidMotionEventAction.Move` |
| pointermove (悬停) | `AndroidMotionEventAction.HoverMove` |
| pointerup | `AndroidMotionEventAction.Up` |
| pointercancel | `AndroidMotionEventAction.Cancel` |

**收获点**：
- 使用 Pointer Events 统一处理鼠标和触摸，避免分别监听 mouse/touch
- `e.buttons` 表示当前按下的按钮状态，`e.button` 表示触发事件的按钮
- 压力值 `e.pressure` 在部分设备上可能为 0，需要 fallback 到 buttons 状态

### 3.5 网络检测与 RTCPeerConnection Trick

```typescript
const pc = new RTCPeerConnection({ iceServers: [] });
pc.createDataChannel('');
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);

await new Promise<void>((resolve) => setTimeout(resolve, 1000));

const sdp = pc.localDescription?.sdp;
const ipMatches = sdp.match(/(\d+\.\d+\.\d+\.\d+)/g);
```

**收获点**：
- 利用 WebRTC 的 ICE candidate gathering 过程获取本地 IP，无需外部服务
- 热点环境通常使用 `192.168.43.x` 或 `172.20.10.x` 网段，可据此判断连接模式
- `navigator.connection` API 可获取网络类型（wifi、cellular 等）

---

## 四、状态管理（Zustand）

```typescript
export const useAdbStore = create<AdbStore>((set) => ({
  ...initialState,
  setConnectionType: (type) => set({ connectionType: type }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setAdb: (adb) => set({ adb }),
  // ...
  reset: () => set(initialState),
}));
```

**收获点**：
- Zustand 的简洁 API 非常适合中小型项目，无需 Provider 包裹
- 将状态与操作分离到自定义 hooks（useUsbConnection、useWifiConnection），store 只负责原始状态
- `reset` 方法在断开连接时统一清理所有状态，避免遗漏

---

## 五、已知限制与踩坑记录

1. **HTTPS 强制**：WebUSB 要求页面必须在 HTTPS 或 localhost 环境
2. **WiFi 首次需要 USB**：ADB over WiFi 必须先通过 USB 开启 `tcpip 5555`
3. **浏览器限制**：仅 Chrome/Edge 支持 WebUSB + WebCodecs
4. **server 版本锁定**：升级 `@yume-chan/adb-scrcpy` 时必须同步更新 `public/scrcpy-server.jar`
5. **开发服务器**：`vite dev` 默认 HTTP，WebUSB 在 localhost 可工作，外网访问需 HTTPS

---

## 六、可扩展方向

- [ ] WiFi 连接完整实现（TCP 直连 ADB Daemon）
- [ ] 音频传输（audio: true + 音频解码器）
- [ ] 多显示器支持（displayId 切换）
- [ ] 键盘事件转发（injectKeyCode）
- [ ] 剪贴板同步

---

## 七、相关资源

- [ya-webadb GitHub](https://github.com/yume-chan/ya-webadb)
- [Scrcpy 官方文档](https://github.com/Genymobile/scrcpy)
- [WebUSB API](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API)
- [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)

---

*整理日期: 2026-05-18*
