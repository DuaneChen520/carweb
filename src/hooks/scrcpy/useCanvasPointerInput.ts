import { useCallback, useEffect, useRef } from 'react';
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
 *
 * S1-P0-3（车机触控优化）：
 * - 触屏（pointerType !== 'mouse'）未按下时忽略 pointermove，不再发送 HoverMove
 *   —— 触屏悬停移动频率极高，会与真实 down/move/up 竞争控制 socket 带宽；
 * - pointermove 按 requestAnimationFrame 节流：同一帧只发送最后一次坐标，
 *   降低控制 socket 写队列拥塞（写失败 → ControllerHealth DEGRADED 的风险源）。
 */
export function useCanvasPointerInput(session: ScrcpySession | null) {
  // rAF 节流状态：待发送的最后一个 move 事件 + 进行中的 rAF 句柄
  const pendingMoveRef = useRef<React.PointerEvent<HTMLDivElement> | null>(null);
  const rafRef = useRef<number | null>(null);
  // 诊断（S2-P0-8）：每 session 首次 pointerdown 记一次到达日志，之后只记异常，
  // 用于区分「事件未达」vs「canvas 未挂载」vs「controller 异常」三种触控失效路径。
  const touchLoggedRef = useRef<string | null>(null);

  const sendPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!session) return;

      const canvas = session.canvas;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        // canvas 未挂到容器 / 不可见：触控静默丢弃（画面可能是 AppTransitionPlaceholder 占位层）。
        if (e.type === 'pointerdown') {
          console.warn(
            `[DEBUG-touch:${session.id}] pointerdown 丢弃: canvas 不可见 ` +
            `(rect=${rect.width}x${rect.height}, parent=${canvas.parentElement?.tagName ?? 'none'})`,
          );
        }
        return;
      }

      if (e.type === 'pointerdown' && touchLoggedRef.current !== session.id) {
        touchLoggedRef.current = session.id;
        console.log(
          `[DEBUG-touch:${session.id}] pointerdown 到达: canvas=${canvas.width}x${canvas.height}, rect=${Math.round(rect.width)}x${Math.round(rect.height)}`,
        );
      }

      // S2-P0-9 根因修复：注入坐标空间必须用「server 上报的视频尺寸」
      // （session.currentState.videoWidth/Height，来自 sizeChanged 回调，与 server 端
      // PositionMapper.videoSize 同源），**不能**用 canvas.width/height——canvas 可能被
      // flex-client 写成与视频尺寸不一致的值（实测 canvas=1520x1728 vs 视频 1512x1716），
      // 尺寸不匹配时 scrcpy server 的 PositionMapper.map() 返回 null → 触控静默忽略
      // （无任何日志，正是"触控失效但控制台干净"的根因）。
      const videoW = session.currentState.videoWidth;
      const videoH = session.currentState.videoHeight;
      if (videoW === 0 || videoH === 0) {
        // 视频尺寸未知（首帧未到 / start 未完成）：无可注入的目标空间
        return;
      }

      // 客户端坐标 → canvas 相对比例 → 视频帧像素坐标（以 server 视频尺寸为空间）
      const relativeX = (e.clientX - rect.left) / rect.width;
      const relativeY = (e.clientY - rect.top) / rect.height;
      const pointerX = Math.max(0, Math.min(1, relativeX)) * videoW;
      const pointerY = Math.max(0, Math.min(1, relativeY)) * videoH;

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
        videoWidth: videoW,
        videoHeight: videoH,
        pressure,
        actionButton,
        buttons,
      });
    },
    [session],
  );

  const handlePointerEvent = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 阻止默认行为（文本选择、触控滚动等）
      e.preventDefault();
      if (!session) return;

      // 诊断（S2-P0-9）：handler 入口无条件日志——区分「事件未达 handler」
      // （无本日志 = UI 层问题：overlay 未渲染/事件被拦截）vs「到达但被丢弃」。
      if (e.type === 'pointerdown') {
        const canvas = session.canvas;
        console.log(
          `[DEBUG-touch2:${session.id}] pointerdown 到达 handler ` +
          `(canvas=${canvas ? 'yes' : 'no'}, rect=${canvas ? `${Math.round(canvas.getBoundingClientRect().width)}x${Math.round(canvas.getBoundingClientRect().height)}` : '-'})`,
        );
      }

      // S1-P0-3：触屏未按下（buttons===0）时抑制 HoverMove，
      // 仅保留鼠标悬停语义（pointerType === 'mouse'）
      if (e.type === 'pointermove' && e.buttons === 0 && e.pointerType !== 'mouse') return;

      // move 按 rAF 节流：同一帧只发最后一次坐标
      if (e.type === 'pointermove') {
        pendingMoveRef.current = e;
        if (rafRef.current == null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            const ev = pendingMoveRef.current;
            pendingMoveRef.current = null;
            if (ev) sendPointer(ev);
          });
        }
        return;
      }

      // down/up/cancel：冲刷掉未发送的 pending move，保证事件顺序（不发出 up 之后的 move）
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingMoveRef.current = null;
      sendPointer(e);
    },
    [session, sendPointer],
  );

  // 组件卸载时取消未执行的 rAF
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return handlePointerEvent;
}
