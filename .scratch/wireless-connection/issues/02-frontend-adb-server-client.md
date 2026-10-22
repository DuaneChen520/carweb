# 前端连接层对接标准 ADB Server 协议

Status: resolved
Type: task
Spec: ../spec.md
Blocked by: 01-adopt-official-adb-host-daemon.md

---

## Problem

前端连接层目前采用直接面向 TCP 端口伪造设备（`AdbDaemonWebSocketDevice`）的逻辑，无法调用官方 ADB 的 `pair` 和 `connect` 服务，也无法监听设备上下线。

## Solution

1. 引入标准 ADB Server 协议客户端，连接宿主 `5037` 端口。
2. 实现 `pair(host, port, code)`、`connect(host, port)`、`listDevices()` 与 `openTransport(serial)`。
3. 对接现有的 `useAdbStore`，输出与既有虚拟屏会话层完全一致的 ADB Transport。

## Acceptance

- 前端可通过管理接口向宿主发送配对码与端口并收到配对结果。
- 设备连接成功后，自动建立数据通道并启动虚拟屏。

## Answer

1. 实现了 `AdbServerWebSocketConnector`（`src/lib/adb-server-connector.ts`），将宿主 WebSocket 网桥（`ws://localhost:8080/adb`）无缝适配为 `@yume-chan/adb` 的原生 `AdbServerClient.ServerConnector` 标准全双工字节流。
2. 封装了高阶管理门面 `AdbServerManager`（`src/lib/adb-server-manager.ts`），支持针对 `pair(address, code)`、`connect(address)`、`disconnect(address)`、`getDevices()`、`createAdb(device)` 的依赖注入与单元测试。
3. 重构了 `useWifiConnection`（`src/hooks/useWifiConnection.ts`），支持免线 6 位配对码 + 配对端口配对、扫码配对、已知 IP 设备一键直连，并无缝接入 `useAdbStore` 和 `killScrcpyServer`。
4. 新增配套热点区测试：`src/lib/__tests__/adb-server-connector.test.ts`、`src/lib/__tests__/adb-server-manager.test.ts`、`src/hooks/__tests__/useWifiConnection.test.ts`。三条验证命令 `npm run test`（358 tests 全绿）、`npm run check`、`npm run lint` 全部通过。
