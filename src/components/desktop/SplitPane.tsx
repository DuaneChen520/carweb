/**
 * SplitPane —— 单个分屏 pane 组件。
 *
 * 设计文档 §2.4 / §12.2：
 * - 左右应用组件平分侧边栏右侧的剩余宽度（各占 50%，中间留分隔间距）
 * - 尺寸随窗口大小响应式动态调整
 * - 空状态：虚线框 + "点击打开应用"
 * - 有 app 时：承载 session 的 canvas + 顶部下拉悬浮控件
 *
 * Canvas Reparenting 机制（Task 6）：
 * SplitPane 通过 ref 暴露容器节点，DesktopShell 负责将 session.canvas
 * 移入/移出该容器（reparentCanvas），保持 WebGL context 不变。
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { PaneEmptyState } from './PaneEmptyState';
import type { AppInstance, PaneSlot } from '@/lib/session-manager';
import type { ScrcpySession } from '@/lib/scrcpy-session';

interface SplitPaneProps {
  pane: PaneSlot;
  app: AppInstance | null;
  session: ScrcpySession | null;
  onOpenAppPicker: () => void;
  /** 顶部下拉菜单插槽（由 DesktopShell 注入，Task 5 实现） */
  dropdown?: ReactNode;
}

export function SplitPane({ pane, app, session, onOpenAppPicker, dropdown }: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 当 session 变化时，将 canvas reparent 到本容器
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !session?.canvas) return;

    // Canvas Reparenting：移动 canvas DOM 节点到本 pane 容器
    // WebGL context 保持不变（Task 6 核心机制）
    if (session.canvas.parentElement !== container) {
      container.appendChild(session.canvas);
    }
  }, [session, app]);

  return (
    <div
      data-pane={pane}
      className="flex-1 h-full bg-slate-100 rounded-lg overflow-hidden relative border border-black/5"
    >
      {app && session ? (
        <>
          {/* canvas 容器：session.canvas 会被 reparent 到这里 */}
          <div
            ref={containerRef}
            className="absolute inset-0 w-full h-full"
          />
          {/* 顶部下拉悬浮控件（透明悬浮，不占画面尺寸） */}
          {dropdown}
        </>
      ) : (
        <PaneEmptyState onClick={onOpenAppPicker} />
      )}
    </div>
  );
}

/**
 * 暴露容器 ref 的版本（供 DesktopShell 直接控制 reparent）。
 * 当前实现已内置 reparent 逻辑，无需额外暴露。
 */
export type SplitPaneHandle = {
  container: HTMLDivElement | null;
};
