# 废弃自研 SPAKE2 代理，接入车机官方 ADB 守护程序

Status: resolved
Type: task
Spec: ../spec.md
Blocked by: none

---

## Problem

旧方案 `bridge/main.go` 试图自研 SPAKE2 + TLS 1.3 协议，但因上游 Go 模块版本缺失无法构建，且在 Android 11+ 配对后的 TLS 会话维持存在原理性缺陷。需要彻底废弃该实现，切换为工业标准的官方 ADB 宿主守护模式。

## Solution

1. 废弃 `bridge/main.go` 内易碎的 SPAKE2/TLS 握手逻辑。
2. 车机后台改为直接依赖预编译好的官方 Android SDK `adb` 二进制程序（监听 `127.0.0.1:5037`）。
3. 宿主端仅提供极简的 5037 端口 WebSocket 字节流转发（约 50 行纯 Go，仅依赖 gorilla/websocket，零加密黑盒依赖）。

## Acceptance

- 彻底移除 `github.com/backkem/spake2-go` 不可用依赖。
- 宿主代理可以一键纯净编译运行。
- 本地 `5037` 管理端口可通过 WebSocket 稳定透传至前端。

## Answer

1. 彻底清除了 `bridge/main.go` 中所有 SPAKE2、AES-GCM、HKDF 与自签名证书等不可用自研密码学代码（600+ 行垃圾代码收敛为极简全双工字节透传），更新了 `bridge/go.mod` 仅依赖标准库及 gorilla/websocket。
2. 宿主默认将本地官方 Android SDK `adb` 二进制监听的标准管理端口（`127.0.0.1:5037`）通过 WebSocket 端点 `/adb` 与 `/adb/{target}` 暴露，并提供 `/health` 健康探测。
3. 额外提供了零编译依赖的 Node.js 版本 `bridge/bridge-node.cjs`，方便开发与测试环境在无 Go 编译器时秒级拉起联调。
4. 本地启动实测通过。
