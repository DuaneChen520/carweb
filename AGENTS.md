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
App.tsx                              # 入口，ConnectionPanel ↔ VirtualScreen 切换
├── src/components/
│   ├── ConnectionPanel.tsx          # 连接选择 UI（USB/WiFi 标签页）
│   ├── ControlSidebar.tsx           # 虚拟屏控制栏（含 app grid + 解析进度条）
│   └── VirtualScreen.tsx            # 虚拟屏显示 + 触摸转发
│
├── src/hooks/
│   ├── useAdbStore.ts               # Zustand 全局状态：adb 实例、连接状态、设备信息
│   ├── useUsbConnection.ts          # WebUSB 连接逻辑
│   ├── useWifiConnection.ts         # WiFi 连接逻辑
│   ├── useNetworkCheck.ts           # 网络环境检测（RTCPeerConnection 获取 IP）
│   ├── useScrcpy.ts                 # 重导出 → ./scrcpy（旧路径兼容）
│   └── scrcpy/                      # Scrcpy 会话模块化拆分
│       ├── useScrcpySession.ts      # 核心会话管理（推 server、启动、解码渲染）
│       ├── useVideoDecoder.ts       # WebGL 视频解码器
│       ├── useAudioDecoder.ts       # 音频解码器
│       ├── useInputInjector.ts      # 触摸/按键事件注入
│       └── useAppManager.ts         # 应用列表、图标、启停
│
├── src/contexts/
│   └── ScrcpyContext.tsx            # Scrcpy 会话 Context（暴露给 VirtualScreen）
│
├── src/lib/
│   ├── adb-commands.ts              # ADB shell 命令封装
│   ├── apk-parser.ts               # APK 解析（app-info-parser + 自定义 fallback）
│   ├── app-info-service.ts          # 应用信息获取服务（带 cache + 日志）
│   ├── app-info-cache.ts           # IndexedDB 缓存层
│   ├── zip-reader.ts               # ZIP 文件条目提取器（低层，浏览器原生）
│   └── ipa-stub.ts                 # app-info-parser CJS require('./ipa') 的 esbuild 编译期 stub
│
└── src/utils/
    ├── display.ts                   # 虚拟屏分辨率/DPI 计算
    ├── presets.ts                   # 分辨率预设定义
    ├── binary-xml.ts               # 二进制 XML 解析（DataView + TextDecoder，正确支持 UTF-8/UTF-16）
    └── resources-arsc.ts           # resources.arsc 解析（用于解析资源引用 @string/app_name）
```

### app-info-parser 兼容层（`ipa-stub.ts` + `vite.config.ts`）

**问题：** `app-info-parser` → `index.js` → `require('./ipa')` → `cgbi-to-png` → `streamifier` → Node.js `util`/`stream`/`zlib`，浏览器不可用。

**解决方案（双层截获）：**
1. **Dev（esbuild pre-bundle）：** `optimizeDeps.esbuildOptions.plugins` 中 `onResolve({ filter: /^\.\/ipa$/ })` → `{ path: '/absolute/path/to/ipa-stub.ts', namespace: 'file' }`
2. **Prod/build（Rollup）：** `resolve.alias` → `{ './ipa': '/absolute/path/to/ipa-stub.ts' }`

`ipa-stub.ts` 内容：空导出，只用于通过编译，app-info-parser 中实际 IPA 解码逻辑不会被调用。

### APK 标签/图标提取双路径

| 路径 | 函数 | 原理 | 适用场景 |
|------|------|------|----------|
| **新路径（主）** | `parseAllApps` → `parseApk` | 下载 APK → `app-info-parser`（含图标提取）+ 自定义 fallback（标签） | 首次批量解析 |
| **旧路径（备）** | `batchGetAppLabels` → `extractAppMeta` | ADB `aapt dump` / `pm path` + `pm dump`（无图标） | 快速获取包名列表 |

`parseAllApps` 先走 IndexedDB 缓存（对比 `versionCode`），未命中则下载 APK 解析，结果写回缓存。

### 标签 fallback 机制

当 `app-info-parser` 返回 `label: null` 时（常见于中文 app 名），`parseApk` 自动回退到自定义解析：

1. `zip-reader.ts` 从 APK ArrayBuffer 中提取 `AndroidManifest.xml`
2. `binary-xml.ts` 解析二进制 XML，提取 `<application android:label>` 属性
3. 若标签为资源引用（`@string/app_name` → 数字 ID），再用 `zip-reader.ts` 提取 `resources.arsc`
4. `resources-arsc.ts` 解析资源表，根据 package ID + type ID + entry index 查到实际字符串

## 常用命令

```bash
npm run dev          # Vite 开发服务器（localhost:5173）
npm run build        # 生产构建 → dist/
npm run lint         # ESLint
npm run check        # TypeScript 类型检查（tsc -b --noEmit）
npm run test         # Vitest 单次运行
npm run test:watch   # Vitest watch 模式
```

## 关键实现细节

### 1. USB 连接 (`useUsbConnection.ts`)

- 使用 `AdbDaemonWebUsbDeviceManager.BROWSER.requestDevice()` 获取设备
- 认证使用 `AdbDaemonTransport.authenticate()` + `AdbWebCredentialStore`
- 凭证 key 名称为 `'carweb-adb-key'`，存储在 IndexedDB

### 2. Scrcpy 启动流程 (`useScrcpySession.ts`)

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

### 5. 路径别名

`@` 映射到 `src/`（vite.config.ts + tsconfig.json paths 配置）。

### 6. 解析日志格式

控制台输出格式化解析日志（每 app 一行）：
```
[Cache] com.tencent.mm HIT label="微信" icon=✓
[Parse] com.example.app ✓ label="My App" icon=✓
[Parse] com.unknown.bad ✗ some error message
```

## 已知限制与注意事项

1. **HTTPS 强制**：WebUSB 要求页面必须在 HTTPS 或 localhost 环境
2. **WiFi 首次需要 USB**：ADB over WiFi 必须先通过 USB 开启 `tcpip 5555`
3. **浏览器限制**：仅 Chrome/Edge 支持 WebUSB + WebCodecs
4. **server 版本锁定**：升级 `@yume-chan/adb-scrcpy` 时必须同步更新 `public/scrcpy-server.jar`
5. **开发服务器**：`vite dev` 默认 HTTP，WebUSB 在 localhost 可工作，外网访问需 HTTPS
6. **APK 解析性能**：解析大量 app 时会依次下载 APK（~1-30MB），带进度反馈；超过 1/4 设备内存的 APK 会跳过

## 测试

- Vitest + `fake-indexeddb`（用于模拟 IndexedDB 环境）
- 测试文件：`src/**/*.test.ts`（`ya-webadb-main/` 目录已排除）
- 测试 setup：`src/test/setup.ts`（自动加载 `fake-indexeddb/auto`）

## 部署

- CI：push to `master` → GitHub Pages 构建部署
- Vite 配置了 `base: '/carweb/'`（子路径部署）

## 参考文档

- `note.md` — 项目复盘，含详细技术收获
- `CONTEXT.md` — 项目术语表（虚拟屏、sw 锚点 DPI、分辨率预设等）
