# 废弃自研 SPAKE2 代理，接入车机官方 ADB 守护程序

Status: ready-for-agent
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
