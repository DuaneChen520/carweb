import { useCallback } from 'react';
import { AndroidMotionEventAction } from '@yume-chan/scrcpy';
import type { ScrcpySession } from '@/lib/scrcpy-session';

/**
 * useCanvasPointerInput —— 分屏/全屏桌面视图的触控输入 hook。
 *
 * 背景：SplitPane / FullscreenOverlay 通过 `appendChild` 把 session.canvas
 * （一个由 ScrcpySession 以原生 DOM 创建的 canvas）直接挂进容器 div。
 * 该 canvas 不是 React 渲染的节点，因此从未绑定任何指针事件处理器，
 * 导致桌面分屏 / 全屏模式下触控完全失效（独立镜像模式的 VirtualScreen
 * 因 canvas 由 React 渲染并自带 onPointer* 处理器，故正常）。
 *
 * 本 hook 返回一个可直接挂在「canvas 容器 div」上的指针事件处理器：
 * - 通过事件冒泡捕获 reparent 进来的原生 canvas 的 pointer 事件
 *   （React 17+ 的事件委托机制保证冒泡到容器 div 的 handler 会触发）；
 * - 将客户端坐标按 canvas 显示尺寸映射到视频帧像素坐标；
 * - 路由到「当前 pane 所属 session」自己的 controller 注入，避免误触其他会话。
 *
 * 注意：canvas.width / canvas.height 即为视频帧像素尺寸（scrcpy-session.ts
 * 中 setupVideoStream 写入），可直接作为 injectTouch 的目标坐标空间。
 */
export function useCanvasPointerInput(session: ScrcpySession | null) {
  const handlePointerEvent = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 阻止默认行为（文本选择、触控滚动等）
      e.preventDefault();
      if (!session) return;

      const canvas = session.canvas;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // 客户端坐标 → canvas 相对比例 → 视频帧像素坐标
      const relativeX = (e.clientX - rect.left) / rect.width;
      const relativeY = (e.clientY - rect.top) / rect.height;
      const pointerX = Math.max(0, Math.min(1, relativeX)) * canvas.width;
      const pointerY = Math.max(0, Math.min(1, relativeY)) * canvas.height;

      let action: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
      switch (e.type) {
        case 'pointerdown':
          action = AndroidMotionEventAction.Down;
          // 捕获指针，保证拖拽过程中 move/up 持续送达本容器
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* 某些环境不支持捕获，忽略 */
          }
          break;
        case 'pointermove':
          action = e.buttons > 0 ? AndroidMotionEventAction.Move : AndroidMotionEventAction.HoverMove;
          break;
        case 'pointerup':
          action = AndroidMotionEventAction.Up;
          break;
        case 'pointercancel':
          action = AndroidMotionEventAction.Cancel;
          break;
        default:
          return;
      }

      // 鼠标统一用 -1，触控/笔使用系统分配的稳定 pointerId
      const pointerId = e.pointerType === 'mouse' ? -1n : BigInt(e.pointerId);
      const pressure = e.pressure !== undefined && e.pressure > 0 ? e.pressure : e.buttons > 0 ? 1 : 0;
      const buttons = e.buttons;
      const actionButton = e.button === 0 ? 1 : e.button === 2 ? 2 : 0;

      void session.injectTouch({
        action,
        pointerId,
        pointerX,
        pointerY,
        videoWidth: canvas.width,
        videoHeight: canvas.height,
        pressure,
        actionButton,
        buttons,
      });
    },
    [session],
  );

  return handlePointerEvent;
}
