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
 * session.canvas 通过 useEffect reparent 到 pane 容器，WebGL context 不变。
 *
 * 自适应尺寸（bugfix 2026-07-05 v2）：
 * ResizeObserver 监听容器 CSS 尺寸 → flexClient.onContainerResize →
 * FlexDisplayClient 发送 RESIZE_DISPLAY → 设备调整虚拟屏分辨率 →
 * 画面保持正确比例。
 *
 * 关键修复（v1 → v2）：
 * 1. ResizeObserver effect 依赖 [app, session, sessionIsRunning] 而非 [resizeScale]，
 *    确保容器出现时（app/session 变非空）和 session 启动完成时（isRunning 变 true）
 *    都能重新设置 observer。
 * 2. 通过订阅 zustand 的 session state（isRunning）触发 re-render，
 *    解决 ScrcpySession 实例引用不变导致 flexClientInstance 变化不可见的问题。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PaneEmptyState } from './PaneEmptyState';
import { useSessionManager } from '@/lib/session-manager';
import type { AppInstance, PaneSlot } from '@/lib/session-manager';
import type { ScrcpySession } from '@/lib/scrcpy-session';
import { useCanvasPointerInput } from '@/hooks/scrcpy/useCanvasPointerInput';
import { AppTransitionPlaceholder } from './AppTransitionPlaceholder';

interface SplitPaneProps {
  pane: PaneSlot;
  app: AppInstance | null;
  session: ScrcpySession | null;
  onOpenAppPicker: () => void;
  /** 顶部下拉菜单插槽（由 DesktopShell 注入） */
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
  // ADR-0011：尺寸变化过渡态（flex-client pendingResize 进行中）。
  // 与 videoWidth===0 共同驱动 AppTransitionPlaceholder 的显隐。
  const [resizing, setResizing] = useState(false);
  // ADR-0011 兜底：resize 进行中启动安全超时，server 未回确认时强制结束过渡，防止占位卡死。
  const resizeSafetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 订阅 session 的 isRunning 状态。
  // ScrcpySession 实例引用不变，但 start() 完成后 isRunning 从 false → true，
  // zustand 的 sessions[sessionId].state 会更新，此 selector 触发 re-render。
  // re-render 时 session.flexClientInstance 从 null 变为非 null。
  const sessionIsRunning = useSessionManager((s) => {
    if (!app) return false;
    const managed = s.sessions[app.sessionId];
    return managed?.state.isRunning ?? false;
  });

  // 订阅 session 的 videoWidth：首帧未到达时为 0（启动过渡中），>0 表示有效帧已渲染。
  const videoWidth = useSessionManager((s) => {
    if (!app) return 0;
    const managed = s.sessions[app.sessionId];
    return managed?.state.videoWidth ?? 0;
  });

  // 触控输入：为 reparent 进来的原生 canvas 绑定指针事件（桌面分屏缺省无触控层）
  const handlePointer = useCanvasPointerInput(session);

  // 1. 同步 flexClientRef —— 每次 re-render 都执行（非 effect），确保拿到最新值
  flexClientRef.current = session?.flexClientInstance ?? null;

  // 1b. ADR-0011：订阅 flex-client 的 resize 进行中回调，驱动尺寸变化过渡占位。
  // flexClientInstance 在 start() 完成后（isRunning 翻转）才就绪，故依赖 sessionIsRunning。
  useEffect(() => {
    const fc = session?.flexClientInstance ?? null;
    if (!fc) return;
    fc.onResizeActivity = (active) => {
      if (resizeSafetyTimer.current) {
        clearTimeout(resizeSafetyTimer.current);
        resizeSafetyTimer.current = null;
      }
      if (active) {
        setResizing(true);
        // 自愈兜底：极端情况下 server 未回 clientResized 确认（尺寸出入/发送失败），
        // 超时后强制结束过渡，避免浅白占位永久占据屏幕。
        resizeSafetyTimer.current = setTimeout(() => {
          resizeSafetyTimer.current = null;
          setResizing(false);
        }, 1200);
      } else {
        setResizing(false);
      }
    };
    return () => {
      fc.onResizeActivity = undefined;
      if (resizeSafetyTimer.current) {
        clearTimeout(resizeSafetyTimer.current);
        resizeSafetyTimer.current = null;
      }
    };
  }, [session, sessionIsRunning]);

  // flexClient 新可用时，立即用缓存的容器尺寸触发一次 resize
  useEffect(() => {
    const fc = flexClientRef.current;
    if (fc && lastSizeRef.current.width > 0 && lastSizeRef.current.height > 0) {
      fc.onContainerResize(
        lastSizeRef.current.width,
        lastSizeRef.current.height,
        resizeScale,
        window.devicePixelRatio || 1,
      );
    }
  }, [session, sessionIsRunning, resizeScale]);

  // 2. Canvas Reparenting
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !session?.canvas) return;

    if (session.canvas.parentElement !== container) {
      container.appendChild(session.canvas);
    }
  }, [session, app, sessionIsRunning]);

  // 3. ResizeObserver —— 依赖 app/session/sessionIsRunning，确保容器出现时能启动
  useEffect(() => {
    const container = containerRef.current;
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
  }, [app, session, sessionIsRunning, resizeScale]);

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
            style={{ touchAction: 'none' }}
            onPointerDown={handlePointer}
            onPointerMove={handlePointer}
            onPointerUp={handlePointer}
            onPointerCancel={handlePointer}
          />
          {/* ADR-0011：应用启动（首帧未到）或尺寸变化（resize 进行中）的统一过渡占位 */}
          <AppTransitionPlaceholder
            pkg={app.packageName}
            show={videoWidth === 0 || resizing}
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

export type SplitPaneHandle = {
  container: HTMLDivElement | null;
};
