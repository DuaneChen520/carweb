# Spec: 无线 ADB 连接（WiFi 投屏）

> 状态：**ready-for-agent**
> 标签：`ready-for-agent`

---

## Problem Statement

carweb 目前仅支持 USB 有线投屏。在实际用车场景中，用户身边往往没有 USB 数据线（或 USB 线在车内走线不便），导致无法使用投屏功能。此外，新能源车普遍自带 4G/5G 流量和车载 WiFi 热点，用户也希望利用车机本身的热点能力来连接手机，无需额外消耗手机流量。

用户需要一种**无需 USB 线**的无线投屏方式，同时支持两种 WiFi 拓扑：

- **手机热点**：手机开热点，车机连接（传统场景）
- **车机热点**：车机（新能源车）开热点，手机连接（新能源车场景，利用车机自带流量）

---

## Solution

### 整体架构

在车机端部署一个极轻量的 **WebSocket ↔ TCP 桥接代理**（tiny-bridge），浏览器通过 WebSocket 连接该代理，代理将流量转发到手机的 ADB 守护进程端口（5555），从而实现浏览器内无线 ADB 连接。

```
┌───────── 车机浏览器 ─────────┐         WiFi          ┌───────── Android 手机 ────────┐
│                              │     TCP :5555          │                              │
│  carweb (WebSocket client)   │ ◄────────────────────  │  ADB Daemon (无线调试)        │
│                              │                        │  ─ port 5555 (adb connect)   │
│  @yume-chan/adb 传输层       │                        │  ─ port 37000+ (adb pair)    │
│  AdbDaemonWebSocketDevice    │                        │                              │
└──────────┬───────────────────┘                        └──────────────────────────────┘
           │ WebSocket :8080
           ▼
┌──────────────────────────────┐
│  tiny-bridge                  │
│  (WebSocket ↔ TCP 桥接)       │
│  编译为单一二进制，~2MB         │
│  随车机系统/容器部署            │
└──────────────────────────────┘
```

### 认证方案

**主路径：扫码配对（Android 11+ 无线调试）**

用户无 USB 线时的唯一选择。利用 Android 11+ 的无线调试功能，通过 QR 码或配对码完成首次认证。

**备选路径：USB 临时认证**

用户手边正好有 USB 线时，插线一次完成 `adb tcpip` 启用，将车机公钥写入手机，后续拔线走无线。

### 网络拓扑

**手机热点**：手机开热点，车机连接。手机 IP 固定为默认网关，无需扫描，零配置自动发现。

**车机热点**：车机（新能源车）开热点，手机连接。手机 IP 由 DHCP 分配，需扫描子网发现。

两种拓扑供用户在 UI 中选择。

---

## User Stories

1. 作为用户，我**没有 USB 线**但想投屏，我希望通过**扫码配对**完成首次连接，以便后续无线投屏。
2. 作为用户，我**手边正好有 USB 线**，我希望插线一次完成认证，之后拔掉走无线，以便省去扫码的操作。
3. 作为用户，我**手机开热点**时，我希望车机自动检测到手机的 IP 并自动连接，以便无需手动输入地址。
4. 作为用户，我的**新能源车自带热点和流量**，我希望车机开热点，手机连接后即可投屏，以便不消耗手机流量。
5. 作为用户，我**首次连接**时，我希望在 UI 中看到手机热点/车机热点/手动输入三种拓扑选项，以便选择符合我当前场景的方式。
6. 作为用户，我**首次连接**且选择扫码配对时，我希望 carweb 能解析 QR 码完成配对，以便无需手动输入配对码。
7. 作为用户，我**首次连接**且选择扫码配对但手机在另一房间时，我希望也能手动输入配对码和 IP:端口，以便不依赖摄像头。
8. 作为用户，我**已配对过**某台手机，我希望下次连接时 carweb 自动识别并一键重连，以便无需重复配对。
9. 作为用户，我**已配对过**多台手机，我希望在设备列表中看到它们并选择连接，以便在手机间切换。
10. 作为用户，我**无线连接使用中**，我希望车机断开/重连时能自动恢复会话（如 LinkSupervisor 的 reconnect），以便体验不中断。
11. 作为用户，我**无线连接使用中**如果 ADB 传输断开（如手机热点关闭），我希望 carweb 显示明确的断线提示，以便知道原因。
12. 作为开发者，我需要在**测试中验证无线连接的重连逻辑**，而不依赖真实设备，以便自动化测试覆盖。

---

## Implementation Decisions

### 1. WebSocket 桥接代理（tiny-bridge）

**位置**：`bridge/` 目录，独立于 carweb 前端项目。

**语言**：Go（编译为单一二进制，无运行时依赖，~2MB 体积）。

**接口**：

```
WebSocket 端点: ws://localhost:8080/adb/{target_host}:{target_port}
```

**行为**：
- 接收 WebSocket 连接，解析 `target_host:target_port`
- 建立 TCP 连接到 `target_host:target_port`（即手机的 ADB 端口）
- 双向透传数据（`io.Copy` 双向桥接）
- 任一端断开即关闭另一端

**部署方式**：随车机系统启动时自动运行，或作为 Docker 容器 / systemd 服务部署。

### 2. `AdbDaemonWebSocketDevice`——浏览器端 WebSocket 传输层

**位置**：`src/lib/websocket-device.ts`

**接口**：实现 `AdbDaemonDevice` 接口，与现有的 `AdbDaemonWebUsbDevice` 类型对齐。

```typescript
class AdbDaemonWebSocketDevice implements AdbDaemonDevice {
  constructor(
    public ip: string,
    public port: number,        // ADB 端口，默认 5555
    private bridgePort = 8080,  // 本地桥接代理端口
  ) {}

  get serial(): string       // 返回 `${ip}:${port}`
  get name(): string | undefined

  connect(): Promise<AdbDaemonConnection>
    // 1. 创建 WebSocket 到 ws://localhost:{bridgePort}/adb/{ip}:{port}
    // 2. 将 WebSocket 流适配为 AdbDaemonConnection（AdbPacketData/AdbPacketInit 读写流）
    // 3. 返回连接
}
```

### 3. `WebSocketStreamAdapter`——WebSocket ↔ ADB 数据包流适配器

**位置**：`src/lib/websocket-stream.ts`

将 WebSocket 的二进制帧流适配为 `AdbDaemonConnection`（即 `ReadableWritablePair<AdbPacketData, Consumable<AdbPacketInit>>`），与 `AdbDaemonWebUsbConnection` 的职责相同，但后端是 WebSocket 而非 USB 批量端点。

**关键接口**：

```typescript
function createAdbDaemonConnectionFromWebSocket(
  ws: WebSocket,
): AdbDaemonConnection
```

### 4. `AdbPairingClient`——ADB 配对协议实现

**位置**：`src/lib/adb-pairing.ts`

实现 Android 11+ 的 ADB 无线配对协议（基于 TLS 的配对握手）：

- 解析 QR 码格式：`WIFI:T:ADB;S:{name};P:{code};H:{host};D:{port};;`
- 连接配对端口（37000+），完成 TLS 握手
- 发送配对码
- 发送车机 RSA 公钥
- 等待手机确认，将公钥写入 `authorized_keys`
- 配对完成后，切换到 ADB 连接端口（5555）进行正常认证

**注意**：配对后车机的公钥被手机信任，**后续连接直接走 ADB 端口 5555，无需再次配对**。

### 5. `useWifiConnection.ts` 重写

**位置**：`src/hooks/useWifiConnection.ts`（现有文件，完全重写）

**新职责**：

- 管理 WiFi 连接状态机（复用 `useAdbStore` 的 `connectionStatus`）
- 提供 `connectWifi(ip, port, pairCode?)` 方法
- 如果传了 `pairCode`，先走 ADB 配对流程，再走 ADB 认证
- 如果没传 `pairCode`，直接走 ADB 认证（假设已经配对过）
- 提供 `scanDevices()` 方法（仅车机热点模式需要主动扫描）
- 遵循 `connectOnce` 模式（与 `useUsbConnection.ts` 保持一致）

**连接流程**：

```
用户选择连接方式 → 拓扑选择（手机热点/车机热点/手动输入）
  → 首次连接 → 扫码配对 / 手动输入配对码
    → 配对端口 → 配对完成 → ADB 端口 → 认证 → scrcpy
  → 已配对设备 → ADB 端口 → 认证 → scrcpy
```

### 6. 网络拓扑发现

**手机热点模式**：
- 车机连接手机热点后，默认网关即为手机 IP
- 通过 `ip route` 或 WebSocket 桥接代理获取网关地址
- 无需扫描，零配置

**车机热点模式**：
- 手机 IP 由 DHCP 分配，不确定
- 需要扫描子网 `192.168.x.0/24` 内所有 IP 的 5555 端口
- 桥接代理提供扫描接口：`GET /scan/{subnet}` 返回活跃设备列表
- 浏览器端通过 WebSocket 代理调用扫描
- 扫描并发 15 连接，超时 200ms，254 个 IP 约 3.5 秒完成

**手动输入模式**：
- 用户直接输入 IP:端口（兜底方案）

### 7. 已配对设备持久化

**复用现有机制**：`useRememberedDevices.ts` 已支持 localStorage 持久化设备信息（`type/usb/wifi`、`address`、`lastConnected`）。

**扩展**：WiFi 设备增加 `pairingPort`、`deviceName` 字段，用于自动重连。

### 8. 重连策略

**复用 LinkSupervisor**：无线连接场景下，ADB 传输断开（如手机热点关闭 → 重连）时，`LinkSupervisor` 的 ADB 子监视器会检测到 `disconnected` 并触发状态转换。

**适配**：无线重连需要重新建立 WebSocket 连接（而非 USB 复位），重连策略注入点与 USB 相同（`retryConnectUsb` 模式），但实现为 `retryConnectWifi`。

### 9. UI 变更

**ConnectionOverlay.tsx**（现有文件，扩展）：

- WiFi 标签页扩展为三个子选项：
  - 手机热点（推荐）
  - 车机热点
  - 手动输入 IP
- 首次连接时显示扫码界面（或手动输入配对码）
- 已配对设备列表（支持一键连接）
- 扫描进度指示器

### 10. 依赖关系

- 新增依赖：`@yume-chan/adb-daemon-webusb`（v3.0.0-beta.1 已存在，不变）
- 新增依赖：`@yume-chan/adb`（v3.0.0-beta.1 已存在，不变）
- 新增依赖：`@yume-chan/adb-credential-web`（v3.0.0-beta.1 已存在，不变）
- 新增依赖：`@yume-chan/adb-scrcpy`（v3.0.0-beta.1 已存在，不变）
- 新增依赖：`@yume-chan/scrcpy`（v3.0.0-beta.1 已存在，不变）
- 新增依赖：无额外 npm 包（WebSocket 是浏览器原生 API，TLS 握手算法使用 Web Crypto API）
- 新增依赖（桥接代理）：Go 标准库 `net/http` + `gorilla/websocket`（或 `nhooyr.io/websocket`）

---

## Testing Decisions

### 测试原则

- 只测**外部行为**，不测实现细节
- 传输层（`AdbDaemonWebSocketDevice`）通过模拟 WebSocket 服务器测试
- 配对逻辑（`AdbPairingClient`）通过模拟 ADB 配对服务器测试
- 连接重试逻辑（`retryConnectWifi`）继承 `retryConnectUsb` 的 DI 模式，注入 mock 依赖
- 不与真实 Android 设备交互

### 测试模块

| 模块 | 测试策略 | 现有模式参考 |
|------|---------|------------|
| `src/lib/websocket-stream.ts` | 用 `WebSocket` 模拟 + 自定义 `WebSocketServer`（Node.js `ws` 库）测试双向数据流 | `usb-connect.test.ts` 的 DI 模式 |
| `src/lib/websocket-device.ts` | 测试 `connect()` 建立 WebSocket、序列化 ADB 数据包、`serial`/`name` 属性 | `usb-connect.test.ts` 的 DI 模式 |
| `src/lib/adb-pairing.ts` | 模拟 TLS 握手 + 配对码交换 + 公钥交换，验证配对成功/失败路径 | 无直接参考，但遵循 `makeDeps` 模式 |
| `src/lib/adb-commands.ts`（扩展） | `tcpip()`、`getWifiIp()` 的单元测试，通过 mock ADB socket 验证 | `adb-commands.ts` 现有测试（vi.mock 模式） |
| `src/hooks/useWifiConnection.ts` | 通过依赖注入模拟 `connectWifi`、`scanDevices`、`disconnect`，验证状态机转换 | `useScrcpySession.sync-guard.test.tsx` 的 hook 测试模式 |
| 桥接代理 `bridge/` | Go 的 `net/http/httptest` + `gorilla/websocket` 测试双向桥接、断开传播、并发 | 独立测试，Go 原生 `testing` 包 |

### 测试接缝（Seam）

**最高接缝**：`retryConnectWifi(target, deps)` 函数，沿用 `retryConnectUsb` 的 DI 模式：

```typescript
// 与 usb-connect.ts 的 RetryConnectDeps 对齐
interface RetryConnectWifiDeps {
  createDevice: (ip: string, port: number, bridgePort: number) => AdbDaemonWebSocketDevice;
  connectOnce: (device: AdbDaemonWebSocketDevice) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  isCancelled: () => boolean;
}
```

**子接缝**：`AdbDaemonWebSocketDevice` 的 `connect()` 方法接受可选的 `wsFactory` 参数，允许测试注入 mock WebSocket。

---

## Out of Scope

1. **mDNS 设备自动发现**：不实现 mDNS/DNS-SD 广播发现，仅通过拓扑发现（网关/扫描/手动）确定手机 IP。
2. **WebRTC P2P 隧道**：不使用 WebRTC 作为传输层，方案过于复杂。
3. **手机端 App**：不开发手机端配套 App，仅依赖 Android 系统原生无线调试功能。
4. **非 Android 设备**：不支持 iOS 或其他平台。
5. **蓝牙配对**：不使用蓝牙作为初始配对通道。
6. **NFC 碰触配对**：不使用 NFC 碰触方式建立连接。

---

## Further Notes

### Android 版本兼容性

| 功能 | Android 版本要求 |
|------|-----------------|
| 扫码配对（无线调试） | Android 11+ |
| USB 认证 → `adb tcpip` | Android 2.2+ |
| ADB over TCP 连接 | Android 2.2+ |
| 二维码扫描 | 不需要 Android 版本支持（浏览器端扫码） |

Android 10 及以下只能通过 USB 认证（`adb tcpip`）启用无线连接，不支持扫码配对。

### 与现有架构的集成点

| 集成点 | 现有模块 | 影响 |
|--------|---------|------|
| 连接状态机 | `useAdbStore`（`connectionStatus`） | 扩展 `connectionType` 支持 `'wifi'`，无需修改状态机 |
| 断线信号 | `adb-intent.ts` + `adb-disconnect.ts` | 复用，无线断线语义与 USB 一致 |
| 链路监督 | `LinkSupervisor` | 复用，重连策略注入点不同但接口相同 |
| 已配对设备 | `useRememberedDevices.ts` | 扩展字段，无需新增存储机制 |
| 设备 PIN | `useDevicePin.ts` | 复用，与传输层无关 |
| scrcpy 会话 | `ScrcpySession` | **完全复用**，ADB 建立后与 USB 路径无差异 |

### 安全考量

- 扫码配对使用 TLS 加密传输配对码和公钥
- 公钥私钥使用 `AdbWebCryptoCredentialManager`（IndexedDB 持久化），与 USB 路径共享同一密钥库
- WebSocket 桥接代理仅监听 `localhost:8080`，不暴露到外部网络
- 手机热点模式下，车机通过网关 IP 连接手机，流量在局域网内不经过公网

### 实现优先级

| 优先级 | 模块 | 预估工作量 |
|--------|------|-----------|
| P0 | `bridge/` WebSocket ↔ TCP 桥接代理 | 1-2 天 |
| P0 | `src/lib/websocket-stream.ts` WebSocket 流适配器 | 1 天 |
| P0 | `src/lib/websocket-device.ts` AdbDaemonWebSocketDevice | 0.5 天 |
| P1 | `src/hooks/useWifiConnection.ts` 重写 | 1 天 |
| P1 | 手机热点 → 网关检测自动发现 | 0.5 天 |
| P1 | 车机热点 → 子网扫描 | 1 天 |
| P1 | UI 扩展（拓扑选择、扫码界面、设备列表） | 1-2 天 |
| P2 | `src/lib/adb-pairing.ts` 扫码配对协议 | 2-3 天 |
| P2 | QR 码解析 UI | 1 天 |
| P2 | 已配对设备自动重连 | 0.5 天 |
| P3 | 无线重连 LinkSupervisor 适配 | 1 天 |
| P3 | 测试覆盖 | 2 天 |