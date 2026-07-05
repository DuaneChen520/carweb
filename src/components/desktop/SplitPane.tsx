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
 *
 * 自适应尺寸（bugfix 2026-07-05）：
 * ResizeObserver 监听容器尺寸变化 → flexClient.onContainerResize →
 * FlexDisplayClient 发送 RESIZE_DISPLAY 到设备 → 虚拟屏调整分辨率 →
 * 画面保持正确比例，不被横向压扁。
 *
 * 关键设计：flexClient 引用通过 ref 持有（而非 effect dependency），
 * 因为 zustand store 返回的 session 对象引用不变但内部状态变化时，
 * React 不会重新渲染。ref 模式确保 ResizeObserver 总能访问到最新的 flexClient。
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
  /**
   * 分辨率缩放系数（与 VirtualScreen 的 resolution preset scale 相同语义）。
   * 默认 1.0 = 原始分辨率。
   */
  resizeScale?: number;
}

export function SplitPane({ pane, app, session, onOpenAppPicker, dropdown, resizeScale = 1.0 }: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const flexClientRef = useRef(session?.flexClientInstance ?? null);
  const lastSizeRef = useRef({ width: 0, height: 0 });

  // 同步 flexClientRef（始终指向最新值，绕过 React 闭包问题）
  useEffect(() => {
    flexClientRef.current = session?.flexClientInstance ?? null;

    // flexClient 新可用时（刚变为非 null），立即触发一次尺寸通知
    const fc = flexClientRef.current;
    if (fc && lastSizeRef.current.width > 0 && lastSizeRef.current.height > 0) {
      fc.onContainerResize(
        lastSizeRef.current.width,
        lastSizeRef.current.height,
        resizeScale,
        window.devicePixelRatio || 1,
      );
    }
  }, [session, resizeScale]);

  // 1. Canvas Reparenting
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !session?.canvas) return;

    if (session.canvas.parentElement !== container) {
      container.appendChild(session.canvas);
    }
  }, [session, app]);

  // 2. ResizeObserver（独立 effect，不依赖 session/flexClient 变化）
  useEffect(() => {
    const container = containerRef.current;
    // 即使 flexClient 尚未可用也启动观察，当 flexClient 就绪时会通过 flexClientRef 触发一次
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;

      lastSizeRef.current = { width, height };

      const fc = flexClientRef.current;
      if (fc) {
        fc.onContainerResize(
          width,
          height,
          resizeScale,
          window.devicePixelRatio || 1,
        );
      }
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [resizeScale]);

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
 */
export type SplitPaneHandle = {
  container: HTMLDivElement | null;
};