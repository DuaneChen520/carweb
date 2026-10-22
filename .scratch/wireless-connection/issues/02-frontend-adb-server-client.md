# 前端连接层对接标准 ADB Server 协议

Status: ready-for-agent
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
