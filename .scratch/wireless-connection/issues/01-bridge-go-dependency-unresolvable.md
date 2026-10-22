# 桥接代理 Go 依赖不可解析，`bridge/` 当前无法构建

Status: resolved
Type: task
Spec: ../spec.md
Blocked by: none

> **已废弃并解决**：在架构评审后，确认废除自研 SPAKE2 代理路线，转向官方 ADB 宿主守护进程方案。
> 后续实现见 `01-adopt-official-adb-host-daemon.md`。

---

## Problem

`bridge/go.mod` 声明的依赖在公开模块代理上**不存在对应版本**，且仓库中缺 `go.sum` / `go.work`，导致**按当前提交无法构建**：

```
require (
	github.com/backkem/spake2-go v0.1.0
	github.com/gorilla/websocket v1.5.3
)
```

## Evidence

1. 上游仓库 `github.com/backkem/spake2-go` 公开可获取的 tag 只有 **`v0.0.1`**；`v0.1.0` 在 `proxy.golang.org` 返回 404（2026-10-22 实测）。
2. `bridge/` 目录下**只有** `go.mod` 与 `main.go`，**没有** `go.sum`，也**没有** `go.work` 或 `replace` 指令——即没有本地替代实现或 vendored 副本兜底。
3. `bridge/main.go` 直接 import `github.com/backkem/spake2-go`（`spake2.DefaultOptions()` / `spake2.NewClient()`），用于 `/pair` 端点的 SPAKE2 配对握手。

## Impact

- README「无线连接」章节要求 `cd bridge && go build -o tiny-bridge main.go && ./tiny-bridge`，**该命令当前会失败**。
- 无桥接代理 → **无线连接功能整条链路不可用**（有线 USB 不受影响）。
- `/pair` 的 SPAKE2 认证是无线配对的**安全前提**，不能简单删掉。

## Options

1. **改用上游实际存在的 `v0.0.1`**
   - 需核对 `v0.0.1` 的 API 与当前 `main.go` 的用法是否兼容（`DefaultOptions()` / `IdentityA` / `IdentityB` / `NewClient` 的签名与行为）。
   - 改动最小，但需实机验证配对握手仍能完成。

2. **改为 vendored 本地副本**
   - 把 `spake2-go` 源码纳入仓库（`bridge/vendor/` 或独立子目录 + `replace` 指令）。
   - 彻底摆脱对上游发布节奏的依赖；代价是引入一份需要自行维护的第三方代码。

3. **更换 SPAKE2 实现库**
   - 评估其他活跃维护的 Go SPAKE2 实现，或改用 Android 无线调试官方支持的其它配对方式。
   - 成本最高，但可消除当前的依赖断裂。

4. **补齐 `go.sum` + `replace` 到可用版本**
   - 在 `go.mod` 中 `replace` 到一个确定可解析的版本/路径，并提交 `go.sum`。
   - 属于方案 1/2 的实现细节变体。

## Acceptance

- `cd bridge && go build -o tiny-bridge main.go` 在干净环境成功。
- 生成的 `go.sum` 提交入库（保证依赖可复现）。
- 真机完成一次 `/pair` 配对握手，浏览器侧 `/adb/{target}` 连接成功。
- README「无线连接」章节的命令与实际一致。

## Notes

- 当前 `.scratch/wireless-connection/spec.md` 状态为 `ready-for-agent`，但桥接代理构建问题会**阻断**该 spec 的端到端验收，建议在无线连接 spec 推进前先解决本条。
- 代理端口 8080，`/scan/{subnet}`、`/adb/{target}`、`/pair` 三个端点均在此单文件内实现。
