/**
 * FullscreenOverlay —— 全屏覆盖层组件。
 *
 * 设计文档 §2.4 / §3.1 / §12.3：
 * - 覆盖侧边栏右侧的 DesktopArea，不遮住侧边栏
 * - 全屏尺寸 = DesktopArea 尺寸（浏览器窗口 - 侧边栏）
 * - 承载 fullscreenSessionId 对应 session 的 canvas
 * - 顶部 FullscreenDropdown
 *
 * 核心机制（§3.1 关键原则）：session 不重启，只换渲染目标 canvas。
 *
 * 自适应尺寸（bugfix 2026-07-05 v2）：
 * ResizeObserver 监听 overlay 容器尺寸 → flexClient.onContainerResize →
 * 设备调整虚拟屏分辨率到全屏尺寸。
 *
 * 与 SplitPane 共享同一套 resize 管线：
 * - sessionIsRunning 订阅触发 re-render
 * - flexClientRef 在 render 时同步
 * - ResizeObserver 依赖 sessionIsRunning 确保容器出现时启动
 */

import { useEffect, useRef, useState } from 'react';
import { useSessionManager } from '@/lib/session-manager';
import { FullscreenDropdown } from './FullscreenDropdown';
import { useCanvasPointerInput } from '@/hooks/scrcpy/useCanvasPointerInput';
import { AppTransitionPlaceholder } from './AppTransitionPlaceholder';
import type { DisplayConfig } from '@/lib/scrcpy-session';

interface FullscreenOverlayProps {
  /** 显示配置（保留接口，当前由 ResizeObserver 动态调整） */
  displayConfig?: DisplayConfig;
  /** 分辨率缩放系数，默认 1.0 */
  resizeScale?: number;
}

export function FullscreenOverlay({ displayConfig, resizeScale = 1.0 }: FullscreenOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const flexClientRef = useRef<import('@/lib/scrcpy4').FlexDisplayClient | null>(null);
  const lastSizeRef = useRef({ width: 0, height: 0 });
  // ADR-0011：尺寸变化过渡态（flex-client pendingResize 进行中）。
  const [resizing, setResizing] = useState(false);
  // ADR-0011 兜底：resize 进行中启动安全超时，server 未回确认时强制结束过渡，防止占位卡死。
  const resizeSafetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fullscreenSessionId = useSessionManager((s) => s.fullscreenSessionId);
  const getSession = useSessionManager((s) => s.getSession);
  const getPaneApp = useSessionManager((s) => s.getPaneApp);
  const fullscreenToPane = useSessionManager((s) => s.fullscreenToPane);
  const closeApp = useSessionManager((s) => s.closeApp);

  const session = fullscreenSessionId ? getSession(fullscreenSessionId) : null;
  const app = useSessionManager((s) =>
    s.fullscreenSessionId ? s.apps.find((a) => a.sessionId === s.fullscreenSessionId) : undefined
  );

  // 订阅 session isRunning 状态，start 完成后触发 re-render
  const sessionIsRunning = useSessionManager((s) => {
    if (!fullscreenSessionId) return false;
    const managed = s.sessions[fullscreenSessionId];
    return managed?.state.isRunning ?? false;
  });

  // 同步 flexClientRef（render 时执行，拿到最新值）
  flexClientRef.current = session?.flexClientInstance ?? null;

  // 订阅 session 的 videoWidth：首帧未到达时为 0（启动过渡中），>0 表示有效帧已渲染。
  const videoWidth = useSessionManager((s) => {
    if (!fullscreenSessionId) return 0;
    const managed = s.sessions[fullscreenSessionId];
    return managed?.state.videoWidth ?? 0;
  });

  // ADR-0011：订阅 flex-client 的 resize 进行中回调，驱动尺寸变化过渡占位。
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

  // flexClient 新可用时，立即用缓存尺寸触发一次 resize
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

  // 1. Canvas Reparenting
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !session?.canvas) return;

    if (session.canvas.parentElement !== container) {
      container.appendChild(session.canvas);
    }
  }, [session, fullscreenSessionId, sessionIsRunning]);

  // 2. ResizeObserver —— 全屏覆盖层也需要动态调整虚拟屏尺寸
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
  }, [fullscreenSessionId, session, sessionIsRunning, resizeScale]);

  // 触控输入：为 reparent 进来的原生 canvas 绑定指针事件（全屏模式缺省无触控层）
  // 必须在 early return 之前调用，遵守 React Rules of Hooks——
  // 否则 session 就绪前后两次 render 的 hook 数量不一致，会令整棵
  // FullscreenOverlay 子树崩溃（"Rendered more hooks than during the previous render"）。
  const handlePointer = useCanvasPointerInput(session);

  if (!fullscreenSessionId || !session || !app) {
    return null;
  }

  const leftApp = getPaneApp('left');
  const rightApp = getPaneApp('right');

  return (
    <div className="absolute inset-0 bg-black z-10 rounded-lg overflow-hidden">
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

      {/* 顶部下拉菜单 */}
      <FullscreenDropdown
        app={app}
        leftApp={leftApp}
        rightApp={rightApp}
        onSplitToPane={(pane) => {
          void fullscreenToPane(pane);
        }}
        onClose={() => {
          void closeApp(fullscreenSessionId);
        }}
      />
    </div>
  );
}
