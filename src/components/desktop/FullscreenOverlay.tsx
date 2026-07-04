/**
 * FullscreenOverlay —— 全屏覆盖层组件。
 *
 * 设计文档 §2.4 / §3.1 / §12.3：
 * - 覆盖侧边栏右侧的 DesktopArea，不遮住侧边栏
 * - 承载 fullscreenSessionId 对应 session 的 canvas
 * - 顶部 FullscreenDropdown
 *
 * 核心机制（§3.1 关键原则）：session 不重启，只换渲染目标 canvas。
 * 分屏 ↔ 全屏转换时，通过 ScrcpySession.reparentCanvas() 移动 DOM 父节点，
 * WebGL context 保持不变，音频画面连续不断。
 *
 * 实现要点：
 * 1. overlay 容器 ref 通过 useEffect 监听 fullscreenSessionId 变化
 * 2. 当 fullscreenSessionId 存在时，调用 session.reparentCanvas(overlayContainer)
 * 3. canvas 从 SplitPane 容器移动到 FullscreenOverlay 容器，WebGL context 不变
 * 4. 退出全屏时，SessionManager.fullscreenToPane/fullscreenToDesktop 会更新状态，
 *    SplitPane 的 useEffect 会自动把 canvas reparent 回 pane 容器
 */

import { useEffect, useRef } from 'react';
import { useSessionManager } from '@/lib/session-manager';
import { FullscreenDropdown } from './FullscreenDropdown';
import type { DisplayConfig } from '@/lib/scrcpy-session';

interface FullscreenOverlayProps {
  /** 显示配置（用于 fullscreenToPane 时的 displayConfig，可选） */
  displayConfig?: DisplayConfig;
}

export function FullscreenOverlay({ displayConfig }: FullscreenOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fullscreenSessionId = useSessionManager((s) => s.fullscreenSessionId);
  const getSession = useSessionManager((s) => s.getSession);
  const getPaneApp = useSessionManager((s) => s.getPaneApp);
  const fullscreenToPane = useSessionManager((s) => s.fullscreenToPane);
  const closeApp = useSessionManager((s) => s.closeApp);

  const session = fullscreenSessionId ? getSession(fullscreenSessionId) : null;
  const app = useSessionManager((s) =>
    s.fullscreenSessionId ? s.apps.find((a) => a.sessionId === s.fullscreenSessionId) : undefined
  );

  // Canvas Reparenting：当 fullscreenSessionId 变化时，将 canvas 移到 overlay 容器
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !session?.canvas) return;

    // 将 session 的 canvas reparent 到 overlay 容器
    // WebGL context 保持不变（Task 6 核心机制）
    if (session.canvas.parentElement !== container) {
      container.appendChild(session.canvas);
    }
  }, [session, fullscreenSessionId]);

  // 清理：overlay 卸载时无需显式移除 canvas，
  // SplitPane 的 useEffect 会在 fullscreenSessionId 变 null 时自动 reparent 回去

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
