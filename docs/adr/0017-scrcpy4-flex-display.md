# ADR-0017: 迁移至 scrcpy 4.0 flex display

- 日期：2026-07-01
- 状态：已采纳
- 重编号说明：本文件原为 `0004-scrcpy4-flex-display.md`，与 `0004-app-info-parsing-strategy.md`（2026-06-13）编号冲突；2026-10-22 重编号为 **ADR-0017**，编号连续性让位给更早采纳的 ADR-0004。

## 背景

CarWeb 使用 scrcpy 3.x 虚拟屏（`@yume-chan/scrcpy` 2.3.0 + server v3.3.3），
尺寸变化需销毁重建会话（`VirtualScreen.tsx:129-176`：防抖 500ms → 抓前台应用 →
`stopScrcpy` → 轮询 `dumpsys display` 确认旧屏销毁 → 触发重启 → 恢复应用），
带来 1–2s 黑屏。

## 决策

自研 scrcpy 4.0 客户端协议适配层（`src/lib/scrcpy4/`），启用 flex display，
通过 `RESIZE_DISPLAY` 控制消息 + 视频流会话包实现运行时动态 resize，
**无需销毁重建会话**。

### 技术路径

**不复用 `@yume-chan/scrcpy` 的 3.x demuxer**：4.0 视频流 PTS 位域不同
（3.x: bit63=config, bit62=keyframe; 4.0: bit63=session, bit62=config, bit61=keyframe, 61-bit PTS），
自写 4.0 demuxer（`src/lib/scrcpy4/video/demuxer.ts`）。

**不 fork node_modules**：通过 `AdbScrcpyOptions4_0 extends AdbScrcpyOptions3_3_3`
override `version`/`serialize`/`controlMessageTypes`/`createMediaStreamTransformer`
四个成员，复用全部 ADB 层及 3.x 协议默认值。

**反抖动采用 CSS/backing-store 结构性隔离**：
`ResizeObserver` 监听 CSS 尺寸（用户驱动），会话包只改 `canvas.width/height`
（位图尺寸，不触发 `ResizeObserver`），天然无环路。`client-resized` 标志
作为协议级二次确认。

### 新增文件

```
src/lib/scrcpy4/
  control/resize-display.ts   # RESIZE_DISPLAY 序列化（5 字节 BE）
  video/demuxer.ts            # 4.0 视频流解复用（会话包+媒体包）
  flex-client.ts              # 反抖动状态机
  options.ts                  # AdbScrcpyOptions4_0
  index.ts                    # 公共导出
  __tests__/                  # 28 个单测
public/scrcpy-server.jar      # v4.0（715KB）
docs/adr/0017-scrcpy4-flex-display.md   # 本文件
```

### 修改文件

| 文件 | 变更 |
|---|---|
| `src/hooks/scrcpy/useScrcpySession.ts` | 切 4.0 options + FlexDisplayClient 集成 |
| `src/hooks/scrcpy/useVideoDecoder.ts` | pump 循环加 session 包分流 |
| `src/components/VirtualScreen.tsx` | 删除销毁重建 resize（~60 行），接入 flex-client |
| `src/contexts/ScrcpyContext.tsx` | `startScrcpy` 签名加第 4 参数 `setCanvasSize`；添加 `flexClient` 字段 |
| `README.md` | scrcpy 版本号更新为 v4.0 |
| `public/scrcpy-server.jar` | 替换为 v4.0 |

## 后果

**正面**：
- 虚拟屏 resize 从 1–2s 黑屏变为 <300ms 无感知过渡
- 前台应用不中断、displayId 会话内稳定
- 无需重新探测/恢复应用

**负面**：
- 维护 4.0 协议适配层的新增成本（`src/lib/scrcpy4/` 约 4 个模块）
- 冷启动成本仍存在（flex 不改善首次启动速度）
- 4.0 协议无前后向兼容，server jar 与 client 必须版本匹配

**保留**：
- `resizeDisplay`（shell 路径）暂保留代码但 flex 模式下不调用，
  留待后续验证稳定后清理

## 关联

- 设计文档：`docs/superpowers/specs/2026-07-01-scrcpy4-flex-display-design.md`
- 实现计划：`docs/superpowers/plans/2026-07-01-scrcpy4-flex-display.md`
- 替代：ADR-0003（虚拟屏自动 resize 的销毁重建方案）
