# Issue 02: 重构 AppIcon 触控防抖与 NowPlayingCard 车机控制区

Status: resolved

## Comments

- `AppIcon.tsx`：
  - 紧凑模式升级为 `w-12 h-12 flex items-center justify-center rounded-xl` 保证 48px 物理靶区；
  - 应用名升级为 `text-xs font-medium text-content-muted`，杜绝 `text-[10px]`；
  - 置顶 Pin 角标升级为 `w-5 h-5` 并使用 `bg-accent-500 text-content-primary`；
  - 统一加入 `active:scale-95 transition-all` 防抖按压微动效。
- `NowPlayingCard.tsx`：
  - 背景升级为 `bg-surface-card/90 backdrop-blur-md border border-surface-elevated/40 shadow-card`；
  - 媒体控制按钮（上一首/播放/下一首）全量升级为 $48\times 48\text{px}$ 物理触控区（`w-12 h-12`），间距保证 `gap-2`（8px）；
  - 进度条时间戳拔高至 `text-xs font-mono tabular-nums text-content-muted`。
- `npm run check` 与 `npm run lint` 均通过。
Type: task
Blocked by: 01

## 目标

依据 ADR-0018、ADR-0019 与 `CODING_STANDARDS.md`，对 `src/components/AppIcon.tsx` 与 `src/components/NowPlayingCard.tsx` 执行重构：

1. `AppIcon.tsx`：
   - 保证触控区域 $\ge 48\times 48\text{px}$（`w-12 h-12 flex items-center justify-center rounded-xl`），图标 36px；
   - 文本模式：应用名称字号提升至 `text-xs text-content-muted group-hover:text-content-secondary truncate w-full text-center transition-colors`，彻底移除 `text-[10px]`；
   - Pin 置顶角标提升为 `w-5 h-5` 并使用 `bg-accent-500 text-content-primary`；
   - 添加即时按压反馈 `active:scale-95 transition-all`。
2. `NowPlayingCard.tsx`：
   - 卡片背景与边框使用 `bg-surface-card/90 backdrop-blur-md border border-surface-elevated/40 rounded-2xl shadow-card`；
   - 歌曲名与艺术家文本分别使用 `text-content-primary` 与 `text-content-secondary`；
   - 控制按钮（上一首/下一首）升级为 $48\times 48\text{px}$ 物理点击区（`w-12 h-12 flex items-center justify-center rounded-xl hover:bg-surface-hover text-content-secondary hover:text-content-primary transition-all active:scale-95`）；
   - 播放/暂停主操作升级为 `w-12 h-12 flex items-center justify-center rounded-xl bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 active:scale-95 transition-all shadow-accent-glow`；
   - 相邻控制按钮间距设为 `gap-2`（8px）；
   - 进度条时间戳字号拔高至 `text-xs font-mono text-content-muted`，杜绝 `text-[10px]`。
